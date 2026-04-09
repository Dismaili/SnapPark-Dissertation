import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

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

/**
 * Send a single base64-encoded image to Gemini and parse the structured response.
 *
 * @param {string} base64Data – raw base64 image data (no data-URL prefix)
 * @param {string} mimeType   – e.g. "image/jpeg"
 * @returns {{ violationConfirmed: boolean, violationType: string|null, confidence: number, explanation: string }}
 */
export const analyseImage = async (base64Data, mimeType) => {
  const imagePart = {
    inlineData: { data: base64Data, mimeType },
  };

  const result = await model.generateContent([SINGLE_IMAGE_PROMPT, imagePart]);
  const text   = result.response.text().trim();

  return parseResponse(text);
};

/**
 * Send multiple base64-encoded images to Gemini in a single request.
 * All images are analysed together for a combined determination.
 *
 * @param {{ base64: string, mimeType: string }[]} images – array of image objects
 * @returns {{ violationConfirmed: boolean, violationType: string|null, confidence: number, explanation: string }}
 */
export const analyseMultipleImages = async (images) => {
  const imageParts = images.map((img) => ({
    inlineData: { data: img.base64, mimeType: img.mimeType },
  }));

  const result = await model.generateContent([MULTI_IMAGE_PROMPT, ...imageParts]);
  const text   = result.response.text().trim();

  return parseResponse(text);
};
