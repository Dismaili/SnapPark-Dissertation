import { query } from './db.js';

/**
 * Auto-discard cleanup job (FR7).
 *
 * Runs on a configurable interval and marks any cases that have been
 * stuck in "pending" status for longer than the defined threshold as
 * "expired". This prevents orphaned cases from accumulating in the
 * database and frees storage.
 *
 * In the current synchronous flow, cases go straight to "completed",
 * so this primarily covers edge cases (e.g. server crash mid-analysis,
 * future async processing mode).
 */

const CLEANUP_INTERVAL_MS = Number(process.env.CLEANUP_INTERVAL_MS || 60 * 60 * 1000); // default: 1 hour
const EXPIRY_THRESHOLD_HOURS = Number(process.env.EXPIRY_THRESHOLD_HOURS || 24);        // default: 24 hours

let cleanupTimer = null;

/**
 * Find and expire all cases that have been pending beyond the threshold.
 */
const runCleanup = async () => {
  try {
    const result = await query(
      `UPDATE cases
       SET status = 'expired', cancelled_at = NOW()
       WHERE status = 'pending'
         AND created_at < NOW() - INTERVAL '1 hour' * $1
       RETURNING id, user_id, created_at`,
      [EXPIRY_THRESHOLD_HOURS]
    );

    if (result.rowCount > 0) {
      console.log(`[cleanup] Expired ${result.rowCount} stale case(s):`,
        result.rows.map((r) => r.id).join(', ')
      );
    } else {
      console.log('[cleanup] No stale cases found');
    }

    return result.rowCount;
  } catch (err) {
    console.error('[cleanup] Failed:', err.message);
    return 0;
  }
};

/**
 * Start the periodic cleanup timer.
 */
export const startCleanupJob = () => {
  console.log(
    `[cleanup] Started — checking every ${CLEANUP_INTERVAL_MS / 1000}s, ` +
    `expiring cases older than ${EXPIRY_THRESHOLD_HOURS}h`
  );

  // Run once immediately on startup
  runCleanup();

  // Then run on interval
  cleanupTimer = setInterval(runCleanup, CLEANUP_INTERVAL_MS);
};

/**
 * Stop the cleanup timer (for graceful shutdown).
 */
export const stopCleanupJob = () => {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
    console.log('[cleanup] Stopped');
  }
};
