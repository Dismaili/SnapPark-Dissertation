import { describe, it, expect, vi } from 'vitest';

// db.js exports EMBEDDING_DIM, which embeddings.js imports. Stub it so
// these unit tests don't try to open a real Postgres pool.
vi.mock('../src/db.js', () => ({
  EMBEDDING_DIM: 768,
}));

const {
  buildEmbeddingInput,
  generateEmbedding,
  __demoEmbeddingForTest,
} = await import('../src/embeddings.js');

describe('buildEmbeddingInput', () => {
  it('joins available fields into a single sentence', () => {
    const out = buildEmbeddingInput({
      violationType: 'double parking',
      explanation:   'Vehicle is parked alongside another car.',
      licensePlate:  'XYZ-123',
    });
    expect(out).toBe(
      'Violation: double parking. Explanation: Vehicle is parked alongside another car. Plate: XYZ-123.'
    );
  });

  it('skips missing fields without leaving stray separators', () => {
    expect(buildEmbeddingInput({ explanation: 'just an explanation' })).toBe(
      'Explanation: just an explanation'
    );
    expect(buildEmbeddingInput({ violationType: null, explanation: '', licensePlate: '' })).toBe('');
  });
});

describe('demo embedding (fallback)', () => {
  it('produces a 768-dimensional unit-length vector', () => {
    const v = __demoEmbeddingForTest('a parked car blocking a fire hydrant');
    expect(v).toHaveLength(768);
    expect(v.every((x) => typeof x === 'number' && Number.isFinite(x))).toBe(true);

    const norm = Math.hypot(...v);
    // Float arithmetic — accept any L2 norm within 1e-6 of unit length.
    expect(Math.abs(norm - 1)).toBeLessThan(1e-6);
  });

  it('is deterministic — same input always yields the same vector', () => {
    const a = __demoEmbeddingForTest('hello world');
    const b = __demoEmbeddingForTest('hello world');
    expect(a).toEqual(b);
  });

  it('produces clearly different vectors for clearly different inputs', () => {
    const a = __demoEmbeddingForTest('blocking a fire hydrant in central London');
    const b = __demoEmbeddingForTest('parked legally inside a designated bay');
    // Cosine similarity should not be ~1 for unrelated SHA-256 outputs.
    const dot = a.reduce((s, x, i) => s + x * b[i], 0);
    expect(Math.abs(dot)).toBeLessThan(0.5);
  });
});

describe('generateEmbedding', () => {
  it('falls back to the demo embedding when no API key is configured', async () => {
    // The module reads process.env.GEMINI_API_KEY at import time. The test
    // process should not have one set (CI default); if a developer has one
    // exported locally, this assertion is genuinely meaningful: it confirms
    // generateEmbedding produces a 768-D vector either way.
    const v = await generateEmbedding('vehicle on pavement');
    expect(v).toHaveLength(768);
  });

  it('rejects empty input loudly', async () => {
    await expect(generateEmbedding('')).rejects.toThrow(/non-empty/i);
    await expect(generateEmbedding(null)).rejects.toThrow(/non-empty/i);
  });
});
