import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app, initDB } from '../../src/index.js';
import { query } from '../../src/db.js';
import pool from '../../src/db.js';
import { issueOtp, OTP_PURPOSE } from '../../src/otp.js';

// ─── Test fixtures ───────────────────────────────────────────────────────────

const TEST_USER = {
  email: 'integration@test.com',
  password: 'securepassword123',
};

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key';

// ─── Lifecycle ───────────────────────────────────────────────────────────────

beforeAll(async () => {
  await initDB();
});

beforeEach(async () => {
  // Clean state before every test to ensure isolation. otps depend on users
  // (FK with ON DELETE CASCADE), so deleting users wipes them — but we delete
  // explicitly anyway in case the cascade is ever changed.
  await query('DELETE FROM otps');
  await query('DELETE FROM refresh_tokens');
  await query('DELETE FROM users');
});

afterAll(async () => {
  await query('DELETE FROM otps');
  await query('DELETE FROM refresh_tokens');
  await query('DELETE FROM users');
  await pool.end();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

const registerUser = (user = TEST_USER) =>
  request(app).post('/auth/register').send(user);

/**
 * Register a user, mark them verified directly in the DB, then sign them in
 * to obtain a token pair. Used by every test suite that exercises the
 * post-verification API surface (login, refresh, logout, etc.) without
 * coupling those tests to the OTP flow.
 */
const registerVerifiedUser = async (user = TEST_USER) => {
  const reg = await registerUser(user);
  expect(reg.status).toBe(201);

  await query(
    'UPDATE users SET email_verified = TRUE WHERE email = $1',
    [user.email.toLowerCase()]
  );

  const login = await request(app).post('/auth/login').send(user);
  expect(login.status).toBe(200);
  return login.body; // { user, token, refreshToken }
};

const getUserId = async (email) => {
  const r = await query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
  return r.rows[0]?.id;
};

// ─── Health Check ────────────────────────────────────────────────────────────

describe('GET /health', () => {
  it('should return 200 with service status', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.service).toBe('authentication-service');
    expect(res.body.status).toBe('ok');
    expect(res.body.timestamp).toBeDefined();
  });
});

// ─── Registration ────────────────────────────────────────────────────────────

describe('POST /auth/register', () => {
  it('should create the account in an unverified state and require OTP', async () => {
    const res = await registerUser();

    expect(res.status).toBe(201);
    expect(res.body.requiresVerification).toBe(true);
    expect(res.body.email).toBe(TEST_USER.email);
    expect(res.body.ttlMinutes).toBeGreaterThan(0);
    // Tokens are NOT issued at registration anymore — only after OTP verification.
    expect(res.body.token).toBeUndefined();
    expect(res.body.refreshToken).toBeUndefined();
  });

  it('should persist the user as unverified', async () => {
    await registerUser();
    const r = await query(
      'SELECT email_verified FROM users WHERE email = $1',
      [TEST_USER.email]
    );
    expect(r.rows[0].email_verified).toBe(false);
  });

  it('should create exactly one active email-verification OTP for the user', async () => {
    await registerUser();
    const userId = await getUserId(TEST_USER.email);
    const r = await query(
      `SELECT id FROM otps
        WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL`,
      [userId, OTP_PURPOSE.EMAIL_VERIFICATION]
    );
    expect(r.rows).toHaveLength(1);
  });

  it('should normalise email to lowercase', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'USER@EXAMPLE.COM', password: 'securepassword123' });

    expect(res.status).toBe(201);
    expect(res.body.email).toBe('user@example.com');
  });

  it('should hash the password (never store plaintext)', async () => {
    await registerUser();
    const result = await query('SELECT password_hash FROM users WHERE email = $1', [TEST_USER.email]);

    expect(result.rows[0].password_hash).not.toBe(TEST_USER.password);
    expect(result.rows[0].password_hash).toMatch(/^\$2[aby]?\$/); // bcrypt prefix
  });

  it('should reject duplicate email with 409', async () => {
    await registerUser();
    const res = await registerUser();

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already exists/i);
  });

  it('should reject missing email with 400', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ password: 'securepassword123' });

    expect(res.status).toBe(400);
  });

  it('should reject missing password with 400', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'test@example.com' });

    expect(res.status).toBe(400);
  });

  it('should reject invalid email format with 400', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'not-an-email', password: 'securepassword123' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid email/i);
  });

  it('should reject passwords shorter than 8 characters with 400', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'test@example.com', password: 'short' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/8 characters/i);
  });
});

