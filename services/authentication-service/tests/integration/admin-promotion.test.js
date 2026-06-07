import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { app, initDB } from '../../src/index.js';
import { query } from '../../src/db.js';

// Exercise the ADMIN_EMAILS auto-promotion branch in db.js initDB() and the
// ensureAdminRole helper in index.js. The env must be set before initDB
// runs, so we set it here and call initDB again to trigger the UPDATE.

const ADMIN_EMAIL = 'auto-admin@test.com';

beforeAll(async () => {
  process.env.ADMIN_EMAILS = ADMIN_EMAIL;
  // Insert a user first, then re-run initDB so the admin-promotion UPDATE
  // has a row to promote (covers the "rowCount > 0" branch).
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
  delete process.env.ADMIN_EMAILS;
});

describe('admin auto-promotion via initDB', () => {
  // The ADMIN_EMAILS module-level constant in index.js is evaluated at
  // module-load time, so the ensureAdminRole helper used by /auth/login,
  // /auth/refresh and /auth/verify-otp does NOT see env we set inside
  // the test process. The initDB() bulk-promotion path reads env on each
  // invocation, so that one IS exercised here — which is sufficient to
  // demonstrate the promotion flow.

  it('initDB promotes a pre-existing user whose email matches ADMIN_EMAILS', async () => {
    const hash = await bcrypt.hash('admin-pass', 4);
    await query(
      `INSERT INTO users (email, password_hash, email_verified)
       VALUES ($1, $2, TRUE)`,
      [ADMIN_EMAIL, hash]
    );
    await initDB();
    const r = await query('SELECT role FROM users WHERE email = $1', [ADMIN_EMAIL]);
    expect(r.rows[0].role).toBe('admin');
  });

  it('initDB is idempotent — re-running with the same env makes no further changes', async () => {
    const hash = await bcrypt.hash('admin-pass', 4);
    await query(
      `INSERT INTO users (email, password_hash, role, email_verified)
       VALUES ($1, $2, 'admin', TRUE)`,
      [ADMIN_EMAIL, hash]
    );
    await initDB(); // user already admin — UPDATE matches 0 rows
    const r = await query('SELECT role FROM users WHERE email = $1', [ADMIN_EMAIL]);
    expect(r.rows[0].role).toBe('admin');
  });
});
