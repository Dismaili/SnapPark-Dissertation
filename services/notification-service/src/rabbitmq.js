import amqplib from 'amqplib';
import dotenv from 'dotenv';

dotenv.config();

const EXCHANGE    = 'snappark';
const QUEUE       = 'notification-service.case-created';
const ROUTING_KEY = 'case.created';
const MAX_RETRIES = 10;
const RETRY_DELAY_MS = 3_000;

let channel = null;

/**
 * Connect to RabbitMQ and start consuming CaseCreated events.
 *
 * @param {(msg: object) => Promise<void>} onMessage – handler called for each event
 */
export const connectAndConsume = async (onMessage) => {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const url = process.env.MESSAGE_BROKER_URL || process.env.RABBITMQ_URL || 'amqp://localhost';
      const connection = await amqplib.connect(url);
      channel = await connection.createChannel();

      // Ensure the exchange exists (must match the producer's declaration)
      await channel.assertExchange(EXCHANGE, 'topic', { durable: true });

      // Create a durable queue for this service
      await channel.assertQueue(QUEUE, {
        durable: true,
        arguments: {
          'x-dead-letter-exchange': '',               // default exchange
          'x-dead-letter-routing-key': `${QUEUE}.dlq`, // dead-letter queue
        },
      });

      // Bind queue to exchange with the routing key
      await channel.bindQueue(QUEUE, EXCHANGE, ROUTING_KEY);

      // Process one message at a time to avoid overwhelming the service
      await channel.prefetch(1);

      // Start consuming
      channel.consume(QUEUE, async (msg) => {
        if (!msg) return;

        try {
          const payload = JSON.parse(msg.content.toString());
          await onMessage(payload);
          channel.ack(msg);
        } catch (err) {
          console.error('[RabbitMQ] Failed to process message:', err.message);
          // Reject and requeue once; if it fails again, it goes to DLQ
          channel.nack(msg, false, !msg.fields.redelivered);
        }
      });

      connection.on('error', (err) => {
        console.warn('[RabbitMQ] Connection error:', err.message);
        channel = null;
      });
      connection.on('close', () => {
        console.warn('[RabbitMQ] Connection closed — will not auto-reconnect');
        channel = null;
      });

      console.log(`[RabbitMQ] Connected — consuming from queue "${QUEUE}"`);
      return;
    } catch (err) {
      console.warn(`[RabbitMQ] Connection attempt ${attempt}/${MAX_RETRIES} failed: ${err.message}`);
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      }
    }
  }

  console.warn('[RabbitMQ] Could not connect after all retries — consuming disabled');
};
