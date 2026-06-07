import { describe, it, expect, vi, beforeEach } from 'vitest';

// The coordinator persists state via db.query. Capture every call so we
// can assert on the lifecycle (insert → updates → final status) without
// needing a live database.
const mockQuery = vi.fn();
vi.mock('../src/db.js', () => ({
  query: mockQuery,
}));

const { runSaga, SagaStatus, recordSagaEvent, getSaga } = await import('../src/saga/coordinator.js');

const SAGA_ID = '11111111-1111-1111-1111-111111111111';

const setupQueryDefaults = () => {
  // The coordinator's first INSERT returns the new saga id. Every
  // subsequent UPDATE returns nothing useful but we still want a
  // resolved promise.
  mockQuery.mockImplementation((sql) => {
    if (/INSERT INTO sagas/i.test(sql)) {
      return Promise.resolve({ rows: [{ id: SAGA_ID }] });
    }
    if (/SELECT \* FROM sagas/i.test(sql)) {
      return Promise.resolve({
        rows: [{ id: SAGA_ID, status: SagaStatus.COMPLETED, history: [] }],
      });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
};

const finalStatus = () => {
  // Walk the recorded UPDATE calls in reverse and pull the most recent
  // explicit `status` change. Avoids relying on call ordering of
  // unrelated UPDATEs (e.g. context refresh).
  const setRegex = /SET\s+(.+?)\s+WHERE/i;
  for (let i = mockQuery.mock.calls.length - 1; i >= 0; i--) {
    const [sql, params] = mockQuery.mock.calls[i];
    if (!/UPDATE sagas/i.test(sql)) continue;
    const m = sql.match(setRegex);
    if (!m) continue;
    const setClause = m[1];
    // status placeholder lands in params at $2 (after id at $1) when
    // status is the only updated column. The coordinator's updateSaga
    // helper iterates the fields object in insertion order, so we look
    // for a `status` token followed by a $N and read params[N-1].
    const sm = setClause.match(/status\s*=\s*\$(\d+)/);
    if (sm) return params[Number(sm[1]) - 1];
  }
  return null;
};

describe('SagaCoordinator', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    setupQueryDefaults();
  });

  it('runs steps in order and persists the saga as completed', async () => {
    const order = [];
    const steps = [
      { name: 's1', execute: async () => { order.push('s1'); return { a: 1 }; } },
      { name: 's2', execute: async () => { order.push('s2'); return { b: 2 }; } },
      { name: 's3', execute: async () => { order.push('s3'); } },
    ];

    const result = await runSaga({ sagaType: 'test', steps, context: { initial: true } });

    expect(order).toEqual(['s1', 's2', 's3']);
    expect(result).toMatchObject({ initial: true, a: 1, b: 2, sagaId: SAGA_ID });
    expect(finalStatus()).toBe(SagaStatus.COMPLETED);
  });

  it('merges each step\'s returned partial context for downstream steps', async () => {
    let observed;
    const steps = [
      { name: 's1', execute: async () => ({ caseId: 'c-42' }) },
      {
        name: 's2',
        execute: async (ctx) => {
          observed = ctx.caseId;
        },
      },
    ];

    await runSaga({ sagaType: 'test', steps, context: {} });
    expect(observed).toBe('c-42');
  });

  it('runs compensations of completed steps in REVERSE order on failure', async () => {
    const order = [];
    const steps = [
      {
        name: 's1',
        execute: async () => { order.push('exec:s1'); },
        compensate: async () => { order.push('comp:s1'); },
      },
      {
        name: 's2',
        execute: async () => { order.push('exec:s2'); },
        compensate: async () => { order.push('comp:s2'); },
      },
      {
        name: 's3',
        execute: async () => { order.push('exec:s3'); throw new Error('boom'); },
        compensate: async () => { order.push('comp:s3'); }, // never runs — s3's exec failed
      },
    ];

    await expect(
      runSaga({ sagaType: 'test', steps, context: {} })
    ).rejects.toMatchObject({
      sagaId: SAGA_ID,
      failedStep: 's3',
      compensated: true,
    });

    expect(order).toEqual(['exec:s1', 'exec:s2', 'exec:s3', 'comp:s2', 'comp:s1']);
    expect(finalStatus()).toBe(SagaStatus.COMPENSATED);
  });

  it('skips compensations for steps that lack one', async () => {
    const order = [];
    const steps = [
      { name: 's1', execute: async () => { order.push('exec:s1'); } /* no compensate */ },
      {
        name: 's2',
        execute: async () => { order.push('exec:s2'); },
        compensate: async () => { order.push('comp:s2'); },
      },
      {
        name: 's3',
        execute: async () => { throw new Error('fail'); },
      },
    ];

    await expect(
      runSaga({ sagaType: 'test', steps, context: {} })
    ).rejects.toThrow();

    expect(order).toEqual(['exec:s1', 'exec:s2', 'comp:s2']);
  });

  it('marks the saga FAILED (not COMPENSATED) when a compensation itself throws', async () => {
    const steps = [
      {
        name: 's1',
        execute: async () => {},
        compensate: async () => { throw new Error('compensation broke'); },
      },
      {
        name: 's2',
        execute: async () => { throw new Error('forward broke'); },
      },
    ];

    await expect(
      runSaga({ sagaType: 'test', steps, context: {} })
    ).rejects.toMatchObject({ compensated: false });

    expect(finalStatus()).toBe(SagaStatus.FAILED);
  });

  it('preserves the original error as `cause` on the thrown saga error', async () => {
    const root = new Error('downstream timeout');
    const steps = [
      { name: 's1', execute: async () => { throw root; } },
    ];

    try {
      await runSaga({ sagaType: 'test', steps, context: {} });
      throw new Error('expected throw');
    } catch (err) {
      expect(err.cause).toBe(root);
      expect(err.failedStep).toBe('s1');
    }
  });
});

describe('recordSagaEvent', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    setupQueryDefaults();
  });

  it('appends an external-event entry to a saga\'s history', async () => {
    await recordSagaEvent({
      sagaId:    SAGA_ID,
      eventType: 'notification.failed',
      payload:   { caseId: 'c-1' },
    });

    const updates = mockQuery.mock.calls
      .filter(([sql]) => /history\s*\|\|/i.test(sql));
    expect(updates).toHaveLength(1);

    const [, params] = updates[0];
    const appended = JSON.parse(params[1])[0];
    expect(appended).toMatchObject({
      step:    'external',
      action:  'event',
      status:  'notification.failed',
      payload: { caseId: 'c-1' },
    });
  });
});

describe('getSaga', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    setupQueryDefaults();
  });

  it('returns the saga row when it exists', async () => {
    const saga = await getSaga(SAGA_ID);
    expect(saga.id).toBe(SAGA_ID);
  });

  it('returns null when the saga is not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const saga = await getSaga('does-not-exist');
    expect(saga).toBeNull();
  });
});
