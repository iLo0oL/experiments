'use strict';
const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const { createLimiter, ipKey } = require('./ratelimit');
const { createAuth } = require('./auth');
const { createOtp } = require('./otp');
const { createTwilio } = require('./twilio');
const { createCommunity } = require('./community');
const { fail, enforce } = require('./http');

/**
 * Build the Express app. Dependencies are injected so tests can use an in-memory DB and a fake fetch.
 */
function createApp({ cfg, db, fetch: fetchImpl = globalThis.fetch, log = console }) {
  const twilio = cfg.twilio.accountSid ? createTwilio(cfg, fetchImpl) : null;
  const ctx = {
    cfg,
    db,
    log,
    twilio,
    limiter: createLimiter(db),
    auth: createAuth({ db, cfg }),
    otp: createOtp({ db, cfg, twilio, log }),
    communityFor: createCommunity({ db, cfg }),
    ipKeyOf: (req) => ipKey(cfg.secret, req.ip),
  };

  const app = express();
  app.set('trust proxy', cfg.trustProxy || false);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          ...(cfg.isProd ? { upgradeInsecureRequests: [] } : {}),
        },
      },
      strictTransportSecurity: cfg.isProd,
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );

  app.get('/health', (_req, res) => res.json({ ok: true }));

  // ----- API -----
  const api = express.Router();
  api.use(express.json({ limit: '10kb' }));
  api.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    // Block cross-site requests that change data (on top of SameSite=Strict cookies).
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const site = req.get('sec-fetch-site');
      const origin = req.get('origin');
      let badOrigin = false;
      if (origin) {
        try {
          badOrigin = new URL(origin).host !== req.get('host');
        } catch {
          badOrigin = true;
        }
      }
      if (badOrigin || (site && !['same-origin', 'none'].includes(site))) return fail(res, 403, 'forbidden_origin');
    }
    next();
  });
  api.use((req, res, next) => {
    if (enforce(ctx.limiter, res, [{ bucket: `api:ip:${ctx.ipKeyOf(req)}`, windowSec: 60, max: cfg.limits.apiPerMinute }])) next();
  });
  api.use(ctx.auth.middleware);

  api.get('/config', (req, res) =>
    res.json({
      defaultCountry: cfg.defaultCountry,
      loggedIn: !!req.user,
      otpProvider: ctx.otp.provider,
      carrierLookup: cfg.twilio.lookupEnabled,
      reportsMinToShow: cfg.reports.minToShow,
      limits: {
        searchesPerDay: cfg.limits.searchesPerDay,
        anonSearchesPerDay: cfg.limits.anonSearchesPerDay,
        searchesPerMinute: cfg.limits.searchesPerMinute,
      },
    }),
  );
  api.use('/auth', require('./routes/auth')(ctx));
  api.use('/me', require('./routes/me')(ctx));
  api.use('/search', require('./routes/search')(ctx));
  api.use('/reports', require('./routes/reports')(ctx));
  api.use((_req, res) => fail(res, 404, 'not_found'));
  api.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') return fail(res, 400, 'bad_request');
    log.error('[kashif] Unhandled error:', err);
    fail(res, 500, 'server_error');
  });
  app.use('/api', api);

  // ----- Pages -----
  app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'], maxAge: cfg.isProd ? '1h' : 0 }));
  app.use((_req, res) => res.status(404).sendFile(path.join(__dirname, '..', 'public', '404.html')));

  return app;
}

module.exports = { createApp };
