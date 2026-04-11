import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
const mockGetPrefs = vi.fn();
const mockUpsertPrefs = vi.fn();
const mockInsertDeliveryLog = vi.fn();

vi.mock('../src/db.js', () => ({
  getNotificationPreferences: (...args) => mockGetPrefs(...args),
  upsertNotificationPreferences: (...args) => mockUpsertPrefs(...args),
  insertDeliveryLog: (...args) => mockInsertDeliveryLog(...args),
}));

// Mock channel registry
const mockInAppSend = vi.fn();
const mockChannels = new Map();
mockChannels.set('in_app', { send: mockInAppSend });

vi.mock('../src/channels/index.js', () => ({
  default: mockChannels,
}));

const { dispatchNotification } = await import('../src/dispatcher.js');

describe('Notification Dispatcher', () => {
  const baseEvent = {
    id: 'case-uuid-123',
    userId: 'user-1',
    violationConfirmed: true,
    violationType: 'double parking',
    confidence: 0.92,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockInsertDeliveryLog.mockResolvedValue({});
  });

  describe('case.created event', () => {
    it('should dispatch in-app notification when user has in_app enabled', async () => {
      mockGetPrefs.mockResolvedValue({ in_app: true, sms: false, email: false, push: false });
      mockInAppSend.mockResolvedValue({ success: true, providerResponse: { notificationId: 'notif-1' } });

      const results = await dispatchNotification('case.created', baseEvent);

      expect(results).toHaveLength(1);
      expect(results[0].channel).toBe('in_app');
      expect(results[0].success).toBe(true);
      expect(mockInAppSend).toHaveBeenCalledOnce();
    });

    it('should build correct message for confirmed violation', async () => {
      mockGetPrefs.mockResolvedValue({ in_app: true, sms: false, email: false, push: false });
      mockInAppSend.mockResolvedValue({ success: true });

      await dispatchNotification('case.created', baseEvent);

      const payload = mockInAppSend.mock.calls[0][0];
      expect(payload.message).toContain('Violation detected');
      expect(payload.message).toContain('double parking');
      expect(payload.metadata.eventType).toBe('case.created');
    });

    it('should build correct message for no violation', async () => {
      mockGetPrefs.mockResolvedValue({ in_app: true, sms: false, email: false, push: false });
      mockInAppSend.mockResolvedValue({ success: true });

      const noViolationEvent = { ...baseEvent, violationConfirmed: false };
      await dispatchNotification('case.created', noViolationEvent);

      const payload = mockInAppSend.mock.calls[0][0];
      expect(payload.message).toContain('No violation detected');
    });
  });

  describe('case.reported event', () => {
    it('should dispatch notification with reported message', async () => {
      mockGetPrefs.mockResolvedValue({ in_app: true, sms: false, email: false, push: false });
      mockInAppSend.mockResolvedValue({ success: true });

      const event = { ...baseEvent, reportedAt: '2024-01-01T00:00:00Z' };
      await dispatchNotification('case.reported', event);

      const payload = mockInAppSend.mock.calls[0][0];
      expect(payload.message).toContain('forwarded to the local authorities');
      expect(payload.subject).toContain('Reported to Authorities');
    });
  });

  describe('case.resolved event', () => {
    it('should dispatch notification with resolved message', async () => {
      mockGetPrefs.mockResolvedValue({ in_app: true, sms: false, email: false, push: false });
      mockInAppSend.mockResolvedValue({ success: true });

      const event = { ...baseEvent, resolvedAt: '2024-01-02T00:00:00Z' };
      await dispatchNotification('case.resolved', event);

      const payload = mockInAppSend.mock.calls[0][0];
      expect(payload.message).toContain('has been resolved');
      expect(payload.message).toContain('Thank you');
    });
  });

  describe('edge cases', () => {
    it('should return empty array for unknown event type', async () => {
      const results = await dispatchNotification('unknown.event', baseEvent);
      expect(results).toEqual([]);
    });

    it('should create default preferences when user has none', async () => {
      mockGetPrefs.mockResolvedValue(null);
      mockUpsertPrefs.mockResolvedValue({ in_app: true, sms: false, email: false, push: false });
      mockInAppSend.mockResolvedValue({ success: true });

      await dispatchNotification('case.created', baseEvent);

      expect(mockUpsertPrefs).toHaveBeenCalledWith({ userId: 'user-1' });
    });

    it('should skip channels that are disabled', async () => {
      mockGetPrefs.mockResolvedValue({ in_app: false, sms: false, email: false, push: false });

      const results = await dispatchNotification('case.created', baseEvent);

      expect(results).toHaveLength(0);
      expect(mockInAppSend).not.toHaveBeenCalled();
    });

    it('should handle channel send failure gracefully', async () => {
      mockGetPrefs.mockResolvedValue({ in_app: true, sms: false, email: false, push: false });
      mockInAppSend.mockRejectedValue(new Error('DB connection failed'));

      const results = await dispatchNotification('case.created', baseEvent);

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(false);
      expect(results[0].error).toContain('DB connection failed');
    });

    it('should log delivery attempt after sending', async () => {
      mockGetPrefs.mockResolvedValue({ in_app: true, sms: false, email: false, push: false });
      mockInAppSend.mockResolvedValue({ success: true, providerResponse: { notificationId: 'n-1' } });

      await dispatchNotification('case.created', baseEvent);

      expect(mockInsertDeliveryLog).toHaveBeenCalledWith(
        expect.objectContaining({
          caseId: 'case-uuid-123',
          userId: 'user-1',
          channel: 'in_app',
          status: 'sent',
        })
      );
    });
  });
});
