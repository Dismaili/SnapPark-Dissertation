import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

// Connection pool — shared across all requests for efficiency
const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME     || 'auth_db',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  max: 10,                    // maximum connections in pool
  idleTimeoutMillis: 30000,   // close idle connections after 30s
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected error on idle client:', err.message);
});

/**
 * Run a parameterised SQL query.
 * @param {string} text  – SQL statement with $1, $2 … placeholders
 * @param {any[]}  params – values bound to the placeholders
 */
export const query = (text, params) => pool.query(text, params);

/**
 * Create tables on first start (idempotent — safe to run on every boot).
 * The Authentication Service is the sole owner of these tables;
 * no other service reads or writes here (Database-per-Service pattern).
 */
export const initDB = async () => {
  await pool.query(`
    -- Users table: stores credentials and profile data
    CREATE TABLE IF NOT EXISTS users (
      id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email                      VARCHAR(255) UNIQUE NOT NULL,
      password_hash              VARCHAR(255) NOT NULL,
      role                       VARCHAR(16)  NOT NULL DEFAULT 'citizen',
      first_name                 VARCHAR(100),
      last_name                  VARCHAR(100),
      email_verified             BOOLEAN NOT NULL DEFAULT FALSE,
      verification_token         UUID,
      verification_token_expires TIMESTAMP WITH TIME ZONE,
      created_at                 TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at                 TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    -- Backfill columns for installations created before they existed
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name = 'users' AND column_name = 'role') THEN
        ALTER TABLE users ADD COLUMN role VARCHAR(16) NOT NULL DEFAULT 'citizen';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name = 'users' AND column_name = 'first_name') THEN
        ALTER TABLE users ADD COLUMN first_name VARCHAR(100);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name = 'users' AND column_name = 'last_name') THEN
        ALTER TABLE users ADD COLUMN last_name VARCHAR(100);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name = 'users' AND column_name = 'email_verified') THEN
        ALTER TABLE users ADD COLUMN email_verified BOOLEAN NOT NULL DEFAULT FALSE;
        -- Treat existing accounts as already verified so they aren't locked out
        UPDATE users SET email_verified = TRUE WHERE email_verified = FALSE;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name = 'users' AND column_name = 'verification_token') THEN
        ALTER TABLE users ADD COLUMN verification_token UUID;
        ALTER TABLE users ADD COLUMN verification_token_expires TIMESTAMP WITH TIME ZONE;
      END IF;
    END
    $$;

    -- Refresh tokens table: supports token rotation and revocation
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token      TEXT UNIQUE NOT NULL,
      expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    -- Index for fast token look-ups during verification
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token
      ON refresh_tokens (token);

    -- Index for efficient clean-up of a user's tokens on logout
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id
      ON refresh_tokens (user_id);

    -- One-time passwords for email verification and password reset.
    -- A single table serves both flows; the 'purpose' column distinguishes them
    -- so the same generate/verify code path can be reused.
    CREATE TABLE IF NOT EXISTS otps (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      purpose     VARCHAR(32) NOT NULL,
      code_hash   VARCHAR(128) NOT NULL,
      expires_at  TIMESTAMP WITH TIME ZONE NOT NULL,
      attempts    INTEGER NOT NULL DEFAULT 0,
      consumed_at TIMESTAMP WITH TIME ZONE,
      created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    -- Look up the active OTP for a (user, purpose) pair. Partial index on the
    -- subset that matters: not-yet-consumed rows.
    CREATE INDEX IF NOT EXISTS idx_otps_active
      ON otps (user_id, purpose)
      WHERE consumed_at IS NULL;
  `);

  // Promote any pre-configured admin emails (comma-separated in ADMIN_EMAILS).
  // Lets the dissertation demo bootstrap a real admin account without manual SQL.
  const adminEmails = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (adminEmails.length > 0) {
    const r = await pool.query(
      `UPDATE users SET role = 'admin', updated_at = NOW()
       WHERE email = ANY($1::text[]) AND role <> 'admin'
       RETURNING email`,
      [adminEmails]
    );
    if (r.rowCount > 0) {
      console.log(`[DB] Promoted ${r.rowCount} user(s) to admin: ${r.rows.map((x) => x.email).join(', ')}`);
    }
  }

  console.log('[DB] Schema initialised successfully');
};

export default pool;
