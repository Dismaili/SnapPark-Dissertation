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

const AUTH_SERVICE_URL         = process.env.AUTH_SERVICE_URL         || 'http://authentication-service:3001';
const VIOLATION_SERVICE_URL    = process.env.VIOLATION_SERVICE_URL    || 'http://violation-analysis-service:3002';
const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://notification-service:3004';

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

// ─── Proxy Helpers ────────────────────────────────────────────────────────────

// Simple passthrough for public JSON endpoints (no user context needed).
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

// Proxies an authenticated request to a downstream service, forwarding the
// caller's user id as `X-User-Id` and role as `X-User-Role` so the service
// can enforce ownership while still allowing admins through.
// `resolveUrl` may be a string or a function that builds the URL from the
// request (useful when path parameters must be substituted).
const proxyAuthenticated = (resolveUrl, { timeout = 10000, responseType } = {}) => async (req, res) => {
  try {
    const url = typeof resolveUrl === 'function' ? resolveUrl(req) : resolveUrl;
    const hasBody = !['GET', 'DELETE', 'HEAD'].includes(req.method);
    const response = await axios({
      method:  req.method,
      url,
      data:    hasBody ? req.body : undefined,
      params:  req.query,
      headers: {
        'X-User-Id':   req.user.sub,
        'X-User-Role': req.user.role || 'citizen',
      },
      timeout,
      responseType,
    });
    if (responseType === 'arraybuffer') {
      const contentType = response.headers['content-type'] || 'application/octet-stream';
      res.setHeader('Content-Type', contentType);
      return res.status(response.status).send(Buffer.from(response.data));
    }
    return res.status(response.status).json(response.data);
  } catch (err) {
    const status = err.response?.status || 502;
    const body   = err.response?.data   || { error: 'Downstream service unavailable.' };
    return res.status(status).json(body);
  }
};

// Ensures the `:userId` path parameter matches the authenticated user.
// Prevents one user from reading or mutating another user's data through
// endpoints that take a user id in the URL. Admins bypass this restriction
// so they can inspect any user's data through the same endpoint.
const requireOwnUserId = (req, res, next) => {
  if (req.user.role === 'admin') return next();
  if (req.params.userId !== req.user.sub) {
    return res.status(403).json({ error: 'Forbidden: cannot access another user\'s data.' });
  }
  next();
};

