import { describe, it, expect, vi, beforeEach } from 'vitest';

// The registry inspects env vars at import time, so each test runs in a
// fresh vi.resetModules() session and sets only the env it wants enabled.

vi.mock('../src/db.js', () => ({
  insertNotification: vi.fn().mockResolvedValue({ id: 'x' }),
}));

vi.mock('nodemailer', () => ({
  default: { createTransport: () => ({ sendMail: vi.fn() }) },
  createTransport: () => ({ sendMail: vi.fn() }),
}));

vi.mock('twilio', () => ({
  default: () => ({ messages: { create: vi.fn() } }),
}));

vi.mock('firebase-admin', () => ({
  default: {
    apps: [{}],
    initializeApp: vi.fn(),
    credential: { cert: vi.fn() },
    messaging: () => ({ send: vi.fn() }),
  },
}));

vi.mock('fs', () => ({
  readFileSync: () => JSON.stringify({ type: 'service_account' }),
}));

const ENV_KEYS = [
  'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER',
  'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SMTP_PORT', 'SMTP_FROM',
  'FIREBASE_SERVICE_ACCOUNT_PATH',
];

const clearChannelEnv = () => {
  for (const k of ENV_KEYS) delete process.env[k];
};

beforeEach(() => {
  vi.resetModules();
  clearChannelEnv();
});

describe('channel registry', () => {
  it('always registers the in_app channel', async () => {
    const channels = (await import('../src/channels/index.js')).default;
    expect(channels.has('in_app')).toBe(true);
  });

  it('skips sms / email / push when credentials are absent', async () => {
    const channels = (await import('../src/channels/index.js')).default;
    expect(channels.has('sms')).toBe(false);
    expect(channels.has('email')).toBe(false);
    expect(channels.has('push')).toBe(false);
  });

  it('registers sms when Twilio env is present', async () => {
    process.env.TWILIO_ACCOUNT_SID = 'AC';
    process.env.TWILIO_AUTH_TOKEN = 'tok';
    process.env.TWILIO_PHONE_NUMBER = '+10000000000';
    const channels = (await import('../src/channels/index.js')).default;
    expect(channels.has('sms')).toBe(true);
  });

  it('registers email when SMTP env is present', async () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_USER = 'u';
    const channels = (await import('../src/channels/index.js')).default;
    expect(channels.has('email')).toBe(true);
  });

  it('registers push when Firebase service-account path is present', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH = '/tmp/x.json';
    const channels = (await import('../src/channels/index.js')).default;
    expect(channels.has('push')).toBe(true);
  });
});
