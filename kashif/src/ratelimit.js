'use strict';
const crypto = require('node:crypto');

/**
 * Fixed-window counters stored in SQLite, so limits survive restarts.
 * consume() counts the attempt and reports whether it is within the limit.
 */
function createLimiter(db) {
  const upsert = db.prepare(`
    INSERT INTO rate_limits (bucket, window_start, count) VALUES (?, ?, 1)
    ON CONFLICT (bucket, window_start) DO UPDATE SET count = count + 1
    RETURNING count
  `);
  const peekStmt = db.prepare('SELECT count FROM rate_limits WHERE bucket = ? AND window_start = ?');

  const windowOf = (windowSec, now) => {
    const ms = windowSec * 1000;
    return Math.floor(now / ms) * ms;
  };

  function consume(bucket, windowSec, max, now = Date.now()) {
    const start = windowOf(windowSec, now);
    const { count } = upsert.get(bucket, start);
    const resetAt = start + windowSec * 1000;
    return { ok: count <= max, remaining: Math.max(0, max - count), resetAt, retryAfterSec: Math.ceil((resetAt - now) / 1000) };
  }

  function peek(bucket, windowSec, max, now = Date.now()) {
    const row = peekStmt.get(bucket, windowOf(windowSec, now));
    return { remaining: Math.max(0, max - (row ? row.count : 0)) };
  }

  /** Consume several limits at once; returns the first one that failed, or null. */
  function consumeAll(rules, now = Date.now()) {
    let failed = null;
    for (const r of rules) {
      const res = consume(r.bucket, r.windowSec, r.max, now);
      if (!res.ok && !failed) failed = { ...res, rule: r };
    }
    return failed;
  }

  return { consume, consumeAll, peek };
}

// Store a keyed hash of the IP instead of the IP itself.
function ipKey(secret, ip) {
  return crypto.createHmac('sha256', secret).update('ip:' + String(ip || '')).digest('base64url').slice(0, 22);
}

module.exports = { createLimiter, ipKey };
