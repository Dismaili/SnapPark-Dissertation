import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hit the remaining decision branches in dispatcher.js: backfill email_addr
// path, channel-missing-from-registry skip, address-field skip, full-failure
// notification.failed publish, partial-success no publish.

const mockGetPrefs = vi.fn();
const mockUpsertPrefs = vi.fn();
const mockInsertDeliveryLog = vi.fn().mockResolvedValue({});

vi.mock('../src/db.js', () => ({
  getNotificationPreferences:    (...a) => mockGetPrefs(...a),
  upsertNotificationPreferences: (...a) => mockUpsertPrefs(...a),
  insertDeliveryLog:             (...a) => mockInsertDeliveryLog(...a),
}));

const mockPublishFailed = vi.fn();
vi.mock('../src/rabbitmq.js', () => ({
  publishNotificationFailed: (...a) => mockPublishFailed(...a),
}));

// Registry contains every channel so we can test the "registry says no" path
// by removing a channel from the map between tests.
const mockInAppSend = vi.fn();
const mockEmailSend = vi.fn();
const mockSmsSend   = vi.fn();
const mockPushSend  = vi.fn();
const channelMap = new Map([
  ['in_app', { send: mockInAppSend }],
  ['email',  { send: mockEmailSend }],
  ['sms',    { send: mockSmsSend   }],
  ['push',   { send: mockPushSend  }],
]);

vi.mock('../src/channels/index.js', () => ({ default: channelMap }));

const { dispatchNotification } = await import('../src/dispatcher.js');

const baseEvent = {
  id: 'case-uuid',
  userId: 'u',
  userEmail: 'u@x.c',
  violationConfirmed: true,
  violationType: 't',
  confidence: 0.9,
  licensePlate: 'AB-123',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('dispatcher — additional branches', () => {
  it('backfills email_addr from event.userEmail when prefs lack it', async () => {
    mockGetPrefs.mockResolvedValue({
      in_app: true, sms: false, email: false, push: false,
      phone: null, email_addr: null, fcm_token: null,
    });
    mockUpsertPrefs.mockResolvedValue({
      in_app: true, sms: false, email: false, push: false,
      email_addr: 'u@x.c',
    });
    mockInAppSend.mockResolvedValue({ success: true });

    await dispatchNotification('case.created', baseEvent);
    expect(mockUpsertPrefs).toHaveBeenCalledWith(expect.objectContaining({ emailAddr: 'u@x.c' }));
  });

  it('skips an email channel that is enabled but has no address on file', async () => {
    mockGetPrefs.mockResolvedValue({
      in_app: false, sms: false, email: true, push: false,
      phone: null, email_addr: null, fcm_token: null,
    });
    const r = await dispatchNotification('case.created', { ...baseEvent, userEmail: null });
    expect(r).toHaveLength(0);
    expect(mockEmailSend).not.toHaveBeenCalled();
  });

  it('publishes notification.failed when every enabled channel fails', async () => {
    mockGetPrefs.mockResolvedValue({
      in_app: true, sms: true, email: false, push: false,
      phone: '+1', email_addr: null, fcm_token: null,
    });
    mockInAppSend.mockResolvedValue({ success: false, error: 'in_app down' });
    mockSmsSend.mockResolvedValue({ success: false, error: 'twilio' });
    await dispatchNotification('case.created', { ...baseEvent, sagaId: 'saga-1' });
    expect(mockPublishFailed).toHaveBeenCalledWith(expect.objectContaining({
      sagaId: 'saga-1', caseId: baseEvent.id,
    }));
  });

  it('does not publish notification.failed on partial success', async () => {
    mockGetPrefs.mockResolvedValue({
      in_app: true, sms: true, email: false, push: false,
      phone: '+1', email_addr: null, fcm_token: null,
    });
    mockInAppSend.mockResolvedValue({ success: true });
    mockSmsSend.mockResolvedValue({ success: false, error: 'twilio' });
    await dispatchNotification('case.created', baseEvent);
    expect(mockPublishFailed).not.toHaveBeenCalled();
  });

  it('skips a channel that is enabled in prefs but not registered in the runtime', async () => {
    // Pretend "push" isn't registered — temporarily delete from the registry.
    channelMap.delete('push');
    mockGetPrefs.mockResolvedValue({
      in_app: false, sms: false, email: false, push: true,
      phone: null, email_addr: 'u@x.c', fcm_token: 'tok',
    });
    try {
      const r = await dispatchNotification('case.created', baseEvent);
      expect(r).toHaveLength(0);
      expect(mockPushSend).not.toHaveBeenCalled();
    } finally {
      channelMap.set('push', { send: mockPushSend });
    }
  });

  it('uses the short case id when no license plate is present', async () => {
    mockGetPrefs.mockResolvedValue({ in_app: true, sms: false, email: false, push: false });
    mockInAppSend.mockResolvedValue({ success: true });
    await dispatchNotification('case.created', { ...baseEvent, licensePlate: null });
    const payload = mockInAppSend.mock.calls[0][0];
    expect(payload.message).toMatch(/case /);
  });

  it('builds a no-violation message when violationConfirmed=false', async () => {
    mockGetPrefs.mockResolvedValue({ in_app: true, sms: false, email: false, push: false });
    mockInAppSend.mockResolvedValue({ success: true });
    await dispatchNotification('case.created', { ...baseEvent, violationConfirmed: false });
    expect(mockInAppSend.mock.calls[0][0].message).toMatch(/No violation/);
  });

  it('uses null sagaId in the failure event when source has none', async () => {
    mockGetPrefs.mockResolvedValue({ in_app: true, sms: false, email: false, push: false });
    mockInAppSend.mockResolvedValue({ success: false, error: 'x' });
    await dispatchNotification('case.created', { ...baseEvent, sagaId: undefined });
    expect(mockPublishFailed).toHaveBeenCalledWith(expect.objectContaining({ sagaId: null }));
  });
});
