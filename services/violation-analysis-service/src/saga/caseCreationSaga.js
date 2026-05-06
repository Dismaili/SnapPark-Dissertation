import { query, insertCaseImages, auditLog } from '../db.js';
import { publishStrict } from '../rabbitmq.js';
import { runSaga } from './coordinator.js';

/**
 * Case-creation saga (orchestrated).
 *
 * Steps run in order; on failure of any step, compensations of the
 * previously-completed steps run in reverse. State is persisted at
 * every transition (see coordinator.js).
 *
 *   1. analyzeImage         — call Gemini (read-only, no compensation)
 *   2. persistCase          — INSERT cases   ↩ DELETE cases (cascade kills images)
 *   3. persistImages        — INSERT case_images (no separate compensation
 *                              — the FK CASCADE on persistCase covers it)
 *   4. recordAuditCreated   — append CaseCreated event ↩ append
 *                              CaseCreationCompensated event (audit log
 *                              is append-only, so we record the rollback
 *                              rather than delete the original)
 *   5. dispatchNotification — publish case.created       ↩ publish case.cancelled
 *
 * The notification step is the only one that crosses a service boundary.
 * Its compensation is *also* an event publish: the notification service
 * subscribes to case.cancelled and suppresses / withdraws any in-app
 * notification it produced for the cancelled case.
 *
 * Asynchronous failures (notification-service can't deliver an email
 * after consuming the event) arrive later as notification.failed events.
 * Those are handled by the saga listener in saga/listeners.js, which
 * appends to the saga history but does NOT roll back the case — the
 * analysis itself has user value independent of notification, so the
 * compensation policy at that boundary is "mark and continue", not
 * "destroy".
 */

const stepAnalyzeImage = (analyser) => ({
  name: 'analyzeImage',
  execute: async (ctx) => {
    const analysis = ctx.imageDetails.length === 1
      ? await analyser.analyseImage(ctx.imageDetails[0].base64, ctx.imageDetails[0].mimeType)
      : await analyser.analyseMultipleImages(
          ctx.imageDetails.map((d) => ({ base64: d.base64, mimeType: d.mimeType })),
        );
    return { analysis };
  },
  // No compensation — calling Gemini is a side-effect-free read.
});

const stepPersistCase = {
  name: 'persistCase',
  execute: async (ctx) => {
    const totalBytes = ctx.imageDetails.reduce((sum, d) => sum + d.sizeBytes, 0);
    const result = await query(
      `INSERT INTO cases
         (user_id, status, violation_confirmed, violation_type, confidence, explanation,
          license_plate, latitude, longitude, location_label,
          image_mime_type, image_size_bytes, image_count, completed_at)
       VALUES ($1, 'completed', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
       RETURNING *`,
      [
        ctx.userId,
        ctx.analysis.violationConfirmed,
        ctx.analysis.violationType,
        ctx.analysis.confidence,
        ctx.analysis.explanation,
        ctx.licensePlate || null,
        ctx.latitude     ?? null,
        ctx.longitude    ?? null,
        ctx.locationLabel|| null,
        ctx.imageDetails[0].mimeType,
        totalBytes,
        ctx.imageDetails.length,
      ]
    );
    return { savedCase: result.rows[0] };
  },
  compensate: async (ctx) => {
    if (!ctx.savedCase?.id) return; // step never produced an ID
    await query('DELETE FROM cases WHERE id = $1', [ctx.savedCase.id]);
  },
};

const stepPersistImages = {
  name: 'persistImages',
  execute: async (ctx) => {
    await insertCaseImages(
      ctx.savedCase.id,
      ctx.imageDetails.map((d) => ({
        mimeType:     d.mimeType,
        sizeBytes:    d.sizeBytes,
        data:         d.buffer,
        qualityStats: d.qualityStats,
      })),
    );
  },
  compensate: async (ctx) => {
    // case_images currently has no FK constraint to cases, so the
    // cascade does NOT happen automatically when the parent is deleted.
    // Compensate explicitly. Idempotent — running twice is a no-op.
    if (!ctx.savedCase?.id) return;
    await query('DELETE FROM case_images WHERE case_id = $1', [ctx.savedCase.id]);
  },
};

const stepRecordAuditCreated = {
  name: 'recordAuditCreated',
  execute: async (ctx) => {
    await auditLog({
      eventType: 'CaseCreated',
      caseId:    ctx.savedCase.id,
      userId:    ctx.savedCase.user_id,
      payload: {
        violationConfirmed: ctx.savedCase.violation_confirmed,
        violationType:      ctx.savedCase.violation_type,
        confidence:         ctx.savedCase.confidence,
        imageCount:         ctx.savedCase.image_count,
        sagaId:             ctx.sagaId,
      },
    });
  },
  compensate: async (ctx) => {
    // Audit log is append-only by design (NFR6 — Auditability), so
    // the compensation is a *new* entry recording the rollback,
    // never a deletion of the original.
    await auditLog({
      eventType: 'CaseCreationCompensated',
      caseId:    ctx.savedCase?.id ?? null,
      userId:    ctx.userId,
      payload: {
        sagaId: ctx.sagaId,
        reason: 'saga step after audit failed; case rolled back',
      },
    });
  },
};

const stepDispatchNotification = {
  name: 'dispatchNotification',
  execute: async (ctx) => {
    publishStrict('case.created', {
      id:                 ctx.savedCase.id,
      userId:             ctx.savedCase.user_id,
      userEmail:          ctx.userEmail,
      violationConfirmed: ctx.savedCase.violation_confirmed,
      violationType:      ctx.savedCase.violation_type,
      confidence:         ctx.savedCase.confidence,
      explanation:        ctx.savedCase.explanation,
      licensePlate:       ctx.savedCase.license_plate,
      imageCount:         ctx.savedCase.image_count,
      createdAt:          ctx.savedCase.created_at,
      sagaId:             ctx.sagaId,
    });
  },
  compensate: async (ctx) => {
    // Best-effort cancellation — if the broker is unavailable here too,
    // the channel-unavailable error from publishStrict is swallowed
    // because we've already decided to roll back; raising here would
    // just block other compensations from running.
    try {
      publishStrict('case.cancelled', {
        id:     ctx.savedCase?.id,
        userId: ctx.savedCase?.user_id,
        reason: 'saga compensated',
        sagaId: ctx.sagaId,
      });
    } catch (err) {
      console.warn(`[saga ${ctx.sagaId}] case.cancelled publish failed:`, err.message);
    }
  },
};

/**
 * Build the saga step list. Analyser is injected so tests can pass a
 * stub without monkey-patching the gemini module.
 */
export const buildCaseCreationSteps = ({ analyser }) => [
  stepAnalyzeImage(analyser),
  stepPersistCase,
  stepPersistImages,
  stepRecordAuditCreated,
  stepDispatchNotification,
];

/**
 * Run the case-creation saga end-to-end. Returns the persisted case row
 * on success; throws (with sagaId on the error) on any unrecoverable
 * failure after compensations.
 */
export const runCaseCreationSaga = async ({ context, analyser }) => {
  const steps  = buildCaseCreationSteps({ analyser });
  const result = await runSaga({
    sagaType: 'case-creation',
    steps,
    context,
  });
  return result;
};
