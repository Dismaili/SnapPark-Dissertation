import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGenerate = vi.fn();
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() { return { generateContent: mockGenerate }; }
  },
}));

process.env.GEMINI_API_KEY = 'test-key';

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  delete process.env.GEMINI_DEMO_MODE;
});

describe('gemini demo fallback', () => {
  it('analyseImage returns a demo verdict when API errors with quota and DEMO_MODE on', async () => {
    const { analyseImage } = await import('../src/gemini.js');
    mockGenerate.mockRejectedValue(new Error('429 RESOURCE_EXHAUSTED'));
    const r = await analyseImage('base64', 'image/jpeg');
    expect(r._demo).toBe(true);
    expect(typeof r.violationConfirmed).toBe('boolean');
  });

  it('analyseImage rethrows when API errors and DEMO_MODE=false', async () => {
    process.env.GEMINI_DEMO_MODE = 'false';
    const { analyseImage } = await import('../src/gemini.js');
    mockGenerate.mockRejectedValue(new Error('429 quota'));
    await expect(analyseImage('base64', 'image/jpeg')).rejects.toThrow(/quota/);
  });

  it('analyseImage rethrows non-API errors even when DEMO_MODE on', async () => {
    const { analyseImage } = await import('../src/gemini.js');
    mockGenerate.mockRejectedValue(new Error('unrelated random failure'));
    await expect(analyseImage('base64', 'image/jpeg')).rejects.toThrow(/unrelated/);
  });

  it('analyseMultipleImages falls back to demo verdict on API error', async () => {
    const { analyseMultipleImages } = await import('../src/gemini.js');
    mockGenerate.mockRejectedValue(new Error('403 API key invalid'));
    const r = await analyseMultipleImages([{ base64: 'x', mimeType: 'image/png' }]);
    expect(r._demo).toBe(true);
  });

  it('analyseMultipleImages rethrows non-API errors', async () => {
    const { analyseMultipleImages } = await import('../src/gemini.js');
    mockGenerate.mockRejectedValue(new Error('unrelated boom'));
    await expect(analyseMultipleImages([{ base64: 'x', mimeType: 'image/png' }])).rejects.toThrow(/boom/);
  });

  it('demo verdict picks a deterministic violation based on input bytes', async () => {
    const { analyseImage } = await import('../src/gemini.js');
    mockGenerate.mockRejectedValue(new Error('fetch failure'));
    const r1 = await analyseImage('aaaaaaaab', 'image/jpeg');
    const r2 = await analyseImage('aaaaaaaab', 'image/jpeg');
    expect(r1.violationType).toBe(r2.violationType);
  });
});
