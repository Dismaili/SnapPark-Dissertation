import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock sharp before importing the module under test
const mockMetadata = vi.fn();
const mockStats = vi.fn();
const mockGrayscale = vi.fn();
const mockConvolve = vi.fn();

vi.mock('sharp', () => {
  return {
    default: vi.fn(() => ({
      metadata: mockMetadata,
      grayscale: () => ({
        stats: mockStats,
        convolve: () => ({
          stats: mockConvolve,
        }),
      }),
    })),
  };
});

// Set env vars before importing
process.env.MIN_IMAGE_WIDTH = '200';
process.env.MIN_IMAGE_HEIGHT = '200';
process.env.MIN_BRIGHTNESS = '30';
process.env.MAX_BRIGHTNESS = '245';
process.env.BLUR_THRESHOLD = '100';

const { validateImageQuality } = await import('../src/imageValidator.js');

describe('Image Validator', () => {
  const validBuffer = Buffer.from('fake-image');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should reject images below minimum resolution', async () => {
    mockMetadata.mockResolvedValue({ width: 100, height: 100 });

    const result = await validateImageQuality(validBuffer);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('resolution too low');
  });

  it('should reject images that are too dark', async () => {
    mockMetadata.mockResolvedValue({ width: 800, height: 600 });
    mockStats.mockResolvedValue({ channels: [{ mean: 10 }] });

    const result = await validateImageQuality(validBuffer);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('too dark');
  });

  it('should reject images that are too bright', async () => {
    mockMetadata.mockResolvedValue({ width: 800, height: 600 });
    mockStats.mockResolvedValue({ channels: [{ mean: 250 }] });

    const result = await validateImageQuality(validBuffer);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('too bright');
  });

  it('should reject blurry images', async () => {
    mockMetadata.mockResolvedValue({ width: 800, height: 600 });
    mockStats.mockResolvedValue({ channels: [{ mean: 120 }] });
    mockConvolve.mockResolvedValue({ channels: [{ stdev: 5 }] }); // variance = 25 < 100

    const result = await validateImageQuality(validBuffer);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('blurry');
  });

  it('should accept valid images', async () => {
    mockMetadata.mockResolvedValue({ width: 800, height: 600 });
    mockStats.mockResolvedValue({ channels: [{ mean: 120 }] });
    mockConvolve.mockResolvedValue({ channels: [{ stdev: 50 }] }); // variance = 2500 > 100

    const result = await validateImageQuality(validBuffer);

    expect(result.valid).toBe(true);
    expect(result.stats).toBeDefined();
    expect(result.stats.width).toBe(800);
    expect(result.stats.height).toBe(600);
  });

  it('should accept images at exact minimum resolution', async () => {
    mockMetadata.mockResolvedValue({ width: 200, height: 200 });
    mockStats.mockResolvedValue({ channels: [{ mean: 120 }] });
    mockConvolve.mockResolvedValue({ channels: [{ stdev: 15 }] }); // variance = 225 > 100

    const result = await validateImageQuality(validBuffer);

    expect(result.valid).toBe(true);
  });

  it('should reject when only width is below minimum', async () => {
    mockMetadata.mockResolvedValue({ width: 150, height: 600 });

    const result = await validateImageQuality(validBuffer);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('resolution too low');
  });

  it('should reject when only height is below minimum', async () => {
    mockMetadata.mockResolvedValue({ width: 600, height: 150 });

    const result = await validateImageQuality(validBuffer);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('resolution too low');
  });
});
