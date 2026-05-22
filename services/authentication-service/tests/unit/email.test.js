import { describe, it, expect, jest } from '@jest/globals';

// Unit test the email module without sending real SMTP. The module reads
// env at import time, so we set SMTP_* before importing.

await jest.unstable_mockModule('nodemailer', () => ({
  default: { createTransport: () => ({ sendMail: jest.fn().mockResolvedValue({ messageId: 'm' }) }) },
}));

// First import — without SMTP env: every send should be a no-op.
process.env.SMTP_HOST = '';
process.env.SMTP_USER = '';
const noSmtp = await import('../../src/email.js');

describe('email module — SMTP not configured', () => {
  it('sendVerificationOtpEmail is a no-op when SMTP env is missing', async () => {
    const r = await noSmtp.sendVerificationOtpEmail({
      to: 'a@b.c', firstName: 'x', code: '1234', ttlMinutes: 10,
    });
    expect(r).toBeUndefined();
  });

  it('sendPasswordResetOtpEmail is a no-op when SMTP env is missing', async () => {
    const r = await noSmtp.sendPasswordResetOtpEmail({
      to: 'a@b.c', firstName: null, code: '5678', ttlMinutes: 10,
    });
    expect(r).toBeUndefined();
  });
});
