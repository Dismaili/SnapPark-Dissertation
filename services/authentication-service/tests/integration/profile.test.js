import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { app, initDB } from '../../src/index.js';
import { query } from '../../src/db.js';

// ─── Lifecycle ───────────────────────────────────────────────────────────────
// The profile/password endpoints accept the authenticated user id via an
// X-User-Id header set by the gateway. The auth-service does not re-verify
// the token on these routes — that's the gateway's job — so the tests use
// the header directly. This mirrors how the routes are reached in production.

const PROFILE_USER = {
  email: 'profile-tests@test.com',
  password: 'profilepass1234',
};

let userId;

beforeAll(async () => {
  await initDB();
});

beforeEach(async () => {
  await query('DELETE FROM otps');
  await query('DELETE FROM refresh_tokens');
  await query('DELETE FROM users');

  const hash = await bcrypt.hash(PROFILE_USER.password, 4);
  const r = await query(
    `INSERT INTO users (email, password_hash, first_name, last_name, email_verified)
     VALUES ($1, $2, $3, $4, TRUE)
     RETURNING id`,
    [PROFILE_USER.email, hash, 'First', 'Last']
  );
  userId = r.rows[0].id;
});

afterAll(async () => {
  await query('DELETE FROM otps');
  await query('DELETE FROM refresh_tokens');
  await query('DELETE FROM users');
});

// ─── PATCH /auth/profile ─────────────────────────────────────────────────────

describe('PATCH /auth/profile', () => {
  it('updates first and last name when both are provided', async () => {
    const res = await request(app)
      .patch('/auth/profile')
      .set('X-User-Id', userId)
      .send({ firstName: 'Updated', lastName: 'Name' });
    expect(res.status).toBe(200);
    expect(res.body.firstName).toBe('Updated');
    expect(res.body.lastName).toBe('Name');
  });

  it('updates only first name when last is omitted', async () => {
    const res = await request(app)
      .patch('/auth/profile')
      .set('X-User-Id', userId)
      .send({ firstName: 'OnlyFirst' });
    expect(res.status).toBe(200);
    expect(res.body.firstName).toBe('OnlyFirst');
    expect(res.body.lastName).toBe('Last');
  });

  it('updates only last name when first is omitted', async () => {
    const res = await request(app)
      .patch('/auth/profile')
      .set('X-User-Id', userId)
      .send({ lastName: 'OnlyLast' });
    expect(res.status).toBe(200);
    expect(res.body.lastName).toBe('OnlyLast');
    expect(res.body.firstName).toBe('First');
  });

  it('returns 401 when X-User-Id header is missing', async () => {
    const res = await request(app)
      .patch('/auth/profile')
      .send({ firstName: 'Anonymous' });
    expect(res.status).toBe(401);
  });

  it('returns 400 when no updatable fields are provided', async () => {
    const res = await request(app)
      .patch('/auth/profile')
      .set('X-User-Id', userId)
      .send({});
    expect(res.status).toBe(400);
  });

  it('trims and caps names to 100 characters', async () => {
    const long = 'a'.repeat(250);
    const res = await request(app)
      .patch('/auth/profile')
      .set('X-User-Id', userId)
      .send({ firstName: `  ${long}  `, lastName: 'OK' });
    expect(res.status).toBe(200);
    expect(res.body.firstName.length).toBeLessThanOrEqual(100);
  });
});

// ─── PATCH /auth/password ────────────────────────────────────────────────────

describe('PATCH /auth/password', () => {
  it('updates the password when the current one is correct', async () => {
    const res = await request(app)
      .patch('/auth/password')
      .set('X-User-Id', userId)
      .send({ currentPassword: PROFILE_USER.password, newPassword: 'newpass5678' });
    expect(res.status).toBe(200);

    // The new password should now authenticate.
    const login = await request(app)
      .post('/auth/login')
      .send({ email: PROFILE_USER.email, password: 'newpass5678' });
    expect(login.status).toBe(200);
  });

  it('returns 401 with no X-User-Id', async () => {
    const res = await request(app)
      .patch('/auth/password')
      .send({ currentPassword: 'a', newPassword: 'b' });
    expect(res.status).toBe(401);
  });

  it('returns 400 when fields are missing', async () => {
    const a = await request(app)
      .patch('/auth/password')
      .set('X-User-Id', userId)
      .send({ newPassword: 'newpass5678' });
    const b = await request(app)
      .patch('/auth/password')
      .set('X-User-Id', userId)
      .send({ currentPassword: PROFILE_USER.password });
    expect(a.status).toBe(400);
    expect(b.status).toBe(400);
  });

  it('returns 400 when the new password is too short', async () => {
    const res = await request(app)
      .patch('/auth/password')
      .set('X-User-Id', userId)
      .send({ currentPassword: PROFILE_USER.password, newPassword: 'short' });
    expect(res.status).toBe(400);
  });

  it('returns 401 when the current password is wrong', async () => {
    const res = await request(app)
      .patch('/auth/password')
      .set('X-User-Id', userId)
      .send({ currentPassword: 'wrong-current-pw', newPassword: 'newpass5678' });
    expect(res.status).toBe(401);
  });

  it('returns 404 when the authenticated user no longer exists', async () => {
    await query('DELETE FROM users WHERE id = $1', [userId]);
    const res = await request(app)
      .patch('/auth/password')
      .set('X-User-Id', userId)
      .send({ currentPassword: PROFILE_USER.password, newPassword: 'newpass5678' });
    expect(res.status).toBe(404);
  });
});
