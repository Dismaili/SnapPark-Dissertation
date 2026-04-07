import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import axios from 'axios';
import multer from 'multer';
import FormData from 'form-data';
import dotenv from 'dotenv';

dotenv.config();

// ─── Configuration ────────────────────────────────────────────────────────────

const app  = express();
const PORT = Number(process.env.PORT || 3000);

const AUTH_SERVICE_URL      = process.env.AUTH_SERVICE_URL      || 'http://authentication-service:3001';
const VIOLATION_SERVICE_URL = process.env.VIOLATION_SERVICE_URL || 'http://violation-analysis-service:3002';

// Multer: keep uploaded images in memory so we can forward them to the
// Violation Analysis Service without writing to disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: Number(process.env.MAX_IMAGE_SIZE || 10 * 1024 * 1024), // 10 MB default
  },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid image type: ${file.mimetype}. Accepted: ${allowed.join(', ')}`));
    }
  },
});

// ─── Global Middleware ────────────────────────────────────────────────────────

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));

// Rate limiter – applies to every route
const windowMs   = Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000); // 15 min
const maxRequests = Number(process.env.RATE_LIMIT_MAX_REQUESTS || 100);
app.use(rateLimit({
  windowMs,
  max: maxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
}));

// ─── Authentication Middleware ────────────────────────────────────────────────
//
// Contacts the Authentication Service to verify the caller's JWT.
// On success the decoded payload (sub, email) is attached to req.user
// so downstream handlers know which user is making the request.
// On failure the request is rejected immediately — it never reaches any
// core microservice.  This matches the architectural diagram:
//
//   Client → API Gateway → Auth Service (verify) → ✅ route to service
//                                                 → ❌ reject with 401

const authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header.' });
  }

  try {
    const { data } = await axios.post(
      `${AUTH_SERVICE_URL}/auth/verify`,
      {},
      { headers: { Authorization: authHeader }, timeout: 5000 },
    );

    if (!data.valid) {
      return res.status(401).json({ error: 'Invalid or expired token.' });
    }

    // Attach user info for downstream services
    req.user = data.payload; // { sub, email, iat, exp }
    next();
  } catch (err) {
    // If the auth service itself returned 401 with details, pass them through
    if (err.response?.status === 401) {
      return res.status(401).json(err.response.data);
    }
    console.error('[gateway] Auth service error:', err.message);
    return res.status(503).json({ error: 'Authentication service unavailable.' });
  }
};

// ─── Helper: proxy a JSON request ─────────────────────────────────────────────

const proxyJSON = (serviceUrl) => async (req, res) => {
  try {
    const response = await axios({
      method: req.method,
      url: serviceUrl,
      data: req.body,
      timeout: 10000,
    });
    return res.status(response.status).json(response.data);
  } catch (err) {
    const status = err.response?.status || 502;
    const body   = err.response?.data   || { error: 'Downstream service unavailable.' };
    return res.status(status).json(body);
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
//  ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Health Check ─────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.status(200).json({
    service:   'api-gateway',
    status:    'ok',
    timestamp: new Date().toISOString(),
  });
});

// ─── Public Auth Routes (no token required) ──────────────────────────────────
// These are simple pass-through proxies to the Authentication Service.

app.post('/auth/register', proxyJSON(`${AUTH_SERVICE_URL}/auth/register`));
app.post('/auth/login',    proxyJSON(`${AUTH_SERVICE_URL}/auth/login`));
app.post('/auth/refresh',  proxyJSON(`${AUTH_SERVICE_URL}/auth/refresh`));

// ─── Protected Auth Routes ───────────────────────────────────────────────────

app.post('/auth/logout', authenticate, proxyJSON(`${AUTH_SERVICE_URL}/auth/logout`));

// ─── Protected Violation Routes ──────────────────────────────────────────────
//
// Every violation route goes through `authenticate` first.  If the token is
// invalid the request is rejected and never reaches the Violation Analysis
// Service.

/**
 * POST /violations/analyze
 *
 * The client uploads an image as multipart/form-data.
 * The gateway:
 *   1. Verifies the token (authenticate middleware)
 *   2. Validates the file (multer fileFilter)
 *   3. Forwards the image + user info to the Violation Analysis Service
 */
app.post('/violations/analyze', authenticate, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: 'Image file is required.',
        accepted: ['image/jpeg', 'image/png', 'image/webp'],
      });
    }

    // Build a new multipart form to forward the image to the Violation Service
    const form = new FormData();
    form.append('image', req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype,
    });

    // Attach the authenticated user's ID so the Violation Service knows
    // who submitted the report (without needing access to the Auth DB)
    form.append('userId', req.user.sub);
    form.append('email', req.user.email);

    const response = await axios.post(
      `${VIOLATION_SERVICE_URL}/violations/analyze`,
      form,
      {
        headers: form.getHeaders(),
        timeout: 30000, // longer timeout — Gemini API analysis may take time
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      },
    );

    return res.status(response.status).json(response.data);
  } catch (err) {
    const status = err.response?.status || 502;
    const body   = err.response?.data   || { error: 'Violation analysis service unavailable.' };
    return res.status(status).json(body);
  }
});

/**
 * GET /violations/:caseId
 * Retrieve the full details of a case.
 */
app.get('/violations/:caseId', authenticate, async (req, res) => {
  try {
    const response = await axios.get(
      `${VIOLATION_SERVICE_URL}/violations/${req.params.caseId}`,
      {
        headers: { 'X-User-Id': req.user.sub },
        timeout: 10000,
      },
    );
    return res.status(response.status).json(response.data);
  } catch (err) {
    const status = err.response?.status || 502;
    const body   = err.response?.data   || { error: 'Violation analysis service unavailable.' };
    return res.status(status).json(body);
  }
});

/**
 * GET /violations/:caseId/status
 * Check the current status of a case analysis.
 */
app.get('/violations/:caseId/status', authenticate, async (req, res) => {
  try {
    const response = await axios.get(
      `${VIOLATION_SERVICE_URL}/violations/${req.params.caseId}/status`,
      {
        headers: { 'X-User-Id': req.user.sub },
        timeout: 10000,
      },
    );
    return res.status(response.status).json(response.data);
  } catch (err) {
    const status = err.response?.status || 502;
    const body   = err.response?.data   || { error: 'Violation analysis service unavailable.' };
    return res.status(status).json(body);
  }
});

/**
 * DELETE /violations/:caseId
 * Cancel a case before analysis completes.
 */
app.delete('/violations/:caseId', authenticate, async (req, res) => {
  try {
    const response = await axios.delete(
      `${VIOLATION_SERVICE_URL}/violations/${req.params.caseId}`,
      {
        headers: { 'X-User-Id': req.user.sub },
        timeout: 10000,
      },
    );
    return res.status(response.status).json(response.data);
  } catch (err) {
    const status = err.response?.status || 502;
    const body   = err.response?.data   || { error: 'Violation analysis service unavailable.' };
    return res.status(status).json(body);
  }
});

// ─── Multer Error Handler ─────────────────────────────────────────────────────
// Catches file upload errors (wrong type, too large) and returns a clean JSON
// response instead of Express's default HTML error page.

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'Image too large. Maximum size is 10 MB.' });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err.message?.includes('Invalid image type')) {
    return res.status(400).json({ error: err.message });
  }
  console.error('[gateway] Unhandled error:', err.message);
  return res.status(500).json({ error: 'Internal gateway error.' });
});

// ─── 404 Handler ──────────────────────────────────────────────────────────────

app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found.' });
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[api-gateway] Listening on port ${PORT}`);
  console.log(`[api-gateway] Auth service:      ${AUTH_SERVICE_URL}`);
  console.log(`[api-gateway] Violation service:  ${VIOLATION_SERVICE_URL}`);
});
