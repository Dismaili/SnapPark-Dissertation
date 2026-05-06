import amqplib from 'amqplib';
import dotenv from 'dotenv';

dotenv.config();

const EXCHANGE      = 'snappark';
const MAX_RETRIES   = 10;
const RETRY_DELAY_MS = 3_000;

let channel = null;

/**
 * Connect to RabbitMQ with exponential back-off retries.
 * If the broker is never reachable, the service continues without publishing.
 */
export const connectRabbitMQ = async () => {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const connection = await amqplib.connect(process.env.MESSAGE_BROKER_URL || process.env.RABBITMQ_URL || 'amqp://localhost');
      channel = await connection.createChannel();

      await channel.assertExchange(EXCHANGE, 'topic', { durable: true });

      connection.on('error', (err) => {
        console.warn('[RabbitMQ] Connection error:', err.message);
        channel = null;
      });
      connection.on('close', () => {
        console.warn('[RabbitMQ] Connection closed');
        channel = null;
      });

      console.log('[RabbitMQ] Connected successfully');
      return;
    } catch (err) {
      console.warn(`[RabbitMQ] Connection attempt ${attempt}/${MAX_RETRIES} failed: ${err.message}`);
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      }
    }
  }

  console.warn('[RabbitMQ] Could not connect after all retries — publishing disabled');
};

/**
 * Publish an event to the snappark exchange.
 *
 * @param {string} routingKey – e.g. "case.created", "case.reported", "case.resolved"
 * @param {object} payload    – the event data
 */
const publish = (routingKey, payload) => {
  if (!channel) {
    console.warn(`[RabbitMQ] Channel unavailable — skipping ${routingKey} for case`, payload.id);
    return;
  }

  try {
    const message = Buffer.from(JSON.stringify(payload));
    channel.publish(EXCHANGE, routingKey, message, { persistent: true });
    console.log(`[RabbitMQ] Published ${routingKey} for case`, payload.id);
  } catch (err) {
    console.warn(`[RabbitMQ] Publish failed (${routingKey}):`, err.message);
  }
};

/**
 * Publish a CaseCreated event — fired after Gemini analysis completes.
 */
export const publishCaseCreated = (payload) => publish('case.created', payload);

/**
 * Publish a CaseReported event — fired when a confirmed violation is
 * forwarded to authorities.
 */
export const publishCaseReported = (payload) => publish('case.reported', payload);

/**
 * Publish a CaseResolved event — fired when a case is marked as resolved.
 */
export const publishCaseResolved = (payload) => publish('case.resolved', payload);

/**
 * Publish a CaseCancelled event — emitted by the saga's compensation
 * step when a case-creation flow is rolled back. The notification
 * service treats this as a request to suppress / withdraw any in-app
 * notification that may have been generated for the cancelled case.
 */
export const publishCaseCancelled = (payload) => publish('case.cancelled', payload);

/**
 * Strict variant of publish() used by saga steps: throws on failure
 * instead of swallowing the error. The fire-and-forget publishers above
 * deliberately log-and-continue because the original handlers were
 * structured around best-effort delivery; saga steps need the opposite
 * contract — a failure must propagate so the coordinator can compensate.
 */
export const publishStrict = (routingKey, payload) => {
  if (!channel) {
    throw new Error(`RabbitMQ channel unavailable — cannot publish ${routingKey}`);
  }
  const message = Buffer.from(JSON.stringify(payload));
  const ok = channel.publish(EXCHANGE, routingKey, message, { persistent: true });
  if (!ok) {
    throw new Error(`RabbitMQ refused publish for ${routingKey} (back-pressure)`);
  }
  console.log(`[RabbitMQ] Published ${routingKey} (strict) for case`, payload.id);
};
