import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';

import {
  query, initDB,
  markNotificationRead, markAllNotificationsRead,
  getNotificationPreferences, upsertNotificationPreferences,
  getDeliveryLog,
} from './db.js';
import { connectAndConsume } from './rabbitmq.js';
import { dispatchNotification } from './dispatcher.js';

dotenv.config();

// ─── Configuration ────────────────────────────────────────────────────────────

const app  = express();
const PORT = Number(process.env.PORT || 3004);

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));

// ─── Event Handlers ──────────────────────────────────────────────────────────
//
// Each handler is called when the corresponding event is consumed from RabbitMQ.
// All dispatch through the multi-channel notification system (in-app, SMS, email, push).

const logDispatch = (eventType, caseId, results) => {
  const summary = results.map((r) => `${r.channel}:${r.success ? 'ok' : 'fail'}`).join(', ');
  console.log(`[event] ${eventType} dispatched for case ${caseId} → ${summary}`);
};

const handleCaseCreated = async (event) => {
  console.log('[event] CaseCreated received:', event.id);
  const results = await dispatchNotification('case.created', event);
  logDispatch('CaseCreated', event.id, results);
};

const handleCaseReported = async (event) => {
  console.log('[event] CaseReported received:', event.id);
  const results = await dispatchNotification('case.reported', event);
  logDispatch('CaseReported', event.id, results);
};

const handleCaseResolved = async (event) => {
  console.log('[event] CaseResolved received:', event.id);
  const results = await dispatchNotification('case.resolved', event);
  logDispatch('CaseResolved', event.id, results);
};

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /health
 */
app.get('/health', (_req, res) => {
  res.status(200).json({
    service:   'notification-service',
    status:    'ok',
    timestamp: new Date().toISOString(),
  });
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * GET /notifications
 * Returns all notifications, newest first. Supports optional userId filter.
 *
 * Query params:
 *   - userId (optional): filter by user
 *   - limit  (optional): max results (default 50)
 *   - offset (optional): pagination offset (default 0)
 */
app.get('/notifications', async (req, res) => {
  try {
    const { userId, limit = '50', offset = '0' } = req.query;
    const maxLimit = Math.min(Number(limit) || 50, 200);
    const skip     = Math.max(Number(offset) || 0, 0);

    let sql, params;

    if (userId) {
      sql    = 'SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3';
      params = [userId, maxLimit, skip];
    } else {
      sql    = 'SELECT * FROM notifications ORDER BY created_at DESC LIMIT $1 OFFSET $2';
      params = [maxLimit, skip];
    }

    const result = await query(sql, params);
    return res.status(200).json({
      notifications: result.rows,
      count:         result.rowCount,
    });
  } catch (err) {
    console.error('[notifications]', err.message);
    return res.status(500).json({ error: 'Failed to retrieve notifications.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * GET /notifications/:id
 * Returns a single notification by UUID.
 */
app.get('/notifications/:id', async (req, res) => {
  try {
    const result = await query('SELECT * FROM notifications WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Notification not found.' });
    }
    return res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error('[notifications/:id]', err.message);
    return res.status(500).json({ error: 'Failed to retrieve notification.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * GET /notifications/case/:caseId
 * Returns all notifications for a specific case.
 */
app.get('/notifications/case/:caseId', async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM notifications WHERE case_id = $1 ORDER BY created_at DESC',
      [req.params.caseId]
    );
    return res.status(200).json({
      notifications: result.rows,
      count:         result.rowCount,
    });
  } catch (err) {
    console.error('[notifications/case/:caseId]', err.message);
    return res.status(500).json({ error: 'Failed to retrieve notifications.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * PATCH /notifications/:id/read
 * Mark a single notification as read.
 */
app.patch('/notifications/:id/read', async (req, res) => {
  try {
    const notification = await markNotificationRead(req.params.id);
    if (!notification) {
      return res.status(404).json({ error: 'Notification not found or already read.' });
    }
    return res.status(200).json(notification);
  } catch (err) {
    console.error('[notifications/:id/read]', err.message);
    return res.status(500).json({ error: 'Failed to mark notification as read.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * PATCH /notifications/read-all/:userId
 * Mark all notifications for a user as read.
 */
app.patch('/notifications/read-all/:userId', async (req, res) => {
  try {
    const count = await markAllNotificationsRead(req.params.userId);
    return res.status(200).json({ markedRead: count });
  } catch (err) {
    console.error('[notifications/read-all]', err.message);
    return res.status(500).json({ error: 'Failed to mark notifications as read.' });
  }
});

// ─── Notification Preferences ───────────────────────────────────────────────

/**
 * GET /notifications/preferences/:userId
 * Returns the user's notification preferences.
 */
app.get('/notifications/preferences/:userId', async (req, res) => {
  try {
    const prefs = await getNotificationPreferences(req.params.userId);
    if (!prefs) {
      return res.status(200).json({
        user_id: req.params.userId,
        in_app: true, sms: false, email: false, push: false,
        phone: null, email_addr: null, fcm_token: null,
      });
    }
    return res.status(200).json(prefs);
  } catch (err) {
    console.error('[preferences]', err.message);
    return res.status(500).json({ error: 'Failed to retrieve preferences.' });
  }
});

/**
 * PUT /notifications/preferences/:userId
 * Create or update notification preferences.
 *
 * Body: { inApp, sms, email, push, phone, emailAddr, fcmToken }
 */
app.put('/notifications/preferences/:userId', async (req, res) => {
  try {
    const { inApp, sms, email, push, phone, emailAddr, fcmToken } = req.body;
    const prefs = await upsertNotificationPreferences({
      userId: req.params.userId,
      inApp, sms, email, push, phone, emailAddr, fcmToken,
    });
    return res.status(200).json(prefs);
  } catch (err) {
    console.error('[preferences]', err.message);
    return res.status(500).json({ error: 'Failed to update preferences.' });
  }
});

// ─── Delivery Log ───────────────────────────────────────────────────────────

/**
 * GET /notifications/delivery-log/:caseId
 * Returns delivery log entries for a case (useful for debugging).
 */
app.get('/notifications/delivery-log/:caseId', async (req, res) => {
  try {
    const logs = await getDeliveryLog(req.params.caseId);
    return res.status(200).json({ logs, count: logs.length });
  } catch (err) {
    console.error('[delivery-log]', err.message);
    return res.status(500).json({ error: 'Failed to retrieve delivery log.' });
  }
});

// ─── Bootstrap ────────────────────────────────────────────────────────────────

const start = async () => {
  await initDB();

  // Connect to RabbitMQ and start consuming events
  // Non-blocking — the HTTP server starts even if the broker is unreachable
  connectAndConsume({
    onCaseCreated:  handleCaseCreated,
    onCaseReported: handleCaseReported,
    onCaseResolved: handleCaseResolved,
  }).catch((err) => {
    console.warn('[RabbitMQ] Background connect failed:', err.message);
  });

  app.listen(PORT, () => {
    console.log(`[notification-service] Listening on port ${PORT}`);
  });
};

start().catch((err) => {
  console.error('[notification-service] Failed to start:', err.message);
  process.exit(1);
});
