import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { query, initDB } from './db.js';
import {
  isValidEmail,
  isValidPassword,
  createAccessToken,
  createRefreshToken,
  extractBearerToken,
} from './helpers.js';
import { sendVerificationEmail } from './email.js';

dotenv.config();

// ─── Configuration ────────────────────────────────────────────────────────────

const app  = express();
const PORT = Number(process.env.PORT || 3001);

const JWT_SECRET         = process.env.JWT_SECRET         || 'dev-secret-key';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret-key';
const TOKEN_EXPIRY       = process.env.TOKEN_EXPIRY       || '15m';   // short-lived
const REFRESH_EXPIRY     = process.env.REFRESH_TOKEN_EXPIRY || '7d';  // long-lived
const SALT_ROUNDS        = Number(process.env.PASSWORD_SALT_ROUNDS || 10);

// Pre-configured admin emails — applied on register, login, and refresh.
// Lets a fresh registration of an admin email pick up the admin role
// immediately without requiring a service restart.
const ADMIN_EMAILS = new Set(
  (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);

const ensureAdminRole = async (user) => {
  if (!user || user.role === 'admin' || !ADMIN_EMAILS.has(user.email?.toLowerCase())) {
    return user;
  }
  const r = await query(
    `UPDATE users SET role = 'admin', updated_at = NOW()
     WHERE id = $1 RETURNING id, email, role`,
    [user.id]
  );
  return r.rows[0] || user;
};

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
    const { email, password, firstName, lastName } = req.body ?? {};

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

    // First/last name are optional but trimmed and capped to fit the DB column.
    const cleanFirst = typeof firstName === 'string' ? firstName.trim().slice(0, 100) : null;
    const cleanLast  = typeof lastName  === 'string' ? lastName.trim().slice(0, 100)  : null;

    const normalised = email.toLowerCase();

    // Duplicate check
    const existing = await query(
      'SELECT id FROM users WHERE email = $1',
      [normalised]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    // Persist user. Role defaults to 'citizen'; admins are minted out-of-band
    // by the ADMIN_EMAILS bootstrap (or by an existing admin via SQL).
    const passwordHash      = await bcrypt.hash(password, SALT_ROUNDS);
    const verificationToken = crypto.randomUUID();
    const tokenExpires      = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 h

    const result = await query(
      `INSERT INTO users
         (email, password_hash, first_name, last_name, verification_token, verification_token_expires)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, email, role, first_name, last_name, email_verified, created_at`,
      [normalised, passwordHash, cleanFirst, cleanLast, verificationToken, tokenExpires]
    );
    let user = result.rows[0];
    user = await ensureAdminRole(user);

    // Send verification email (non-blocking — failure doesn't break registration)
    sendVerificationEmail({
      to:        user.email,
      firstName: user.first_name,
      token:     verificationToken,
    }).catch((err) => console.warn('[register] Verification email failed:', err.message));

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
      user: {
        id:            user.id,
        email:         user.email,
        role:          user.role,
        firstName:     user.first_name,
        lastName:      user.last_name,
        emailVerified: user.email_verified,
        createdAt:     user.created_at,
      },
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
      'SELECT id, email, role, first_name, last_name, email_verified, password_hash FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    // Use identical error message for both "not found" and "wrong password"
    // to prevent user enumeration attacks
    let user = result.rows[0];
    const passwordMatch = user
      ? await bcrypt.compare(password, user.password_hash)
      : false;

    if (!user || !passwordMatch) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    // Promote to admin if email is on the allowlist (idempotent — runs every login)
    user = await ensureAdminRole(user);

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
      user: {
        id:            user.id,
        email:         user.email,
        role:          user.role,
        firstName:     user.first_name,
        lastName:      user.last_name,
        emailVerified: user.email_verified,
      },
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
      'SELECT id, email, role FROM users WHERE id = $1',
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

// ─────────────────────────────────────────────────────────────────────────────
/**
 * GET /auth/verify-email?token=<uuid>
 * Marks the user's email as verified. Called when the user clicks the link
 * in their verification email. Redirects to the frontend on success/failure.
 */
app.get('/auth/verify-email', async (req, res) => {
  const { token } = req.query;
  const FRONTEND = process.env.APP_FRONTEND_URL || 'http://localhost:3002';

  if (!token) {
    return res.redirect(`${FRONTEND}/login?verified=invalid`);
  }

  try {
    const result = await query(
      `UPDATE users
         SET email_verified = TRUE,
             verification_token = NULL,
             verification_token_expires = NULL,
             updated_at = NOW()
       WHERE verification_token = $1
         AND verification_token_expires > NOW()
         AND email_verified = FALSE
       RETURNING id`,
      [token]
    );

    if (result.rowCount === 0) {
      return res.redirect(`${FRONTEND}/login?verified=invalid`);
    }

    return res.redirect(`${FRONTEND}/login?verified=true`);
  } catch (err) {
    console.error('[verify-email]', err.message);
    return res.redirect(`${FRONTEND}/login?verified=error`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * POST /auth/resend-verification
 * Resends the verification email. Requires a valid Bearer access token.
 */
app.post('/auth/resend-verification', async (req, res) => {
  try {
    const token = extractBearerToken(req);
    if (!token) return res.status(401).json({ error: 'Authentication required.' });

    const payload = jwt.verify(token, JWT_SECRET);
    const result  = await query(
      'SELECT id, email, first_name, email_verified FROM users WHERE id = $1',
      [payload.sub]
    );
    const user = result.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found.' });
    if (user.email_verified) return res.status(400).json({ error: 'Email already verified.' });

    const newToken   = crypto.randomUUID();
    const newExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await query(
      `UPDATE users SET verification_token = $1, verification_token_expires = $2 WHERE id = $3`,
      [newToken, newExpires, user.id]
    );

    await sendVerificationEmail({ to: user.email, firstName: user.first_name, token: newToken });
    return res.status(200).json({ message: 'Verification email sent.' });
  } catch (err) {
    console.error('[resend-verification]', err.message);
    return res.status(500).json({ error: 'Failed to resend verification email.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * PATCH /auth/profile
 * Update the authenticated user's first and last name.
 * Body: { firstName, lastName }
 */
app.patch('/auth/profile', async (req, res) => {
  try {
    // The API Gateway verifies the JWT and forwards the user id as X-User-Id.
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'Authentication required.' });

    const { firstName, lastName } = req.body ?? {};

    const cleanFirst = typeof firstName === 'string' ? firstName.trim().slice(0, 100) : undefined;
    const cleanLast  = typeof lastName  === 'string' ? lastName.trim().slice(0, 100)  : undefined;

    if (cleanFirst === undefined && cleanLast === undefined) {
      return res.status(400).json({ error: 'Provide at least one field to update.' });
    }

    const result = await query(
      `UPDATE users
         SET first_name  = COALESCE($1, first_name),
             last_name   = COALESCE($2, last_name),
             updated_at  = NOW()
       WHERE id = $3
       RETURNING id, email, first_name, last_name`,
      [cleanFirst ?? null, cleanLast ?? null, userId]
    );

    const updated = result.rows[0];
    return res.status(200).json({
      id:        updated.id,
      email:     updated.email,
      firstName: updated.first_name,
      lastName:  updated.last_name,
    });
  } catch (err) {
    console.error('[profile]', err.message);
    return res.status(500).json({ error: 'Failed to update profile.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * PATCH /auth/password
 * Change the authenticated user's password.
 * Body: { currentPassword, newPassword }
 */
app.patch('/auth/password', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'Authentication required.' });

    const { currentPassword, newPassword } = req.body ?? {};

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new passwords are required.' });
    }
    if (!isValidPassword(newPassword)) {
      return res.status(400).json({ error: 'New password must be at least 8 characters.' });
    }

    const result = await query(
      'SELECT id, password_hash FROM users WHERE id = $1',
      [userId]
    );
    const user = result.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found.' });

    const match = await bcrypt.compare(currentPassword, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Current password is incorrect.' });

    const newHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await query(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
      [newHash, userId]
    );

    return res.status(200).json({ message: 'Password updated successfully.' });
  } catch (err) {
    console.error('[password]', err.message);
    return res.status(500).json({ error: 'Failed to update password.' });
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
