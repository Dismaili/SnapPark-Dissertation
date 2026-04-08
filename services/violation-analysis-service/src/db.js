import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 2_000,
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected error on idle client:', err.message);
});

export const query = (text, params) => pool.query(text, params);

/**
 * Create the cases table on first start (idempotent).
 * Owned exclusively by this service — Database-per-Service pattern.
 *
 * Status flow:
 *   completed → reported_to_authority → resolved
 *   completed → cancelled
 */
export const initDB = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cases (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id             TEXT NOT NULL,
      status              TEXT NOT NULL DEFAULT 'completed',
      violation_confirmed BOOLEAN NOT NULL,
      violation_type      TEXT,
      confidence          NUMERIC(5, 4),
      explanation         TEXT,
      image_mime_type     TEXT,
      image_size_bytes    INTEGER,
      created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      completed_at        TIMESTAMP WITH TIME ZONE,
      cancelled_at        TIMESTAMP WITH TIME ZONE,
      reported_at         TIMESTAMP WITH TIME ZONE,
      resolved_at         TIMESTAMP WITH TIME ZONE
    );

    CREATE INDEX IF NOT EXISTS idx_cases_user_id  ON cases (user_id);
    CREATE INDEX IF NOT EXISTS idx_cases_created  ON cases (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_cases_status   ON cases (status);
  `);

  // Add columns to existing tables created before these columns existed
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cases' AND column_name = 'status') THEN
        ALTER TABLE cases ADD COLUMN status TEXT NOT NULL DEFAULT 'completed';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cases' AND column_name = 'completed_at') THEN
        ALTER TABLE cases ADD COLUMN completed_at TIMESTAMP WITH TIME ZONE;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cases' AND column_name = 'cancelled_at') THEN
        ALTER TABLE cases ADD COLUMN cancelled_at TIMESTAMP WITH TIME ZONE;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cases' AND column_name = 'reported_at') THEN
        ALTER TABLE cases ADD COLUMN reported_at TIMESTAMP WITH TIME ZONE;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cases' AND column_name = 'resolved_at') THEN
        ALTER TABLE cases ADD COLUMN resolved_at TIMESTAMP WITH TIME ZONE;
      END IF;
    END
    $$;
  `);

  console.log('[DB] Schema initialised successfully');
};

export default pool;