// Overrides any caller-supplied `?userId=` with the authenticated user so
// collection endpoints cannot leak cross-user data. Admins keep their
// requested filter (or no filter) so they can see every user's cases.
const enforceQueryUserId = (req, _res, next) => {
  if (req.user.role !== 'admin') {
    req.query.userId = req.user.sub;
  }
  next();
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

app.post('/auth/register',         proxyJSON(`${AUTH_SERVICE_URL}/auth/register`));
app.post('/auth/login',            proxyJSON(`${AUTH_SERVICE_URL}/auth/login`));
app.post('/auth/refresh',          proxyJSON(`${AUTH_SERVICE_URL}/auth/refresh`));

// OTP-based registration verification + password reset — all public because
// the user has no access token at this point in either flow.
app.post('/auth/verify-otp',       proxyJSON(`${AUTH_SERVICE_URL}/auth/verify-otp`));
app.post('/auth/resend-otp',       proxyJSON(`${AUTH_SERVICE_URL}/auth/resend-otp`));
app.post('/auth/forgot-password',  proxyJSON(`${AUTH_SERVICE_URL}/auth/forgot-password`));
app.post('/auth/reset-password',   proxyJSON(`${AUTH_SERVICE_URL}/auth/reset-password`));

// ─── Protected Auth Routes ───────────────────────────────────────────────────

app.post('/auth/logout',               authenticate, proxyJSON(`${AUTH_SERVICE_URL}/auth/logout`));
app.patch('/auth/profile',             authenticate, proxyAuthenticated(`${AUTH_SERVICE_URL}/auth/profile`));
app.patch('/auth/password',            authenticate, proxyAuthenticated(`${AUTH_SERVICE_URL}/auth/password`));

// ─── Protected Violation Routes ──────────────────────────────────────────────
//
// Every violation route goes through `authenticate` first.  If the token is
// invalid the request is rejected and never reaches the Violation Analysis
// Service.
//
// NOTE: Route order matters — Express matches registration order, so literal
// paths (e.g. `/violations/cases`) MUST be declared before parametric ones
// (e.g. `/violations/:caseId`) to avoid the parameter swallowing them.

/**
 * POST /violations/analyze
 *
 * The client uploads one or more images as multipart/form-data.
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

    // Build a new multipart form to forward the image to the Violation Service.
    // The downstream service uses multer.array('images'); send under that name.
    const form = new FormData();
    form.append('images', req.file.buffer, {
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
 * GET /violations/cases
 * List cases for the authenticated user. Supports optional filters:
 *   ?status=completed  ?from=...  ?to=...  ?limit=50  ?offset=0
 * The `userId` query param is always overridden with the caller's id —
 * users can only list their own cases through the gateway.
 */
app.get('/violations/cases',
  authenticate,
  enforceQueryUserId,
  proxyAuthenticated(`${VIOLATION_SERVICE_URL}/violations/cases`),
);

/**
 * GET /violations/stats/:userId
 * Aggregated statistics (total cases, confirmed, etc.) for a user.
 * Callers may only request their own stats.
 */
app.get('/violations/stats/:userId',
  authenticate,
  requireOwnUserId,
  proxyAuthenticated((req) => `${VIOLATION_SERVICE_URL}/violations/stats/${req.params.userId}`),
);

/**
 * GET /violations/audit/user/:userId
 * Full audit trail of all case events for a user.
 * Callers may only request their own audit trail.
 */
app.get('/violations/audit/user/:userId',
  authenticate,
  requireOwnUserId,
  proxyAuthenticated((req) => `${VIOLATION_SERVICE_URL}/violations/audit/user/${req.params.userId}`),
);

/**
 * GET /violations/:caseId/images/:index
 * Stream a single image attached to a case (binary).
 * Declared before the generic /:caseId route so Express picks the more
 * specific pattern first.
 */
app.get('/violations/:caseId/images/:index',
  authenticate,
  proxyAuthenticated(
    (req) => `${VIOLATION_SERVICE_URL}/violations/${req.params.caseId}/images/${req.params.index}`,
    { responseType: 'arraybuffer' },
  ),
);

/**
 * GET /violations/:caseId
 * Retrieve the full details of a case.
 */
app.get('/violations/:caseId',
  authenticate,
  proxyAuthenticated((req) => `${VIOLATION_SERVICE_URL}/violations/${req.params.caseId}`),
);

/**
 * GET /violations/:caseId/status
 * Check the current status of a case analysis.
 */
app.get('/violations/:caseId/status',
  authenticate,
  proxyAuthenticated((req) => `${VIOLATION_SERVICE_URL}/violations/${req.params.caseId}/status`),
);

/**
 * GET /violations/:caseId/audit
 * Per-case audit trail — every state change recorded for a single case.
 */
app.get('/violations/:caseId/audit',
  authenticate,
  proxyAuthenticated((req) => `${VIOLATION_SERVICE_URL}/violations/${req.params.caseId}/audit`),
);

/**
 * PATCH /violations/:caseId/report
 * Move a completed, confirmed violation into `reported_to_authority` status.
 * Publishes a `case.reported` event consumed by the Notification Service.
 */
app.patch('/violations/:caseId/report',
  authenticate,
  proxyAuthenticated((req) => `${VIOLATION_SERVICE_URL}/violations/${req.params.caseId}/report`),
);

/**
 * PATCH /violations/:caseId/resolve
 * Mark a reported case as resolved. Publishes a `case.resolved` event.
 */
app.patch('/violations/:caseId/resolve',
  authenticate,
  proxyAuthenticated((req) => `${VIOLATION_SERVICE_URL}/violations/${req.params.caseId}/resolve`),
);

/**
 * DELETE /violations/:caseId
 * Cancel a case before analysis completes.
 */
app.delete('/violations/:caseId',
  authenticate,
  proxyAuthenticated((req) => `${VIOLATION_SERVICE_URL}/violations/${req.params.caseId}`),
);

// ─── Protected Notification Routes ───────────────────────────────────────────
//
// All notification endpoints require authentication. As with the violation
// routes, literal paths are registered before parametric ones so Express
// matches the more specific pattern first.

/**
 * GET /notifications
 * List the authenticated user's notifications (newest first).
 * Supports ?limit=50&offset=0. `userId` is always overridden.
 */
app.get('/notifications',
  authenticate,
  enforceQueryUserId,
  proxyAuthenticated(`${NOTIFICATION_SERVICE_URL}/notifications`),
);

/**
 * GET /notifications/case/:caseId
 * All notifications generated for a single case.
 */
app.get('/notifications/case/:caseId',
  authenticate,
  proxyAuthenticated((req) => `${NOTIFICATION_SERVICE_URL}/notifications/case/${req.params.caseId}`),
);

/**
 * PATCH /notifications/read-all/:userId
 * Mark every notification for a user as read.
 */
app.patch('/notifications/read-all/:userId',
  authenticate,
  requireOwnUserId,
  proxyAuthenticated((req) => `${NOTIFICATION_SERVICE_URL}/notifications/read-all/${req.params.userId}`),
);

/**
 * GET /notifications/unread-count/:userId
 * Number of unread notifications — intended for UI badges.
 */
app.get('/notifications/unread-count/:userId',
  authenticate,
  requireOwnUserId,
  proxyAuthenticated((req) => `${NOTIFICATION_SERVICE_URL}/notifications/unread-count/${req.params.userId}`),
);

/**
 * GET /notifications/preferences/:userId
 * Fetch the user's channel preferences (in-app, SMS, email, push).
 */
app.get('/notifications/preferences/:userId',
  authenticate,
  requireOwnUserId,
  proxyAuthenticated((req) => `${NOTIFICATION_SERVICE_URL}/notifications/preferences/${req.params.userId}`),
);

/**
 * PUT /notifications/preferences/:userId
 * Create or update the user's channel preferences.
 */
app.put('/notifications/preferences/:userId',
  authenticate,
  requireOwnUserId,
  proxyAuthenticated((req) => `${NOTIFICATION_SERVICE_URL}/notifications/preferences/${req.params.userId}`),
);

/**
 * GET /notifications/delivery-log/:caseId
 * Per-case delivery attempts across all channels (debug / audit).
 */
app.get('/notifications/delivery-log/:caseId',
  authenticate,
  proxyAuthenticated((req) => `${NOTIFICATION_SERVICE_URL}/notifications/delivery-log/${req.params.caseId}`),
);

/**
 * GET /notifications/:notificationId
 * Retrieve a single notification by its id.
 */
app.get('/notifications/:notificationId',
  authenticate,
  proxyAuthenticated((req) => `${NOTIFICATION_SERVICE_URL}/notifications/${req.params.notificationId}`),
);

/**
 * PATCH /notifications/:notificationId/read
 * Mark a single notification as read.
 */
app.patch('/notifications/:notificationId/read',
  authenticate,
  proxyAuthenticated((req) => `${NOTIFICATION_SERVICE_URL}/notifications/${req.params.notificationId}/read`),
);

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
  console.log(`[api-gateway] Auth service:         ${AUTH_SERVICE_URL}`);
  console.log(`[api-gateway] Violation service:    ${VIOLATION_SERVICE_URL}`);
  console.log(`[api-gateway] Notification service: ${NOTIFICATION_SERVICE_URL}`);
});
