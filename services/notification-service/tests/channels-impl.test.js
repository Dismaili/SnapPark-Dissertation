import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock external SDKs before importing each channel ───────────────────────

const mockInsertNotification = vi.fn();
vi.mock('../src/db.js', () => ({
  insertNotification: (...a) => mockInsertNotification(...a),
}));

const mockSendMail = vi.fn();
vi.mock('nodemailer', () => ({
  default: { createTransport: () => ({ sendMail: (...a) => mockSendMail(...a) }) },
  createTransport: () => ({ sendMail: (...a) => mockSendMail(...a) }),
}));

const mockTwilioCreate = vi.fn();
vi.mock('twilio', () => ({
  default: () => ({ messages: { create: (...a) => mockTwilioCreate(...a) } }),
}));

const mockFcmSend = vi.fn();
vi.mock('firebase-admin', () => ({
  default: {
    apps: [{}], // pretend already initialised so PushChannel does not re-init
    initializeApp: vi.fn(),
    credential: { cert: vi.fn() },
    messaging: () => ({ send: (...a) => mockFcmSend(...a) }),
  },
}));

vi.mock('fs', () => ({
  readFileSync: () => JSON.stringify({ type: 'service_account' }),
}));

const { InAppChannel } = await import('../src/channels/InAppChannel.js');
const { EmailChannel } = await import('../src/channels/EmailChannel.js');
const { SmsChannel }   = await import('../src/channels/SmsChannel.js');
const { PushChannel }  = await import('../src/channels/PushChannel.js');
const { BaseChannel }  = await import('../src/channels/BaseChannel.js');

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── BaseChannel ─────────────────────────────────────────────────────────────

describe('BaseChannel', () => {
  it('throws when instantiated directly', () => {
    expect(() => new BaseChannel('x')).toThrow(/abstract/);
  });

  it('throws on unimplemented send()', async () => {
    class Stub extends BaseChannel {}
    const s = new Stub('stub');
    await expect(s.send({})).rejects.toThrow(/must be implemented/);
  });
});

// ─── InAppChannel ────────────────────────────────────────────────────────────

describe('InAppChannel', () => {
  it('persists the notification and returns the inserted id', async () => {
    mockInsertNotification.mockResolvedValue({ id: 'notif-1' });
    const ch = new InAppChannel();
    const r = await ch.send({ caseId: 'c', userId: 'u', message: 'm', metadata: {} });
    expect(r.success).toBe(true);
    expect(r.providerResponse.notificationId).toBe('notif-1');
  });

  it('returns error result when DB insert throws', async () => {
    mockInsertNotification.mockRejectedValue(new Error('db down'));
    const ch = new InAppChannel();
    const r = await ch.send({ caseId: 'c', userId: 'u', message: 'm' });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/db down/);
  });
});

// ─── EmailChannel ────────────────────────────────────────────────────────────

describe('EmailChannel', () => {
  it('sends an HTML email with subject + provider id', async () => {
    mockSendMail.mockResolvedValue({ messageId: 'msg-1' });
    const ch = new EmailChannel();
    const r = await ch.send({
      to: 'a@b.c',
      subject: 'Hi',
      message: 'hello',
      metadata: { confidence: 0.5, violationConfirmed: true, violationType: 'x', licensePlate: 'AB' },
    });
    expect(r.success).toBe(true);
    expect(r.providerResponse.messageId).toBe('msg-1');
    const sent = mockSendMail.mock.calls[0][0];
    expect(sent.to).toBe('a@b.c');
    expect(sent.html).toContain('hello');
    expect(sent.html).toContain('AB');
  });

  it('falls back to default subject when none supplied', async () => {
    mockSendMail.mockResolvedValue({ messageId: 'msg-2' });
    const ch = new EmailChannel();
    await ch.send({ to: 'a@b.c', message: 'x', metadata: {} });
    expect(mockSendMail.mock.calls[0][0].subject).toMatch(/SnapPark/);
  });

  it('returns error result on send failure', async () => {
    mockSendMail.mockRejectedValue(new Error('smtp'));
    const ch = new EmailChannel();
    const r = await ch.send({ to: 'a@b.c', message: 'x' });
    expect(r.success).toBe(false);
    expect(r.error).toBe('smtp');
  });

  it('omits license-plate row when not provided', async () => {
    mockSendMail.mockResolvedValue({ messageId: 'msg-3' });
    const ch = new EmailChannel();
    await ch.send({ to: 'a@b.c', message: 'x', metadata: { violationConfirmed: false } });
    expect(mockSendMail.mock.calls[0][0].html).not.toMatch(/License Plate/);
  });
});

// ─── SmsChannel ──────────────────────────────────────────────────────────────

describe('SmsChannel', () => {
  it('sends a message via Twilio', async () => {
    mockTwilioCreate.mockResolvedValue({ sid: 'sm-1', status: 'queued' });
    const ch = new SmsChannel();
    const r = await ch.send({ to: '+10000000000', message: 'hi' });
    expect(r.success).toBe(true);
    expect(r.providerResponse.sid).toBe('sm-1');
    expect(mockTwilioCreate).toHaveBeenCalledWith(expect.objectContaining({ to: '+10000000000', body: 'hi' }));
  });

  it('returns error on Twilio failure', async () => {
    mockTwilioCreate.mockRejectedValue(new Error('twilio'));
    const ch = new SmsChannel();
    const r = await ch.send({ to: '+1', message: 'hi' });
    expect(r.success).toBe(false);
    expect(r.error).toBe('twilio');
  });
});

// ─── PushChannel ─────────────────────────────────────────────────────────────

describe('PushChannel', () => {
  // Set the env var the constructor reads so the test path doesn't error out
  // (the path is consumed by our `fs` mock, which returns a static JSON blob).
  process.env.FIREBASE_SERVICE_ACCOUNT_PATH = '/tmp/fake-key.json';

  it('sends a push notification via FCM', async () => {
    mockFcmSend.mockResolvedValue('projects/x/messages/y');
    const ch = new PushChannel();
    const r = await ch.send({
      to: 'device-token',
      subject: 'Hi',
      message: 'body',
      metadata: { caseId: 'c', violationConfirmed: true, violationType: 't', confidence: 0.9 },
    });
    expect(r.success).toBe(true);
    expect(r.providerResponse.messageId).toMatch(/projects/);
  });

  it('uses the default subject when none provided', async () => {
    mockFcmSend.mockResolvedValue('m');
    const ch = new PushChannel();
    await ch.send({ to: 'd', message: 'b' });
    expect(mockFcmSend.mock.calls[0][0].notification.title).toMatch(/SnapPark/);
  });

  it('returns error when FCM rejects', async () => {
    mockFcmSend.mockRejectedValue(new Error('fcm'));
    const ch = new PushChannel();
    const r = await ch.send({ to: 'd', message: 'b' });
    expect(r.success).toBe(false);
    expect(r.error).toBe('fcm');
  });
});
