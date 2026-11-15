'use strict';
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

// Load .env from the project root if present (Node >= 21.7 has a built-in loader).
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile) && !process.env.KASHIF_SKIP_ENV_FILE) process.loadEnvFile(envFile);

const str = (name, def = '') => (process.env[name] ?? def).toString().trim();
const int = (name, def) => {
  const v = parseInt(process.env[name], 10);
  return Number.isFinite(v) ? v : def;
};
const bool = (name, def) => {
  const v = process.env[name];
  if (v == null || v === '') return def;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
};

function deepMerge(target, src) {
  for (const [k, v] of Object.entries(src)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object') deepMerge(target[k], v);
    else target[k] = v;
  }
  return target;
}

function loadConfig(overrides = {}) {
  const env = str('NODE_ENV', 'development');
  const isProd = env === 'production';

  const cfg = {
    env,
    isProd,
    port: int('PORT', 3000),
    dbPath: str('DB_PATH', path.join(ROOT, 'data', 'kashif.db')),
    secret: str('APP_SECRET'),
    trustProxy: int('TRUST_PROXY', 0), // number of reverse proxies in front of the app
    defaultCountry: str('DEFAULT_COUNTRY', 'SA').toUpperCase(),

    otp: {
      provider: str('OTP_PROVIDER', 'console'), // console | twilio_verify
      ttlSec: int('OTP_TTL_SECONDS', 300),
      maxAttempts: int('OTP_MAX_ATTEMPTS', 5),
    },

    twilio: {
      accountSid: str('TWILIO_ACCOUNT_SID'),
      authToken: str('TWILIO_AUTH_TOKEN'),
      verifyServiceSid: str('TWILIO_VERIFY_SERVICE_SID'),
      lookupEnabled: bool('TWILIO_LOOKUP_ENABLED', false),
    },

    limits: {
      apiPerMinute: int('API_REQUESTS_PER_MINUTE', 60),
      searchesPerMinute: int('SEARCHES_PER_MINUTE', 5),
      searchesPerDay: int('SEARCHES_PER_DAY', 30),
      anonSearchesPerDay: int('ANON_SEARCHES_PER_DAY', 10),
      otpPerPhonePer15Min: int('OTP_PER_PHONE_PER_15_MIN', 3),
      otpPerIpPerHour: int('OTP_PER_IP_PER_HOUR', 10),
      reportsPerDay: int('REPORTS_PER_DAY', 20),
    },

    reports: {
      minToShow: int('REPORTS_MIN_TO_SHOW', 3),
      retentionDays: int('REPORTS_RETENTION_DAYS', 365),
    },

    lookupCacheDays: int('LOOKUP_CACHE_DAYS', 30),
    sessionDays: int('SESSION_DAYS', 30),
  };
  deepMerge(cfg, overrides);

  if (!cfg.secret) {
    if (cfg.isProd) throw new Error('APP_SECRET is required in production (use a long random value).');
    cfg.secret = 'dev-only-insecure-secret-change-me';
    if (!overrides.quiet) console.warn('[kashif] APP_SECRET is not set; using an insecure development secret.');
  }
  if (cfg.isProd && cfg.otp.provider === 'console') {
    throw new Error('OTP_PROVIDER=console is for local development only. Use twilio_verify in production.');
  }
  if (cfg.otp.provider === 'twilio_verify' && !(cfg.twilio.accountSid && cfg.twilio.authToken && cfg.twilio.verifyServiceSid)) {
    throw new Error('OTP_PROVIDER=twilio_verify needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_VERIFY_SERVICE_SID.');
  }
  if (cfg.twilio.lookupEnabled && !(cfg.twilio.accountSid && cfg.twilio.authToken)) {
    throw new Error('TWILIO_LOOKUP_ENABLED=true needs TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.');
  }
  return cfg;
}

module.exports = { loadConfig, ROOT };
