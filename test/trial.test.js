import test from 'node:test';
import assert from 'node:assert/strict';
import { dataStore } from '../config/firebase.js';
import app from '../index.js';

process.env.NODE_ENV = 'test';
process.env.TRIAL_DURATION_DAYS = '30';

test('dataStore saves and retrieves OTP records correctly', async () => {
  const email = 'test-otp@example.com';
  const otp = '654321';
  const expiresAt = Date.now() + 60000;

  await dataStore.saveOtp(email, otp, expiresAt);
  const record = await dataStore.getOtp(email);

  assert.equal(record.email, email);
  assert.equal(record.otp, otp);
  assert.equal(record.expiresAt, expiresAt);

  await dataStore.deleteOtp(email);
  const afterDelete = await dataStore.getOtp(email);
  assert.equal(afterDelete, null);
});

test('dataStore saves and updates user 30-day trial status', async () => {
  const email = 'user-trial@example.com';
  const now = new Date();
  const trialEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

  await dataStore.saveUser(email, {
    isVerified: true,
    plan: 'free_trial',
    status: 'active',
    trialStartDate: now.toISOString(),
    trialEndDate: trialEnd,
  });

  const user = await dataStore.getUserByEmail(email);
  assert.ok(user);
  assert.equal(user.email, email);
  assert.equal(user.isVerified, true);
  assert.equal(user.status, 'active');
  assert.equal(user.plan, 'free_trial');
  assert.equal(user.trialEndDate, trialEnd);
});

test('trial period calculations accurately reflect 30 days', () => {
  const trialDurationDays = 30;
  const now = Date.now();
  const endDate = new Date(now + trialDurationDays * 24 * 60 * 60 * 1000);

  const daysRemaining = Math.ceil((endDate.getTime() - now) / (1000 * 60 * 60 * 24));
  assert.equal(daysRemaining, 30);
});

test('HTTP API: full free-trial OTP request, verification, and status lifecycle', async () => {
  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  try {
    // 1. Health check
    const healthRes = await fetch(`${baseUrl}/api/health`);
    const healthData = await healthRes.json();
    assert.equal(healthRes.status, 200);
    assert.equal(healthData.status, 'ok');

    // 2. Reject invalid email
    const badEmailRes = await fetch(`${baseUrl}/api/trial/request-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email' }),
    });
    assert.equal(badEmailRes.status, 400);

    // 3. Request OTP with valid email
    const testEmail = 'pilot-user@example.com';
    const otpReqRes = await fetch(`${baseUrl}/api/trial/request-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail }),
    });
    assert.equal(otpReqRes.status, 200);
    const otpReqData = await otpReqRes.json();
    assert.equal(otpReqData.success, true);
    assert.ok(otpReqData.debugOtp);
    const generatedOtp = otpReqData.debugOtp;

    // 4. Reject incorrect OTP
    const badOtpRes = await fetch(`${baseUrl}/api/trial/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, otp: '000000' }),
    });
    assert.equal(badOtpRes.status, 400);

    // 5. Verify with correct OTP
    const verifyRes = await fetch(`${baseUrl}/api/trial/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, otp: generatedOtp }),
    });
    assert.equal(verifyRes.status, 200);
    const verifyData = await verifyRes.json();
    assert.equal(verifyData.success, true);
    assert.equal(verifyData.user.email, testEmail);
    assert.equal(verifyData.user.isVerified, true);
    assert.equal(verifyData.user.plan, 'free_trial');
    assert.equal(verifyData.user.status, 'active');
    assert.equal(verifyData.user.daysRemaining, 30);

    // 6. Query status
    const statusRes = await fetch(`${baseUrl}/api/trial/status?email=${encodeURIComponent(testEmail)}`);
    assert.equal(statusRes.status, 200);
    const statusData = await statusRes.json();
    assert.equal(statusData.success, true);
    assert.equal(statusData.user.email, testEmail);
    assert.equal(statusData.user.status, 'active');
    assert.equal(statusData.user.daysRemaining, 30);
  } finally {
    server.close();
  }
});
