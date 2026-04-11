import jwt from 'jsonwebtoken';
import crypto from 'crypto';

// ─── Validators ──────────────────────────────────────────────────────────────

/** Basic email format check */
export const isValidEmail = (email) =>
  typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

/** Minimum password policy: at least 8 characters */
export const isValidPassword = (pw) => typeof pw === 'string' && pw.length >= 8;

// ─── Token utilities ─────────────────────────────────────────────────────────

/** Sign a short-lived access token */
export const createAccessToken = (user, secret, expiresIn) =>
  jwt.sign({ sub: user.id, email: user.email, jti: crypto.randomUUID() }, secret, { expiresIn });

/** Sign a long-lived refresh token */
export const createRefreshToken = (user, secret, expiresIn) =>
  jwt.sign({ sub: user.id, type: 'refresh', jti: crypto.randomUUID() }, secret, { expiresIn });

/** Extract Bearer token from Authorization header */
export const extractBearerToken = (req) => {
  const header = req.headers.authorization ?? '';
  if (!header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim();
};
