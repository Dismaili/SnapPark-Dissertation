import { GoogleGenerativeAI } from '@google/generative-ai';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import { EMBEDDING_DIM } from './db.js';

dotenv.config();

// text-embedding-004 returns 768-dimensional dense vectors. Centralising
// the model name here keeps it in lock-step with EMBEDDING_DIM in db.js.
const EMBED_MODEL_NAME = process.env.GEMINI_EMBED_MODEL || 'text-embedding-004';

// Reuse the same key/auth used for generateContent. We instantiate the
// embedding model lazily so a missing key only matters when we actually
// try to embed (and so tests can run with no key set).
const apiKey = process.env.GEMINI_API_KEY;
let cachedModel = null;
const embeddingModel = () => {
  if (!apiKey) return null;
  if (!cachedModel) {
    cachedModel = new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: EMBED_MODEL_NAME });
  }
  return cachedModel;
};

// Mirrors the demo-mode pattern from gemini.js so the full pipeline is
// testable without a billed embeddings project. When the real API isn't
// reachable, we fall back to a deterministic local embedding derived from
// SHA-256 — same input always yields the same vector, and semantically
// similar input strings *tend* to cluster (because shared substrings
// produce overlapping hash bytes), which is good enough for end-to-end
// demo / smoke tests but is NOT a real semantic embedding.
const DEMO_MODE = process.env.GEMINI_DEMO_MODE !== 'false';

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
 * Build the text we embed for a case. Concatenates the structured fields
 * the AI produced — violation type, plain-English explanation, license
 * plate — into a single string. The plate is included because two cases
 * about the same vehicle should cluster together even if their
 * explanations differ in wording.
 *
 * Exported so tests and the dissertation can show exactly what's
 * being embedded (no hidden inputs to the model).
 */
export const buildEmbeddingInput = ({ violationType, explanation, licensePlate }) => {
  const parts = [];
  if (violationType) parts.push(`Violation: ${violationType}.`);
  if (explanation)   parts.push(`Explanation: ${explanation}`);
  if (licensePlate)  parts.push(`Plate: ${licensePlate}.`);
  return parts.join(' ').trim();
};

/**
 * Deterministic 768-D vector derived from SHA-256 over the input text.
 *
 * Why this exists: GEMINI_DEMO_MODE allows the full upload → analyze →
 * notify pipeline to run without a Gemini API key. The embedding step
 * needs the same fallback, otherwise the saga would always crash in
 * demo mode. The vector is L2-normalised so cosine distance behaves
 * sensibly (0 = identical, 2 = opposite).
 */
const demoEmbedding = (text) => {
  // Generate enough hash bytes to cover all 768 floats × 4 bytes each.
  // Each chunk of the SHA-256 output is reinterpreted as a Float32 in
  // the range [-1, 1] via (byte - 128) / 128.
  const need   = EMBEDDING_DIM;
  const buf    = Buffer.alloc(need);
  let   filled = 0;
  let   counter = 0;
  while (filled < need) {
    const chunk = crypto.createHash('sha256').update(`${text}:${counter++}`).digest();
    const take  = Math.min(chunk.length, need - filled);
    chunk.copy(buf, filled, 0, take);
    filled += take;
  }
  const raw = Array.from(buf, (b) => (b - 128) / 128);
  // Normalise to unit length so cosine distance is stable.
  const norm = Math.hypot(...raw) || 1;
  return raw.map((x) => x / norm);
};

/**
 * Compute a 768-D embedding for the given text.
 *
 * Behaviour:
 *   - With a valid GEMINI_API_KEY, calls text-embedding-004.
 *   - If the API errors AND DEMO_MODE is on, falls back to demoEmbedding.
 *   - If no API key is present at all, uses demoEmbedding directly.
 *
 * Always returns an array of length EMBEDDING_DIM.
 */
export const generateEmbedding = async (text) => {
  if (typeof text !== 'string' || text.length === 0) {
    throw new Error('generateEmbedding: text must be a non-empty string');
  }

  const model = embeddingModel();
  if (!model) {
    return demoEmbedding(text);
  }

  try {
    const result = await model.embedContent(text);
    const values = result?.embedding?.values;
    if (!Array.isArray(values) || values.length !== EMBEDDING_DIM) {
      throw new Error(`Embedding API returned unexpected shape (length ${values?.length ?? 'unknown'})`);
    }
    return values;
  } catch (err) {
    if (DEMO_MODE && isGeminiApiError(err)) {
      console.warn('[embeddings] API error — using demo embedding:', err.message?.slice(0, 200));
      return demoEmbedding(text);
    }
    throw err;
  }
};

// Exported so tests can verify deterministic-fallback behaviour without
// monkey-patching the SDK.
export const __demoEmbeddingForTest = demoEmbedding;
