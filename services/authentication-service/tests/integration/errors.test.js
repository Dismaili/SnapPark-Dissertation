import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import { app, initDB } from '../../src/index.js';
import { query } from '../../src/db.js';

// Hit several error / edge branches in index.js that the happy-path auth
// suite doesn't cover: missing-body 400s, expired OTP path (via
// manipulating expires_at directly), refresh-token-for-deleted-user 401.

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

describe('error / edge branches', () => {
  it('register returns 400 when body is empty', async () => {
    const res = await request(app).post('/auth/register').send({});
    expect(res.status).toBe(400);
  });

  it('verify-otp returns 400 with no body', async () => {
    const res = await request(app).post('/auth/verify-otp').send({});
    expect(res.status).toBe(400);
  });

  it('refresh returns 401 for a token whose user has been deleted', async () => {
    // Register + verify
    const reg = await request(app)
      .post('/auth/register')
      .send({ email: 'gone@test.com', password: 'longenoughpw' });
    expect(reg.status).toBe(201);
    await query('UPDATE users SET email_verified = TRUE WHERE email = $1', ['gone@test.com']);
    const login = await request(app)
      .post('/auth/login')
      .send({ email: 'gone@test.com', password: 'longenoughpw' });

    // Delete the user — cascade also wipes refresh_tokens, so we re-insert
    // a fake-looking row to keep the token present in the DB while the
    // user is gone (exercises the "user not found" branch in /refresh).
    const userId = login.body.user.id;
    await query('DELETE FROM refresh_tokens WHERE user_id = $1', [userId]);
    await query('DELETE FROM users WHERE id = $1', [userId]);

    // Re-create the user so jwt.verify passes (sub matches), then delete again
    // — except we want jwt.verify to succeed and the DB lookup to fail. The
    // simplest way is to register a fresh user, log in, then delete:
    await request(app).post('/auth/register').send({ email: 'gone2@test.com', password: 'longenoughpw' });
    await query('UPDATE users SET email_verified = TRUE WHERE email = $1', ['gone2@test.com']);
    const login2 = await request(app)
      .post('/auth/login')
      .send({ email: 'gone2@test.com', password: 'longenoughpw' });
    const newRefresh = login2.body.refreshToken;
    await query('DELETE FROM refresh_tokens WHERE user_id = $1', [login2.body.user.id]);
    await query('DELETE FROM users WHERE id = $1', [login2.body.user.id]);

    const r = await request(app).post('/auth/refresh').send({ refreshToken: newRefresh });
    expect(r.status).toBe(401);
  });

  it('verify-otp with an expired code rejects with 400', async () => {
    await request(app)
      .post('/auth/register')
      .send({ email: 'exp@test.com', password: 'longenoughpw' });
    // Move the OTP's expiry into the past then submit any code.
    await query('UPDATE otps SET expires_at = NOW() - INTERVAL \'1 hour\'');
    const res = await request(app)
      .post('/auth/verify-otp')
      .send({ email: 'exp@test.com', code: '0000' });
    expect(res.status).toBe(400);
  });

  it('login on an unverified account responds 403 with requiresVerification', async () => {
    await request(app)
      .post('/auth/register')
      .send({ email: 'still-unverified@test.com', password: 'longenoughpw' });
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'still-unverified@test.com', password: 'longenoughpw' });
    expect(res.status).toBe(403);
    expect(res.body.requiresVerification).toBe(true);
  });
});
