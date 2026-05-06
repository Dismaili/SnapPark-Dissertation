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
import {
  sendVerificationOtpEmail,
  sendPasswordResetOtpEmail,
} from './email.js';
import {
  issueOtp,
  verifyOtp,
  OTP_PURPOSE,
  OTP_TTL_MINUTES,
} from './otp.js';

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

// Issue a fresh access+refresh pair and persist the refresh token.
// Centralised because both login and OTP-verification flows need it.
const issueTokenPair = async (user) => {
  const accessToken  = createAccessToken(user, JWT_SECRET, TOKEN_EXPIRY);
  const refreshToken = createRefreshToken(user, JWT_REFRESH_SECRET, REFRESH_EXPIRY);

  const { exp } = jwt.decode(refreshToken);
  await query(
    `INSERT INTO refresh_tokens (user_id, token, expires_at)
     VALUES ($1, $2, to_timestamp($3))`,
    [user.id, refreshToken, exp]
  );

  return { accessToken, refreshToken };
};

const userResponse = (user) => ({
  id:            user.id,
  email:         user.email,
  role:          user.role,
  firstName:     user.first_name,
  lastName:      user.last_name,
  emailVerified: user.email_verified,
  createdAt:     user.created_at,
});

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
 * Create a new user account. The account is created in an UNVERIFIED state;
 * a 4-digit OTP is emailed to the user, and they must call /auth/verify-otp
 * with the code before they receive any access tokens.
 *
 * Body: { email, password, firstName?, lastName? }
 * Response 201: { message, email, requiresVerification: true, ttlMinutes }
 */
