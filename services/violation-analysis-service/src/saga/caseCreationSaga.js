import { query, insertCaseImages, auditLog, setCaseEmbedding, clearCaseEmbedding } from '../db.js';
import { publishStrict } from '../rabbitmq.js';
import { runSaga } from './coordinator.js';
import { generateEmbedding, buildEmbeddingInput } from '../embeddings.js';

/**
 * Case-creation saga (orchestrated).
 *
 * Steps run in order; on failure of any step, compensations of the
 * previously-completed steps run in reverse. State is persisted at
 * every transition (see coordinator.js).
 *
 *   1. analyzeImage         — call Gemini (read-only, no compensation)
 *   2. persistCase          — INSERT cases    ↩ DELETE cases
 *   3. persistImages        — INSERT case_images ↩ DELETE case_images
 *   4. embedAndIndex        — embed verdict text + UPDATE embedding ↩ NULL
 *                              the embedding column (the case row itself is
 *                              rolled back by stepPersistCase if needed)
 *   5. recordAuditCreated   — append CaseCreated event ↩ append
 *                              CaseCreationCompensated event (audit log
 *                              is append-only, so we record the rollback
 *                              rather than delete the original)
 *   6. dispatchNotification — publish case.created       ↩ publish case.cancelled
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

// Embed the AI's verdict text into a 768-D vector and store it on the
// case row, so the cases table can later be searched by semantic
// similarity (pgvector / cosine distance). Step is placed AFTER
// persistImages so that an embedding failure does not block the
// relational data from existing — the case is still useful without an
// embedding; it just won't show up in similarity queries.
//
// Compensation deletes only the embedding column. The case row itself
// is rolled back by stepPersistCase's compensation if a later step
// fails, so we do NOT delete the case here.
const stepEmbedAndIndex = {
  name: 'embedAndIndex',
  execute: async (ctx) => {
    const text = buildEmbeddingInput({
      violationType: ctx.savedCase.violation_type,
      explanation:   ctx.savedCase.explanation,
      licensePlate:  ctx.savedCase.license_plate,
    });
    if (!text) {
      // Nothing useful to embed (e.g. analysis returned no explanation
      // and no plate was supplied). Skip silently — the case row still
      // exists and the embedding column remains NULL, which makes the
      // case invisible to similarity search but preserves all other data.
      return { embedded: false };
    }
    const embedding = await generateEmbedding(text);
    await setCaseEmbedding(ctx.savedCase.id, embedding);
    return { embedded: true, embeddingLength: embedding.length };
  },
  compensate: async (ctx) => {
    if (!ctx.savedCase?.id) return;
    // The case row is about to be deleted by stepPersistCase's
    // compensation; clearing the embedding here is mostly a defence
    // against future re-orderings of the saga steps. Errors here must
    // not abort the compensation chain — the next compensation deletes
    // the row anyway, which is the stronger guarantee.
    try {
      await clearCaseEmbedding(ctx.savedCase.id);
    } catch (err) {
      console.warn(`[saga ${ctx.sagaId}] clearCaseEmbedding non-fatal:`, err.message);
    }
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
  stepEmbedAndIndex,
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