// ─── OTP Verification ────────────────────────────────────────────────────────

describe('POST /auth/verify-otp', () => {
  let userId;
  let validCode;

  beforeEach(async () => {
    await registerUser();
    userId = await getUserId(TEST_USER.email);
    // Issue a fresh OTP whose plaintext we control so the test can submit it.
    const otp = await issueOtp({ userId, purpose: OTP_PURPOSE.EMAIL_VERIFICATION });
    validCode = otp.code;
  });

  it('should verify the user, mark email_verified, and return tokens', async () => {
    const res = await request(app)
      .post('/auth/verify-otp')
      .send({ email: TEST_USER.email, code: validCode });

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(TEST_USER.email);
    expect(res.body.user.emailVerified).toBe(true);
    expect(res.body.token).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();

    const r = await query('SELECT email_verified FROM users WHERE id = $1', [userId]);
    expect(r.rows[0].email_verified).toBe(true);
  });

  it('should issue a valid access token signed with the configured secret', async () => {
    const res = await request(app)
      .post('/auth/verify-otp')
      .send({ email: TEST_USER.email, code: validCode });

    const decoded = jwt.verify(res.body.token, JWT_SECRET);
    expect(decoded.sub).toBe(userId);
    expect(decoded.email).toBe(TEST_USER.email);
  });

  it('should consume the OTP so it cannot be reused', async () => {
    await request(app)
      .post('/auth/verify-otp')
      .send({ email: TEST_USER.email, code: validCode });

    const replay = await request(app)
      .post('/auth/verify-otp')
      .send({ email: TEST_USER.email, code: validCode });

    // Already verified → 400 'already verified'; the underlying OTP is also consumed.
    expect(replay.status).toBe(400);
  });

  it('should reject the wrong code with 400', async () => {
    const wrong = validCode === '0000' ? '1111' : '0000';
    const res = await request(app)
      .post('/auth/verify-otp')
      .send({ email: TEST_USER.email, code: wrong });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid/i);
  });

  it('should reject non-numeric or wrong-length codes', async () => {
    const a = await request(app)
      .post('/auth/verify-otp')
      .send({ email: TEST_USER.email, code: 'abcd' });
    const b = await request(app)
      .post('/auth/verify-otp')
      .send({ email: TEST_USER.email, code: '12' });

    expect(a.status).toBe(400);
    expect(b.status).toBe(400);
  });

  it('should return 429 after too many wrong attempts and burn the code', async () => {
    const wrong = validCode === '0000' ? '1111' : '0000';
    // Default OTP_MAX_ATTEMPTS = 5; submit 5 wrong codes to exhaust attempts.
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post('/auth/verify-otp')
        .send({ email: TEST_USER.email, code: wrong });
    }
    const res = await request(app)
      .post('/auth/verify-otp')
      .send({ email: TEST_USER.email, code: wrong });
    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/too many/i);

    // Even submitting the originally-correct code now must fail — the row is consumed.
    const stillBlocked = await request(app)
      .post('/auth/verify-otp')
      .send({ email: TEST_USER.email, code: validCode });
    expect(stillBlocked.status).toBe(400);
  });

  it('should not enumerate accounts: unknown email returns the same 400', async () => {
    const res = await request(app)
      .post('/auth/verify-otp')
      .send({ email: 'nobody@example.com', code: '0000' });

    expect(res.status).toBe(400);
  });

  it('should reject re-verification once email is already verified', async () => {
    await query('UPDATE users SET email_verified = TRUE WHERE id = $1', [userId]);
    const res = await request(app)
      .post('/auth/verify-otp')
      .send({ email: TEST_USER.email, code: validCode });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already verified/i);
  });

  it('should reject missing fields with 400', async () => {
    const a = await request(app).post('/auth/verify-otp').send({ code: validCode });
    const b = await request(app).post('/auth/verify-otp').send({ email: TEST_USER.email });
    expect(a.status).toBe(400);
    expect(b.status).toBe(400);
  });
});

