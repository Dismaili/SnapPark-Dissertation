import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 2_000,
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected error on idle client:', err.message);
});

export const query = (text, params) => pool.query(text, params);

/**
 * Create tables on first start (idempotent).
 * Owned exclusively by this service — Database-per-Service pattern.
 */
export const initDB = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      case_id       UUID NOT NULL,
      user_id       TEXT NOT NULL,
      channel       TEXT NOT NULL DEFAULT 'in_app',
      message       TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'pending',
      metadata      JSONB,
      retry_count   INTEGER NOT NULL DEFAULT 0,
      created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      sent_at       TIMESTAMP WITH TIME ZONE,
      failed_at     TIMESTAMP WITH TIME ZONE,
      read_at       TIMESTAMP WITH TIME ZONE
    );

    CREATE INDEX IF NOT EXISTS idx_notifications_case_id    ON notifications (case_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_user_id    ON notifications (user_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_status     ON notifications (status);
    CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications (created_at DESC);

    CREATE TABLE IF NOT EXISTS notification_preferences (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     TEXT NOT NULL UNIQUE,
      in_app      BOOLEAN NOT NULL DEFAULT TRUE,
      sms         BOOLEAN NOT NULL DEFAULT FALSE,
      email       BOOLEAN NOT NULL DEFAULT FALSE,
      push        BOOLEAN NOT NULL DEFAULT FALSE,
      phone       TEXT,
      email_addr  TEXT,
      fcm_token   TEXT,
      created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_notif_prefs_user_id ON notification_preferences (user_id);

    CREATE TABLE IF NOT EXISTS notification_delivery_log (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      notification_id   UUID,
      case_id           UUID NOT NULL,
      user_id           TEXT NOT NULL,
      channel           TEXT NOT NULL,
      status            TEXT NOT NULL DEFAULT 'pending',
      provider_response JSONB,
      error_message     TEXT,
      attempt           INTEGER NOT NULL DEFAULT 1,
      created_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_delivery_log_case_id ON notification_delivery_log (case_id);
    CREATE INDEX IF NOT EXISTS idx_delivery_log_user_id ON notification_delivery_log (user_id);
  `);

  console.log('[DB] Schema initialised successfully');
};

// ─── Notification CRUD ──────────────────────────────────────────────────────

/**
 * Insert a new notification record.
 */
export const insertNotification = async ({ caseId, userId, channel, message, metadata }) => {
  const result = await query(
    `INSERT INTO notifications (case_id, user_id, channel, message, status, metadata)
     VALUES ($1, $2, $3, $4, 'sent', $5)
     RETURNING *`,
    [caseId, userId, channel, message, metadata ? JSON.stringify(metadata) : null]
  );
  return result.rows[0];
};

/**
 * Mark a notification as failed.
 */
export const markFailed = async (id, retryCount) => {
  await query(
    `UPDATE notifications SET status = 'failed', failed_at = NOW(), retry_count = $2 WHERE id = $1`,
    [id, retryCount]
  );
};

/**
 * Mark a single notification as read.
 */
export const markNotificationRead = async (id) => {
  const result = await query(
    `UPDATE notifications SET read_at = NOW() WHERE id = $1 AND read_at IS NULL RETURNING *`,
    [id]
  );
  return result.rows[0] || null;
};

/**
 * Mark all notifications for a user as read.
 */
export const markAllNotificationsRead = async (userId) => {
  const result = await query(
    `UPDATE notifications SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL`,
    [userId]
  );
  return result.rowCount;
};

// ─── Notification Preferences ───────────────────────────────────────────────

/**
 * Get notification preferences for a user.
 * Returns null if none exist.
 */
export const getNotificationPreferences = async (userId) => {
  const result = await query(
    `SELECT * FROM notification_preferences WHERE user_id = $1`,
    [userId]
  );
  return result.rows[0] || null;
};

/**
 * Create or update notification preferences for a user.
 */
export const upsertNotificationPreferences = async ({
  userId, inApp = true, sms = false, email = true, push = false,
  phone = null, emailAddr = null, fcmToken = null,
}) => {
  const result = await query(
    `INSERT INTO notification_preferences
       (user_id, in_app, sms, email, push, phone, email_addr, fcm_token)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (user_id) DO UPDATE SET
       in_app     = EXCLUDED.in_app,
       sms        = EXCLUDED.sms,
       email      = EXCLUDED.email,
       push       = EXCLUDED.push,
       phone      = COALESCE(EXCLUDED.phone, notification_preferences.phone),
       email_addr = COALESCE(EXCLUDED.email_addr, notification_preferences.email_addr),
       fcm_token  = COALESCE(EXCLUDED.fcm_token, notification_preferences.fcm_token),
       updated_at = NOW()
     RETURNING *`,
    [userId, inApp, sms, email, push, phone, emailAddr, fcmToken]
  );
  return result.rows[0];
};

// ─── Delivery Log ───────────────────────────────────────────────────────────

/**
 * Insert a delivery log entry for a channel dispatch attempt.
 */
export const insertDeliveryLog = async ({
  notificationId = null, caseId, userId, channel, status, providerResponse = null, errorMessage = null,
}) => {
  const result = await query(
    `INSERT INTO notification_delivery_log
       (notification_id, case_id, user_id, channel, status, provider_response, error_message)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      notificationId, caseId, userId, channel, status,
      providerResponse ? JSON.stringify(providerResponse) : null,
      errorMessage,
    ]
  );
  return result.rows[0];
};

/**
 * Get delivery log entries for a case.
 */
export const getDeliveryLog = async (caseId) => {
  const result = await query(
    `SELECT * FROM notification_delivery_log WHERE case_id = $1 ORDER BY created_at DESC`,
    [caseId]
  );
  return result.rows;
};

// ─── Unread Count ───────────────────────────────────────────────────────────

/**
 * Get the count of unread in-app notifications for a user.
 * Used by the UI to show a notification badge.
 */
export const getUnreadCount = async (userId) => {
  const result = await query(
    `SELECT COUNT(*) as count FROM notifications
     WHERE user_id = $1 AND channel = 'in_app' AND read_at IS NULL`,
    [userId]
  );
  return Number(result.rows[0].count);
};

export default pool;
