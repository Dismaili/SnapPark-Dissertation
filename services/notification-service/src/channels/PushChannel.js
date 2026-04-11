import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { BaseChannel } from './BaseChannel.js';

/**
 * Push notification channel via Firebase Cloud Messaging (FCM).
 *
 * Required env vars:
 *   FIREBASE_SERVICE_ACCOUNT_PATH — path to the Firebase service-account JSON key
 */
export class PushChannel extends BaseChannel {
  constructor() {
    super('push');

    const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf-8'));

    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
    }

    this.messaging = admin.messaging();
  }

  async send({ to, subject, message, metadata }) {
    try {
      const result = await this.messaging.send({
        token: to,
        notification: {
          title: subject || 'SnapPark — Parking Report Update',
          body:  message,
        },
        data: {
          caseId:             metadata?.caseId || '',
          violationConfirmed: String(metadata?.violationConfirmed ?? ''),
          violationType:      metadata?.violationType || '',
          confidence:         String(metadata?.confidence ?? ''),
        },
      });

      return {
        success: true,
        providerResponse: { messageId: result },
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
}
