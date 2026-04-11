import sharp from 'sharp';

// ─── Thresholds (configurable via env) ──────────────────────────────────────

const MIN_WIDTH        = Number(process.env.MIN_IMAGE_WIDTH  || 200);
const MIN_HEIGHT       = Number(process.env.MIN_IMAGE_HEIGHT || 200);
const MIN_BRIGHTNESS   = Number(process.env.MIN_BRIGHTNESS   || 30);   // 0–255 scale
const MAX_BRIGHTNESS   = Number(process.env.MAX_BRIGHTNESS   || 245);  // reject near-white
const BLUR_THRESHOLD   = Number(process.env.BLUR_THRESHOLD   || 100);  // Laplacian variance

/**
 * Validate image quality before sending to Gemini.
 *
 * Checks performed:
 *   1. Resolution — rejects images smaller than MIN_WIDTH × MIN_HEIGHT
 *   2. Brightness — rejects images that are too dark or too washed-out
 *   3. Blurriness — uses Laplacian variance; low variance = blurry
 *
 * @param {Buffer} imageBuffer – raw image bytes
 * @returns {Promise<{ valid: boolean, reason?: string, stats?: object }>}
 */
export const validateImageQuality = async (imageBuffer) => {
  const image = sharp(imageBuffer);
  const metadata = await image.metadata();

  // ── 1. Resolution check ──────────────────────────────────────────────────
  if (metadata.width < MIN_WIDTH || metadata.height < MIN_HEIGHT) {
    return {
      valid:  false,
      reason: `Image resolution too low (${metadata.width}×${metadata.height}). Minimum is ${MIN_WIDTH}×${MIN_HEIGHT} pixels.`,
    };
  }

  // ── 2. Brightness check ──────────────────────────────────────────────────
  // Convert to grayscale and compute pixel statistics
  const { channels } = await sharp(imageBuffer)
    .grayscale()
    .stats();

  const meanBrightness = channels[0].mean;

  if (meanBrightness < MIN_BRIGHTNESS) {
    return {
      valid:  false,
      reason: `Image is too dark (brightness: ${meanBrightness.toFixed(1)}/255). Please take the photo in better lighting.`,
    };
  }

  if (meanBrightness > MAX_BRIGHTNESS) {
    return {
      valid:  false,
      reason: `Image is too bright or washed out (brightness: ${meanBrightness.toFixed(1)}/255). Please reduce exposure.`,
    };
  }

  // ── 3. Blur detection ────────────────────────────────────────────────────
  // Apply a Laplacian-like edge detection kernel and measure the variance.
  // Sharp images produce high variance; blurry images produce low variance.
  const laplacianKernel = {
    width:  3,
    height: 3,
    kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0],
  };

  const { channels: edgeChannels } = await sharp(imageBuffer)
    .grayscale()
    .convolve(laplacianKernel)
    .stats();

  // Standard deviation squared ≈ variance of edge response
  const edgeVariance = edgeChannels[0].stdev ** 2;

  if (edgeVariance < BLUR_THRESHOLD) {
    return {
      valid:  false,
      reason: `Image appears too blurry (sharpness score: ${edgeVariance.toFixed(1)}, minimum: ${BLUR_THRESHOLD}). Please take a clearer photo.`,
    };
  }

  return {
    valid: true,
    stats: {
      width:      metadata.width,
      height:     metadata.height,
      brightness: meanBrightness.toFixed(1),
      sharpness:  edgeVariance.toFixed(1),
    },
  };
};
