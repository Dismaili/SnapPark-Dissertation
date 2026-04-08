import channels from './channels/index.js';
import {
  getNotificationPreferences,
  upsertNotificationPreferences,
  insertDeliveryLog,
} from './db.js';

/**
 * Channel-to-address mapping.
 * Maps a channel name to the field on the preferences row
 * that holds the delivery address for that channel.
 */
const ADDRESS_FIELD = {
  in_app: null,          // in-app needs no external address
  sms:    'phone',
  email:  'email_addr',
  push:   'fcm_token',
};

/**
 * Dispatch a notification to every channel the user has enabled.
 *
 * Uses Promise.allSettled so that one failing channel does not block others.
 *
 * @param {{ id: string, userId: string, violationConfirmed: boolean, violationType: string, confidence: number }} event
 * @returns {Promise<{ channel: string, success: boolean, error?: string }[]>}
 */
export const dispatchNotification = async (event) => {
  // 1. Build the notification message
  const violationLabel = event.violationConfirmed
    ? `Violation detected: ${event.violationType} (confidence: ${(event.confidence * 100).toFixed(0)}%)`
    : 'No violation detected in the submitted image.';

  const message  = `Your parking report (case ${event.id}) has been analysed. ${violationLabel}`;
  const subject  = event.violationConfirmed
    ? `Violation Detected — ${event.violationType}`
    : 'Parking Report — No Violation Found';

  const metadata = {
    caseId:             event.id,
    violationConfirmed: event.violationConfirmed,
    violationType:      event.violationType,
    confidence:         event.confidence,
  };

  // 2. Get (or create default) preferences for the user
  let prefs = await getNotificationPreferences(event.userId);
  if (!prefs) {
    prefs = await upsertNotificationPreferences({ userId: event.userId });
  }

  // 3. Determine which channels to dispatch to
  const enabledChannels = ['in_app', 'sms', 'email', 'push'].filter((ch) => {
    if (!prefs[ch]) return false;              // user disabled this channel
    if (!channels.has(ch)) return false;       // channel not registered (env missing)

    const addrField = ADDRESS_FIELD[ch];
    if (addrField && !prefs[addrField]) {      // external channel but no address on file
      console.warn(`[dispatcher] ${ch} enabled for user ${event.userId} but no ${addrField} configured — skipping`);
      return false;
    }

    return true;
  });

  // 4. Fan out to all enabled channels concurrently
  const results = await Promise.allSettled(
    enabledChannels.map(async (ch) => {
      const provider = channels.get(ch);
      const addrField = ADDRESS_FIELD[ch];
      const to = addrField ? prefs[addrField] : undefined;

      const result = await provider.send({
        to,
        caseId: event.id,
        userId: event.userId,
        subject,
        message,
        metadata,
      });

      // Log the delivery attempt
      await insertDeliveryLog({
        notificationId: result.providerResponse?.notificationId || null,
        caseId: event.id,
        userId: event.userId,
        channel: ch,
        status: result.success ? 'sent' : 'failed',
        providerResponse: result.providerResponse || null,
        errorMessage: result.error || null,
      });

      return { channel: ch, success: result.success, error: result.error };
    })
  );

  // 5. Normalise allSettled results
  return results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    return { channel: enabledChannels[i], success: false, error: r.reason?.message };
  });
};
