import amqplib from 'amqplib';
import { query } from '../db.js';
import { recordSagaEvent } from './coordinator.js';

const EXCHANGE = 'snappark';
const QUEUE    = 'violation-analysis.notification-failed';
const KEY      = 'notification.failed';

/**
 * Subscribe to notification.failed events from the notification service.
 *
 * This is the "distributed compensation" half of the saga: the failure
 * happens in another service, asynchronously, after the saga has already
 * returned a 201 to the client. The listener:
 *
 *   1. Appends the failure to the originating saga's history (so a single
 *      sagas/:id query still tells the whole story).
 *   2. Marks the case as `notification_failed` in the cases table — the
 *      analysis itself is still useful, so we DO NOT delete the case.
 *   3. Writes an audit entry for traceability (NFR6).
 *
 * Compensation policy at this boundary is "mark and continue", not
 * "destroy". See docs/saga-pattern.md for the rationale.
 */
export const startSagaListener = async ({ url } = {}) => {
  const brokerUrl = url
    || process.env.MESSAGE_BROKER_URL
    || process.env.RABBITMQ_URL
    || 'amqp://localhost';

  const connection = await amqplib.connect(brokerUrl);
  const channel    = await connection.createChannel();

  await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
  await channel.assertQueue(QUEUE, { durable: true });
  await channel.bindQueue(QUEUE, EXCHANGE, KEY);
  await channel.prefetch(1);

  channel.consume(QUEUE, async (msg) => {
    if (!msg) return;
    try {
      const payload = JSON.parse(msg.content.toString());
      await handleNotificationFailed(payload);
      channel.ack(msg);
    } catch (err) {
      console.error('[saga listener] failed to handle notification.failed:', err.message);
      // Re-queue once; if it fails again it goes to whatever DLQ is configured.
      channel.nack(msg, false, !msg.fields.redelivered);
    }
  });

  console.log(`[saga listener] consuming from "${QUEUE}" (${KEY})`);

  connection.on('error', (err) => console.warn('[saga listener] connection error:', err.message));
  connection.on('close', () => console.warn('[saga listener] connection closed'));

  return { channel, connection };
};

const handleNotificationFailed = async ({ sagaId, caseId, channel, error }) => {
  if (sagaId) {
    await recordSagaEvent({
      sagaId,
      eventType: 'notification.failed',
      payload: { caseId, channel, error },
    });
  }

  if (caseId) {
    await query(
      `UPDATE cases
          SET status = CASE WHEN status = 'completed' THEN 'notification_failed' ELSE status END
        WHERE id = $1`,
      [caseId],
    );

    await query(
      `INSERT INTO case_audit_log (event_type, case_id, payload)
       VALUES ('NotificationFailed', $1, $2::jsonb)`,
      [caseId, JSON.stringify({ sagaId, channel, error })],
    );
  }
};
