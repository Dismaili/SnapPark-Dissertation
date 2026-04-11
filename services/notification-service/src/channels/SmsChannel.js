import twilio from 'twilio';
import { BaseChannel } from './BaseChannel.js';

/**
 * SMS notification channel via Twilio.
 *
 * Required env vars:
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER
 */
export class SmsChannel extends BaseChannel {
  constructor() {
    super('sms');

    const sid   = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    this.from   = process.env.TWILIO_PHONE_NUMBER;

    this.client = twilio(sid, token);
  }

  async send({ to, message }) {
    try {
      const result = await this.client.messages.create({
        body: message,
        from: this.from,
        to,
      });

      return {
        success: true,
        providerResponse: { sid: result.sid, status: result.status },
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
}
