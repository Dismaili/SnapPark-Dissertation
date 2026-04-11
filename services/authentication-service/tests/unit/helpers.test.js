import { describe, it, expect } from '@jest/globals';
import jwt from 'jsonwebtoken';
import {
  isValidEmail,
  isValidPassword,
  createAccessToken,
  createRefreshToken,
  extractBearerToken,
} from '../../src/helpers.js';

// ─── Email Validation ────────────────────────────────────────────────────────

describe('isValidEmail', () => {
  it('should accept a standard email address', () => {
    expect(isValidEmail('user@example.com')).toBe(true);
  });

  it('should accept emails with subdomains', () => {
    expect(isValidEmail('user@mail.example.co.uk')).toBe(true);
  });

  it('should accept emails with plus addressing', () => {
    expect(isValidEmail('user+tag@example.com')).toBe(true);
  });

  it('should reject an email without an @ symbol', () => {
    expect(isValidEmail('userexample.com')).toBe(false);
  });

  it('should reject an email without a domain', () => {
    expect(isValidEmail('user@')).toBe(false);
  });

  it('should reject an email without a local part', () => {
    expect(isValidEmail('@example.com')).toBe(false);
  });

  it('should reject an email with spaces', () => {
    expect(isValidEmail('user @example.com')).toBe(false);
  });

  it('should reject an empty string', () => {
    expect(isValidEmail('')).toBe(false);
  });

  it('should reject null and undefined', () => {
    expect(isValidEmail(null)).toBe(false);
    expect(isValidEmail(undefined)).toBe(false);
  });

  it('should reject non-string types', () => {
    expect(isValidEmail(12345)).toBe(false);
    expect(isValidEmail({})).toBe(false);
  });
});

// ─── Password Validation ────────────────────────────────────────────────────

describe('isValidPassword', () => {
  it('should accept a password with exactly 8 characters', () => {
    expect(isValidPassword('abcdefgh')).toBe(true);
  });

  it('should accept a password longer than 8 characters', () => {
    expect(isValidPassword('securepassword123')).toBe(true);
  });

  it('should reject a password shorter than 8 characters', () => {
    expect(isValidPassword('short')).toBe(false);
  });

  it('should reject an empty string', () => {
    expect(isValidPassword('')).toBe(false);
  });

  it('should reject null and undefined', () => {
    expect(isValidPassword(null)).toBe(false);
    expect(isValidPassword(undefined)).toBe(false);
  });

  it('should reject non-string types', () => {
    expect(isValidPassword(12345678)).toBe(false);
  });
});

// ─── Access Token Creation ──────────────────────────────────────────────────

describe('createAccessToken', () => {
  const secret = 'test-access-secret';
  const user = { id: 'user-uuid-123', email: 'test@example.com' };

  it('should return a valid JWT string', () => {
    const token = createAccessToken(user, secret, '15m');
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3); // header.payload.signature
  });

  it('should embed the user id as the "sub" claim', () => {
    const token = createAccessToken(user, secret, '15m');
    const decoded = jwt.verify(token, secret);
    expect(decoded.sub).toBe(user.id);
  });

  it('should embed the user email in the payload', () => {
    const token = createAccessToken(user, secret, '15m');
    const decoded = jwt.verify(token, secret);
    expect(decoded.email).toBe(user.email);
  });

  it('should include an expiration claim', () => {
    const token = createAccessToken(user, secret, '15m');
    const decoded = jwt.verify(token, secret);
    expect(decoded.exp).toBeDefined();
    expect(decoded.exp).toBeGreaterThan(decoded.iat);
  });

  it('should fail verification with the wrong secret', () => {
    const token = createAccessToken(user, secret, '15m');
    expect(() => jwt.verify(token, 'wrong-secret')).toThrow();
  });
});

// ─── Refresh Token Creation ─────────────────────────────────────────────────

describe('createRefreshToken', () => {
  const secret = 'test-refresh-secret';
  const user = { id: 'user-uuid-456', email: 'test@example.com' };

  it('should return a valid JWT string', () => {
    const token = createRefreshToken(user, secret, '7d');
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3);
  });

  it('should embed the user id as the "sub" claim', () => {
    const token = createRefreshToken(user, secret, '7d');
    const decoded = jwt.verify(token, secret);
    expect(decoded.sub).toBe(user.id);
  });

  it('should include type "refresh" to distinguish from access tokens', () => {
    const token = createRefreshToken(user, secret, '7d');
    const decoded = jwt.verify(token, secret);
    expect(decoded.type).toBe('refresh');
  });

  it('should NOT include the email (minimise data in long-lived tokens)', () => {
    const token = createRefreshToken(user, secret, '7d');
    const decoded = jwt.verify(token, secret);
    expect(decoded.email).toBeUndefined();
  });

  it('should have a later expiry than a 15m access token', () => {
    const accessToken  = createAccessToken(user, 'a-secret', '15m');
    const refreshToken = createRefreshToken(user, secret, '7d');
    const accessExp  = jwt.decode(accessToken).exp;
    const refreshExp = jwt.decode(refreshToken).exp;
    expect(refreshExp).toBeGreaterThan(accessExp);
  });
});

// ─── Bearer Token Extraction ────────────────────────────────────────────────

describe('extractBearerToken', () => {
  it('should extract the token from a valid Bearer header', () => {
    const req = { headers: { authorization: 'Bearer abc123' } };
    expect(extractBearerToken(req)).toBe('abc123');
  });

  it('should return null when the Authorization header is missing', () => {
    const req = { headers: {} };
    expect(extractBearerToken(req)).toBeNull();
  });

  it('should return null when the scheme is not Bearer', () => {
    const req = { headers: { authorization: 'Basic abc123' } };
    expect(extractBearerToken(req)).toBeNull();
  });

  it('should return null for an empty Authorization header', () => {
    const req = { headers: { authorization: '' } };
    expect(extractBearerToken(req)).toBeNull();
  });

  it('should trim whitespace around the token value', () => {
    const req = { headers: { authorization: 'Bearer   abc123   ' } };
    expect(extractBearerToken(req)).toBe('abc123');
  });
});
