import { query } from '../db.js';

/**
 * Generic saga coordinator.
 *
 * A saga is a sequence of steps where each step is a local transaction
 * with an optional compensating transaction. The coordinator runs the
 * forward steps in order; if any step throws, it runs the compensations
 * of the previously-completed steps in reverse order.
 *
 * State at every transition is persisted to the `sagas` table, so a
 * crash mid-saga is recoverable: a recovery process can read in-flight
 * sagas and decide whether to resume or compensate.
 *
 * A step is an object:
 *   {
 *     name: string,                            // unique within the saga
 *     execute: async (ctx) => ctx | void,      // returns updated context (merged in)
 *     compensate?: async (ctx) => void,        // optional — only present for steps with side effects
 *   }
 *
 * The context is a plain object that flows through the saga and is
 * persisted on every transition. Steps may both read from it and add to
 * it via their return value (a partial context is merged into the
 * existing one, like a reducer). This is how `caseId` produced by
 * `persistCase` becomes available to the compensation of a later step.
 */

export const SagaStatus = Object.freeze({
  RUNNING:        'running',
  COMPLETED:      'completed',
  COMPENSATING:   'compensating',
  COMPENSATED:    'compensated',
  FAILED:         'failed',                // forward failure AND compensation failure
});

const insertSaga = async ({ sagaType, context }) => {
  const r = await query(
    `INSERT INTO sagas (saga_type, status, context, history)
     VALUES ($1, $2, $3, '[]'::jsonb)
     RETURNING id`,
    [sagaType, SagaStatus.RUNNING, context]
  );
  return r.rows[0].id;
};

const appendHistory = async (sagaId, entry) => {
  await query(
    `UPDATE sagas
        SET history    = history || $2::jsonb,
            updated_at = NOW()
      WHERE id = $1`,
    [sagaId, JSON.stringify([entry])]
  );
};

const updateSaga = async (sagaId, fields) => {
  const sets   = [];
  const params = [];
  let           i = 1;
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = $${++i}`);
    params.push(v);
  }
  params.unshift(sagaId);
  sets.push('updated_at = NOW()');
  await query(`UPDATE sagas SET ${sets.join(', ')} WHERE id = $1`, params);
};

const safeMerge = (ctx, partial) =>
  partial && typeof partial === 'object' ? { ...ctx, ...partial } : ctx;

/**
 * Run a saga to completion (or compensated end-state).
 *
 * Returns the final context if successful, or throws a SagaError
 * carrying the failed step name and the original cause.
 */
export const runSaga = async ({ sagaType, steps, context: initial }) => {
  let context  = { ...initial };
  const sagaId = await insertSaga({ sagaType, context });
  context.sagaId = sagaId;

  const completed = []; // names of steps whose forward action succeeded

  for (const step of steps) {
    await updateSaga(sagaId, { current_step: step.name });
    await appendHistory(sagaId, {
      step:   step.name,
      action: 'execute',
      status: 'started',
      at:     new Date().toISOString(),
    });

    try {
      const partial = await step.execute(context);
      context = safeMerge(context, partial);

      // The context column is the canonical record of saga progress —
      // refresh it after every successful step.
      await updateSaga(sagaId, { context });
      await appendHistory(sagaId, {
        step:   step.name,
        action: 'execute',
        status: 'succeeded',
        at:     new Date().toISOString(),
      });

      completed.push(step);
    } catch (err) {
      await appendHistory(sagaId, {
        step:   step.name,
        action: 'execute',
        status: 'failed',
        error:  err.message,
        at:     new Date().toISOString(),
      });

      await updateSaga(sagaId, {
        status:       SagaStatus.COMPENSATING,
        error:        `${step.name}: ${err.message}`,
      });

      const compensationOk = await runCompensations({
        sagaId,
        completed,
        context,
      });

      await updateSaga(sagaId, {
        status: compensationOk ? SagaStatus.COMPENSATED : SagaStatus.FAILED,
      });

      const compositeErr = new Error(`Saga '${sagaType}' failed at step '${step.name}': ${err.message}`);
      compositeErr.sagaId        = sagaId;
      compositeErr.failedStep    = step.name;
      compositeErr.cause         = err;
      compositeErr.compensated   = compensationOk;
      throw compositeErr;
    }
  }

  await updateSaga(sagaId, {
    status:       SagaStatus.COMPLETED,
    current_step: null,
  });
  return context;
};

const runCompensations = async ({ sagaId, completed, context }) => {
  // Run compensations in reverse order so resources are released in the
  // opposite order they were acquired (LIFO).
  for (const step of [...completed].reverse()) {
    if (typeof step.compensate !== 'function') continue;

    await appendHistory(sagaId, {
      step:   step.name,
      action: 'compensate',
      status: 'started',
      at:     new Date().toISOString(),
    });

    try {
      await step.compensate(context);
      await appendHistory(sagaId, {
        step:   step.name,
        action: 'compensate',
        status: 'succeeded',
        at:     new Date().toISOString(),
      });
    } catch (err) {
      // A compensation failure is a serious operational event: it leaves
      // partial state behind that needs human intervention. Log it loudly
      // and continue compensating earlier steps so we release as much
      // state as possible.
      console.error(`[saga ${sagaId}] Compensation '${step.name}' FAILED:`, err.message);
      await appendHistory(sagaId, {
        step:   step.name,
        action: 'compensate',
        status: 'failed',
        error:  err.message,
        at:     new Date().toISOString(),
      });
      // Mark the saga as not fully compensated so monitoring can flag it.
      return false;
    }
  }

  return true;
};

/**
 * Mark an existing saga with a follow-up event coming from another
 * service (e.g. the notification service publishing notification.failed).
 *
 * This is how distributed compensation is recorded: the originating
 * service's saga keeps a single audit trail of everything that happened,
 * including outcomes that arrived asynchronously.
 */
export const recordSagaEvent = async ({ sagaId, eventType, payload }) => {
  await appendHistory(sagaId, {
    step:    'external',
    action:  'event',
    status:  eventType,
    payload: payload ?? null,
    at:      new Date().toISOString(),
  });
};

/**
 * Read a single saga's full state. Used by /sagas/:id for evidence and
 * by the recovery routine on restart.
 */
export const getSaga = async (sagaId) => {
  const r = await query('SELECT * FROM sagas WHERE id = $1', [sagaId]);
  return r.rows[0] || null;
};