// ─── Resend OTP ──────────────────────────────────────────────────────────────

describe('POST /auth/resend-otp', () => {
  it('should issue a new active OTP and invalidate the previous one', async () => {
    await registerUser();
    const userId = await getUserId(TEST_USER.email);

    const before = await query(
      `SELECT id FROM otps WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL`,
      [userId, OTP_PURPOSE.EMAIL_VERIFICATION]
    );
    const beforeId = before.rows[0].id;

    const res = await request(app)
      .post('/auth/resend-otp')
      .send({ email: TEST_USER.email });
    expect(res.status).toBe(200);

    const after = await query(
      `SELECT id FROM otps WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL`,
      [userId, OTP_PURPOSE.EMAIL_VERIFICATION]
    );
    expect(after.rows).toHaveLength(1);
    expect(after.rows[0].id).not.toBe(beforeId);
  });

  it('should respond 200 generically for unknown emails (no enumeration)', async () => {
    const res = await request(app)
      .post('/auth/resend-otp')
      .send({ email: 'nobody@example.com' });
    expect(res.status).toBe(200);
  });

  it('should respond 200 generically for already-verified accounts (no enumeration) and not issue a new OTP', async () => {
    await registerUser();
    const userId = await getUserId(TEST_USER.email);
    await query('UPDATE users SET email_verified = TRUE WHERE id = $1', [userId]);
    // Mark the existing registration OTP consumed to make the assertion meaningful.
    await query('UPDATE otps SET consumed_at = NOW() WHERE user_id = $1', [userId]);

    const res = await request(app)
      .post('/auth/resend-otp')
      .send({ email: TEST_USER.email });
    expect(res.status).toBe(200);

    const after = await query(
      `SELECT COUNT(*)::int AS n FROM otps
        WHERE user_id = $1 AND consumed_at IS NULL`,
      [userId]
    );
    expect(after.rows[0].n).toBe(0);
  });

  it('should reject malformed email with 400', async () => {
    const res = await request(app)
      .post('/auth/resend-otp')
      .send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
  });
});

// ─── Forgot / Reset Password ─────────────────────────────────────────────────

