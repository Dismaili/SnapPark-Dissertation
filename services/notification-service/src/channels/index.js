import { InAppChannel }  from './InAppChannel.js';
import { SmsChannel }    from './SmsChannel.js';
import { EmailChannel }  from './EmailChannel.js';
import { PushChannel }   from './PushChannel.js';

/**
 * Channel registry.
 *
 * Only channels whose required environment variables are present are
 * registered. This allows the service to run in development with only
 * in-app notifications — no code changes or feature flags required.
 */
const channels = new Map();

// In-app is always available (only needs the database)
channels.set('in_app', new InAppChannel());

// SMS — requires Twilio credentials
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
  try {
    channels.set('sms', new SmsChannel());
    console.log('[channels] SMS channel registered');
  } catch (err) {
    console.warn('[channels] SMS channel failed to initialise:', err.message);
  }
} else {
  console.warn('[channels] SMS channel skipped — Twilio credentials not configured');
}

// Email — requires SMTP credentials
if (process.env.SMTP_HOST && process.env.SMTP_USER) {
  try {
    channels.set('email', new EmailChannel());
    console.log('[channels] Email channel registered');
  } catch (err) {
    console.warn('[channels] Email channel failed to initialise:', err.message);
  }
} else {
  console.warn('[channels] Email channel skipped — SMTP credentials not configured');
}

// Push — requires Firebase service account
if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
  try {
    channels.set('push', new PushChannel());
    console.log('[channels] Push channel registered');
  } catch (err) {
    console.warn('[channels] Push channel failed to initialise:', err.message);
  }
} else {
  console.warn('[channels] Push channel skipped — Firebase credentials not configured');
}

export default channels;
