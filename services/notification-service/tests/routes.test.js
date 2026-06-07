import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// Mock db.js entirely so routes can be tested without Postgres
const mockQuery                     = vi.fn();
const mockInitDB                    = vi.fn().mockResolvedValue();
const mockMarkRead                  = vi.fn();
const mockMarkAllRead               = vi.fn();
const mockGetPrefs                  = vi.fn();
const mockUpsertPrefs               = vi.fn();
const mockGetDeliveryLog            = vi.fn();
const mockGetUnreadCount            = vi.fn();

vi.mock('../src/db.js', () => ({
  query:                          (...a) => mockQuery(...a),
  initDB:                         (...a) => mockInitDB(...a),
  markNotificationRead:           (...a) => mockMarkRead(...a),
  markAllNotificationsRead:       (...a) => mockMarkAllRead(...a),
  getNotificationPreferences:     (...a) => mockGetPrefs(...a),
  upsertNotificationPreferences:  (...a) => mockUpsertPrefs(...a),
  getDeliveryLog:                 (...a) => mockGetDeliveryLog(...a),
  getUnreadCount:                 (...a) => mockGetUnreadCount(...a),
  default: {},
}));

vi.mock('../src/rabbitmq.js', () => ({
  connectAndConsume: vi.fn().mockResolvedValue(),
}));

const mockDispatch = vi.fn();
vi.mock('../src/dispatcher.js', () => ({
  dispatchNotification: (...a) => mockDispatch(...a),
}));

const { app, handleCaseCreated, handleCaseReported, handleCaseResolved } =
  await import('../src/index.js');

const USER_ID = 'user-1';
const CASE_ID = 'case-1';
const NOTIF_ID = 'notif-1';

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── /health ─────────────────────────────────────────────────────────────────

describe('GET /health', () => {
  it('returns 200 with service identity', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.service).toBe('notification-service');
    expect(res.body.status).toBe('ok');
  });
});

// ─── /notifications ──────────────────────────────────────────────────────────

describe('GET /notifications', () => {
  it('lists all notifications when no userId filter is given', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: NOTIF_ID }], rowCount: 1 });
    const res = await request(app).get('/notifications');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(mockQuery.mock.calls[0][0]).not.toMatch(/user_id =/);
  });

  it('filters by userId when provided', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    const res = await request(app).get('/notifications').query({ userId: USER_ID });
    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[0][0]).toMatch(/user_id = \$1/);
    expect(mockQuery.mock.calls[0][1][0]).toBe(USER_ID);
  });

  it('clamps limit to 200 and honours offset', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    const res = await request(app).get('/notifications').query({ limit: '500', offset: '7' });
    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[0][1][0]).toBe(200);
    expect(mockQuery.mock.calls[0][1][1]).toBe(7);
  });

  it('500s if the query fails', async () => {
    mockQuery.mockRejectedValue(new Error('db'));
    const res = await request(app).get('/notifications');
    expect(res.status).toBe(500);
  });
});

// ─── /notifications/:id ──────────────────────────────────────────────────────

describe('GET /notifications/:id', () => {
  it('returns the notification when found', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: NOTIF_ID, message: 'hi' }] });
    const res = await request(app).get(`/notifications/${NOTIF_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('hi');
  });

  it('404s when no row matches', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await request(app).get(`/notifications/${NOTIF_ID}`);
    expect(res.status).toBe(404);
  });

  it('500s on DB error', async () => {
    mockQuery.mockRejectedValue(new Error('db'));
    const res = await request(app).get(`/notifications/${NOTIF_ID}`);
    expect(res.status).toBe(500);
  });
});

// ─── /notifications/case/:caseId ─────────────────────────────────────────────

describe('GET /notifications/case/:caseId', () => {
  it('returns rows filtered by case id', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: NOTIF_ID }], rowCount: 1 });
    const res = await request(app).get(`/notifications/case/${CASE_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(mockQuery.mock.calls[0][1][0]).toBe(CASE_ID);
  });

  it('500s on DB error', async () => {
    mockQuery.mockRejectedValue(new Error('db'));
    const res = await request(app).get(`/notifications/case/${CASE_ID}`);
    expect(res.status).toBe(500);
  });
});

// ─── PATCH /notifications/:id/read ───────────────────────────────────────────

