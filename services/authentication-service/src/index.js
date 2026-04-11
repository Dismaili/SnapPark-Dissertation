import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { query, initDB } from './db.js';
import {
  isValidEmail,
  isValidPassword,
  createAccessToken,
  createRefreshToken,
  extractBearerToken,
} from './helpers.js';

dotenv.config();

// ─── Configuration ────────────────────────────────────────────────────────────

const app  = express();
const PORT = Number(process.env.PORT || 3001);

const JWT_SECRET         = process.env.JWT_SECRET         || 'dev-secret-key';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret-key';
const TOKEN_EXPIRY       = process.env.TOKEN_EXPIRY       || '15m';   // short-lived
const REFRESH_EXPIRY     = process.env.REFRESH_TOKEN_EXPIRY || '7d';  // long-lived
const SALT_ROUNDS        = Number(process.env.PASSWORD_SALT_ROUNDS || 10);

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /health
 * Liveness probe used by Docker / Kubernetes and the API Gateway.
 */
app.get('/health', (_req, res) => {
  res.status(200).json({
    service:   'authentication-service',
    status:    'ok',
    timestamp: new Date().toISOString(),
  });
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * POST /auth/register
 * Create a new user account.
 *
 * Body: { email, password }
 * Response 201: { user: { id, email, createdAt }, token, refreshToken }
 */
app.post('/auth/register', async (req, res) => {
  try {
    const { email, password } = req.body ?? {};

    // Input validation
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Invalid email format.' });
    }
    if (!isValidPassword(password)) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    const normalised = email.toLowerCase();

    // Duplicate check
    const existing = await query(
      'SELECT id FROM users WHERE email = $1',
      [normalised]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    // Persist user
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const result = await query(
      `INSERT INTO users (email, password_hash)
       VALUES ($1, $2)
       RETURNING id, email, created_at`,
      [normalised, passwordHash]
    );
    const user = result.rows[0];

    // Issue tokens
    const accessToken  = createAccessToken(user, JWT_SECRET, TOKEN_EXPIRY);
    const refreshToken = createRefreshToken(user, JWT_REFRESH_SECRET, REFRESH_EXPIRY);

    const { exp } = jwt.decode(refreshToken);
    await query(
      `INSERT INTO refresh_tokens (user_id, token, expires_at)
       VALUES ($1, $2, to_timestamp($3))`,
      [user.id, refreshToken, exp]
    );

    return res.status(201).json({
      user: { id: user.id, email: user.email, createdAt: user.created_at },
      token: accessToken,
      refreshToken,
    });
  } catch (err) {
    console.error('[register]', err.message);
    return res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * POST /auth/login
 * Authenticate an existing user.
 *
 * Body: { email, password }
 * Response 200: { user: { id, email }, token, refreshToken }
 */
app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body ?? {};

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const result = await query(
      'SELECT id, email, password_hash FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    // Use identical error message for both "not found" and "wrong password"
    // to prevent user enumeration attacks
    const user = result.rows[0];
    const passwordMatch = user
      ? await bcrypt.compare(password, user.password_hash)
      : false;

    if (!user || !passwordMatch) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    // Issue tokens
    const accessToken  = createAccessToken(user, JWT_SECRET, TOKEN_EXPIRY);
    const refreshToken = createRefreshToken(user, JWT_REFRESH_SECRET, REFRESH_EXPIRY);

    const { exp } = jwt.decode(refreshToken);
    await query(
      `INSERT INTO refresh_tokens (user_id, token, expires_at)
       VALUES ($1, $2, to_timestamp($3))`,
      [user.id, refreshToken, exp]
    );

    return res.status(200).json({
      user: { id: user.id, email: user.email },
      token: accessToken,
      refreshToken,
    });
  } catch (err) {
    console.error('[login]', err.message);
    return res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * POST /auth/verify
 * Validate an access token.  Called internally by the API Gateway on every
 * incoming request before routing to any core service.
 *
 * Body: { token } OR Authorization: Bearer <token>
 * Response 200: { valid: true, payload: { sub, email, iat, exp } }
 * Response 401: { valid: false, error: "..." }
 */
app.post('/auth/verify', async (req, res) => {
  try {
    const token = req.body?.token ?? extractBearerToken(req);

    if (!token) {
      return res.status(400).json({ valid: false, error: 'Token is required.' });
    }

    // Verify signature and expiry
    const payload = jwt.verify(token, JWT_SECRET);

    // Confirm the user still exists (account may have been deleted)
    const result = await query(
      'SELECT id FROM users WHERE id = $1',
      [payload.sub]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ valid: false, error: 'User not found.' });
    }

    return res.status(200).json({ valid: true, payload });
  } catch (_err) {
    // Do not leak internal error details to the caller
    return res.status(401).json({ valid: false, error: 'Invalid or expired token.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * POST /auth/refresh
 * Exchange a valid refresh token for a new access + refresh token pair.
 * The old refresh token is immediately deleted (token rotation), so it cannot
 * be reused even if intercepted later.
 *
 * Body: { refreshToken }
 * Response 200: { token, refreshToken }
 */
app.post('/auth/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body ?? {};

    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token is required.' });
    }

    // Verify the JWT signature
    const payload = jwt.verify(refreshToken, JWT_REFRESH_SECRET);

    // Check the token exists in DB and has not expired
    const stored = await query(
      `SELECT id FROM refresh_tokens
       WHERE token = $1 AND expires_at > NOW()`,
      [refreshToken]
    );
    if (stored.rows.length === 0) {
      return res.status(401).json({ error: 'Refresh token is invalid or has been revoked.' });
    }

    // Fetch user
    const userResult = await query(
      'SELECT id, email FROM users WHERE id = $1',
      [payload.sub]
    );
    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'User not found.' });
    }
    const user = userResult.rows[0];

    // Rotate: delete old token, issue new pair
    await query('DELETE FROM refresh_tokens WHERE token = $1', [refreshToken]);

    const newAccessToken  = createAccessToken(user, JWT_SECRET, TOKEN_EXPIRY);
    const newRefreshToken = createRefreshToken(user, JWT_REFRESH_SECRET, REFRESH_EXPIRY);

    const { exp } = jwt.decode(newRefreshToken);
    await query(
      `INSERT INTO refresh_tokens (user_id, token, expires_at)
       VALUES ($1, $2, to_timestamp($3))`,
      [user.id, newRefreshToken, exp]
    );

    return res.status(200).json({ token: newAccessToken, refreshToken: newRefreshToken });
  } catch (_err) {
    return res.status(401).json({ error: 'Invalid or expired refresh token.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * POST /auth/logout
 * Revoke a refresh token so it can no longer be used to obtain new access tokens.
 * The client should discard both tokens on receipt of this response.
 *
 * Body: { refreshToken }
 * Response 200: { message: "Logged out successfully." }
 */
app.post('/auth/logout', async (req, res) => {
  try {
    const { refreshToken } = req.body ?? {};

    if (refreshToken) {
      await query('DELETE FROM refresh_tokens WHERE token = $1', [refreshToken]);
    }

    return res.status(200).json({ message: 'Logged out successfully.' });
  } catch (err) {
    console.error('[logout]', err.message);
    return res.status(500).json({ error: 'Logout failed. Please try again.' });
  }
});

// ─── Export for testing ──────────────────────────────────────────────────────

export { app, initDB };

// ─── Bootstrap ────────────────────────────────────────────────────────────────

const start = async () => {
  await initDB();
  app.listen(PORT, () => {
    console.log(`[auth-service] Listening on port ${PORT}`);
  });
};

// Only start the server when this file is run directly (not imported by tests)
if (process.argv[1]?.includes('index.js')) {
  start().catch((err) => {
    console.error('[auth-service] Failed to start:', err.message);
    process.exit(1);
  });
}
