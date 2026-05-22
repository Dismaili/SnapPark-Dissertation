import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/db.js', () => ({ EMBEDDING_DIM: 768 }));

const mockEmbedContent = vi.fn();
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() { return { embedContent: mockEmbedContent }; }
  },
}));

const ORIG_KEY  = process.env.GEMINI_API_KEY;
const ORIG_MODE = process.env.GEMINI_DEMO_MODE;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  process.env.GEMINI_API_KEY = 'test-key';
  delete process.env.GEMINI_DEMO_MODE;
});

afterAll: () => {
  if (ORIG_KEY === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = ORIG_KEY;
  if (ORIG_MODE === undefined) delete process.env.GEMINI_DEMO_MODE; else process.env.GEMINI_DEMO_MODE = ORIG_MODE;
};

describe('generateEmbedding — API path', () => {
  it('returns the API result when the shape is correct', async () => {
    const { generateEmbedding } = await import('../src/embeddings.js');
    const fake = new Array(768).fill(0.01);
    mockEmbedContent.mockResolvedValue({ embedding: { values: fake } });
    const r = await generateEmbedding('hello');
    expect(r).toEqual(fake);
  });

  it('throws when the API returns the wrong vector length and DEMO_MODE is off', async () => {
    process.env.GEMINI_DEMO_MODE = 'false';
    const { generateEmbedding } = await import('../src/embeddings.js');
    mockEmbedContent.mockResolvedValue({ embedding: { values: [1, 2, 3] } });
    await expect(generateEmbedding('hello')).rejects.toThrow(/unexpected shape/);
  });

  it('throws when the API throws a non-API error (no demo fallback)', async () => {
    const { generateEmbedding } = await import('../src/embeddings.js');
    mockEmbedContent.mockRejectedValue(new Error('completely unrelated parse error'));
    await expect(generateEmbedding('hello')).rejects.toThrow(/unrelated/);
  });

  it('falls back to demo vector on Gemini API errors when DEMO_MODE is on', async () => {
    const { generateEmbedding } = await import('../src/embeddings.js');
    mockEmbedContent.mockRejectedValue(new Error('429 RESOURCE_EXHAUSTED'));
    const r = await generateEmbedding('hello');
    expect(r).toHaveLength(768);
  });

  it('still falls back when error mentions GoogleGenerativeAI Error', async () => {
    const { generateEmbedding } = await import('../src/embeddings.js');
    mockEmbedContent.mockRejectedValue(new Error('GoogleGenerativeAI Error: 403'));
    const r = await generateEmbedding('hello');
    expect(r).toHaveLength(768);
  });

  it('rethrows on API error when DEMO_MODE=false', async () => {
    process.env.GEMINI_DEMO_MODE = 'false';
    const { generateEmbedding } = await import('../src/embeddings.js');
    mockEmbedContent.mockRejectedValue(new Error('429 quota exceeded'));
    await expect(generateEmbedding('hello')).rejects.toThrow(/quota/);
  });
});

describe('buildEmbeddingInput — branch coverage', () => {
  it('handles every individual field present alone', async () => {
    const { buildEmbeddingInput } = await import('../src/embeddings.js');
    expect(buildEmbeddingInput({ violationType: 'x' })).toBe('Violation: x.');
    expect(buildEmbeddingInput({ explanation: 'e' })).toBe('Explanation: e');
    expect(buildEmbeddingInput({ licensePlate: 'p' })).toBe('Plate: p.');
  });

  it('returns empty string when no fields are present', async () => {
    const { buildEmbeddingInput } = await import('../src/embeddings.js');
    expect(buildEmbeddingInput({})).toBe('');
  });
});
