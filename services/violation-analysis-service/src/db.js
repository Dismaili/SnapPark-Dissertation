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
 * Create tables on first start (idempotent).
 * Owned exclusively by this service — Database-per-Service pattern.
 *
 * Status flow:
 *   pending → completed → reported_to_authority → resolved
 *   pending → expired (auto-cleanup after threshold)
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
      image_count         INTEGER NOT NULL DEFAULT 1,
      created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      completed_at        TIMESTAMP WITH TIME ZONE,
      cancelled_at        TIMESTAMP WITH TIME ZONE,
      reported_at         TIMESTAMP WITH TIME ZONE,
      resolved_at         TIMESTAMP WITH TIME ZONE
    );

    CREATE INDEX IF NOT EXISTS idx_cases_user_id  ON cases (user_id);
    CREATE INDEX IF NOT EXISTS idx_cases_created  ON cases (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_cases_status   ON cases (status);

    CREATE TABLE IF NOT EXISTS case_images (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      case_id          UUID NOT NULL,
      image_index      INTEGER NOT NULL DEFAULT 0,
      image_mime_type  TEXT NOT NULL,
      image_size_bytes INTEGER NOT NULL,
      quality_stats    JSONB,
      created_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_case_images_case_id ON case_images (case_id);

    CREATE TABLE IF NOT EXISTS case_audit_log (
      id             BIGSERIAL PRIMARY KEY,
      event_id       UUID NOT NULL DEFAULT gen_random_uuid(),
      event_type     TEXT NOT NULL,
      case_id        UUID,
      user_id        TEXT,
      payload        JSONB NOT NULL,
      occurred_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_audit_case_id     ON case_audit_log (case_id);
    CREATE INDEX IF NOT EXISTS idx_audit_user_id     ON case_audit_log (user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_event_type  ON case_audit_log (event_type);
    CREATE INDEX IF NOT EXISTS idx_audit_occurred_at ON case_audit_log (occurred_at DESC);
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
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cases' AND column_name = 'image_count') THEN
        ALTER TABLE cases ADD COLUMN image_count INTEGER NOT NULL DEFAULT 1;
      END IF;
    END
    $$;
  `);

  console.log('[DB] Schema initialised successfully');
};

// ─── Case Images ─────────────────────────────────────────────────────────────

/**
 * Insert a record for each image submitted in a case.
 */
export const insertCaseImages = async (caseId, images) => {
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    await query(
      `INSERT INTO case_images (case_id, image_index, image_mime_type, image_size_bytes, quality_stats)
       VALUES ($1, $2, $3, $4, $5)`,
      [caseId, i, img.mimeType, img.sizeBytes, img.qualityStats ? JSON.stringify(img.qualityStats) : null]
    );
  }
};

/**
 * Get all images for a case, ordered by index.
 */
export const getCaseImages = async (caseId) => {
  const result = await query(
    'SELECT * FROM case_images WHERE case_id = $1 ORDER BY image_index',
    [caseId]
  );
  return result.rows;
};

// ─── Audit Log (NFR6 — Auditability) ─────────────────────────────────────────
//
// Append-only event log for all significant case state changes.
// Supports legal accountability and tamper-proof history requirements.

/**
 * Append an event to the audit log.
 * This table is append-only — never updated or deleted.
 *
 * @param {{ eventType: string, caseId?: string, userId?: string, payload: object }} entry
 */
export const auditLog = async ({ eventType, caseId, userId, payload }) => {
  try {
    await query(
      `INSERT INTO case_audit_log (event_type, case_id, user_id, payload)
       VALUES ($1, $2, $3, $4)`,
      [eventType, caseId || null, userId || null, JSON.stringify(payload)]
    );
  } catch (err) {
    // Audit failures must never crash the main flow
    console.error('[audit] Failed to write audit log:', err.message);
  }
};

/**
 * Get the full audit trail for a specific case, oldest first.
 */
export const getAuditLog = async (caseId) => {
  const result = await query(
    'SELECT * FROM case_audit_log WHERE case_id = $1 ORDER BY occurred_at ASC',
    [caseId]
  );
  return result.rows;
};

/**
 * Get all audit events for a user.
 */
export const getAuditLogByUser = async (userId, limit = 50, offset = 0) => {
  const result = await query(
    'SELECT * FROM case_audit_log WHERE user_id = $1 ORDER BY occurred_at DESC LIMIT $2 OFFSET $3',
    [userId, limit, offset]
  );
  return result.rows;
};

export default pool;
