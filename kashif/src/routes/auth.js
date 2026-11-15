'use strict';
const express = require('express');
const { analyze, normalizeCountry } = require('../phone');
const { fail, enforce } = require('../http');

module.exports = function authRoutes(ctx) {
  const { cfg, db, limiter, otp, auth, ipKeyOf, log } = ctx;
  const r = express.Router();

  const insertUser = db.prepare(`
    INSERT INTO users (phone, terms_accepted_at, created_at, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (phone) DO UPDATE SET terms_accepted_at = excluded.terms_accepted_at, updated_at = excluded.updated_at
    RETURNING id
  `);

  // Step 1: send a login code to the number.
  r.post('/request-otp', async (req, res) => {
    const { phone, country, acceptTerms } = req.body || {};
    const info = analyze(phone, normalizeCountry(country, cfg.defaultCountry));
    if (!info || !info.canReceiveSms) return fail(res, 400, 'invalid_mobile');
    if (acceptTerms !== true) return fail(res, 400, 'terms_required');

    const ok = enforce(limiter, res, [
      { bucket: `otp:phone:${info.e164}`, windowSec: 900, max: cfg.limits.otpPerPhonePer15Min },
      { bucket: `otp:ip:${ipKeyOf(req)}`, windowSec: 3600, max: cfg.limits.otpPerIpPerHour },
    ]);
    if (!ok) return;

    try {
      const extra = await otp.send(info.e164);
      res.json({ ok: true, e164: info.e164, international: info.international, ttlSec: cfg.otp.ttlSec, ...extra });
    } catch (err) {
      log.error('[kashif] OTP send failed:', err.message, err.status || '');
      fail(res, 502, 'sms_failed');
    }
  });

  // Step 2: check the code; create the account on first login.
  r.post('/verify-otp', async (req, res) => {
    const { phone, code } = req.body || {};
    const info = analyze(phone, cfg.defaultCountry);
    if (!info || !info.canReceiveSms) return fail(res, 400, 'invalid_mobile');
    const digits = String(code ?? '').replace(/\D/g, '');
    if (!/^\d{6}$/.test(digits)) return fail(res, 400, 'invalid_code');

    const ok = enforce(limiter, res, [
      { bucket: `verify:ip:${ipKeyOf(req)}`, windowSec: 3600, max: 30 },
      { bucket: `verify:phone:${info.e164}`, windowSec: 900, max: 10 },
    ]);
    if (!ok) return;

    let result;
    try {
      result = await otp.verify(info.e164, digits);
    } catch (err) {
      log.error('[kashif] OTP verify failed:', err.message, err.status || '');
      return fail(res, 502, 'sms_failed');
    }
    if (!result.ok) return fail(res, 400, result.reason);

    const now = Date.now();
    const { id } = insertUser.get(info.e164, now, now, now);
    auth.startSession(res, id);
    res.json({ ok: true });
  });

  r.post('/logout', (req, res) => {
    auth.endSession(req, res);
    res.json({ ok: true });
  });

  return r;
};
