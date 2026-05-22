import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import { app, initDB } from '../../src/index.js';
import { query } from '../../src/db.js';

// Configure SMTP env so email.js's "configured" branch is exercised. We
// don't intercept nodemailer here — the real transport will fail to send
// (no SMTP host at the fake hostname), but email.js catches that with the
// optional-chain `.catch()` in index.js, so the routes still respond 200/201.

process.env.SMTP_HOST = 'smtp.invalid.localhost';
process.env.SMTP_USER = 'noop';
process.env.SMTP_PASS = 'noop';

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

describe('email-sending branches', () => {
  it('register triggers the SMTP-configured branch of sendVerificationOtpEmail', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'smtp-branch@test.com', password: 'longenoughpw' });
    expect(res.status).toBe(201);
  });

  it('forgot-password triggers the SMTP-configured branch', async () => {
    await request(app)
      .post('/auth/register')
      .send({ email: 'fp-branch@test.com', password: 'longenoughpw' });
    await query('UPDATE users SET email_verified = TRUE WHERE email = $1', ['fp-branch@test.com']);
    const res = await request(app)
      .post('/auth/forgot-password')
      .send({ email: 'fp-branch@test.com' });
    expect(res.status).toBe(200);
  });

  it('login on an unverified account re-issues OTP via the configured SMTP branch', async () => {
    await request(app)
      .post('/auth/register')
      .send({ email: 'unverified-smtp@test.com', password: 'longenoughpw' });
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'unverified-smtp@test.com', password: 'longenoughpw' });
    expect(res.status).toBe(403);
    expect(res.body.requiresVerification).toBe(true);
  });
});
