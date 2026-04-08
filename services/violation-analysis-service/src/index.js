import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import multer from 'multer';
import dotenv from 'dotenv';

import { query, initDB }        from './db.js';
import { connectRabbitMQ, publishCaseCreated, publishCaseReported, publishCaseResolved } from './rabbitmq.js';
import { analyseImage }         from './gemini.js';
import { validateImageQuality } from './imageValidator.js';

dotenv.config();

// ─── Configuration ────────────────────────────────────────────────────────────

const app  = express();
const PORT = Number(process.env.PORT || 3002);

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_IMAGE_BYTES    = 5 * 1024 * 1024; // 5 MB

// Multer: keep images in memory for base64 conversion before sending to Gemini
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid image type: ${file.mimetype}. Accepted: ${[...ALLOWED_MIME_TYPES].join(', ')}`));
    }
  },
});

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(morgan('dev'));

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /health
 */
app.get('/health', (_req, res) => {
  res.status(200).json({
    service:   'violation-analysis-service',
    status:    'ok',
    timestamp: new Date().toISOString(),
  });
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * POST /violations/analyze
 *
 * Accepts EITHER:
 *   1. multipart/form-data with fields: image (file), userId, email
 *      (this is what the API Gateway sends)
 *   2. JSON body with fields: image (base64 string), mimeType, userId
 *      (useful for direct testing)
 *
 * Before calling Gemini, the image is validated for quality (resolution,
 * brightness, sharpness). Rejected images return 422 with an explanation.
 */
app.post('/violations/analyze', upload.single('image'), async (req, res) => {
  try {
    let base64Data, mimeType, userId, imageBuffer;

    if (req.file) {
      // ── Multipart upload (from API Gateway) ──────────────────────────────
      imageBuffer = req.file.buffer;
      base64Data  = imageBuffer.toString('base64');
      mimeType    = req.file.mimetype;
      userId      = req.body.userId;
    } else {
      // ── JSON body (direct / testing) ─────────────────────────────────────
      base64Data  = req.body.image;
      mimeType    = req.body.mimeType;
      userId      = req.body.userId;
      if (base64Data) {
        imageBuffer = Buffer.from(base64Data, 'base64');
      }
    }

    // ── Input validation ────────────────────────────────────────────────────
    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ error: 'userId is required.' });
    }
    if (!base64Data || typeof base64Data !== 'string') {
      return res.status(400).json({ error: 'Image is required.' });
    }
    if (!mimeType || !ALLOWED_MIME_TYPES.has(mimeType)) {
      return res.status(400).json({
        error:    'Invalid or missing mimeType.',
        accepted: [...ALLOWED_MIME_TYPES],
      });
    }

    // Approximate byte size from base64 length
    const approxBytes = Math.ceil((base64Data.length * 3) / 4);
    if (approxBytes > MAX_IMAGE_BYTES) {
      return res.status(413).json({
        error: `Image exceeds the 5 MB limit (received ~${(approxBytes / 1024 / 1024).toFixed(2)} MB).`,
      });
    }

    // ── Image quality pre-filter ────────────────────────────────────────────
    // Checks resolution, brightness, and sharpness before calling Gemini.
    // Saves API credits by rejecting unusable images early.
    const qualityCheck = await validateImageQuality(imageBuffer);

    if (!qualityCheck.valid) {
      return res.status(422).json({
        error:  'Image quality check failed.',
        reason: qualityCheck.reason,
        suggestion: 'Please take a new photo ensuring the scene is well-lit, in focus, and clearly shows the vehicle.',
      });
    }

    console.log('[analyze] Image quality OK:', qualityCheck.stats);

    // ── Gemini analysis ─────────────────────────────────────────────────────
    const analysis = await analyseImage(base64Data, mimeType);

    // ── Persist to database ─────────────────────────────────────────────────
    const result = await query(
      `INSERT INTO cases
         (user_id, status, violation_confirmed, violation_type, confidence, explanation, image_mime_type, image_size_bytes, completed_at)
       VALUES ($1, 'completed', $2, $3, $4, $5, $6, $7, NOW())
       RETURNING *`,
      [
        userId,
        analysis.violationConfirmed,
        analysis.violationType,
        analysis.confidence,
        analysis.explanation,
        mimeType,
        approxBytes,
      ]
    );
    const savedCase = result.rows[0];

    // ── Publish event ────────────────────────────────────────────────────────
    publishCaseCreated({
      id:                 savedCase.id,
      userId:             savedCase.user_id,
      violationConfirmed: savedCase.violation_confirmed,
      violationType:      savedCase.violation_type,
      confidence:         savedCase.confidence,
      explanation:        savedCase.explanation,
      createdAt:          savedCase.created_at,
    });

    return res.status(201).json({
      caseId:    savedCase.id,
      userId:    savedCase.user_id,
      status:    savedCase.status,
      analysis,
      imageQuality: qualityCheck.stats,
      createdAt: savedCase.created_at,
    });
  } catch (err) {
    console.error('[analyze]', err.message);
    return res.status(500).json({ error: 'Analysis failed. Please try again.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * GET /violations/cases
 * Returns all stored cases, newest first.
 */
app.get('/violations/cases', async (_req, res) => {
  try {
    const result = await query(
      'SELECT * FROM cases ORDER BY created_at DESC'
    );
    return res.status(200).json({ cases: result.rows, total: result.rowCount });
  } catch (err) {
    console.error('[cases]', err.message);
    return res.status(500).json({ error: 'Failed to retrieve cases.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * GET /violations/:id
 * Returns a single case by UUID.
 *
 * The API Gateway forwards X-User-Id to enforce ownership.
 * If the header is present, only the case owner can view it.
 */
app.get('/violations/:id', async (req, res) => {
  try {
    const result = await query('SELECT * FROM cases WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Case not found.' });
    }

    const caseRow = result.rows[0];

    // Ownership check — the gateway passes X-User-Id from the JWT
    const requestingUser = req.headers['x-user-id'];
    if (requestingUser && caseRow.user_id !== requestingUser) {
      return res.status(403).json({ error: 'You do not have access to this case.' });
    }

    return res.status(200).json(caseRow);
  } catch (err) {
    console.error('[violations/:id]', err.message);
    return res.status(500).json({ error: 'Failed to retrieve case.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * GET /violations/:id/status
 * Returns only the status-related fields for a case.
 *
 * Useful for polling from the client without fetching the full case.
 */
app.get('/violations/:id/status', async (req, res) => {
  try {
    const result = await query(
      'SELECT id, user_id, status, created_at, completed_at, cancelled_at, reported_at, resolved_at FROM cases WHERE id = $1',
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Case not found.' });
    }

    const caseRow = result.rows[0];

    const requestingUser = req.headers['x-user-id'];
    if (requestingUser && caseRow.user_id !== requestingUser) {
      return res.status(403).json({ error: 'You do not have access to this case.' });
    }

    return res.status(200).json(caseRow);
  } catch (err) {
    console.error('[violations/:id/status]', err.message);
    return res.status(500).json({ error: 'Failed to retrieve case status.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * PATCH /violations/:id/report
 * Mark a confirmed violation case as reported to authorities.
 *
 * Only cases with status "completed" and violation_confirmed = true can
 * be reported. Publishes a CaseReported event so the notification service
 * can alert the user that their report has been forwarded.
 */
app.patch('/violations/:id/report', async (req, res) => {
  try {
    const result = await query('SELECT * FROM cases WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Case not found.' });
    }

    const caseRow = result.rows[0];

    // Ownership check
    const requestingUser = req.headers['x-user-id'];
    if (requestingUser && caseRow.user_id !== requestingUser) {
      return res.status(403).json({ error: 'You do not have access to this case.' });
    }

    if (!caseRow.violation_confirmed) {
      return res.status(409).json({ error: 'Only confirmed violations can be reported to authorities.' });
    }

    if (caseRow.status === 'reported_to_authority') {
      return res.status(409).json({ error: 'Case has already been reported.' });
    }

    if (caseRow.status === 'resolved') {
      return res.status(409).json({ error: 'Case is already resolved.' });
    }

    if (caseRow.status !== 'completed') {
      return res.status(409).json({ error: `Case cannot be reported from status "${caseRow.status}".` });
    }

    const updated = await query(
      `UPDATE cases SET status = 'reported_to_authority', reported_at = NOW() WHERE id = $1 RETURNING *`,
      [req.params.id]
    );

    const updatedCase = updated.rows[0];

    // Publish event — notification service sends SMS/email to the user
    publishCaseReported({
      id:                 updatedCase.id,
      userId:             updatedCase.user_id,
      violationConfirmed: updatedCase.violation_confirmed,
      violationType:      updatedCase.violation_type,
      confidence:         updatedCase.confidence,
      explanation:        updatedCase.explanation,
      reportedAt:         updatedCase.reported_at,
    });

    return res.status(200).json({
      message: 'Case reported to authorities successfully.',
      caseId:  updatedCase.id,
      status:  updatedCase.status,
      reportedAt: updatedCase.reported_at,
    });
  } catch (err) {
    console.error('[violations/:id/report]', err.message);
    return res.status(500).json({ error: 'Failed to report case.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * PATCH /violations/:id/resolve
 * Mark a reported case as resolved.
 *
 * Only cases with status "reported_to_authority" can be resolved.
 * Publishes a CaseResolved event so the user is notified of the outcome.
 */
app.patch('/violations/:id/resolve', async (req, res) => {
  try {
    const result = await query('SELECT * FROM cases WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Case not found.' });
    }

    const caseRow = result.rows[0];

    if (caseRow.status !== 'reported_to_authority') {
      return res.status(409).json({ error: `Case cannot be resolved from status "${caseRow.status}". It must be reported first.` });
    }

    const updated = await query(
      `UPDATE cases SET status = 'resolved', resolved_at = NOW() WHERE id = $1 RETURNING *`,
      [req.params.id]
    );

    const updatedCase = updated.rows[0];

    publishCaseResolved({
      id:                 updatedCase.id,
      userId:             updatedCase.user_id,
      violationConfirmed: updatedCase.violation_confirmed,
      violationType:      updatedCase.violation_type,
      resolvedAt:         updatedCase.resolved_at,
    });

    return res.status(200).json({
      message: 'Case resolved successfully.',
      caseId:  updatedCase.id,
      status:  updatedCase.status,
      resolvedAt: updatedCase.resolved_at,
    });
  } catch (err) {
    console.error('[violations/:id/resolve]', err.message);
    return res.status(500).json({ error: 'Failed to resolve case.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * DELETE /violations/:id
 * Cancel a case — only allowed if the case has not yet been completed.
 *
 * Since analysis is currently synchronous (the POST waits for Gemini),
 * cases arrive as "completed" immediately. This endpoint is designed for
 * future support of asynchronous analysis where a case could be pending.
 * Already-completed cases cannot be cancelled — they can only be viewed.
 */
app.delete('/violations/:id', async (req, res) => {
  try {
    const result = await query('SELECT * FROM cases WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Case not found.' });
    }

    const caseRow = result.rows[0];

    // Ownership check
    const requestingUser = req.headers['x-user-id'];
    if (requestingUser && caseRow.user_id !== requestingUser) {
      return res.status(403).json({ error: 'You do not have access to this case.' });
    }

    if (caseRow.status === 'cancelled') {
      return res.status(409).json({ error: 'Case is already cancelled.' });
    }

    if (caseRow.status === 'completed') {
      return res.status(409).json({ error: 'Cannot cancel a completed case.' });
    }

    // Cancel the case
    await query(
      `UPDATE cases SET status = 'cancelled', cancelled_at = NOW() WHERE id = $1`,
      [req.params.id]
    );

    return res.status(200).json({
      message: 'Case cancelled successfully.',
      caseId:  req.params.id,
      status:  'cancelled',
    });
  } catch (err) {
    console.error('[violations/:id DELETE]', err.message);
    return res.status(500).json({ error: 'Failed to cancel case.' });
  }
});

// ─── Multer Error Handler ────────────────────────────────────────────────────

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'Image too large. Maximum size is 5 MB.' });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err.message?.includes('Invalid image type')) {
    return res.status(400).json({ error: err.message });
  }
  console.error('[violation-analysis-service] Unhandled error:', err.message);
  return res.status(500).json({ error: 'Internal server error.' });
});

// ─── Bootstrap ────────────────────────────────────────────────────────────────

const start = async () => {
  await initDB();

  // RabbitMQ connection is non-blocking — service starts even if broker is down
  connectRabbitMQ().catch((err) => {
    console.warn('[RabbitMQ] Background connect failed:', err.message);
  });

  app.listen(PORT, () => {
    console.log(`[violation-analysis-service] Listening on port ${PORT}`);
  });
};

start().catch((err) => {
  console.error('[violation-analysis-service] Failed to start:', err.message);
  process.exit(1);
});
