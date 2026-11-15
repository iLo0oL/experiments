'use strict';
const express = require('express');
const { analyze, normalizeCountry } = require('../phone');
const { fail, enforce } = require('../http');
const { requireUser } = require('../auth');

const CATEGORIES = ['spam', 'fraud'];

module.exports = function reportRoutes(ctx) {
  const { cfg, db, limiter, communityFor } = ctx;
  const r = express.Router();
  r.use(requireUser);

  const upsert = db.prepare(`
    INSERT INTO reports (reporter_id, phone, category, created_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (reporter_id, phone) DO UPDATE SET category = excluded.category, created_at = excluded.created_at
  `);
  const remove = db.prepare('DELETE FROM reports WHERE reporter_id = ? AND phone = ?');

  const target = (req, res) => {
    const { phone, country } = req.body || {};
    const info = analyze(phone, normalizeCountry(country, cfg.defaultCountry));
    if (!info || !info.valid) {
      fail(res, 400, 'invalid_number');
      return null;
    }
    return info;
  };

  // Report a number as spam or fraud. One report per user per number (re-reporting changes the category).
  r.post('/', (req, res) => {
    const info = target(req, res);
    if (!info) return;
    if (info.e164 === req.user.phone) return fail(res, 400, 'cannot_report_self');
    const { category } = req.body;
    if (!CATEGORIES.includes(category)) return fail(res, 400, 'invalid_category');
    if (!enforce(limiter, res, [{ bucket: `report:u:${req.user.id}:d`, windowSec: 86400, max: cfg.limits.reportsPerDay }])) return;

    upsert.run(req.user.id, info.e164, category, Date.now());
    res.json({ ok: true, community: communityFor(info.e164, req.user) });
  });

  // Withdraw my report.
  r.post('/withdraw', (req, res) => {
    const info = target(req, res);
    if (!info) return;
    remove.run(req.user.id, info.e164);
    res.json({ ok: true, community: communityFor(info.e164, req.user) });
  });

  return r;
};