describe('Password reset flow', () => {
  beforeEach(async () => {
    await registerVerifiedUser();
  });

  describe('POST /auth/forgot-password', () => {
    it('should issue a password-reset OTP for an existing account', async () => {
      const userId = await getUserId(TEST_USER.email);
      const res = await request(app)
        .post('/auth/forgot-password')
        .send({ email: TEST_USER.email });
      expect(res.status).toBe(200);

      const r = await query(
        `SELECT id FROM otps WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL`,
        [userId, OTP_PURPOSE.PASSWORD_RESET]
      );
      expect(r.rows).toHaveLength(1);
    });

    it('should respond 200 for unknown emails (no enumeration) and not issue an OTP', async () => {
      const res = await request(app)
        .post('/auth/forgot-password')
        .send({ email: 'nobody@example.com' });
      expect(res.status).toBe(200);

      const r = await query(
        `SELECT COUNT(*)::int AS n FROM otps WHERE purpose = $1 AND consumed_at IS NULL`,
        [OTP_PURPOSE.PASSWORD_RESET]
      );
      expect(r.rows[0].n).toBe(0);
    });

    it('should reject missing/invalid email with 400', async () => {
      const a = await request(app).post('/auth/forgot-password').send({});
      const b = await request(app).post('/auth/forgot-password').send({ email: 'bad' });
      expect(a.status).toBe(400);
      expect(b.status).toBe(400);
    });
  });

  describe('POST /auth/reset-password', () => {
    let userId;
    let resetCode;

    beforeEach(async () => {
      userId = await getUserId(TEST_USER.email);
      const otp = await issueOtp({ userId, purpose: OTP_PURPOSE.PASSWORD_RESET });
      resetCode = otp.code;
    });

    it('should reset the password and revoke all existing refresh tokens', async () => {
      // Confirm there is a refresh token from the verified-user setup.
      const before = await query(
        'SELECT COUNT(*)::int AS n FROM refresh_tokens WHERE user_id = $1',
        [userId]
      );
      expect(before.rows[0].n).toBeGreaterThan(0);

      const res = await request(app)
        .post('/auth/reset-password')
        .send({
          email:       TEST_USER.email,
          code:        resetCode,
          newPassword: 'brand-new-pass-123',
        });
      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/password updated/i);

      // The new password must work on /auth/login.
      const login = await request(app)
        .post('/auth/login')
        .send({ email: TEST_USER.email, password: 'brand-new-pass-123' });
      expect(login.status).toBe(200);

      // The old password must fail.
      const oldLogin = await request(app)
        .post('/auth/login')
        .send(TEST_USER);
      expect(oldLogin.status).toBe(401);

      // All previously issued refresh tokens are gone.
      const after = await query(
        'SELECT COUNT(*)::int AS n FROM refresh_tokens WHERE user_id = $1',
        [userId]
      );
      // Only the one minted by the new login above should exist.
      expect(after.rows[0].n).toBe(1);
    });

    it('should reject the wrong code with 400 and not change the password', async () => {
      const wrong = resetCode === '0000' ? '1111' : '0000';
      const res = await request(app)
        .post('/auth/reset-password')
        .send({
          email:       TEST_USER.email,
          code:        wrong,
          newPassword: 'brand-new-pass-123',
        });
      expect(res.status).toBe(400);

      // Original password still works.
      const login = await request(app).post('/auth/login').send(TEST_USER);
      expect(login.status).toBe(200);
    });

    it('should reject missing fields with 400', async () => {
      const a = await request(app)
        .post('/auth/reset-password')
        .send({ code: resetCode, newPassword: 'brand-new-pass-123' });
      const b = await request(app)
        .post('/auth/reset-password')
        .send({ email: TEST_USER.email, newPassword: 'brand-new-pass-123' });
      const c = await request(app)
        .post('/auth/reset-password')
        .send({ email: TEST_USER.email, code: resetCode });
      expect(a.status).toBe(400);
      expect(b.status).toBe(400);
      expect(c.status).toBe(400);
    });

    it('should reject a too-short new password with 400', async () => {
      const res = await request(app)
        .post('/auth/reset-password')
        .send({
          email:       TEST_USER.email,
          code:        resetCode,
          newPassword: 'short',
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/8 characters/i);
    });

    it('should not enumerate: unknown email returns the same 400', async () => {
      const res = await request(app)
        .post('/auth/reset-password')
        .send({
          email:       'nobody@example.com',
          code:        '0000',
          newPassword: 'brand-new-pass-123',
        });
      expect(res.status).toBe(400);
    });
  });
});

// ─── Login ───────────────────────────────────────────────────────────────────

