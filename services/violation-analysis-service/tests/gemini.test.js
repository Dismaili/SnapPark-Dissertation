import { describe, it, expect, vi } from 'vitest';

// Mock the Google Generative AI module
const mockGenerateContent = vi.fn();

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    constructor() {}
    getGenerativeModel() {
      return { generateContent: mockGenerateContent };
    }
  },
}));

process.env.GEMINI_API_KEY = 'test-api-key';

const { analyseImage, analyseMultipleImages } = await import('../src/gemini.js');

describe('Gemini Integration', () => {
  describe('analyseImage', () => {
    it('should parse a valid JSON response from Gemini', async () => {
      const mockResponse = {
        violationConfirmed: true,
        violationType: 'double parking',
        confidence: 0.92,
        explanation: 'The vehicle is clearly double parked.',
      };

      mockGenerateContent.mockResolvedValue({
        response: { text: () => JSON.stringify(mockResponse) },
      });

      const result = await analyseImage('base64data', 'image/jpeg');

      expect(result.violationConfirmed).toBe(true);
      expect(result.violationType).toBe('double parking');
      expect(result.confidence).toBe(0.92);
      expect(result.explanation).toContain('double parked');
    });

    it('should handle markdown-wrapped JSON response', async () => {
      const json = JSON.stringify({
        violationConfirmed: false,
        violationType: null,
        confidence: 0.1,
        explanation: 'No vehicle visible.',
      });

      mockGenerateContent.mockResolvedValue({
        response: { text: () => `\`\`\`json\n${json}\n\`\`\`` },
      });

      const result = await analyseImage('base64data', 'image/png');

      expect(result.violationConfirmed).toBe(false);
      expect(result.violationType).toBeNull();
    });

    it('should throw on non-JSON response', async () => {
      mockGenerateContent.mockResolvedValue({
        response: { text: () => 'I cannot analyse this image because...' },
      });

      await expect(analyseImage('base64data', 'image/jpeg'))
        .rejects.toThrow('non-JSON');
    });

    it('should default missing fields', async () => {
      mockGenerateContent.mockResolvedValue({
        response: { text: () => '{}' },
      });

      const result = await analyseImage('base64data', 'image/jpeg');

      expect(result.violationConfirmed).toBe(false);
      expect(result.violationType).toBeNull();
      expect(result.confidence).toBe(0);
      expect(result.explanation).toBe('');
    });
  });

  describe('analyseMultipleImages', () => {
    it('should send multiple images and parse response', async () => {
      const mockResponse = {
        violationConfirmed: true,
        violationType: 'no parking zone',
        confidence: 0.97,
        explanation: 'Multiple angles confirm the vehicle is in a no parking zone.',
      };

      mockGenerateContent.mockResolvedValue({
        response: { text: () => JSON.stringify(mockResponse) },
      });

      const images = [
        { base64: 'img1data', mimeType: 'image/jpeg' },
        { base64: 'img2data', mimeType: 'image/jpeg' },
      ];

      const result = await analyseMultipleImages(images);

      expect(result.violationConfirmed).toBe(true);
      expect(result.confidence).toBe(0.97);

      // Verify it sent prompt + 2 image parts
      const lastCall = mockGenerateContent.mock.calls[mockGenerateContent.mock.calls.length - 1][0];
      expect(lastCall).toHaveLength(3); // prompt + 2 images
    });
  });
});