app.post('/auth/register', async (req, res) => {
  try {
    const { email, password, firstName, lastName } = req.body ?? {};

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Invalid email format.' });
    }
    if (!isValidPassword(password)) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    const cleanFirst = typeof firstName === 'string' ? firstName.trim().slice(0, 100) : null;
    const cleanLast  = typeof lastName  === 'string' ? lastName.trim().slice(0, 100)  : null;
    const normalised = email.toLowerCase();

    const existing = await query('SELECT id FROM users WHERE email = $1', [normalised]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const result = await query(
      `INSERT INTO users (email, password_hash, first_name, last_name)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, role, first_name, last_name, email_verified, created_at`,
      [normalised, passwordHash, cleanFirst, cleanLast]
    );
    let user = result.rows[0];
    user = await ensureAdminRole(user);

    // Issue and email the OTP. Failure to send the email is logged but does
    // not roll the registration back — the user can request a resend.
    const { code } = await issueOtp({
      userId:  user.id,
      purpose: OTP_PURPOSE.EMAIL_VERIFICATION,
    });

    sendVerificationOtpEmail({
      to:         user.email,
      firstName:  user.first_name,
      code,
      ttlMinutes: OTP_TTL_MINUTES,
    }).catch((err) => console.warn('[register] OTP email failed:', err.message));

    return res.status(201).json({
      message:              'Account created. Check your email for a verification code.',
      email:                user.email,
      requiresVerification: true,
      ttlMinutes:           OTP_TTL_MINUTES,
    });
  } catch (err) {
    console.error('[register]', err.message);
    return res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * POST /auth/verify-otp
 * Validate a 4-digit code emailed during registration. On success the
 * account is marked verified and a token pair is issued so the user can
 * land directly in the app.
 *
 * Body: { email, code }
 * Response 200: { user, token, refreshToken }
 */
app.post('/auth/verify-otp', async (req, res) => {
  try {
    const { email, code } = req.body ?? {};

    if (!email || !code) {
      return res.status(400).json({ error: 'Email and code are required.' });
    }

    const userResult = await query(
      `SELECT id, email, role, first_name, last_name, email_verified, created_at
         FROM users WHERE email = $1`,
      [email.toLowerCase()]
    );
    let user = userResult.rows[0];

    // Use a generic message so the endpoint can't be used to enumerate accounts.
    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired code.' });
    }

    if (user.email_verified) {
      return res.status(400).json({ error: 'Email is already verified. Please sign in.' });
    }

    const result = await verifyOtp({
      userId:  user.id,
      purpose: OTP_PURPOSE.EMAIL_VERIFICATION,
      code:    String(code),
    });

    if (!result.ok) {
      const status = result.reason === 'too_many_attempts' ? 429 : 400;
      const msg    = result.reason === 'too_many_attempts'
        ? 'Too many incorrect attempts. Please request a new code.'
        : 'Invalid or expired code.';
      return res.status(status).json({ error: msg });
    }

    await query(
      `UPDATE users SET email_verified = TRUE, updated_at = NOW() WHERE id = $1`,
      [user.id]
    );
    user = { ...user, email_verified: true };
    user = await ensureAdminRole(user);

    const { accessToken, refreshToken } = await issueTokenPair(user);

    return res.status(200).json({
      user:  userResponse(user),
      token: accessToken,
      refreshToken,
    });
  } catch (err) {
    console.error('[verify-otp]', err.message);
    return res.status(500).json({ error: 'Verification failed. Please try again.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * POST /auth/resend-otp
 * Re-issue the registration verification code. Public endpoint — the user
 * has no access token at this point in the flow. Always responds 200 to
 * avoid leaking which emails belong to unverified accounts.
 *
 * Body: { email }
 */
app.post('/auth/resend-otp', async (req, res) => {
  const { email } = req.body ?? {};

  if (!email || !isValidEmail(email)) {
    return res.status(400).json({ error: 'A valid email is required.' });
  }

  try {
    const result = await query(
      'SELECT id, email, first_name, email_verified FROM users WHERE email = $1',
      [email.toLowerCase()]
    );
    const user = result.rows[0];

    // Only re-issue for accounts that genuinely need verification, but
    // respond identically in every case.
    if (user && !user.email_verified) {
      const { code } = await issueOtp({
        userId:  user.id,
        purpose: OTP_PURPOSE.EMAIL_VERIFICATION,
      });
      sendVerificationOtpEmail({
        to:         user.email,
        firstName:  user.first_name,
        code,
        ttlMinutes: OTP_TTL_MINUTES,
      }).catch((err) => console.warn('[resend-otp] email failed:', err.message));
    }

    return res.status(200).json({
      message:    'If an unverified account exists for that email, a new code has been sent.',
      ttlMinutes: OTP_TTL_MINUTES,
    });
  } catch (err) {
    console.error('[resend-otp]', err.message);
    return res.status(500).json({ error: 'Failed to resend code. Please try again.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * POST /auth/forgot-password
 * Begin the password-reset flow. Always returns 200 regardless of whether
 * the email is registered, to prevent the endpoint from being used for
 * account enumeration.
 *
 * Body: { email }
 */
app.post('/auth/forgot-password', async (req, res) => {
  const { email } = req.body ?? {};

  if (!email || !isValidEmail(email)) {
    return res.status(400).json({ error: 'A valid email is required.' });
  }

  try {
    const result = await query(
      'SELECT id, email, first_name FROM users WHERE email = $1',
      [email.toLowerCase()]
    );
    const user = result.rows[0];

    if (user) {
      const { code } = await issueOtp({
        userId:  user.id,
        purpose: OTP_PURPOSE.PASSWORD_RESET,
      });
      sendPasswordResetOtpEmail({
        to:         user.email,
        firstName:  user.first_name,
        code,
        ttlMinutes: OTP_TTL_MINUTES,
      }).catch((err) => console.warn('[forgot-password] email failed:', err.message));
    }

    return res.status(200).json({
      message:    'If an account exists for that email, a reset code has been sent.',
      ttlMinutes: OTP_TTL_MINUTES,
    });
  } catch (err) {
    console.error('[forgot-password]', err.message);
    return res.status(500).json({ error: 'Failed to start reset. Please try again.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * POST /auth/reset-password
 * Complete the password-reset flow by submitting the OTP and a new password.
 * On success all existing refresh tokens for the user are revoked so any
 * previously-stolen session immediately stops working.
 *
 * Body: { email, code, newPassword }
 */
app.post('/auth/reset-password', async (req, res) => {
  try {
    const { email, code, newPassword } = req.body ?? {};

    if (!email || !code || !newPassword) {
      return res.status(400).json({ error: 'Email, code, and new password are required.' });
    }
    if (!isValidPassword(newPassword)) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    const userResult = await query(
      'SELECT id FROM users WHERE email = $1',
      [email.toLowerCase()]
    );
    const user = userResult.rows[0];
    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired code.' });
    }

    const result = await verifyOtp({
      userId:  user.id,
      purpose: OTP_PURPOSE.PASSWORD_RESET,
      code:    String(code),
    });

    if (!result.ok) {
      const status = result.reason === 'too_many_attempts' ? 429 : 400;
      const msg    = result.reason === 'too_many_attempts'
        ? 'Too many incorrect attempts. Please request a new code.'
        : 'Invalid or expired code.';
      return res.status(status).json({ error: msg });
    }

    const newHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await query(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
      [newHash, user.id]
    );
    // Force re-login on every device — any leaked refresh token is now dead.
    await query('DELETE FROM refresh_tokens WHERE user_id = $1', [user.id]);

    return res.status(200).json({ message: 'Password updated. Please sign in with your new password.' });
  } catch (err) {
    console.error('[reset-password]', err.message);
    return res.status(500).json({ error: 'Failed to reset password. Please try again.' });
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

    // Block unverified accounts. The credentials check above runs first so
    // we never reveal "unverified" for a wrong password (which would leak
    // that the email is registered).
    if (!user.email_verified) {
      // Issue a fresh OTP so the verify screen has a code waiting; the
      // previous one (from registration) may have expired or been consumed.
      const { code } = await issueOtp({
        userId:  user.id,
        purpose: OTP_PURPOSE.EMAIL_VERIFICATION,
      });
      sendVerificationOtpEmail({
        to:         user.email,
        firstName:  user.first_name,
        code,
        ttlMinutes: OTP_TTL_MINUTES,
      }).catch((err) => console.warn('[login] OTP email failed:', err.message));

      return res.status(403).json({
        error:                'Please verify your email before signing in. We sent a new code to your inbox.',
        requiresVerification: true,
        email:                user.email,
        ttlMinutes:           OTP_TTL_MINUTES,
      });
    }

    // Promote to admin if email is on the allowlist (idempotent — runs every login)
    user = await ensureAdminRole(user);

    const { accessToken, refreshToken } = await issueTokenPair(user);

    return res.status(200).json({
      user:  userResponse(user),
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

    const payload = jwt.verify(token, JWT_SECRET);

    const result = await query('SELECT id FROM users WHERE id = $1', [payload.sub]);
    if (result.rows.length === 0) {
      return res.status(401).json({ valid: false, error: 'User not found.' });
    }

    return res.status(200).json({ valid: true, payload });
  } catch (_err) {
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

    const payload = jwt.verify(refreshToken, JWT_REFRESH_SECRET);

    const stored = await query(
      `SELECT id FROM refresh_tokens
       WHERE token = $1 AND expires_at > NOW()`,
      [refreshToken]
    );
    if (stored.rows.length === 0) {
      return res.status(401).json({ error: 'Refresh token is invalid or has been revoked.' });
    }

    const userResult = await query(
      'SELECT id, email, role FROM users WHERE id = $1',
      [payload.sub]
    );
    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'User not found.' });
    }
    const user = userResult.rows[0];

    await query('DELETE FROM refresh_tokens WHERE token = $1', [refreshToken]);

    const { accessToken: newAccessToken, refreshToken: newRefreshToken } =
      await issueTokenPair(user);

    return res.status(200).json({ token: newAccessToken, refreshToken: newRefreshToken });
  } catch (_err) {
    return res.status(401).json({ error: 'Invalid or expired refresh token.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * POST /auth/logout
 * Revoke a refresh token so it can no longer be used to obtain new access tokens.
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
 * PATCH /auth/profile
 * Update the authenticated user's first and last name.
 * Body: { firstName, lastName }
 */
app.patch('/auth/profile', async (req, res) => {
  try {
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

if (process.argv[1]?.includes('index.js')) {
  start().catch((err) => {
    console.error('[auth-service] Failed to start:', err.message);
    process.exit(1);
  });
}
