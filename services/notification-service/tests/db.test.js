import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock pg module
const mockQuery = vi.fn();

vi.mock('pg', () => ({
  default: {
    Pool: class {
      constructor() {}
      query(text, params) { return mockQuery(text, params); }
      on() {}
    },
  },
}));

const db = await import('../src/db.js');

describe('Notification Database', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('insertNotification', () => {
    it('should insert a notification with correct parameters', async () => {
      const notification = {
        id: 'notif-1',
        case_id: 'case-1',
        user_id: 'user-1',
        channel: 'in_app',
        message: 'Test message',
        status: 'sent',
      };

      mockQuery.mockResolvedValue({ rows: [notification] });

      const result = await db.insertNotification({
        caseId: 'case-1',
        userId: 'user-1',
        channel: 'in_app',
        message: 'Test message',
        metadata: { eventType: 'case.created' },
      });

      expect(result).toEqual(notification);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO notifications'),
        expect.arrayContaining(['case-1', 'user-1', 'in_app', 'Test message'])
      );
    });

    it('should handle null metadata', async () => {
      mockQuery.mockResolvedValue({ rows: [{}] });

      await db.insertNotification({
        caseId: 'case-1',
        userId: 'user-1',
        channel: 'in_app',
        message: 'Test',
        metadata: null,
      });

      const params = mockQuery.mock.calls[0][1];
      expect(params[4]).toBeNull();
    });
  });

  describe('markNotificationRead', () => {
    it('should mark a notification as read', async () => {
      const notification = { id: 'notif-1', read_at: '2024-01-01' };
      mockQuery.mockResolvedValue({ rows: [notification] });

      const result = await db.markNotificationRead('notif-1');

      expect(result).toEqual(notification);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('read_at = NOW()'),
        ['notif-1']
      );
    });

    it('should return null when notification not found or already read', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      const result = await db.markNotificationRead('nonexistent-id');

      expect(result).toBeNull();
    });
  });

  describe('markAllNotificationsRead', () => {
    it('should return count of marked notifications', async () => {
      mockQuery.mockResolvedValue({ rowCount: 5 });

      const count = await db.markAllNotificationsRead('user-1');

      expect(count).toBe(5);
    });

    it('should return 0 when no unread notifications exist', async () => {
      mockQuery.mockResolvedValue({ rowCount: 0 });

      const count = await db.markAllNotificationsRead('user-1');

      expect(count).toBe(0);
    });
  });

  describe('getUnreadCount', () => {
    it('should return the count of unread in-app notifications', async () => {
      mockQuery.mockResolvedValue({ rows: [{ count: '12' }] });

      const count = await db.getUnreadCount('user-1');

      expect(count).toBe(12);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("channel = 'in_app'"),
        ['user-1']
      );
    });

    it('should return 0 when no unread notifications', async () => {
      mockQuery.mockResolvedValue({ rows: [{ count: '0' }] });

      const count = await db.getUnreadCount('user-1');

      expect(count).toBe(0);
    });
  });

  describe('getNotificationPreferences', () => {
    it('should return user preferences', async () => {
      const prefs = { user_id: 'user-1', in_app: true, sms: false };
      mockQuery.mockResolvedValue({ rows: [prefs] });

      const result = await db.getNotificationPreferences('user-1');

      expect(result).toEqual(prefs);
    });

    it('should return null when no preferences exist', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      const result = await db.getNotificationPreferences('user-1');

      expect(result).toBeNull();
    });
  });

  describe('upsertNotificationPreferences', () => {
    it('should create preferences with defaults', async () => {
      const prefs = { user_id: 'user-1', in_app: true, sms: false, email: false, push: false };
      mockQuery.mockResolvedValue({ rows: [prefs] });

      const result = await db.upsertNotificationPreferences({ userId: 'user-1' });

      expect(result).toEqual(prefs);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('ON CONFLICT'),
        expect.arrayContaining(['user-1', true, false, false, false])
      );
    });
  });

  describe('insertDeliveryLog', () => {
    it('should insert a delivery log entry', async () => {
      const log = { id: 'log-1', channel: 'in_app', status: 'sent' };
      mockQuery.mockResolvedValue({ rows: [log] });

      const result = await db.insertDeliveryLog({
        caseId: 'case-1',
        userId: 'user-1',
        channel: 'in_app',
        status: 'sent',
      });

      expect(result).toEqual(log);
    });
  });

  describe('getDeliveryLog', () => {
    it('should return delivery logs for a case', async () => {
      const logs = [
        { id: 'log-1', channel: 'in_app' },
        { id: 'log-2', channel: 'sms' },
      ];
      mockQuery.mockResolvedValue({ rows: logs });

      const result = await db.getDeliveryLog('case-1');

      expect(result).toEqual(logs);
      expect(result).toHaveLength(2);
    });
  });
});
