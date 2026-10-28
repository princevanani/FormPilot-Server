import nodemailer from 'nodemailer';

let transporter = null;
let isSmtpConfigured = false;

export async function initMailer() {
  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey) {
    console.log('[Mailer] Resend API key configured (using HTTPS port 443).');
    return;
  }

  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (host && user && pass) {
    try {
      transporter = nodemailer.createTransport({
        host,
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: process.env.SMTP_SECURE === 'true',
        auth: { user, pass: pass.replace(/\s+/g, '') },
        connectionTimeout: 5000,
        greetingTimeout: 5000,
        socketTimeout: 5000,
      });
      await transporter.verify();
      isSmtpConfigured = true;
      console.log(`[Mailer] SMTP transporter configured and connected (${host}).`);
    } catch (err) {
      console.warn(`[Mailer] SMTP verification failed (${err.message}). Falling back to dev mode.`);
      transporter = null;
      isSmtpConfigured = false;
    }
  } else {
    console.log('[Mailer] SMTP credentials not set in .env. Running in console/development mode (OTP will be printed here).');
  }
}

/**
 * Send 6-digit OTP verification email for the 30-day Free Trial
 */
export async function sendOtpEmail(toEmail, otp) {
  const from = process.env.SMTP_FROM || `FormPilot <${process.env.SMTP_USER || 'no-reply@formpilot.app'}>`;
  const subject = `Your FormPilot 30-Day Free Trial Code: ${otp}`;
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0f1420; color: #e7ecf7; padding: 24px; margin: 0; }
        .card { max-width: 480px; margin: 0 auto; background: #161d2e; border: 1px solid #2a3348; border-radius: 12px; padding: 32px 24px; }
        .logo-wrap { display: flex; align-items: center; gap: 10px; margin-bottom: 24px; }
        .title { font-size: 20px; font-weight: 700; color: #ffffff; margin: 0 0 8px; }
        .subtitle { font-size: 14px; color: #8b94ab; margin-bottom: 24px; line-height: 1.5; }
        .otp-box { background: #1e263b; border: 2px dashed #6d5efc; border-radius: 8px; padding: 18px; text-align: center; margin: 24px 0; }
        .otp-code { font-size: 32px; font-weight: 800; letter-spacing: 6px; color: #8b7bff; font-family: monospace; }
        .note { font-size: 12px; color: #8b94ab; margin-top: 16px; line-height: 1.5; }
        .footer { text-align: center; font-size: 11px; color: #5a647d; margin-top: 24px; border-top: 1px solid #232b40; padding-top: 16px; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1 class="title">Verify your email for FormPilot</h1>
        <p class="subtitle">Enter the verification code below in your FormPilot Chrome extension to activate your <strong>30-Day Free Trial</strong>.</p>
        
        <div class="otp-box">
          <div class="otp-code">${otp}</div>
        </div>
        
        <p class="note">This code is valid for 10 minutes. If you did not request this, you can safely ignore this email.</p>
        <div class="footer">
          FormPilot · Smart cross-tab form autofill<br/>
          Gujarat, India
        </div>
      </div>
    </body>
    </html>
  `;

  const resendApiKey = process.env.RESEND_API_KEY;
  if (resendApiKey) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: process.env.RESEND_FROM || 'FormPilot <onboarding@resend.dev>',
          to: [toEmail],
          subject,
          html,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        return { success: true, messageId: data.id, isDev: false };
      }
      console.error('[Mailer] Resend API error:', data);
    } catch (err) {
      console.error('[Mailer] Resend request failed:', err.message);
    }
  }

  if (isSmtpConfigured && transporter) {
    try {
      const info = await transporter.sendMail({
        from,
        to: toEmail,
        subject,
        html,
        text: `Your FormPilot verification code is: ${otp}. It expires in 10 minutes.`,
      });
      return { success: true, messageId: info.messageId, isDev: false };
    } catch (err) {
      console.error('[Mailer] Error sending real email:', err.message);
      // Fall through to console log
    }
  }

  // Development fallback: Log prominently to server console
  console.log('\n======================================================');
  console.log(`✉️  [FormPilot EMAIL DEV] Verification Code for ${toEmail}:`);
  console.log(`👉  OTP: [ ${otp} ]  (Valid for 10 minutes)`);
  console.log('======================================================\n');

  return { success: true, isDev: true, debugOtp: otp };
}
