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
// Embedding dimension. text-embedding-004 returns 768-D vectors.
// Centralised here so the schema migration, the embedding module, and
// any future model swap all reference the same constant.
export const EMBEDDING_DIM = 768;

export const initDB = async () => {
  // Enable pgvector. Idempotent — no-op once installed. Without this,
  // the `vector` type does not exist and the embedding column below
  // would fail to create.
  await pool.query(`CREATE EXTENSION IF NOT EXISTS vector`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS cases (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id             TEXT NOT NULL,
      status              TEXT NOT NULL DEFAULT 'completed',
      violation_confirmed BOOLEAN NOT NULL,
      violation_type      TEXT,
      confidence          NUMERIC(5, 4),
      explanation         TEXT,
      license_plate       TEXT,
      latitude            NUMERIC(10, 7),
      longitude           NUMERIC(10, 7),
      location_label      TEXT,
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
      image_data       BYTEA,
      quality_stats    JSONB,
      created_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_case_images_case_id ON case_images (case_id);

    -- Backfill column for installations that pre-date image_data
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name = 'case_images' AND column_name = 'image_data') THEN
        ALTER TABLE case_images ADD COLUMN image_data BYTEA;
      END IF;
    END
    $$;

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

    -- Saga state table.
    -- Persisting saga state at every transition is what distinguishes a real
    -- saga from a sequence of try/catch blocks: if the service crashes after
    -- step N succeeds but before step N+1 starts, on restart we can read the
    -- last-known state and decide whether to resume forward or compensate.
    -- The 'history' column is an append-only audit trail of every step
    -- attempt and every compensation attempt — surfaced verbatim in
    -- /sagas/:id for dissertation evidence.
    CREATE TABLE IF NOT EXISTS sagas (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      saga_type    TEXT NOT NULL,
      status       TEXT NOT NULL,
      context      JSONB NOT NULL,
      current_step TEXT,
      history      JSONB NOT NULL DEFAULT '[]'::jsonb,
      error        TEXT,
      created_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_sagas_status    ON sagas (status);
    CREATE INDEX IF NOT EXISTS idx_sagas_saga_type ON sagas (saga_type);
    CREATE INDEX IF NOT EXISTS idx_sagas_created   ON sagas (created_at DESC);
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
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cases' AND column_name = 'license_plate') THEN
        ALTER TABLE cases ADD COLUMN license_plate TEXT;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cases' AND column_name = 'latitude') THEN
        ALTER TABLE cases ADD COLUMN latitude NUMERIC(10, 7);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cases' AND column_name = 'longitude') THEN
        ALTER TABLE cases ADD COLUMN longitude NUMERIC(10, 7);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cases' AND column_name = 'location_label') THEN
        ALTER TABLE cases ADD COLUMN location_label TEXT;
      END IF;
    END
    $$;
  `);

  // ── Polyglot persistence: vector embeddings ────────────────────────────────
  // The cases table holds standard relational columns (status, confidence,
  // license_plate, …) and a 768-dimensional embedding of the AI's
  // explanation/verdict text. The embedding column lives in the same row
  // as the relational data, so similarity search and exact-match queries
  // operate on the same source of truth.
  //
  // The HNSW index uses cosine distance — appropriate for normalised
  // text-embedding vectors. lists/m/ef_construction are pgvector defaults
  // tuned for "tens of thousands of rows" which comfortably covers the
  // dissertation demo and any plausible single-instance production load.
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name = 'cases' AND column_name = 'embedding') THEN
        ALTER TABLE cases ADD COLUMN embedding vector(${EMBEDDING_DIM});
      END IF;
    END
    $$;

    CREATE INDEX IF NOT EXISTS idx_cases_embedding_hnsw
      ON cases USING hnsw (embedding vector_cosine_ops);
  `);

  console.log('[DB] Schema initialised successfully');
};

// ─── Case Images ─────────────────────────────────────────────────────────────

/**
 * Insert a record for each image submitted in a case.
 * The raw bytes are stored in `image_data` so the frontend can later display
 * the photo alongside the AI verdict (no S3 / object store needed for the demo).
 */
export const insertCaseImages = async (caseId, images) => {
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    await query(
      `INSERT INTO case_images (case_id, image_index, image_mime_type, image_size_bytes, image_data, quality_stats)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        caseId,
        i,
        img.mimeType,
        img.sizeBytes,
        img.data || null,
        img.qualityStats ? JSON.stringify(img.qualityStats) : null,
      ]
    );
  }
};

/**
 * Get all images for a case, ordered by index — metadata only.
 * The bytes column (`image_data`) is excluded; use `getCaseImageBytes`
 * for the binary payload of a single image.
 */
export const getCaseImages = async (caseId) => {
  const result = await query(
    `SELECT id, case_id, image_index, image_mime_type, image_size_bytes, quality_stats, created_at
     FROM case_images WHERE case_id = $1 ORDER BY image_index`,
    [caseId]
  );
  return result.rows;
};

/**
 * Fetch the raw bytes (and mime type) for a single image of a case.
 * Returns null if no row exists.
 */
export const getCaseImageBytes = async (caseId, imageIndex) => {
  const result = await query(
    `SELECT image_mime_type, image_data
     FROM case_images
     WHERE case_id = $1 AND image_index = $2`,
    [caseId, imageIndex]
  );
  return result.rows[0] || null;
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

// ─── Vector embeddings (pgvector polyglot persistence) ──────────────────────

/**
 * Convert a JS number array to pgvector's textual representation.
 * pgvector accepts strings of the form "[0.1,0.2,…]" for inserts and
 * comparisons; the node-postgres driver does NOT serialise typed arrays
 * for us, so we do the conversion explicitly to avoid silent failures.
 */
const toPgvector = (vec) => `[${vec.join(',')}]`;

/**
 * Persist an embedding for an existing case. The embedding is computed
 * from the AI verdict text (see embeddings.js) and is deliberately stored
 * AFTER the case row exists, so a Gemini-embedding failure leaves the
 * relational data intact (the saga's embedAndIndex step compensates by
 * clearing the column rather than the whole case).
 */
export const setCaseEmbedding = async (caseId, embedding) => {
  if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIM) {
    throw new Error(`Invalid embedding: expected array of ${EMBEDDING_DIM} numbers`);
  }
  await query(
    `UPDATE cases SET embedding = $1::vector WHERE id = $2`,
    [toPgvector(embedding), caseId]
  );
};

export const clearCaseEmbedding = async (caseId) => {
  await query(`UPDATE cases SET embedding = NULL WHERE id = $1`, [caseId]);
};

/**
 * Find the N cases most semantically similar to the given case, ordered
 * by cosine distance ascending (smaller = more similar). The source case
 * is excluded from results so the caller doesn't have to filter it out.
 *
 * Returns rows with a `distance` column (0 = identical, 1 = orthogonal,
 * 2 = opposite) so the UI can render relative similarity scores.
 *
 * Note: requires the source case to have a non-null embedding. Callers
 * that want a "find similar to a query string" flavour can compute the
 * query embedding directly and call findSimilarByEmbedding() below.
 */
export const findSimilarCases = async (caseId, limit = 5) => {
  const r = await query(
    `SELECT c.id, c.user_id, c.status, c.violation_confirmed, c.violation_type,
            c.confidence, c.explanation, c.license_plate, c.created_at,
            c.embedding <=> src.embedding AS distance
       FROM cases c, cases src
      WHERE src.id = $1
        AND src.embedding IS NOT NULL
        AND c.id <> src.id
        AND c.embedding IS NOT NULL
      ORDER BY distance ASC
      LIMIT $2`,
    [caseId, limit]
  );
  return r.rows;
};

export const findSimilarByEmbedding = async (embedding, limit = 5) => {
  if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIM) {
    throw new Error(`Invalid embedding: expected array of ${EMBEDDING_DIM} numbers`);
  }
  const r = await query(
    `SELECT id, user_id, status, violation_confirmed, violation_type,
            confidence, explanation, license_plate, created_at,
            embedding <=> $1::vector AS distance
       FROM cases
      WHERE embedding IS NOT NULL
      ORDER BY distance ASC
      LIMIT $2`,
    [toPgvector(embedding), limit]
  );
  return r.rows;
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
