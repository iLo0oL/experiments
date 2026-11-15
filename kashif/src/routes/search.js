'use strict';
const express = require('express');
const { analyze, normalizeCountry } = require('../phone');
const { fail, enforce } = require('../http');
const { externalLinks } = require('../links');

const LINE_TYPES = {
  mobile: 'جوال',
  landline: 'هاتف ثابت',
  fixedVoip: 'اتصال عبر الإنترنت (ثابت)',
  nonFixedVoip: 'اتصال عبر الإنترنت (رقم افتراضي)',
  personal: 'رقم شخصي',
  tollFree: 'رقم مجاني',
  premium: 'رقم بتعرفة مرتفعة',
  sharedCost: 'رقم بتكلفة مشتركة',
  uan: 'رقم موحّد',
  voicemail: 'بريد صوتي',
  pager: 'جهاز نداء',
  unknown: 'غير معروف',
};

module.exports = function searchRoutes(ctx) {
  const { cfg, db, limiter, ipKeyOf, communityFor, twilio, log } = ctx;
  const r = express.Router();

  const getCache = db.prepare('SELECT data, fetched_at FROM lookup_cache WHERE phone = ?');
  const putCache = db.prepare(`
    INSERT INTO lookup_cache (phone, data, fetched_at) VALUES (?, ?, ?)
    ON CONFLICT (phone) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at
  `);

  async function carrierFor(phone) {
    if (!cfg.twilio.lookupEnabled) return null;
    const row = getCache.get(phone);
    let data;
    if (row && row.fetched_at > Date.now() - cfg.lookupCacheDays * 86400000) {
      data = JSON.parse(row.data);
    } else {
      try {
        data = await twilio.lookupLineType(phone);
        putCache.run(phone, JSON.stringify(data), Date.now());
      } catch (err) {
        log.error('[kashif] Twilio Lookup failed:', err.message, err.status || '');
        return { error: true };
      }
    }
    return { ...data, lineTypeLabel: data.lineType ? LINE_TYPES[data.lineType] || data.lineType : null, source: 'Twilio Lookup' };
  }

  // POST (not GET) so searched numbers never end up in URLs, browser history or access logs.
  r.post('/', async (req, res) => {
    const { phone, country } = req.body || {};
    const info = analyze(phone, normalizeCountry(country, cfg.defaultCountry));
    if (!info) return fail(res, 400, 'invalid_number');

    const L = cfg.limits;
    const who = req.user ? `u:${req.user.id}` : `ip:${ipKeyOf(req)}`;
    const dayRule = req.user
      ? { bucket: `search:${who}:d`, windowSec: 86400, max: L.searchesPerDay, code: 'search_daily_limit' }
      : { bucket: `search:${who}:d`, windowSec: 86400, max: L.anonSearchesPerDay, code: 'anon_daily_limit' };
    if (!enforce(limiter, res, [{ bucket: `search:${who}:m`, windowSec: 60, max: L.searchesPerMinute }, dayRule])) return;

    const result = {
      number: {
        e164: info.e164,
        international: info.international,
        national: info.national,
        country: info.country,
        countryName: info.countryName,
        callingCode: info.callingCode,
        valid: info.valid,
        possible: info.possible,
        type: info.type,
        typeLabel: info.typeLabel,
      },
      links: info.valid ? externalLinks(info) : [],
      loggedIn: !!req.user,
      community: null,
      carrier: null,
      quota: { remainingToday: limiter.peek(dayRule.bucket, 86400, dayRule.max).remaining },
    };

    // Data that people added about numbers is only shown to verified users.
    if (req.user && info.valid) {
      result.community = communityFor(info.e164, req.user);
      result.carrier = await carrierFor(info.e164);
    }
    res.json(result);
  });

  return r;
};
