'use strict';
const crypto = require('node:crypto');

const COOKIE = 'kashif_session';
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      out[k] = part.slice(i + 1).trim();
    }
  }
  return out;
}

function createAuth({ db, cfg }) {
  const insert = db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)');
  const find = db.prepare(`
    SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `);
  const remove = db.prepare('DELETE FROM sessions WHERE token_hash = ?');

  const cookieOptions = () => ({
    httpOnly: true,
    sameSite: 'strict',
    secure: cfg.isProd,
    path: '/',
    maxAge: cfg.sessionDays * 86400000,
  });

  return {
    startSession(res, userId) {
      const token = crypto.randomBytes(32).toString('base64url');
      const now = Date.now();
      insert.run(sha256(token), userId, now, now + cfg.sessionDays * 86400000);
      res.cookie(COOKIE, token, cookieOptions());
    },

    endSession(req, res) {
      const token = parseCookies(req.headers.cookie)[COOKIE];
      if (token) remove.run(sha256(token));
      res.clearCookie(COOKIE, { ...cookieOptions(), maxAge: undefined });
    },

    clearCookie(res) {
      res.clearCookie(COOKIE, { ...cookieOptions(), maxAge: undefined });
    },

    // Attaches req.user when the session cookie is valid.
    middleware(req, _res, next) {
      const token = parseCookies(req.headers.cookie)[COOKIE];
      req.user = token ? find.get(sha256(token), Date.now()) || null : null;
      next();
    },
  };
}

function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'login_required' });
  next();
}

module.exports = { createAuth, requireUser, parseCookies, COOKIE };
