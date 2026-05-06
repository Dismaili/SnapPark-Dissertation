import crypto from 'crypto';
import { query } from './db.js';

// ─── Constants ───────────────────────────────────────────────────────────────

export const OTP_PURPOSE = Object.freeze({
  EMAIL_VERIFICATION: 'email_verification',
  PASSWORD_RESET:     'password_reset',
});

export const OTP_LENGTH       = 4;
export const OTP_TTL_MINUTES  = Number(process.env.OTP_TTL_MINUTES  || 10);
export const OTP_MAX_ATTEMPTS = Number(process.env.OTP_MAX_ATTEMPTS || 5);

// ─── Internal helpers ────────────────────────────────────────────────────────

/**
 * Generate a cryptographically random N-digit numeric code, padded with
 * leading zeros so the printed length is always exactly OTP_LENGTH.
 *
 * crypto.randomInt is uniform across [0, max) so this avoids the modulo bias
 * that a naive `Math.random` based implementation would have.
 */
const generateNumericCode = (length = OTP_LENGTH) => {
  const max = 10 ** length;
  return String(crypto.randomInt(0, max)).padStart(length, '0');
};

/**
 * Codes are short-lived (minutes) and low-entropy (10⁴ values). bcrypt would
 * be overkill and slow; SHA-256 is fast and sufficient since the attempt
 * limit + expiry already bound brute-force feasibility.
 */
const hashCode = (code) =>
  crypto.createHash('sha256').update(String(code)).digest('hex');

const assertValidPurpose = (purpose) => {
  if (!Object.values(OTP_PURPOSE).includes(purpose)) {
    throw new Error(`Invalid OTP purpose: ${purpose}`);
  }
};

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Issue a fresh OTP for the given (user, purpose) pair. Any previously
 * issued, still-active OTP for the same pair is invalidated first so only
 * one code is ever active at a time — this prevents a re-send from leaving
 * an older code usable.
 *
 * Returns the plaintext code so the caller can email it. The plaintext is
 * NOT persisted; only its hash is.
 */
export const issueOtp = async ({ userId, purpose }) => {
  assertValidPurpose(purpose);

  const code      = generateNumericCode();
  const codeHash  = hashCode(code);
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

  // Invalidate any active OTP for the same (user, purpose) so the new one
  // is the only valid code.
  await query(
    `UPDATE otps SET consumed_at = NOW()
     WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL`,
    [userId, purpose]
  );

  await query(
    `INSERT INTO otps (user_id, purpose, code_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [userId, purpose, codeHash, expiresAt]
  );

  return { code, expiresAt };
};

/**
 * Validate a submitted code against the active OTP for the (user, purpose)
 * pair. On success the OTP is marked consumed so it can't be replayed.
 *
 * Failure modes are reported as discriminated results rather than thrown
 * errors so callers can map them to user-facing messages without losing
 * the structured reason.
 *
 * Returns one of:
 *   { ok: true }
 *   { ok: false, reason: 'no_active_code' | 'expired' | 'too_many_attempts' | 'invalid' }
 */
export const verifyOtp = async ({ userId, purpose, code }) => {
  assertValidPurpose(purpose);

  if (typeof code !== 'string' || !/^\d+$/.test(code) || code.length !== OTP_LENGTH) {
    return { ok: false, reason: 'invalid' };
  }

  const result = await query(
    `SELECT id, code_hash, expires_at, attempts
       FROM otps
      WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1
      FOR UPDATE`,
    [userId, purpose]
  );

  const row = result.rows[0];
  if (!row) return { ok: false, reason: 'no_active_code' };

  if (new Date(row.expires_at) <= new Date()) {
    await query('UPDATE otps SET consumed_at = NOW() WHERE id = $1', [row.id]);
    return { ok: false, reason: 'expired' };
  }

  if (row.attempts >= OTP_MAX_ATTEMPTS) {
    // Burn the code so it can't be used even if a later attempt happens to match.
    await query('UPDATE otps SET consumed_at = NOW() WHERE id = $1', [row.id]);
    return { ok: false, reason: 'too_many_attempts' };
  }

  const submittedHash = hashCode(code);

  // Constant-time comparison defends against timing side-channels even though
  // the inputs are short — cheap insurance.
  const matches = crypto.timingSafeEqual(
    Buffer.from(submittedHash, 'hex'),
    Buffer.from(row.code_hash, 'hex'),
  );

  if (!matches) {
    await query(
      'UPDATE otps SET attempts = attempts + 1 WHERE id = $1',
      [row.id]
    );
    return { ok: false, reason: 'invalid' };
  }

  await query(
    'UPDATE otps SET consumed_at = NOW() WHERE id = $1',
    [row.id]
  );
  return { ok: true };
};
