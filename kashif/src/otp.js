'use strict';
const crypto = require('node:crypto');

/*
  Login codes (OTP).
  - console: for local development. The code is printed in the server terminal
             (and returned to the page as devCode, outside production only).
  - twilio_verify: Twilio Verify sends the SMS and checks the code.
*/

function createOtp({ db, cfg, twilio, log = console }) {
  const hash = (phone, code) => crypto.createHmac('sha256', cfg.secret).update(`otp:${phone}:${code}`).digest('hex');
  const same = (a, b) => {
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    return x.length === y.length && crypto.timingSafeEqual(x, y);
  };

  const upsert = db.prepare(`
    INSERT INTO otps (phone, code_hash, expires_at, attempts) VALUES (?, ?, ?, 0)
    ON CONFLICT (phone) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0
  `);
  const getStmt = db.prepare('SELECT code_hash, expires_at, attempts FROM otps WHERE phone = ?');
  const bump = db.prepare('UPDATE otps SET attempts = attempts + 1 WHERE phone = ?');
  const del = db.prepare('DELETE FROM otps WHERE phone = ?');

  if (cfg.otp.provider === 'twilio_verify') {
    return {
      provider: 'twilio_verify',
      async send(phone) {
        await twilio.startVerification(phone);
        return {};
      },
      async verify(phone, code) {
        return (await twilio.checkVerification(phone, code)) ? { ok: true } : { ok: false, reason: 'wrong_code' };
      },
    };
  }

  return {
    provider: 'console',
    async send(phone) {
      const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
      upsert.run(phone, hash(phone, code), Date.now() + cfg.otp.ttlSec * 1000);
      log.log(`[kashif] رمز التحقق للرقم ${phone}: ${code}`);
      return cfg.isProd ? {} : { devCode: code };
    },
    async verify(phone, code) {
      const row = getStmt.get(phone);
      if (!row || row.expires_at < Date.now()) return { ok: false, reason: 'expired' };
      if (row.attempts >= cfg.otp.maxAttempts) {
        del.run(phone);
        return { ok: false, reason: 'too_many_attempts' };
      }
      if (!same(row.code_hash, hash(phone, code))) {
        bump.run(phone);
        return { ok: false, reason: 'wrong_code' };
      }
      del.run(phone);
      return { ok: true };
    },
  };
}

module.exports = { createOtp };
