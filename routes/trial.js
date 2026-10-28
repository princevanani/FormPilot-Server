import express from 'express';
import crypto from 'node:crypto';
import { dataStore } from '../config/firebase.js';
import { sendOtpEmail } from '../config/mailer.js';

export const trialRouter = express.Router();

function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email.trim());
}

function generateOtp() {
  // Cryptographically secure 6-digit numeric OTP
  return crypto.randomInt(100000, 999999).toString();
}

/**
 * POST /api/trial/request-otp
 * Body: { email: string }
 */
trialRouter.post('/request-otp', async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ success: false, error: 'Please provide a valid email address.' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const otp = generateOtp();
    const expiryMinutes = parseInt(process.env.OTP_EXPIRY_MINUTES || '10', 10);
    const expiresAt = Date.now() + expiryMinutes * 60 * 1000;

    await dataStore.saveOtp(normalizedEmail, otp, expiresAt);
    const mailResult = await sendOtpEmail(normalizedEmail, otp);

    return res.json({
      success: true,
      message: `Verification code sent to ${normalizedEmail}`,
      expiresInMinutes: expiryMinutes,
      isDev: mailResult.isDev,
      debugOtp: mailResult.debugOtp, // provided in dev mode for easy testing
    });
  } catch (err) {
    console.error('[Trial Router] request-otp error:', err);
    return res.status(500).json({ success: false, error: 'Failed to send verification code. Please try again.' });
  }
});

/**
 * POST /api/trial/verify-otp
 * Body: { email: string, otp: string }
 */
trialRouter.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body || {};
    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ success: false, error: 'Please provide a valid email address.' });
    }
    if (!otp || typeof otp !== 'string' || otp.trim().length !== 6) {
      return res.status(400).json({ success: false, error: 'Please enter a valid 6-digit verification code.' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const otpRecord = await dataStore.getOtp(normalizedEmail);

    if (!otpRecord) {
      return res.status(400).json({
        success: false,
        error: 'No active verification code found for this email. Please request a new code.',
      });
    }

    if (Date.now() > otpRecord.expiresAt) {
      await dataStore.deleteOtp(normalizedEmail);
      return res.status(400).json({
        success: false,
        error: 'Verification code has expired. Please request a new code.',
      });
    }

    if (otpRecord.otp !== otp.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Invalid verification code. Please check and try again.',
      });
    }

    // Code is valid! Remove OTP record
    await dataStore.deleteOtp(normalizedEmail);

    // Check if user already exists
    const existingUser = await dataStore.getUserByEmail(normalizedEmail);
    const trialDays = parseInt(process.env.TRIAL_DURATION_DAYS || '30', 10);
    const now = new Date();

    let trialStartDate;
    let trialEndDate;

    if (existingUser && existingUser.trialStartDate && existingUser.trialEndDate) {
      trialStartDate = existingUser.trialStartDate;
      trialEndDate = existingUser.trialEndDate;
    } else {
      trialStartDate = now.toISOString();
      const end = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000);
      trialEndDate = end.toISOString();
    }

    const isExpired = Date.now() > new Date(trialEndDate).getTime();
    const daysRemaining = isExpired
      ? 0
      : Math.max(1, Math.ceil((new Date(trialEndDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));

    const userProfile = {
      email: normalizedEmail,
      isVerified: true,
      plan: 'free_trial',
      status: isExpired ? 'expired' : 'active',
      trialDurationDays: trialDays,
      trialStartDate,
      trialEndDate,
      lastLoginAt: now.toISOString(),
    };

    await dataStore.saveUser(normalizedEmail, userProfile);

    return res.json({
      success: true,
      message: 'Email verified successfully! 30-day Free Trial is active.',
      user: {
        ...userProfile,
        daysRemaining,
      },
    });
  } catch (err) {
    console.error('[Trial Router] verify-otp error:', err);
    return res.status(500).json({ success: false, error: 'Failed to verify code. Please try again.' });
  }
});

/**
 * GET /api/trial/status?email=...
 */
trialRouter.get('/status', async (req, res) => {
  try {
    const { email } = req.query || {};
    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ success: false, error: 'Valid email is required.' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const user = await dataStore.getUserByEmail(normalizedEmail);

    if (!user || !user.isVerified) {
      return res.json({
        success: true,
        isRegistered: false,
        status: 'unverified',
      });
    }

    const isExpired = Date.now() > new Date(user.trialEndDate).getTime();
    const daysRemaining = isExpired
      ? 0
      : Math.max(0, Math.ceil((new Date(user.trialEndDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));

    return res.json({
      success: true,
      isRegistered: true,
      user: {
        ...user,
        status: isExpired ? 'expired' : 'active',
        daysRemaining,
      },
    });
  } catch (err) {
    console.error('[Trial Router] status error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch status.' });
  }
});
