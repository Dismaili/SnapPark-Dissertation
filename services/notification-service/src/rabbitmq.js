import amqplib from 'amqplib';
import dotenv from 'dotenv';

dotenv.config();

const EXCHANGE    = 'snappark';
const MAX_RETRIES = 10;
const RETRY_DELAY_MS = 3_000;

/**
 * Queue bindings — one queue per event type so each can be processed
 * independently and failures in one do not block others.
 */
const BINDINGS = [
  { queue: 'notification-service.case-created',  routingKey: 'case.created'  },
  { queue: 'notification-service.case-reported',  routingKey: 'case.reported' },
  { queue: 'notification-service.case-resolved',  routingKey: 'case.resolved' },
];

let channel = null;

/**
 * Connect to RabbitMQ and start consuming events.
 *
 * @param {{ onCaseCreated, onCaseReported, onCaseResolved }} handlers
 */
export const connectAndConsume = async (handlers) => {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const url = process.env.MESSAGE_BROKER_URL || process.env.RABBITMQ_URL || 'amqp://localhost';
      const connection = await amqplib.connect(url);
      channel = await connection.createChannel();

      // Ensure the exchange exists (must match the producer's declaration)
      await channel.assertExchange(EXCHANGE, 'topic', { durable: true });

      // Process one message at a time per queue
      await channel.prefetch(1);

      // Set up each queue binding and consumer
      for (const { queue, routingKey } of BINDINGS) {
        await channel.assertQueue(queue, {
          durable: true,
          arguments: {
            'x-dead-letter-exchange': '',
            'x-dead-letter-routing-key': `${queue}.dlq`,
          },
        });

        await channel.bindQueue(queue, EXCHANGE, routingKey);

        // Map routing key to handler
        const handler = {
          'case.created':  handlers.onCaseCreated,
          'case.reported': handlers.onCaseReported,
          'case.resolved': handlers.onCaseResolved,
        }[routingKey];

        if (!handler) continue;

        channel.consume(queue, async (msg) => {
          if (!msg) return;

          try {
            const payload = JSON.parse(msg.content.toString());
            await handler(payload);
            channel.ack(msg);
          } catch (err) {
            console.error(`[RabbitMQ] Failed to process ${routingKey}:`, err.message);
            channel.nack(msg, false, !msg.fields.redelivered);
          }
        });

        console.log(`[RabbitMQ] Consuming from queue "${queue}" (${routingKey})`);
      }

      connection.on('error', (err) => {
        console.warn('[RabbitMQ] Connection error:', err.message);
        channel = null;
      });
      connection.on('close', () => {
        console.warn('[RabbitMQ] Connection closed — will not auto-reconnect');
        channel = null;
      });

      console.log('[RabbitMQ] Connected — all queues bound');
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
