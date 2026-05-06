import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST,
  port:   Number(process.env.SMTP_PORT) || 587,
  secure: Number(process.env.SMTP_PORT) === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const FROM = process.env.SMTP_FROM || 'snapparkillegalparking@gmail.com';
const APP_URL = process.env.APP_URL || 'http://localhost:3001';

/**
 * Send an email-verification link to a newly registered user.
 */
export const sendVerificationEmail = async ({ to, firstName, token }) => {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) {
    console.warn('[email] SMTP not configured — skipping verification email');
    return;
  }

  const link = `${APP_URL}/auth/verify-email?token=${token}`;
  const name = firstName || 'there';

  await transporter.sendMail({
    from:    FROM,
    to,
    subject: 'Verify your SnapPark email address',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b;">
        <h2 style="color: #059669;">Welcome to SnapPark, ${name}!</h2>
        <p style="font-size: 15px; line-height: 1.6;">
          Thanks for creating an account. Please verify your email address by clicking the button below.
        </p>
        <a href="${link}"
           style="display: inline-block; margin: 24px 0; padding: 12px 28px;
                  background: #059669; color: #fff; text-decoration: none;
                  border-radius: 6px; font-size: 15px; font-weight: bold;">
          Verify my email
        </a>
        <p style="font-size: 13px; color: #64748b;">
          This link expires in 24 hours. If you didn't create a SnapPark account, you can safely ignore this email.
        </p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
        <p style="font-size: 12px; color: #94a3b8;">SnapPark — Smart Parking Violation Reporting</p>
      </div>
    `,
  });
};
