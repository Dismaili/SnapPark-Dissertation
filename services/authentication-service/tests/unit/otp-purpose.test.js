import { describe, it, expect, jest } from '@jest/globals';

// Cover the assertValidPurpose throw branch in otp.js.
await jest.unstable_mockModule('../../src/db.js', () => ({
  query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
}));

const { issueOtp, verifyOtp, OTP_PURPOSE } = await import('../../src/otp.js');

describe('otp purpose assertion', () => {
  it('issueOtp throws for an unknown purpose', async () => {
    await expect(issueOtp({ userId: 'u', purpose: 'bogus' })).rejects.toThrow(/Invalid OTP purpose/);
  });

  it('verifyOtp throws for an unknown purpose', async () => {
    await expect(verifyOtp({ userId: 'u', purpose: 'bogus', code: '1234' })).rejects.toThrow(/Invalid OTP purpose/);
  });

  it('exports the canonical purpose constants', () => {
    expect(OTP_PURPOSE.EMAIL_VERIFICATION).toBe('email_verification');
    expect(OTP_PURPOSE.PASSWORD_RESET).toBe('password_reset');
  });
});