describe('POST /auth/login', () => {
  beforeEach(async () => {
    await registerVerifiedUser();
  });

  it('should authenticate with valid credentials and return tokens', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send(TEST_USER);

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(TEST_USER.email);
    expect(res.body.token).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
  });

  it('should reject an incorrect password with 401', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: TEST_USER.email, password: 'wrongpassword' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid credentials/i);
  });

  it('should reject a non-existent email with 401', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'nobody@example.com', password: 'somepassword123' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid credentials/i);
  });

  it('should return the same error for wrong email and wrong password (prevent user enumeration)', async () => {
    const wrongEmail = await request(app)
      .post('/auth/login')
      .send({ email: 'nobody@example.com', password: 'somepassword123' });

    const wrongPassword = await request(app)
      .post('/auth/login')
      .send({ email: TEST_USER.email, password: 'wrongpassword' });

    expect(wrongEmail.status).toBe(wrongPassword.status);
    expect(wrongEmail.body.error).toBe(wrongPassword.body.error);
  });

  it('should reject missing fields with 400', async () => {
    const noEmail = await request(app).post('/auth/login').send({ password: 'x' });
    const noPass  = await request(app).post('/auth/login').send({ email: 'x@x.com' });

    expect(noEmail.status).toBe(400);
    expect(noPass.status).toBe(400);
  });

  it('should reject login for unverified accounts with 403 and re-issue an OTP', async () => {
    // Register a separate user that we DON'T verify.
    const unverified = { email: 'unverified@test.com', password: 'unverifiedpw123' };
    const reg = await registerUser(unverified);
    expect(reg.status).toBe(201);

    const userId = await getUserId(unverified.email);
    // Consume the registration OTP so we can prove a NEW one is issued by login.
    await query(
      `UPDATE otps SET consumed_at = NOW() WHERE user_id = $1`,
      [userId]
    );

    const res = await request(app)
      .post('/auth/login')
      .send(unverified);

    expect(res.status).toBe(403);
    expect(res.body.requiresVerification).toBe(true);
    expect(res.body.email).toBe(unverified.email);
    expect(res.body.token).toBeUndefined();

    const otps = await query(
      `SELECT id FROM otps
        WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL`,
      [userId, OTP_PURPOSE.EMAIL_VERIFICATION]
    );
    expect(otps.rows).toHaveLength(1);
  });

  it('should not reveal "unverified" when the password is wrong', async () => {
    // Wrong password on an unverified account must still look identical to
    // any other invalid-credentials response — otherwise the endpoint leaks
    // verification state, which is itself an enumeration vector.
    const unverified = { email: 'leak-check@test.com', password: 'rightpw12345' };
    await registerUser(unverified);

    const res = await request(app)
      .post('/auth/login')
      .send({ email: unverified.email, password: 'wrong-pass-1234' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid credentials/i);
    expect(res.body.requiresVerification).toBeUndefined();
  });
});

// ─── Token Verification ─────────────────────────────────────────────────────

describe('POST /auth/verify', () => {
  let validToken;
  let userId;

  beforeEach(async () => {
    const session = await registerVerifiedUser();
    validToken = session.token;
    userId     = session.user.id;
  });

  it('should confirm a valid access token', async () => {
    const res = await request(app)
      .post('/auth/verify')
      .send({ token: validToken });

    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.payload.sub).toBe(userId);
    expect(res.body.payload.email).toBe(TEST_USER.email);
  });

  it('should accept the token via Authorization header', async () => {
    const res = await request(app)
      .post('/auth/verify')
      .set('Authorization', `Bearer ${validToken}`);

    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
  });

  it('should reject an expired token with 401', async () => {
    const expired = jwt.sign(
      { sub: userId, email: TEST_USER.email },
      JWT_SECRET,
      { expiresIn: '0s' }
    );

    const res = await request(app)
      .post('/auth/verify')
      .send({ token: expired });

    expect(res.status).toBe(401);
    expect(res.body.valid).toBe(false);
  });

  it('should reject a token signed with the wrong secret', async () => {
    const forged = jwt.sign(
      { sub: userId, email: TEST_USER.email },
      'attacker-secret',
      { expiresIn: '15m' }
    );

    const res = await request(app)
      .post('/auth/verify')
      .send({ token: forged });

    expect(res.status).toBe(401);
    expect(res.body.valid).toBe(false);
  });

  it('should reject a token for a deleted user', async () => {
    await query('DELETE FROM refresh_tokens WHERE user_id = $1', [userId]);
    await query('DELETE FROM users WHERE id = $1', [userId]);

    const res = await request(app)
      .post('/auth/verify')
      .send({ token: validToken });

    expect(res.status).toBe(401);
    expect(res.body.valid).toBe(false);
    expect(res.body.error).toMatch(/user not found/i);
  });

  it('should reject a request with no token at all', async () => {
    const res = await request(app)
      .post('/auth/verify')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.valid).toBe(false);
  });
});

// ─── Token Refresh ───────────────────────────────────────────────────────────