describe('PATCH /notifications/:id/read', () => {
  it('returns the updated notification on success', async () => {
    mockMarkRead.mockResolvedValue({ id: NOTIF_ID, read_at: 'now' });
    const res = await request(app).patch(`/notifications/${NOTIF_ID}/read`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(NOTIF_ID);
  });

  it('404s when not found / already read', async () => {
    mockMarkRead.mockResolvedValue(null);
    const res = await request(app).patch(`/notifications/${NOTIF_ID}/read`);
    expect(res.status).toBe(404);
  });

  it('500s on DB error', async () => {
    mockMarkRead.mockRejectedValue(new Error('db'));
    const res = await request(app).patch(`/notifications/${NOTIF_ID}/read`);
    expect(res.status).toBe(500);
  });
});

// ─── PATCH /notifications/read-all/:userId ───────────────────────────────────

describe('PATCH /notifications/read-all/:userId', () => {
  it('returns the count marked read', async () => {
    mockMarkAllRead.mockResolvedValue(3);
    const res = await request(app).patch(`/notifications/read-all/${USER_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.markedRead).toBe(3);
  });

  it('500s on DB error', async () => {
    mockMarkAllRead.mockRejectedValue(new Error('db'));
    const res = await request(app).patch(`/notifications/read-all/${USER_ID}`);
    expect(res.status).toBe(500);
  });
});

// ─── GET /notifications/unread-count/:userId ─────────────────────────────────

describe('GET /notifications/unread-count/:userId', () => {
  it('returns the unread count', async () => {
    mockGetUnreadCount.mockResolvedValue(7);
    const res = await request(app).get(`/notifications/unread-count/${USER_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.unreadCount).toBe(7);
  });

  it('500s on DB error', async () => {
    mockGetUnreadCount.mockRejectedValue(new Error('db'));
    const res = await request(app).get(`/notifications/unread-count/${USER_ID}`);
    expect(res.status).toBe(500);
  });
});

// ─── /notifications/preferences/:userId ──────────────────────────────────────

describe('GET /notifications/preferences/:userId', () => {
  it('returns stored preferences when present', async () => {
    mockGetPrefs.mockResolvedValue({ user_id: USER_ID, in_app: true, email: false });
    const res = await request(app).get(`/notifications/preferences/${USER_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.in_app).toBe(true);
  });

  it('returns sensible defaults when none stored', async () => {
    mockGetPrefs.mockResolvedValue(null);
    const res = await request(app).get(`/notifications/preferences/${USER_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.in_app).toBe(true);
    expect(res.body.email).toBe(true);
    expect(res.body.sms).toBe(false);
  });

  it('500s on DB error', async () => {
    mockGetPrefs.mockRejectedValue(new Error('db'));
    const res = await request(app).get(`/notifications/preferences/${USER_ID}`);
    expect(res.status).toBe(500);
  });
});

describe('PUT /notifications/preferences/:userId', () => {
  it('accepts camelCase payload and persists', async () => {
    mockUpsertPrefs.mockResolvedValue({ user_id: USER_ID, in_app: false });
    const res = await request(app)
      .put(`/notifications/preferences/${USER_ID}`)
      .send({ inApp: false, emailAddr: 'a@b.c', fcmToken: 'tok' });
    expect(res.status).toBe(200);
    expect(mockUpsertPrefs).toHaveBeenCalledWith(expect.objectContaining({
      userId: USER_ID, inApp: false, emailAddr: 'a@b.c', fcmToken: 'tok',
    }));
  });

  it('accepts snake_case payload (frontend round-trip)', async () => {
    mockUpsertPrefs.mockResolvedValue({ user_id: USER_ID });
    const res = await request(app)
      .put(`/notifications/preferences/${USER_ID}`)
      .send({ in_app: true, email_addr: 'x@y.z', fcm_token: 't' });
    expect(res.status).toBe(200);
    expect(mockUpsertPrefs).toHaveBeenCalledWith(expect.objectContaining({
      inApp: true, emailAddr: 'x@y.z', fcmToken: 't',
    }));
  });

  it('500s on DB error', async () => {
    mockUpsertPrefs.mockRejectedValue(new Error('db'));
    const res = await request(app)
      .put(`/notifications/preferences/${USER_ID}`)
      .send({ inApp: true });
    expect(res.status).toBe(500);
  });
});

// ─── /notifications/delivery-log/:caseId ─────────────────────────────────────

describe('GET /notifications/delivery-log/:caseId', () => {
  it('returns log rows with count', async () => {
    mockGetDeliveryLog.mockResolvedValue([{ channel: 'in_app', status: 'sent' }]);
    const res = await request(app).get(`/notifications/delivery-log/${CASE_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
  });

  it('500s on DB error', async () => {
    mockGetDeliveryLog.mockRejectedValue(new Error('db'));
    const res = await request(app).get(`/notifications/delivery-log/${CASE_ID}`);
    expect(res.status).toBe(500);
  });
});

// ─── Event handlers (covered indirectly through the route file) ──────────────

describe('Event handlers', () => {
  it('handleCaseCreated dispatches a case.created event', async () => {
    mockDispatch.mockResolvedValue([{ channel: 'in_app', success: true }]);
    await handleCaseCreated({ id: CASE_ID, userId: USER_ID });
    expect(mockDispatch).toHaveBeenCalledWith('case.created', expect.objectContaining({ id: CASE_ID }));
  });

  it('handleCaseReported dispatches a case.reported event', async () => {
    mockDispatch.mockResolvedValue([{ channel: 'in_app', success: true }]);
    await handleCaseReported({ id: CASE_ID, userId: USER_ID });
    expect(mockDispatch).toHaveBeenCalledWith('case.reported', expect.objectContaining({ id: CASE_ID }));
  });

  it('handleCaseResolved dispatches a case.resolved event', async () => {
    mockDispatch.mockResolvedValue([{ channel: 'in_app', success: true }]);
    await handleCaseResolved({ id: CASE_ID, userId: USER_ID });
    expect(mockDispatch).toHaveBeenCalledWith('case.resolved', expect.objectContaining({ id: CASE_ID }));
  });
});
