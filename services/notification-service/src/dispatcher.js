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
 * Build message content for each event type.
 */
/**
 * Returns a human-friendly reference for the case.
 * If a license plate was captured, use that ("vehicle ABC-123").
 * Otherwise fall back to the short case ID ("case 101beb69…").
 */
const caseRef = (event) =>
  event.licensePlate
    ? `vehicle ${event.licensePlate}`
    : `case ${event.id.slice(0, 8)}…`;

const buildMessage = {
  'case.created': (event) => {
    const ref = caseRef(event);
    const violationLabel = event.violationConfirmed
      ? `Violation detected: ${event.violationType} (confidence: ${(event.confidence * 100).toFixed(0)}%)`
      : 'No violation detected in the submitted image.';

    return {
      message: `Your parking report for ${ref} has been analysed. ${violationLabel}`,
      subject: event.violationConfirmed
        ? `Violation Detected — ${event.violationType} (${ref})`
        : `Parking Report — No Violation Found (${ref})`,
      metadata: {
        eventType:          'case.created',
        caseId:             event.id,
        violationConfirmed: event.violationConfirmed,
        violationType:      event.violationType,
        confidence:         event.confidence,
        licensePlate:       event.licensePlate || null,
      },
    };
  },

  'case.reported': (event) => {
    const ref = caseRef(event);
    return {
      message: `Good news! Your violation report for ${ref} ("${event.violationType}") has been forwarded to the local authorities. We'll notify you when there's an update.`,
      subject: `Case Reported to Authorities — ${event.violationType} (${ref})`,
      metadata: {
        eventType:     'case.reported',
        caseId:        event.id,
        violationType: event.violationType,
        licensePlate:  event.licensePlate || null,
        reportedAt:    event.reportedAt,
      },
    };
  },

  'case.resolved': (event) => {
    const ref = caseRef(event);
    return {
      message: `Your violation report for ${ref} ("${event.violationType}") has been resolved by the authorities. Thank you for helping keep your community safe!`,
      subject: `Case Resolved — ${event.violationType} (${ref})`,
      metadata: {
        eventType:     'case.resolved',
        caseId:        event.id,
        violationType: event.violationType,
        licensePlate:  event.licensePlate || null,
        resolvedAt:    event.resolvedAt,
      },
    };
  },
};

/**
 * Dispatch a notification to every channel the user has enabled.
 *
 * Uses Promise.allSettled so that one failing channel does not block others.
 *
 * @param {string} eventType – "case.created", "case.reported", or "case.resolved"
 * @param {object} event     – event payload from RabbitMQ
 * @returns {Promise<{ channel: string, success: boolean, error?: string }[]>}
 */
export const dispatchNotification = async (eventType, event) => {
  // 1. Build message content for this event type
  const builder = buildMessage[eventType];
  if (!builder) {
    console.error(`[dispatcher] Unknown event type: ${eventType}`);
    return [];
  }

  const { message, subject, metadata } = builder(event);

  // 2. Get (or create default) preferences for the user.
  //    First-time users get email enabled by default with their auth email
  //    pre-filled, so they receive notifications without first visiting Settings.
  let prefs = await getNotificationPreferences(event.userId);
  if (!prefs) {
    prefs = await upsertNotificationPreferences({
      userId:    event.userId,
      emailAddr: event.userEmail || null,
    });
  } else if (!prefs.email_addr && event.userEmail) {
    // User has prefs but never set an email address — backfill from the event.
    prefs = await upsertNotificationPreferences({
      userId:    event.userId,
      inApp:     prefs.in_app,
      sms:       prefs.sms,
      email:     prefs.email,
      push:      prefs.push,
      phone:     prefs.phone,
      emailAddr: event.userEmail,
      fcmToken:  prefs.fcm_token,
    });
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
