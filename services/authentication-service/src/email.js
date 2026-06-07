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

const isSmtpConfigured = () =>
  Boolean(process.env.SMTP_HOST && process.env.SMTP_USER);

/**
 * Renders a single OTP email body. Both verification and password-reset use
 * the same visual structure so the user recognises the format; only the
 * heading and supporting copy differ.
 */
const renderOtpHtml = ({ name, code, heading, intro, ttlMinutes }) => `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b;">
    <h2 style="color: #059669;">${heading}</h2>
    <p style="font-size: 15px; line-height: 1.6;">Hi ${name},</p>
    <p style="font-size: 15px; line-height: 1.6;">${intro}</p>
    <div style="margin: 28px 0; text-align: center;">
      <div style="display: inline-block; padding: 18px 32px; background: #f1f5f9;
                  border: 1px solid #e2e8f0; border-radius: 8px;
                  font-family: 'Courier New', monospace; font-size: 32px;
                  letter-spacing: 12px; font-weight: 700; color: #0f172a;">
        ${code}
      </div>
    </div>
    <p style="font-size: 13px; color: #64748b;">
      This code expires in ${ttlMinutes} minutes. If you didn't request it, you can safely ignore this email.
    </p>
    <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
    <p style="font-size: 12px; color: #94a3b8;">SnapPark — Smart Parking Violation Reporting</p>
  </div>
`;

/**
 * Send a 4-digit OTP to a newly registered user so they can finish creating
 * their account.
 */
export const sendVerificationOtpEmail = async ({ to, firstName, code, ttlMinutes }) => {
  if (!isSmtpConfigured()) {
    console.warn('[email] SMTP not configured — skipping verification OTP email');
    return;
  }

  await transporter.sendMail({
    from:    FROM,
    to,
    subject: 'Your SnapPark verification code',
    html: renderOtpHtml({
      name:       firstName || 'there',
      code,
      heading:    'Verify your SnapPark account',
      intro:      'Use the code below to finish creating your account.',
      ttlMinutes,
    }),
  });
};

/**
 * Send a 4-digit OTP for the password-reset flow. Reuses the same template
 * shell as registration — the only differences are the subject and copy —
 * so the user gets a consistent visual cue.
 */
export const sendPasswordResetOtpEmail = async ({ to, firstName, code, ttlMinutes }) => {
  if (!isSmtpConfigured()) {
    console.warn('[email] SMTP not configured — skipping password-reset OTP email');
    return;
  }

  await transporter.sendMail({
    from:    FROM,
    to,
    subject: 'Your SnapPark password reset code',
    html: renderOtpHtml({
      name:       firstName || 'there',
      code,
      heading:    'Reset your SnapPark password',
      intro:      'We received a request to reset your password. Use the code below to set a new one. If you didn\'t request a reset, no action is needed.',
      ttlMinutes,
    }),
  });
};
