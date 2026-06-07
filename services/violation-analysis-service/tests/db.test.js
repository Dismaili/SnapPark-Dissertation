import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the `pg` module entirely so we can capture the SQL sent to a fake Pool.
const mockPoolQuery = vi.fn();
const mockPoolOn    = vi.fn();
vi.mock('pg', () => ({
  default: { Pool: class { constructor() {} query(...a) { return mockPoolQuery(...a); } on(...a) { return mockPoolOn(...a); } } },
}));

const db = await import('../src/db.js');

beforeEach(() => {
  vi.clearAllMocks();
  mockPoolQuery.mockResolvedValue({ rows: [], rowCount: 0 });
});

// ─── query / initDB ─────────────────────────────────────────────────────────

describe('query', () => {
  it('forwards SQL + params to the pool', async () => {
    await db.query('SELECT 1', [42]);
    expect(mockPoolQuery).toHaveBeenCalledWith('SELECT 1', [42]);
  });
});

describe('initDB', () => {
  it('runs the schema migrations (vector ext + tables + columns + index)', async () => {
    await db.initDB();
    // multiple pool.query calls are made: extension, base schema, ALTER TABLE,
    // embedding column + HNSW index.
    expect(mockPoolQuery.mock.calls.length).toBeGreaterThanOrEqual(4);
    const allSql = mockPoolQuery.mock.calls.map((c) => c[0]).join('\n');
    expect(allSql).toMatch(/CREATE EXTENSION IF NOT EXISTS vector/);
    expect(allSql).toMatch(/CREATE TABLE IF NOT EXISTS cases/);
    expect(allSql).toMatch(/CREATE TABLE IF NOT EXISTS sagas/);
    expect(allSql).toMatch(/idx_cases_embedding_hnsw/);
  });
});

// ─── insertCaseImages / getCaseImages / getCaseImageBytes ───────────────────

describe('insertCaseImages', () => {
  it('inserts one row per image with its index, mime, size and quality stats', async () => {
    await db.insertCaseImages('case-1', [
      { mimeType: 'image/png', sizeBytes: 10, data: Buffer.from('a'), qualityStats: { brightness: 0.5 } },
      { mimeType: 'image/jpeg', sizeBytes: 20 },
    ]);
    expect(mockPoolQuery).toHaveBeenCalledTimes(2);
    const [, params1] = mockPoolQuery.mock.calls[0];
    expect(params1[0]).toBe('case-1');
    expect(params1[1]).toBe(0);
    expect(params1[2]).toBe('image/png');
    const [, params2] = mockPoolQuery.mock.calls[1];
    expect(params2[1]).toBe(1);
    // image_data should be null when not provided
    expect(params2[4]).toBeNull();
    // quality_stats should be null when not provided
    expect(params2[5]).toBeNull();
  });
});

describe('getCaseImages', () => {
  it('returns rows for a case ordered by index', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ image_index: 0 }, { image_index: 1 }] });
    const r = await db.getCaseImages('case-1');
    expect(r).toHaveLength(2);
    expect(mockPoolQuery.mock.calls[0][1]).toEqual(['case-1']);
  });
});

describe('getCaseImageBytes', () => {
  it('returns null when no row matches', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });
    const r = await db.getCaseImageBytes('case-1', 0);
    expect(r).toBeNull();
  });

  it('returns the mime + bytes for the matching row', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ image_mime_type: 'image/png', image_data: Buffer.from('x') }] });
    const r = await db.getCaseImageBytes('case-1', 0);
    expect(r.image_mime_type).toBe('image/png');
  });
});

// ─── auditLog / getAuditLog / getAuditLogByUser ─────────────────────────────

describe('auditLog', () => {
  it('inserts an audit row with the payload serialised as JSON', async () => {
    await db.auditLog({ eventType: 'CaseReported', caseId: 'c', userId: 'u', payload: { x: 1 } });
    const [, params] = mockPoolQuery.mock.calls[0];
    expect(params[0]).toBe('CaseReported');
    expect(params[1]).toBe('c');
    expect(params[2]).toBe('u');
    expect(JSON.parse(params[3])).toEqual({ x: 1 });
  });

  it('swallows insert errors so the audit failure never crashes callers', async () => {
    mockPoolQuery.mockRejectedValueOnce(new Error('disk full'));
    await expect(
      db.auditLog({ eventType: 'X', payload: {} })
    ).resolves.toBeUndefined();
  });
});

describe('getAuditLog', () => {
  it('returns events for a case ordered oldest first', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ id: 1 }, { id: 2 }] });
    const r = await db.getAuditLog('c');
    expect(r).toHaveLength(2);
    expect(mockPoolQuery.mock.calls[0][0]).toMatch(/ORDER BY occurred_at ASC/);
  });
});

describe('getAuditLogByUser', () => {
  it('passes user, limit, offset', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });
    await db.getAuditLogByUser('u', 10, 5);
    expect(mockPoolQuery.mock.calls[0][1]).toEqual(['u', 10, 5]);
  });
});

// ─── Embeddings + similar cases ─────────────────────────────────────────────

describe('setCaseEmbedding', () => {
  it('throws when the embedding has the wrong shape', async () => {
    await expect(db.setCaseEmbedding('c', [1, 2, 3])).rejects.toThrow(/Invalid embedding/);
  });

  it('issues an UPDATE that casts the vector literal', async () => {
    await db.setCaseEmbedding('c', new Array(768).fill(0.1));
    const [, params] = mockPoolQuery.mock.calls[0];
    expect(params[0]).toMatch(/^\[/);     // textual pgvector form
    expect(params[1]).toBe('c');
    expect(mockPoolQuery.mock.calls[0][0]).toMatch(/::vector/);
  });
});

describe('clearCaseEmbedding', () => {
  it('nulls the embedding column', async () => {
    await db.clearCaseEmbedding('c');
    expect(mockPoolQuery.mock.calls[0][0]).toMatch(/embedding = NULL/);
    expect(mockPoolQuery.mock.calls[0][1]).toEqual(['c']);
  });
});

describe('findSimilarCases', () => {
  it('queries by case id with cosine distance order', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ id: 'sim-1', distance: 0.1 }] });
    const r = await db.findSimilarCases('c', 7);
    expect(r).toHaveLength(1);
    expect(mockPoolQuery.mock.calls[0][1]).toEqual(['c', 7]);
    expect(mockPoolQuery.mock.calls[0][0]).toMatch(/<=>/);
  });
});

describe('findSimilarByEmbedding', () => {
  it('throws when given a wrongly-sized embedding', async () => {
    await expect(db.findSimilarByEmbedding([1, 2, 3])).rejects.toThrow(/Invalid embedding/);
  });

  it('returns rows when given a 768-D embedding', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ id: 'x' }] });
    const r = await db.findSimilarByEmbedding(new Array(768).fill(0), 3);
    expect(r).toHaveLength(1);
  });
});
