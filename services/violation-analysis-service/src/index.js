import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import multer from 'multer';
import dotenv from 'dotenv';

import { query, initDB, insertCaseImages, getCaseImages, getCaseImageBytes, auditLog, getAuditLog, getAuditLogByUser, findSimilarCases } from './db.js';
import { connectRabbitMQ, publishCaseCreated, publishCaseReported, publishCaseResolved } from './rabbitmq.js';
import { analyseImage, analyseMultipleImages } from './gemini.js';
import { validateImageQuality } from './imageValidator.js';
import { startCleanupJob } from './cleanup.js';
import { runCaseCreationSaga } from './saga/caseCreationSaga.js';
import { getSaga } from './saga/coordinator.js';
import { startSagaListener } from './saga/listeners.js';

dotenv.config();

// ─── Configuration ────────────────────────────────────────────────────────────

const app  = express();
const PORT = Number(process.env.PORT || 3002);

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_IMAGE_BYTES    = 5 * 1024 * 1024;  // 5 MB per image
const MAX_IMAGES         = 5;                 // max images per report

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
app.use(express.json({ limit: '50mb' }));
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
 *   1. multipart/form-data with fields: images (up to 5 files), userId, email
 *      — also supports single "image" field for backward compatibility
 *   2. JSON body with fields: images [{ image, mimeType }], userId
 *      — also supports single image via { image, mimeType, userId }
 *
 * Before calling Gemini, each image is validated for quality (resolution,
 * brightness, sharpness). Rejected images return 422 with an explanation.
 *
 * Multiple images are sent to Gemini together for a combined analysis,
 * giving higher confidence through additional evidence (FR8).
 */
