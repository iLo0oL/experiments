'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
  PRAGMA foreign_keys = ON;

  -- People who registered their own number (verified by OTP).
  CREATE TABLE IF NOT EXISTS users (
    id               INTEGER PRIMARY KEY,
    phone            TEXT    NOT NULL UNIQUE,  -- E.164
    display_name     TEXT,                     -- shown in search only with explicit consent
    name_consent_at  INTEGER,                  -- when the user consented to show the name
    hidden           INTEGER NOT NULL DEFAULT 0, -- 1 = do not show anything the user added
    terms_accepted_at INTEGER NOT NULL,
    created_at       INTEGER NOT NULL,
    updated_at       INTEGER NOT NULL
  );

  -- One pending login code per phone. Only an HMAC of the code is stored.
  CREATE TABLE IF NOT EXISTS otps (
    phone      TEXT    PRIMARY KEY,
    code_hash  TEXT    NOT NULL,
    expires_at INTEGER NOT NULL,
    attempts   INTEGER NOT NULL DEFAULT 0
  );

  -- Login sessions. Only a SHA-256 of the cookie token is stored.
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT    PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

  -- Spam / fraud reports. One report per reporter per number. Reporter identity is never exposed.
  CREATE TABLE IF NOT EXISTS reports (
    id          INTEGER PRIMARY KEY,
    reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    phone       TEXT    NOT NULL,
    category    TEXT    NOT NULL CHECK (category IN ('spam', 'fraud')),
    created_at  INTEGER NOT NULL,
    UNIQUE (reporter_id, phone)
  );
  CREATE INDEX IF NOT EXISTS reports_phone ON reports(phone);

  -- Cache of carrier / line type answers from Twilio Lookup (to limit cost).
  CREATE TABLE IF NOT EXISTS lookup_cache (
    phone      TEXT    PRIMARY KEY,
    data       TEXT    NOT NULL,
    fetched_at INTEGER NOT NULL
  );

  -- Fixed-window counters for rate limiting. Buckets hold user ids or HMACs of IPs, never raw IPs
  -- and never the numbers that were searched.
  CREATE TABLE IF NOT EXISTS rate_limits (
    bucket       TEXT    NOT NULL,
    window_start INTEGER NOT NULL,
    count        INTEGER NOT NULL,
    PRIMARY KEY (bucket, window_start)
  );
`;

function openDb(dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  if (dbPath !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  return db;
}

function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Delete data we no longer need (data minimisation).
function cleanup(db, cfg, now = Date.now()) {
  const day = 86400000;
  db.prepare('DELETE FROM otps WHERE expires_at < ?').run(now);
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
  db.prepare('DELETE FROM rate_limits WHERE window_start < ?').run(now - 2 * day);
  db.prepare('DELETE FROM lookup_cache WHERE fetched_at < ?').run(now - cfg.lookupCacheDays * day);
  db.prepare('DELETE FROM reports WHERE created_at < ?').run(now - cfg.reports.retentionDays * day);
}

module.exports = { openDb, tx, cleanup };
