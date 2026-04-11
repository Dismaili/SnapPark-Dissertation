import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app, initDB } from '../../src/index.js';
import { query } from '../../src/db.js';
import pool from '../../src/db.js';

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
  // Clean state before every test to ensure isolation
  await query('DELETE FROM refresh_tokens');
  await query('DELETE FROM users');
});

afterAll(async () => {
  await query('DELETE FROM refresh_tokens');
  await query('DELETE FROM users');
  await pool.end();
});

// ─── Helper ──────────────────────────────────────────────────────────────────

const registerUser = (user = TEST_USER) =>
  request(app).post('/auth/register').send(user);

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
  it('should register a new user and return tokens', async () => {
    const res = await registerUser();

    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe(TEST_USER.email);
    expect(res.body.user.id).toBeDefined();
    expect(res.body.user.createdAt).toBeDefined();
    expect(res.body.token).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
  });

  it('should return a valid access token with correct claims', async () => {
    const res = await registerUser();
    const decoded = jwt.verify(res.body.token, JWT_SECRET);

    expect(decoded.sub).toBe(res.body.user.id);
    expect(decoded.email).toBe(TEST_USER.email);
    expect(decoded.exp).toBeDefined();
  });

  it('should store the refresh token in the database', async () => {
    const res = await registerUser();
    const stored = await query(
      'SELECT * FROM refresh_tokens WHERE user_id = $1',
      [res.body.user.id]
    );

    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0].token).toBe(res.body.refreshToken);
  });

  it('should normalise email to lowercase', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'USER@EXAMPLE.COM', password: 'securepassword123' });

    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe('user@example.com');
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

// ─── Login ───────────────────────────────────────────────────────────────────

describe('POST /auth/login', () => {
  beforeEach(async () => {
    await registerUser();
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

    // Both responses must be indistinguishable to the caller
    expect(wrongEmail.status).toBe(wrongPassword.status);
    expect(wrongEmail.body.error).toBe(wrongPassword.body.error);
  });

  it('should reject missing fields with 400', async () => {
    const noEmail = await request(app).post('/auth/login').send({ password: 'x' });
    const noPass  = await request(app).post('/auth/login').send({ email: 'x@x.com' });

    expect(noEmail.status).toBe(400);
    expect(noPass.status).toBe(400);
  });
});

// ─── Token Verification ─────────────────────────────────────────────────────

describe('POST /auth/verify', () => {
  let validToken;
  let userId;

  beforeEach(async () => {
    const res = await registerUser();
    validToken = res.body.token;
    userId = res.body.user.id;
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
    // Create a token that already expired
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
    const res = await registerUser();
    refreshToken = res.body.refreshToken;
  });

  it('should issue a new token pair and rotate the refresh token', async () => {
    const res = await request(app)
      .post('/auth/refresh')
      .send({ refreshToken });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();

    // The new refresh token must differ from the old one (rotation)
    expect(res.body.refreshToken).not.toBe(refreshToken);
  });

  it('should invalidate the old refresh token after rotation', async () => {
    await request(app)
      .post('/auth/refresh')
      .send({ refreshToken });

    // Attempting to reuse the old token must fail
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
    const res = await registerUser();
    refreshToken = res.body.refreshToken;
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
  it('should complete: register → login → verify → refresh → logout', async () => {
    // 1. Register
    const regRes = await request(app)
      .post('/auth/register')
      .send({ email: 'flow@test.com', password: 'flowpassword123' });
    expect(regRes.status).toBe(201);

    // 2. Login with the same credentials
    const loginRes = await request(app)
      .post('/auth/login')
      .send({ email: 'flow@test.com', password: 'flowpassword123' });
    expect(loginRes.status).toBe(200);

    // 3. Verify the access token
    const verifyRes = await request(app)
      .post('/auth/verify')
      .send({ token: loginRes.body.token });
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.valid).toBe(true);

    // 4. Refresh the token pair
    const refreshRes = await request(app)
      .post('/auth/refresh')
      .send({ refreshToken: loginRes.body.refreshToken });
    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.token).toBeDefined();

    // 5. Logout — revoke the new refresh token
    const logoutRes = await request(app)
      .post('/auth/logout')
      .send({ refreshToken: refreshRes.body.refreshToken });
    expect(logoutRes.status).toBe(200);

    // 6. Confirm the revoked token can no longer be used
    const reuseRes = await request(app)
      .post('/auth/refresh')
      .send({ refreshToken: refreshRes.body.refreshToken });
    expect(reuseRes.status).toBe(401);
  });
});
