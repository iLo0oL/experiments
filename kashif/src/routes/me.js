'use strict';
const express = require('express');
const { analyze } = require('../phone');
const { fail } = require('../http');
const { requireUser } = require('../auth');
const { tx } = require('../db');

// Letters (any script), spaces, dot, apostrophe, hyphen. No digits, links or symbols.
function cleanName(raw) {
  const s = String(raw ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
  if (s.length < 2 || s.length > 40) return null;
  if (!/^\p{L}[\p{L}\p{M} .'\-]*$/u.test(s)) return null;
  return s;
}

module.exports = function meRoutes(ctx) {
  const { db, auth } = ctx;
  const r = express.Router();
  r.use(requireUser);

  const setName = db.prepare('UPDATE users SET display_name = ?, name_consent_at = ?, updated_at = ? WHERE id = ?');
  const setHidden = db.prepare('UPDATE users SET hidden = ?, updated_at = ? WHERE id = ?');
  const myReports = db.prepare('SELECT phone, category, created_at FROM reports WHERE reporter_id = ? ORDER BY created_at DESC');
  const sessionCount = db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND expires_at > ?');
  const deleteUser = db.prepare('DELETE FROM users WHERE id = ?');
  const deleteOtp = db.prepare('DELETE FROM otps WHERE phone = ?');
  const deleteCache = db.prepare('DELETE FROM lookup_cache WHERE phone = ?');
  const getUser = db.prepare('SELECT * FROM users WHERE id = ?');

  const view = (u) => ({
    e164: u.phone,
    international: analyze(u.phone)?.international || u.phone,
    displayName: u.display_name,
    nameConsentAt: u.name_consent_at,
    hidden: !!u.hidden,
    termsAcceptedAt: u.terms_accepted_at,
    createdAt: u.created_at,
  });

  r.get('/', (req, res) => res.json({ user: view(req.user) }));

  // Add or change the name shown to people who search for this number.
  r.put('/name', (req, res) => {
    const { displayName, consent } = req.body || {};
    if (consent !== true) return fail(res, 400, 'consent_required');
    const name = cleanName(displayName);
    if (!name) return fail(res, 400, 'invalid_name');
    const now = Date.now();
    setName.run(name, now, now, req.user.id);
    res.json({ user: view(getUser.get(req.user.id)) });
  });

  // Delete the name and withdraw consent.
  r.delete('/name', (req, res) => {
    setName.run(null, null, Date.now(), req.user.id);
    res.json({ user: view(getUser.get(req.user.id)) });
  });

  // Hide or show everything this user added (their name) in search results.
  r.put('/visibility', (req, res) => {
    const { hidden } = req.body || {};
    if (typeof hidden !== 'boolean') return fail(res, 400, 'invalid_value');
    setHidden.run(hidden ? 1 : 0, Date.now(), req.user.id);
    res.json({ user: view(getUser.get(req.user.id)) });
  });

  r.get('/reports', (req, res) => {
    const reports = myReports.all(req.user.id).map((x) => ({
      e164: x.phone,
      international: analyze(x.phone)?.international || x.phone,
      category: x.category,
      createdAt: x.created_at,
    }));
    res.json({ reports });
  });

  // Right of access: a copy of everything stored about this user.
  r.get('/export', (req, res) => {
    const u = req.user;
    const data = {
      exportedAt: new Date().toISOString(),
      service: 'كاشف',
      account: {
        phone: u.phone,
        displayName: u.display_name,
        nameConsentAt: u.name_consent_at ? new Date(u.name_consent_at).toISOString() : null,
        hiddenFromSearch: !!u.hidden,
        termsAcceptedAt: new Date(u.terms_accepted_at).toISOString(),
        createdAt: new Date(u.created_at).toISOString(),
        updatedAt: new Date(u.updated_at).toISOString(),
      },
      reportsYouMade: myReports.all(u.id).map((x) => ({ phone: x.phone, category: x.category, createdAt: new Date(x.created_at).toISOString() })),
      activeSessions: sessionCount.get(u.id, Date.now()).n,
      notStored: [
        'جهات الاتصال: لا نرفعها ولا نطلبها',
        'الأرقام التي بحثت عنها: لا نحفظها',
        'عنوان IP: لا نحفظه، نحفظ بصمة مشفّرة مؤقتة منه لحدود الاستخدام فقط وتُحذف خلال يومين',
      ],
    };
    res.set('Content-Disposition', 'attachment; filename="kashif-my-data.json"');
    res.type('application/json').send(JSON.stringify(data, null, 2));
  });

  // Right to erasure: delete the account and everything linked to it.
  r.delete('/', (req, res) => {
    const { confirm } = req.body || {};
    if (confirm !== true) return fail(res, 400, 'confirm_required');
    const u = req.user;
    tx(db, () => {
      deleteUser.run(u.id); // sessions and reports cascade
      deleteOtp.run(u.phone);
      deleteCache.run(u.phone);
    });
    auth.clearCookie(res);
    res.json({ ok: true });
  });

  return r;
};

module.exports.cleanName = cleanName;
