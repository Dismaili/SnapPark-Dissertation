import { BaseChannel } from './BaseChannel.js';
import { insertNotification } from '../db.js';

/**
 * In-app notification channel.
 * Persists the notification to the database so it can be retrieved
 * via the REST API (GET /notifications).
 */
export class InAppChannel extends BaseChannel {
  constructor() {
    super('in_app');
  }

  async send({ caseId, userId, message, metadata }) {
    try {
      const notification = await insertNotification({
        caseId,
        userId,
        channel: 'in_app',
        message,
        metadata,
      });

      return { success: true, providerResponse: { notificationId: notification.id } };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
}
