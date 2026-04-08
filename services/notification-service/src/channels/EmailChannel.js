import nodemailer from 'nodemailer';
import { BaseChannel } from './BaseChannel.js';

/**
 * Email notification channel via SMTP (Nodemailer).
 *
 * Required env vars:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 */
export class EmailChannel extends BaseChannel {
  constructor() {
    super('email');

    this.from = process.env.SMTP_FROM || 'noreply@snappark.app';

    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }

  async send({ to, subject, message, metadata }) {
    try {
      const html = this._buildHtml(message, metadata);

      const info = await this.transporter.sendMail({
        from:    this.from,
        to,
        subject: subject || 'SnapPark — Parking Report Update',
        html,
      });

      return {
        success: true,
        providerResponse: { messageId: info.messageId },
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  _buildHtml(message, metadata) {
    const confidence = metadata?.confidence
      ? `${(metadata.confidence * 100).toFixed(0)}%`
      : 'N/A';

    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #1a73e8;">SnapPark Notification</h2>
        <p style="font-size: 16px; line-height: 1.5;">${message}</p>
        <table style="margin-top: 16px; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 16px; font-weight: bold;">Violation</td>
            <td style="padding: 8px 16px;">${metadata?.violationConfirmed ? 'Yes' : 'No'}</td>
          </tr>
          <tr>
            <td style="padding: 8px 16px; font-weight: bold;">Type</td>
            <td style="padding: 8px 16px;">${metadata?.violationType || 'N/A'}</td>
          </tr>
          <tr>
            <td style="padding: 8px 16px; font-weight: bold;">Confidence</td>
            <td style="padding: 8px 16px;">${confidence}</td>
          </tr>
        </table>
        <p style="margin-top: 24px; font-size: 12px; color: #888;">
          This is an automated message from SnapPark. Do not reply.
        </p>
      </div>
    `;
  }
}
