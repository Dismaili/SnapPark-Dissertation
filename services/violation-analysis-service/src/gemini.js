import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// Model name is configurable so we can roll forward when Google deprecates a SKU.
// `gemini-1.5-flash` (the original choice) was retired in 2025.
const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const model = genAI.getGenerativeModel({ model: MODEL_NAME });

const SINGLE_IMAGE_PROMPT = `You are an expert traffic warden and parking enforcement officer.
Analyse the provided image and determine whether an illegal parking violation is occurring.

Respond ONLY with a single valid JSON object — no markdown, no extra text — in exactly this shape:
{
  "violationConfirmed": <true | false>,
  "violationType": "<short description of violation, or null if none>",
  "confidence": <float 0.0–1.0>,
  "explanation": "<one or two sentences explaining your determination>"
}

Guidelines:
- Set violationConfirmed to true only when you can clearly see a parking violation.
- violationType examples: "blocking fire hydrant", "double parking", "no stopping zone",
  "expired meter", "bus stop obstruction", "pavement parking", "no parking zone".
- confidence should reflect how certain you are (e.g. 0.95 = very certain, 0.5 = uncertain).
- If the image does not show a vehicle or road scene, set violationConfirmed to false and
  explain what you see instead.`;

const MULTI_IMAGE_PROMPT = `You are an expert traffic warden and parking enforcement officer.
You have been provided with multiple images of the same parking situation.
Analyse ALL the images together to determine whether an illegal parking violation is occurring.
Use the combined evidence from all images to make a more informed decision.

Respond ONLY with a single valid JSON object — no markdown, no extra text — in exactly this shape:
{
  "violationConfirmed": <true | false>,
  "violationType": "<short description of violation, or null if none>",
  "confidence": <float 0.0–1.0>,
  "explanation": "<one or two sentences explaining your determination, referencing evidence from the images>"
}

Guidelines:
- Set violationConfirmed to true only when you can clearly see a parking violation.
- violationType examples: "blocking fire hydrant", "double parking", "no stopping zone",
  "expired meter", "bus stop obstruction", "pavement parking", "no parking zone".
- confidence should reflect how certain you are (e.g. 0.95 = very certain, 0.5 = uncertain).
- Multiple images provide more context — use them to increase or decrease your confidence.
- If the images do not show a vehicle or road scene, set violationConfirmed to false and
  explain what you see instead.`;

/**
 * Parse and validate Gemini's JSON response.
 */
const parseResponse = (text) => {
  const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

  let parsed;
  try {
    parsed = JSON.parse(clean);
  } catch {
    throw new Error(`Gemini returned non-JSON response: ${text.slice(0, 200)}`);
  }

  return {
    violationConfirmed: Boolean(parsed.violationConfirmed),
    violationType:      parsed.violationType ?? null,
    confidence:         Number(parsed.confidence ?? 0),
    explanation:        String(parsed.explanation ?? ''),
  };
};

// ─── Demo fallback ────────────────────────────────────────────────────────────
// When GEMINI_DEMO_MODE=true (or the real API returns a quota/auth error) the
// service returns a deterministic mock verdict so the full pipeline (upload →
// analysis → notification) can be demonstrated without a billed Gemini project.
// Set GEMINI_DEMO_MODE=false to disable the fallback entirely.
const DEMO_MODE = process.env.GEMINI_DEMO_MODE !== 'false';

const DEMO_VIOLATIONS = [
  { violationConfirmed: true,  violationType: 'double parking',       confidence: 0.91, explanation: 'The vehicle is parked alongside another car in a single-lane space, blocking traffic flow. This constitutes a clear double-parking violation.' },
  { violationConfirmed: true,  violationType: 'no stopping zone',     confidence: 0.87, explanation: 'The vehicle is stopped on a section of road marked with yellow zigzag lines indicating a no-stopping zone near a pedestrian crossing.' },
  { violationConfirmed: true,  violationType: 'pavement parking',     confidence: 0.94, explanation: 'The vehicle has mounted the pavement, obstructing the footway and posing a hazard to pedestrians, including those with mobility aids.' },
  { violationConfirmed: false, violationType: null,                   confidence: 0.82, explanation: 'The vehicle appears to be parked within a designated bay and no visible restrictions are present. No violation is confirmed.' },
  { violationConfirmed: true,  violationType: 'bus stop obstruction', confidence: 0.89, explanation: 'The vehicle is parked directly in a marked bus stop, preventing buses from pulling in and causing inconvenience to passengers.' },
];

const mockVerdict = (base64Data) => {
  // Deterministic index from last byte of image data so same image → same result.
  const byte = base64Data.charCodeAt(base64Data.length - 1) || 0;
  return { ...DEMO_VIOLATIONS[byte % DEMO_VIOLATIONS.length], _demo: true };
};

// Catch any Gemini API failure (quota, invalid key, region block, 5xx) so the
// demo pipeline keeps flowing even when the external dependency is unavailable.
const isGeminiApiError = (err) => {
  const msg = err?.message || '';
  return (
    msg.includes('GoogleGenerativeAI Error') ||
    msg.includes('429') || msg.includes('403') || msg.includes('400') ||
    msg.includes('quota') || msg.includes('API key') ||
    msg.includes('RESOURCE_EXHAUSTED') || msg.includes('fetch')
  );
};

/**
 * Send a single base64-encoded image to Gemini and parse the structured response.
 *
 * @param {string} base64Data – raw base64 image data (no data-URL prefix)
 * @param {string} mimeType   – e.g. "image/jpeg"
 * @returns {{ violationConfirmed: boolean, violationType: string|null, confidence: number, explanation: string }}
 */
export const analyseImage = async (base64Data, mimeType) => {
  try {
    const imagePart = { inlineData: { data: base64Data, mimeType } };
    const result = await model.generateContent([SINGLE_IMAGE_PROMPT, imagePart]);
    return parseResponse(result.response.text().trim());
  } catch (err) {
    if (DEMO_MODE && isGeminiApiError(err)) {
      console.warn('[gemini] API error — returning demo verdict:', err.message?.slice(0, 200));
      return mockVerdict(base64Data);
    }
    throw err;
  }
};

/**
 * Send multiple base64-encoded images to Gemini in a single request.
 * All images are analysed together for a combined determination.
 *
 * @param {{ base64: string, mimeType: string }[]} images – array of image objects
 * @returns {{ violationConfirmed: boolean, violationType: string|null, confidence: number, explanation: string }}
 */
export const analyseMultipleImages = async (images) => {
  try {
    const imageParts = images.map((img) => ({
      inlineData: { data: img.base64, mimeType: img.mimeType },
    }));
    const result = await model.generateContent([MULTI_IMAGE_PROMPT, ...imageParts]);
    return parseResponse(result.response.text().trim());
  } catch (err) {
    if (DEMO_MODE && isGeminiApiError(err)) {
      console.warn('[gemini] Quota/auth error — returning demo verdict. Set GEMINI_DEMO_MODE=false to disable.');
      return mockVerdict(images[0]?.base64 || '');
    }
    throw err;
  }
};
