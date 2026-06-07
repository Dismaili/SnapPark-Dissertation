import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockMetadata = vi.fn();
const mockStats = vi.fn();
const mockConvolve = vi.fn();

vi.mock('sharp', () => ({
  default: vi.fn(() => ({
    metadata: mockMetadata,
    grayscale: () => ({
      stats: mockStats,
      convolve: () => ({ stats: mockConvolve }),
    }),
  })),
}));

const { validateImageQuality } = await import('../src/imageValidator.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('validateImageQuality — branch coverage', () => {
  it('exact min brightness (30) is accepted', async () => {
    mockMetadata.mockResolvedValue({ width: 800, height: 600 });
    mockStats.mockResolvedValue({ channels: [{ mean: 30 }] });
    mockConvolve.mockResolvedValue({ channels: [{ stdev: 20 }] }); // variance 400 > 100
    const r = await validateImageQuality(Buffer.from('x'));
    expect(r.valid).toBe(true);
  });

  it('brightness just over MAX (245) is rejected as too bright', async () => {
    mockMetadata.mockResolvedValue({ width: 800, height: 600 });
    mockStats.mockResolvedValue({ channels: [{ mean: 246 }] });
    const r = await validateImageQuality(Buffer.from('x'));
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/bright/);
  });

  it('blurry boundary: variance equal to threshold is accepted', async () => {
    mockMetadata.mockResolvedValue({ width: 800, height: 600 });
    mockStats.mockResolvedValue({ channels: [{ mean: 120 }] });
    mockConvolve.mockResolvedValue({ channels: [{ stdev: 10 }] }); // variance 100 == threshold
    const r = await validateImageQuality(Buffer.from('x'));
    expect(r.valid).toBe(true);
  });

  it('rejects when both width AND height are below minimum', async () => {
    mockMetadata.mockResolvedValue({ width: 100, height: 50 });
    const r = await validateImageQuality(Buffer.from('x'));
    expect(r.valid).toBe(false);
  });
});
