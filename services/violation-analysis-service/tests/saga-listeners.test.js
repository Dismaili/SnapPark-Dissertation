import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock amqplib so we can drive the consumer callback directly.
const mockAck = vi.fn();
const mockNack = vi.fn();
let consumeHandler;
const mockChannel = {
  assertExchange: vi.fn().mockResolvedValue(),
  assertQueue:    vi.fn().mockResolvedValue(),
  bindQueue:      vi.fn().mockResolvedValue(),
  prefetch:       vi.fn().mockResolvedValue(),
  consume:        vi.fn((queue, handler) => { consumeHandler = handler; return Promise.resolve({ consumerTag: 't' }); }),
  ack:            mockAck,
  nack:           mockNack,
};

const mockConnection = {
  createChannel: vi.fn().mockResolvedValue(mockChannel),
  on:            vi.fn(),
};

vi.mock('amqplib', () => ({
  default: { connect: vi.fn().mockResolvedValue(mockConnection) },
}));

// Mock the coordinator + db.query that listeners.js depends on.
const mockRecordSagaEvent = vi.fn().mockResolvedValue();
vi.mock('../src/saga/coordinator.js', () => ({
  recordSagaEvent: (...a) => mockRecordSagaEvent(...a),
}));

const mockQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
vi.mock('../src/db.js', () => ({
  query: (...a) => mockQuery(...a),
}));

const { startSagaListener } = await import('../src/saga/listeners.js');

beforeEach(() => {
  vi.clearAllMocks();
  consumeHandler = undefined;
});

// ─── Bootstrap ───────────────────────────────────────────────────────────────

describe('startSagaListener', () => {
  it('asserts the exchange, queue, binding and registers a consumer', async () => {
    await startSagaListener({ url: 'amqp://test' });
    expect(mockChannel.assertExchange).toHaveBeenCalled();
    expect(mockChannel.assertQueue).toHaveBeenCalled();
    expect(mockChannel.bindQueue).toHaveBeenCalled();
    expect(mockChannel.consume).toHaveBeenCalled();
    expect(typeof consumeHandler).toBe('function');
  });

  it('falls back to MESSAGE_BROKER_URL / RABBITMQ_URL when no url passed', async () => {
    delete process.env.RABBITMQ_URL;
    process.env.MESSAGE_BROKER_URL = 'amqp://from-env';
    await startSagaListener();
    const amqplib = (await import('amqplib')).default;
    expect(amqplib.connect).toHaveBeenLastCalledWith('amqp://from-env');
    delete process.env.MESSAGE_BROKER_URL;
  });
});

// ─── Consumer handler ────────────────────────────────────────────────────────

describe('notification.failed consumer', () => {
  beforeEach(async () => {
    await startSagaListener({ url: 'amqp://test' });
  });

  it('records the event on the saga and audits the case', async () => {
    const msg = {
      content: Buffer.from(JSON.stringify({
        sagaId: 'saga-1', caseId: 'case-1', channel: 'email', error: 'smtp',
      })),
      fields: { redelivered: false },
    };
    await consumeHandler(msg);
    expect(mockRecordSagaEvent).toHaveBeenCalledWith(expect.objectContaining({
      sagaId: 'saga-1',
      eventType: 'notification.failed',
    }));
    // 1st query: UPDATE cases  2nd query: INSERT into case_audit_log
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockAck).toHaveBeenCalled();
  });

  it('skips coordinator update when sagaId is absent', async () => {
    const msg = {
      content: Buffer.from(JSON.stringify({ caseId: 'case-2', channel: 'sms', error: 'x' })),
      fields: { redelivered: false },
    };
    await consumeHandler(msg);
    expect(mockRecordSagaEvent).not.toHaveBeenCalled();
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('skips case update + audit when caseId is absent', async () => {
    const msg = {
      content: Buffer.from(JSON.stringify({ sagaId: 'saga-only' })),
      fields: { redelivered: false },
    };
    await consumeHandler(msg);
    expect(mockRecordSagaEvent).toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockAck).toHaveBeenCalled();
  });

  it('nacks (with requeue) on first failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db'));
    const msg = {
      content: Buffer.from(JSON.stringify({ sagaId: 's', caseId: 'c', channel: 'sms', error: 'x' })),
      fields: { redelivered: false },
    };
    await consumeHandler(msg);
    expect(mockNack).toHaveBeenCalledWith(msg, false, true);
  });

  it('nacks (no requeue) on the redelivered attempt to avoid an infinite loop', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db'));
    const msg = {
      content: Buffer.from(JSON.stringify({ sagaId: 's', caseId: 'c', channel: 'sms', error: 'x' })),
      fields: { redelivered: true },
    };
    await consumeHandler(msg);
    expect(mockNack).toHaveBeenCalledWith(msg, false, false);
  });

  it('returns early when msg is null', async () => {
    await consumeHandler(null);
    expect(mockAck).not.toHaveBeenCalled();
  });
});