describe('POST /auth/refresh', () => {
  let refreshToken;

  beforeEach(async () => {
    const session = await registerVerifiedUser();
    refreshToken = session.refreshToken;
  });

  it('should issue a new token pair and rotate the refresh token', async () => {
    const res = await request(app)
      .post('/auth/refresh')
      .send({ refreshToken });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
    expect(res.body.refreshToken).not.toBe(refreshToken);
  });

  it('should invalidate the old refresh token after rotation', async () => {
    await request(app)
      .post('/auth/refresh')
      .send({ refreshToken });

    const res = await request(app)
      .post('/auth/refresh')
      .send({ refreshToken });

    expect(res.status).toBe(401);
  });

  it('should reject a completely invalid refresh token', async () => {
    const res = await request(app)
      .post('/auth/refresh')
      .send({ refreshToken: 'garbage-token' });

    expect(res.status).toBe(401);
  });

  it('should reject a missing refresh token with 400', async () => {
    const res = await request(app)
      .post('/auth/refresh')
      .send({});

    expect(res.status).toBe(400);
  });

  it('should allow the new access token to pass verification', async () => {
    const refreshRes = await request(app)
      .post('/auth/refresh')
      .send({ refreshToken });

    const verifyRes = await request(app)
      .post('/auth/verify')
      .send({ token: refreshRes.body.token });

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.valid).toBe(true);
  });
});

// ─── Logout ──────────────────────────────────────────────────────────────────

describe('POST /auth/logout', () => {
  let refreshToken;

  beforeEach(async () => {
    const session = await registerVerifiedUser();
    refreshToken = session.refreshToken;
  });

  it('should revoke the refresh token and return success', async () => {
    const res = await request(app)
      .post('/auth/logout')
      .send({ refreshToken });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/logged out/i);
  });

  it('should prevent the revoked refresh token from being reused', async () => {
    await request(app)
      .post('/auth/logout')
      .send({ refreshToken });

    const res = await request(app)
      .post('/auth/refresh')
      .send({ refreshToken });

    expect(res.status).toBe(401);
  });

  it('should succeed even without a refresh token (graceful)', async () => {
    const res = await request(app)
      .post('/auth/logout')
      .send({});

    expect(res.status).toBe(200);
  });
});

// ─── Full Authentication Flow ────────────────────────────────────────────────

describe('End-to-end authentication flow', () => {
  it('should complete: register → verify-otp → login → verify → refresh → logout', async () => {
    const email    = 'flow@test.com';
    const password = 'flowpassword123';

    // 1. Register — no tokens yet
    const regRes = await request(app)
      .post('/auth/register')
      .send({ email, password });
    expect(regRes.status).toBe(201);
    expect(regRes.body.requiresVerification).toBe(true);

    // 2. Issue a known OTP via the module so we can submit it
    const userId = await getUserId(email);
    const { code } = await issueOtp({
      userId,
      purpose: OTP_PURPOSE.EMAIL_VERIFICATION,
    });

    // 3. Verify OTP — tokens issued here for the first time
    const verifyOtpRes = await request(app)
      .post('/auth/verify-otp')
      .send({ email, code });
    expect(verifyOtpRes.status).toBe(200);
    expect(verifyOtpRes.body.token).toBeDefined();

    // 4. Subsequent login also succeeds
    const loginRes = await request(app)
      .post('/auth/login')
      .send({ email, password });
    expect(loginRes.status).toBe(200);

    // 5. Verify the access token
    const verifyRes = await request(app)
      .post('/auth/verify')
      .send({ token: loginRes.body.token });
    expect(verifyRes.status).toBe(200);

    // 6. Refresh the token pair
    const refreshRes = await request(app)
      .post('/auth/refresh')
      .send({ refreshToken: loginRes.body.refreshToken });
    expect(refreshRes.status).toBe(200);

    // 7. Logout — revoke the new refresh token
    const logoutRes = await request(app)
      .post('/auth/logout')
      .send({ refreshToken: refreshRes.body.refreshToken });
    expect(logoutRes.status).toBe(200);

    // 8. The revoked token can no longer be used
    const reuseRes = await request(app)
      .post('/auth/refresh')
      .send({ refreshToken: refreshRes.body.refreshToken });
    expect(reuseRes.status).toBe(401);
  });
});