app.post('/violations/analyze', upload.array('images', MAX_IMAGES), async (req, res) => {
  try {
    let imageEntries = []; // { buffer, base64, mimeType }
    let userId;
    let userEmail;       // forwarded to the notification service via the case events
    let licensePlate;    // optional — captured from the upload form
    let latitude;        // optional — from map pin drop
    let longitude;
    let locationLabel;   // optional — human-readable address from reverse-geocode

    const extractMeta = (body) => {
      userId       = body.userId;
      userEmail    = body.email;
      licensePlate = typeof body.licensePlate === 'string' ? body.licensePlate.trim().toUpperCase() || null : null;
      latitude     = body.latitude  ? parseFloat(body.latitude)  : null;
      longitude    = body.longitude ? parseFloat(body.longitude) : null;
      locationLabel = typeof body.locationLabel === 'string' ? body.locationLabel.trim() || null : null;
    };

    if (req.files && req.files.length > 0) {
      // ── Multipart upload (multiple files) ────────────────────────────────
      extractMeta(req.body);
      imageEntries = req.files.map((f) => ({
        buffer:   f.buffer,
        base64:   f.buffer.toString('base64'),
        mimeType: f.mimetype,
      }));
    } else if (req.file) {
      // ── Multipart upload (single file — backward compat) ────────────────
      extractMeta(req.body);
      imageEntries = [{
        buffer:   req.file.buffer,
        base64:   req.file.buffer.toString('base64'),
        mimeType: req.file.mimetype,
      }];
    } else if (req.body.images && Array.isArray(req.body.images)) {
      // ── JSON body (multiple images) ──────────────────────────────────────
      extractMeta(req.body);
      imageEntries = req.body.images.map((img) => ({
        buffer:   Buffer.from(img.image, 'base64'),
        base64:   img.image,
        mimeType: img.mimeType,
      }));
    } else if (req.body.image) {
      // ── JSON body (single image — backward compat) ──────────────────────
      extractMeta(req.body);
      imageEntries = [{
        buffer:   Buffer.from(req.body.image, 'base64'),
        base64:   req.body.image,
        mimeType: req.body.mimeType,
      }];
    }

    // ── Input validation ────────────────────────────────────────────────────
    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ error: 'userId is required.' });
    }
    if (imageEntries.length === 0) {
      return res.status(400).json({ error: 'At least one image is required.' });
    }
    if (imageEntries.length > MAX_IMAGES) {
      return res.status(400).json({ error: `Maximum ${MAX_IMAGES} images per report.` });
    }

    // Validate each image
    const imageDetails = [];
    for (let i = 0; i < imageEntries.length; i++) {
      const img = imageEntries[i];

      if (!img.mimeType || !ALLOWED_MIME_TYPES.has(img.mimeType)) {
        return res.status(400).json({
          error:    `Image ${i + 1}: invalid or missing mimeType.`,
          accepted: [...ALLOWED_MIME_TYPES],
        });
      }

      const approxBytes = Math.ceil((img.base64.length * 3) / 4);
      if (approxBytes > MAX_IMAGE_BYTES) {
        return res.status(413).json({
          error: `Image ${i + 1} exceeds the 5 MB limit (received ~${(approxBytes / 1024 / 1024).toFixed(2)} MB).`,
        });
      }

      // ── Image quality pre-filter ──────────────────────────────────────
      const qualityCheck = await validateImageQuality(img.buffer);
      if (!qualityCheck.valid) {
        await auditLog({
          eventType: 'ImageQualityRejected',
          userId,
          payload: { imageIndex: i, reason: qualityCheck.reason },
        });
        return res.status(422).json({
          error:      `Image ${i + 1}: quality check failed.`,
          reason:     qualityCheck.reason,
          imageIndex: i,
          suggestion: 'Please take a new photo ensuring the scene is well-lit, in focus, and clearly shows the vehicle.',
        });
      }

      imageDetails.push({
        buffer:     img.buffer,
        base64:     img.base64,
        mimeType:   img.mimeType,
        sizeBytes:  approxBytes,
        qualityStats: qualityCheck.stats,
      });
    }

    console.log(`[analyze] ${imageDetails.length} image(s) passed quality check`);

    // ── Saga-orchestrated case creation ─────────────────────────────────────
    //
    // The previous version of this handler ran each step (Gemini, INSERT case,
    // INSERT case_images, audit log, publish event) inline with no
    // compensation: a failure halfway through left orphaned rows. The saga
    // coordinator persists state at every transition and runs compensations
    // in reverse order on failure. See src/saga/caseCreationSaga.js for the
    // step definitions and src/saga/coordinator.js for the engine.

    let sagaResult;
    try {
      sagaResult = await runCaseCreationSaga({
        analyser: { analyseImage, analyseMultipleImages },
        context: {
          userId,
          userEmail,
          licensePlate,
          latitude,
          longitude,
          locationLabel,
          imageDetails,
        },
      });
    } catch (err) {
      // The coordinator already ran compensations and recorded the
      // outcome in the sagas table. Surface the saga id so the response
      // is debuggable (audit_log + sagas table together explain exactly
      // which step failed and what was rolled back).
      console.error(`[analyze] Saga failed (sagaId=${err.sagaId}):`, err.message);
      return res.status(502).json({
        error:       'Failed to create violation case. The operation was rolled back.',
        sagaId:      err.sagaId,
        failedStep:  err.failedStep,
        compensated: err.compensated,
      });
    }

    const { savedCase, analysis } = sagaResult;

    return res.status(201).json({
      caseId:     savedCase.id,
      userId:     savedCase.user_id,
      status:     savedCase.status,
      imageCount: savedCase.image_count,
      analysis,
      createdAt:  savedCase.created_at,
      sagaId:     sagaResult.sagaId,
    });
  } catch (err) {
    console.error('[analyze]', err.message);
    return res.status(500).json({ error: 'Analysis failed. Please try again.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * GET /violations/cases
 * Returns cases with filtering, sorting and pagination.
 *
 * Query params:
 *   - userId  (optional): filter by user
 *   - status  (optional): filter by status (completed, reported_to_authority, resolved, cancelled)
 *   - from    (optional): ISO-8601 date — cases created after this
 *   - to      (optional): ISO-8601 date — cases created before this
 *   - limit   (optional): max results (default 50, max 200)
 *   - offset  (optional): pagination offset (default 0)
 */
app.get('/violations/cases', async (req, res) => {
  try {
    const { userId, status, from, to, limit = '50', offset = '0' } = req.query;
    const maxLimit = Math.min(Number(limit) || 50, 200);
    const skip     = Math.max(Number(offset) || 0, 0);

    const conditions = [];
    const params     = [];
    let paramIndex   = 1;

    if (userId) {
      conditions.push(`user_id = $${paramIndex++}`);
      params.push(userId);
    }
    if (status) {
      conditions.push(`status = $${paramIndex++}`);
      params.push(status);
    }
    if (from) {
      conditions.push(`created_at >= $${paramIndex++}`);
      params.push(from);
    }
    if (to) {
      conditions.push(`created_at <= $${paramIndex++}`);
      params.push(to);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get total count for pagination metadata
    const countResult = await query(`SELECT COUNT(*) as total FROM cases ${where}`, params);
    const total = Number(countResult.rows[0].total);

    // Get paginated results
    const result = await query(
      `SELECT * FROM cases ${where} ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      [...params, maxLimit, skip]
    );

    return res.status(200).json({
      cases:  result.rows,
      count:  result.rowCount,
      total,
      limit:  maxLimit,
      offset: skip,
    });
  } catch (err) {
    console.error('[cases]', err.message);
    return res.status(500).json({ error: 'Failed to retrieve cases.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * GET /violations/stats/:userId
 * Returns summary statistics for a user's cases.
 * Powers the user dashboard without loading all case data.
 */
app.get('/violations/stats/:userId', async (req, res) => {
  try {
    const result = await query(
      `SELECT
         COUNT(*)                                              AS total_cases,
         COUNT(*) FILTER (WHERE violation_confirmed = true)    AS violations_confirmed,
         COUNT(*) FILTER (WHERE violation_confirmed = false)   AS violations_not_confirmed,
         COUNT(*) FILTER (WHERE status = 'completed')          AS status_completed,
         COUNT(*) FILTER (WHERE status = 'reported_to_authority') AS status_reported,
         COUNT(*) FILTER (WHERE status = 'resolved')           AS status_resolved,
         COUNT(*) FILTER (WHERE status = 'cancelled')          AS status_cancelled,
         ROUND(AVG(confidence)::numeric, 4)                    AS avg_confidence
       FROM cases
       WHERE user_id = $1`,
      [req.params.userId]
    );

    return res.status(200).json({
      userId: req.params.userId,
      ...result.rows[0],
    });
  } catch (err) {
    console.error('[stats]', err.message);
    return res.status(500).json({ error: 'Failed to retrieve stats.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * GET /violations/:id/images/:index
 * Stream the raw bytes of a single image attached to a case.
 *
 * MUST be declared before the generic `/violations/:id` route below,
 * otherwise Express's first-match rule swallows it as a case id.
 *
 * Ownership is enforced via the X-User-Id header passed by the gateway —
 * admins (X-User-Role: admin) bypass the check.
 */
app.get('/violations/:id/images/:index', async (req, res) => {
  try {
    const caseId = req.params.id;
    const index  = Number(req.params.index);
    if (!Number.isInteger(index) || index < 0) {
      return res.status(400).json({ error: 'Invalid image index.' });
    }

    const caseRow = await query('SELECT user_id FROM cases WHERE id = $1', [caseId]);
    if (caseRow.rows.length === 0) {
      return res.status(404).json({ error: 'Case not found.' });
    }

    const requestingUser = req.headers['x-user-id'];
    const requestingRole = req.headers['x-user-role'];
    if (requestingUser && requestingRole !== 'admin' && caseRow.rows[0].user_id !== requestingUser) {
      return res.status(403).json({ error: 'You do not have access to this case.' });
    }

    const row = await getCaseImageBytes(caseId, index);
    if (!row || !row.image_data) {
      return res.status(404).json({ error: 'Image not found.' });
    }

    res.setHeader('Content-Type', row.image_mime_type || 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return res.status(200).send(row.image_data);
  } catch (err) {
    console.error('[violations/:id/images/:index]', err.message);
    return res.status(500).json({ error: 'Failed to retrieve image.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * GET /violations/:id
 * Returns a single case by UUID, including its images.
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
    const requestingRole = req.headers['x-user-role'];
    if (requestingUser && requestingRole !== 'admin' && caseRow.user_id !== requestingUser) {
      return res.status(403).json({ error: 'You do not have access to this case.' });
    }

    // Include image records
    const images = await getCaseImages(caseRow.id);

    return res.status(200).json({ ...caseRow, images });
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
      'SELECT id, user_id, status, image_count, created_at, completed_at, cancelled_at, reported_at, resolved_at FROM cases WHERE id = $1',
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Case not found.' });
    }

    const caseRow = result.rows[0];

    const requestingUser = req.headers['x-user-id'];
    const requestingRole = req.headers['x-user-role'];
    if (requestingUser && requestingRole !== 'admin' && caseRow.user_id !== requestingUser) {
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
    const requestingRole = req.headers['x-user-role'];
    if (requestingUser && requestingRole !== 'admin' && caseRow.user_id !== requestingUser) {
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

    // ── Audit log ────────────────────────────────────────────────────────────
    await auditLog({
      eventType: 'CaseReported',
      caseId:    updatedCase.id,
      userId:    updatedCase.user_id,
      payload: {
        violationType: updatedCase.violation_type,
        reportedAt:    updatedCase.reported_at,
      },
    });

    // Publish event — notification service sends SMS/email to the user
    publishCaseReported({
      id:                 updatedCase.id,
      userId:             updatedCase.user_id,
      violationConfirmed: updatedCase.violation_confirmed,
      violationType:      updatedCase.violation_type,
      confidence:         updatedCase.confidence,
      explanation:        updatedCase.explanation,
      licensePlate:       updatedCase.license_plate,
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

    // ── Audit log ────────────────────────────────────────────────────────────
    await auditLog({
      eventType: 'CaseResolved',
      caseId:    updatedCase.id,
      userId:    updatedCase.user_id,
      payload: {
        violationType: updatedCase.violation_type,
        resolvedAt:    updatedCase.resolved_at,
      },
    });

    publishCaseResolved({
      id:                 updatedCase.id,
      userId:             updatedCase.user_id,
      violationConfirmed: updatedCase.violation_confirmed,
      violationType:      updatedCase.violation_type,
      licensePlate:       updatedCase.license_plate,
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
    const requestingRole = req.headers['x-user-role'];
    if (requestingUser && requestingRole !== 'admin' && caseRow.user_id !== requestingUser) {
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

    await auditLog({
      eventType: 'CaseCancelled',
      caseId:    req.params.id,
      userId:    caseRow.user_id,
      payload:   { previousStatus: caseRow.status },
    });

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

// ─── Audit Log Endpoints ─────────────────────────────────────────────────────

/**
 * GET /violations/:id/audit
 * Returns the full audit trail for a case, oldest first.
 * Supports NFR6 — legal accountability and tamper-proof history.
 */
app.get('/violations/:id/audit', async (req, res) => {
  try {
    const result = await query('SELECT * FROM cases WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Case not found.' });
    }

    const requestingUser = req.headers['x-user-id'];
    const requestingRole = req.headers['x-user-role'];
    if (requestingUser && requestingRole !== 'admin' && result.rows[0].user_id !== requestingUser) {
      return res.status(403).json({ error: 'You do not have access to this case.' });
    }

    const events = await getAuditLog(req.params.id);
    return res.status(200).json({ caseId: req.params.id, events, count: events.length });
  } catch (err) {
    console.error('[audit]', err.message);
    return res.status(500).json({ error: 'Failed to retrieve audit log.' });
  }
});

/**
 * GET /violations/:id/similar?limit=5
 *
 * Returns the cases most semantically similar to the given case, using
 * pgvector cosine distance over the AI-verdict embedding stored on
 * each row. The source case is excluded from results.
 *
 * The `distance` value is the raw cosine distance from pgvector
 * (0 = identical, 2 = opposite). The frontend converts it to a
 * 0–100 similarity score for display.
 */
app.get('/violations/:id/similar', async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 5, 1), 25);

    // Confirm the case exists and the caller is allowed to see it. We
    // use the same ownership rules as the case-detail route — citizens
    // can only query similars for their own case; admins can query any.
    const result = await query('SELECT id, user_id, embedding FROM cases WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Case not found.' });
    }
    const caseRow        = result.rows[0];
    const requestingUser = req.headers['x-user-id'];
    const requestingRole = req.headers['x-user-role'];
    if (requestingUser && requestingRole !== 'admin' && caseRow.user_id !== requestingUser) {
      return res.status(403).json({ error: 'You do not have access to this case.' });
    }

    // The case may not have an embedding yet (e.g. created before the
    // embedding column existed, or analysis returned no usable text).
    // Surface that explicitly so the frontend can show "no comparable
    // cases yet" rather than a misleading empty list.
    if (!caseRow.embedding) {
      return res.status(200).json({
        caseId:    req.params.id,
        results:   [],
        embedded:  false,
        reason:    'This case has no embedding — semantic similarity not available.',
      });
    }

    const results = await findSimilarCases(req.params.id, limit);
    return res.status(200).json({
      caseId:   req.params.id,
      results,
      embedded: true,
      count:    results.length,
    });
  } catch (err) {
    console.error('[violations/:id/similar]', err.message);
    return res.status(500).json({ error: 'Failed to fetch similar cases.' });
  }
});

/**
 * GET /sagas/:id
 * Inspect the full state of a saga — current status, the per-step
 * history (start / succeed / fail / compensate), and any external events
 * that arrived later (e.g. notification.failed). Surfaced primarily as
 * dissertation evidence; also useful for debugging in development.
 */
app.get('/sagas/:id', async (req, res) => {
  try {
    const saga = await getSaga(req.params.id);
    if (!saga) return res.status(404).json({ error: 'Saga not found.' });
    return res.status(200).json(saga);
  } catch (err) {
    console.error('[sagas/:id]', err.message);
    return res.status(500).json({ error: 'Failed to fetch saga.' });
  }
});

/**
 * GET /violations/audit/user/:userId
 * Returns all audit events for a specific user.
 */
app.get('/violations/audit/user/:userId', async (req, res) => {
  try {
    const limit  = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const events = await getAuditLogByUser(req.params.userId, limit, offset);
    return res.status(200).json({ userId: req.params.userId, events, count: events.length });
  } catch (err) {
    console.error('[audit/user]', err.message);
    return res.status(500).json({ error: 'Failed to retrieve audit log.' });
  }
});

// ─── Multer Error Handler ────────────────────────────────────────────────────

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'Image too large. Maximum size is 5 MB per image.' });
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({ error: `Maximum ${MAX_IMAGES} images per report.` });
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

  // Start the auto-cleanup job for stale pending cases (FR7)
  startCleanupJob();

  // RabbitMQ connection is non-blocking — service starts even if broker is down.
  // The saga listener is started after the channel is up so it can subscribe
  // to notification.failed events; if RabbitMQ never connects, distributed
  // compensation is logged-and-skipped (the in-process saga still works).
  connectRabbitMQ()
    .then(() => startSagaListener().catch((err) =>
      console.warn('[saga] Listener failed to start:', err.message)
    ))
    .catch((err) => console.warn('[RabbitMQ] Background connect failed:', err.message));

  app.listen(PORT, () => {
    console.log(`[violation-analysis-service] Listening on port ${PORT}`);
  });
};

start().catch((err) => {
  console.error('[violation-analysis-service] Failed to start:', err.message);
  process.exit(1);
});
