import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import { app, initDB } from '../../src/index.js';
import { query } from '../../src/db.js';

// Trip the remaining condition branches in index.js: missing-body fallbacks
// (req.body ?? {} on every route), non-string firstName/lastName ternaries,
// and the verify-otp / reset-password "invalid but not too-many-attempts"
// path that errors.test.js doesn't quite reach.

beforeAll(async () => {
  await initDB();
});

beforeEach(async () => {
  await query('DELETE FROM otps');
  await query('DELETE FROM refresh_tokens');
  await query('DELETE FROM users');
});

afterAll(async () => {
  await query('DELETE FROM otps');
  await query('DELETE FROM refresh_tokens');
  await query('DELETE FROM users');
});

describe('missing-body fallbacks (req.body ?? {})', () => {
  // supertest .post() without .send() leaves body undefined → Express's
  // body-parser produces {}, which still trips the destructuring fallback
  // chain. To exercise the `??` operator properly we send a Content-Type
  // header with no body (Content-Length 0).
  const noBody = (path) =>
    request(app).post(path).set('Content-Type', 'application/json');

  it.each([
    '/auth/register', '/auth/login', '/auth/refresh', '/auth/logout',
    '/auth/verify-otp', '/auth/resend-otp', '/auth/forgot-password', '/auth/reset-password',
  ])('handles %s with no body without crashing', async (path) => {
    const res = await noBody(path);
    // Every route must respond 400/401/200 — not 500
    expect([200, 400, 401]).toContain(res.status);
  });

  it('PATCH /auth/profile with no body and X-User-Id returns 400', async () => {
    const reg = await request(app).post('/auth/register').send({ email: 'p@x.c', password: 'longenoughpw' });
    expect(reg.status).toBe(201);
    const r = await query('SELECT id FROM users WHERE email = $1', ['p@x.c']);
    const userId = r.rows[0].id;

    const res = await request(app)
      .patch('/auth/profile')
      .set('X-User-Id', userId)
      .set('Content-Type', 'application/json');
    expect(res.status).toBe(400);
  });

  it('PATCH /auth/password with no body and X-User-Id returns 400', async () => {
    const reg = await request(app).post('/auth/register').send({ email: 'pw@x.c', password: 'longenoughpw' });
    const r = await query('SELECT id FROM users WHERE email = $1', ['pw@x.c']);
    const userId = r.rows[0].id;

    const res = await request(app)
      .patch('/auth/password')
      .set('X-User-Id', userId)
      .set('Content-Type', 'application/json');
    expect(res.status).toBe(400);
  });
});

describe('non-string firstName / lastName branch', () => {
  it('register treats numeric firstName/lastName as "not a string" → stored as null', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'numname@test.com', password: 'longenoughpw', firstName: 12345, lastName: false });
    expect(res.status).toBe(201);
    const r = await query('SELECT first_name, last_name FROM users WHERE email = $1', ['numname@test.com']);
    expect(r.rows[0].first_name).toBeNull();
    expect(r.rows[0].last_name).toBeNull();
  });
});

describe('reset-password: invalid (but not too-many-attempts) path returns 400', () => {
  it('returns 400 on a wrong code that is not the 5th wrong attempt', async () => {
    // Register + verify a user, then issue a password-reset OTP and submit
    // a single wrong code (not enough to trip the attempt limit).
    await request(app).post('/auth/register').send({ email: 'rp@x.c', password: 'longenoughpw' });
    await query('UPDATE users SET email_verified = TRUE WHERE email = $1', ['rp@x.c']);
    const userIdRow = await query('SELECT id FROM users WHERE email = $1', ['rp@x.c']);
    const userId = userIdRow.rows[0].id;

    // Manually insert a reset OTP so we know the correct code (force wrong).
    await query(
      `INSERT INTO otps (user_id, purpose, code_hash, expires_at)
       VALUES ($1, 'password_reset', $2, NOW() + INTERVAL '10 minutes')`,
      [userId, '0'.repeat(64)]
    );

    const res = await request(app)
      .post('/auth/reset-password')
      .send({ email: 'rp@x.c', code: '0000', newPassword: 'fresh-password-12345' });
    expect(res.status).toBe(400);
  });

  it('returns 429 only after MAX_ATTEMPTS wrong submissions', async () => {
    await request(app).post('/auth/register').send({ email: 'rpa@x.c', password: 'longenoughpw' });
    await query('UPDATE users SET email_verified = TRUE WHERE email = $1', ['rpa@x.c']);
    const userIdRow = await query('SELECT id FROM users WHERE email = $1', ['rpa@x.c']);
    const userId = userIdRow.rows[0].id;

    await query(
      `INSERT INTO otps (user_id, purpose, code_hash, expires_at, attempts)
       VALUES ($1, 'password_reset', $2, NOW() + INTERVAL '10 minutes', 5)`,
      [userId, '0'.repeat(64)]
    );
    const res = await request(app)
      .post('/auth/reset-password')
      .send({ email: 'rpa@x.c', code: '0000', newPassword: 'fresh-password-12345' });
    expect(res.status).toBe(429);
  });
});
