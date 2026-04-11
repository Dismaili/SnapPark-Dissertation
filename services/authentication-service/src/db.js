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
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email        VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      created_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

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
  `);

  console.log('[DB] Schema initialised successfully');
};

export default pool;
