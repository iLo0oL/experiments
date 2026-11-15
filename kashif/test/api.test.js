'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers');

const A = '0501111111';
const B = '0552222222';
const C = '0563333333';
const A164 = '+966501111111';

test('anonymous search: number analysis and links only', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const r = await app.client().post('/api/search', { phone: '0501234567' });
  assert.equal(r.status, 200);
  assert.equal(r.body.number.e164, '+966501234567');
  assert.equal(r.body.number.valid, true);
  assert.equal(r.body.number.typeLabel, 'جوال');
  assert.equal(r.body.loggedIn, false);
  assert.equal(r.body.community, null);
  assert.deepEqual(r.body.links.map((l) => l.id), ['whatsapp', 'telegram', 'truecaller', 'google', 'call']);
  assert.equal(r.body.links[0].url, 'https://wa.me/966501234567');

  const bad = await app.client().post('/api/search', { phone: 'hello' });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'invalid_number');
});

test('OTP login: terms required, wrong code rejected, right code logs in', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const c = app.client();

  assert.equal((await c.get('/api/me')).status, 401);
  assert.equal((await c.post('/api/auth/request-otp', { phone: A })).body.error, 'terms_required');
  assert.equal((await c.post('/api/auth/request-otp', { phone: '0112345678', acceptTerms: true })).body.error, 'invalid_mobile');

  const r1 = await c.post('/api/auth/request-otp', { phone: A, acceptTerms: true });
  assert.equal(r1.status, 200);
  assert.match(r1.body.devCode, /^\d{6}$/);
  // The code is stored hashed, never in clear text.
  const row = app.db.prepare('SELECT code_hash FROM otps WHERE phone = ?').get(A164);
  assert.notEqual(row.code_hash, r1.body.devCode);

  const wrong = r1.body.devCode === '000000' ? '111111' : '000000';
  const r2 = await c.post('/api/auth/verify-otp', { phone: A164, code: wrong });
  assert.equal(r2.body.error, 'wrong_code');

  const r3 = await c.post('/api/auth/verify-otp', { phone: A164, code: r1.body.devCode });
  assert.equal(r3.status, 200);
  assert.match(r3.headers.get('set-cookie'), /HttpOnly/i);
  assert.match(r3.headers.get('set-cookie'), /SameSite=Strict/i);

  const me = await c.get('/api/me');
  assert.equal(me.body.user.e164, A164);
  assert.equal(me.body.user.displayName, null);

  // A code works only once.
  assert.equal((await app.client().post('/api/auth/verify-otp', { phone: A164, code: r1.body.devCode })).body.error, 'expired');

  await c.post('/api/auth/logout');
  assert.equal((await c.get('/api/me')).status, 401);
});

test('too many wrong codes burns the code', async (t) => {
  const app = await startApp({ otp: { maxAttempts: 3 } });
  t.after(app.close);
  const c = app.client();
  const r1 = await c.post('/api/auth/request-otp', { phone: A, acceptTerms: true });
  const wrong = r1.body.devCode === '000000' ? '111111' : '000000';
  for (let i = 0; i < 3; i++) await c.post('/api/auth/verify-otp', { phone: A164, code: wrong });
  const r = await c.post('/api/auth/verify-otp', { phone: A164, code: r1.body.devCode });
  assert.equal(r.body.error, 'too_many_attempts');
});

test('name needs explicit consent, can be hidden and deleted', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const owner = app.client();
  const searcher = app.client();
  await owner.login(A);
  await searcher.login(B);

  assert.equal((await owner.put('/api/me/name', { displayName: 'محمد' })).body.error, 'consent_required');
  assert.equal((await owner.put('/api/me/name', { displayName: 'محمد 055', consent: true })).body.error, 'invalid_name');

  const saved = await owner.put('/api/me/name', { displayName: '  محمد   العتيبي ', consent: true });
  assert.equal(saved.body.user.displayName, 'محمد العتيبي');
  assert.ok(saved.body.user.nameConsentAt);

  let s = await searcher.post('/api/search', { phone: A });
  assert.equal(s.body.community.name, 'محمد العتيبي');
  assert.equal(s.body.community.isMe, false);

  // Anonymous users never see names.
  s = await app.client().post('/api/search', { phone: A });
  assert.equal(s.body.community, null);

  await owner.put('/api/me/visibility', { hidden: true });
  s = await searcher.post('/api/search', { phone: A });
  assert.equal(s.body.community.name, null);

  await owner.put('/api/me/visibility', { hidden: false });
  s = await searcher.post('/api/search', { phone: A });
  assert.equal(s.body.community.name, 'محمد العتيبي');

  const del = await owner.del('/api/me/name');
  assert.equal(del.body.user.displayName, null);
  assert.equal(del.body.user.nameConsentAt, null);
  s = await searcher.post('/api/search', { phone: A });
  assert.equal(s.body.community.name, null);
});

test('reports: counts only, threshold, no self report, withdraw', async (t) => {
  const app = await startApp(); // minToShow = 2 in tests
  t.after(app.close);
  const b = app.client();
  const c = app.client();
  await b.login(B);
  await c.login(C);

  assert.equal((await app.client().post('/api/reports', { phone: A, category: 'spam' })).status, 401);
  assert.equal((await b.post('/api/reports', { phone: B, category: 'spam' })).body.error, 'cannot_report_self');
  assert.equal((await b.post('/api/reports', { phone: A, category: 'nope' })).body.error, 'invalid_category');

  let r = await b.post('/api/reports', { phone: A, category: 'spam' });
  assert.equal(r.status, 200);
  assert.equal(r.body.community.reports, null); // below threshold
  assert.equal(r.body.community.myReport, 'spam');

  // Reporting again only changes the category (one report per person).
  r = await b.post('/api/reports', { phone: A, category: 'fraud' });
  assert.equal(r.body.community.myReport, 'fraud');

  r = await c.post('/api/reports', { phone: '+966 50 111 1111', category: 'spam' });
  assert.deepEqual(r.body.community.reports, { spam: 1, fraud: 1, total: 2 });

  // The search response never contains reporter identities.
  const s = await c.post('/api/search', { phone: A });
  assert.deepEqual(s.body.community.reports, { spam: 1, fraud: 1, total: 2 });
  assert.doesNotMatch(s.text, /552222222|563333333/);

  const mine = await b.get('/api/me/reports');
  assert.equal(mine.body.reports.length, 1);
  assert.equal(mine.body.reports[0].category, 'fraud');

  r = await b.post('/api/reports/withdraw', { phone: A });
  assert.equal(r.body.community.reports, null);
  assert.equal(r.body.community.myReport, null);
});

test('rate limits: per-minute and per-day search limits', async (t) => {
  const app = await startApp({ limits: { searchesPerMinute: 3, anonSearchesPerDay: 100 } });
  t.after(app.close);
  const c = app.client();
  for (let i = 0; i < 3; i++) assert.equal((await c.post('/api/search', { phone: '050123456' + i })).status, 200);
  const r = await c.post('/api/search', { phone: '0501234569' });
  assert.equal(r.status, 429);
  assert.equal(r.body.error, 'rate_limited');
  assert.ok(Number(r.headers.get('retry-after')) > 0);

  const app2 = await startApp({ limits: { searchesPerDay: 2 } });
  t.after(app2.close);
  const u = app2.client();
  await u.login(A);
  assert.equal((await u.post('/api/search', { phone: B })).body.quota.remainingToday, 1);
  assert.equal((await u.post('/api/search', { phone: C })).body.quota.remainingToday, 0);
  const over = await u.post('/api/search', { phone: C });
  assert.equal(over.status, 429);
  assert.equal(over.body.error, 'search_daily_limit');

  // Searched numbers are never stored in the rate-limit table.
  const buckets = app2.db.prepare('SELECT bucket FROM rate_limits').all().map((x) => x.bucket).join(' ');
  assert.doesNotMatch(buckets, /552222222|563333333|127\.0\.0\.1/);
});

test('OTP requests are limited per phone', async (t) => {
  const app = await startApp({ limits: { otpPerPhonePer15Min: 2 } });
  t.after(app.close);
  const c = app.client();
  assert.equal((await c.post('/api/auth/request-otp', { phone: A, acceptTerms: true })).status, 200);
  assert.equal((await c.post('/api/auth/request-otp', { phone: A, acceptTerms: true })).status, 200);
  assert.equal((await c.post('/api/auth/request-otp', { phone: A, acceptTerms: true })).status, 429);
});

test('cross-site requests are rejected', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const c = app.client();
  const r = await c.req('POST', '/api/search', { phone: A }, { Origin: 'https://evil.example' });
  assert.equal(r.status, 403);
  const r2 = await c.req('POST', '/api/search', { phone: A }, { 'Sec-Fetch-Site': 'cross-site' });
  assert.equal(r2.status, 403);
});

test('export and delete account', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const a = app.client();
  const b = app.client();
  await a.login(A);
  await b.login(B);
  await a.put('/api/me/name', { displayName: 'سارة', consent: true });
  await a.post('/api/reports', { phone: C, category: 'spam' });

  const ex = await a.get('/api/me/export');
  assert.equal(ex.status, 200);
  assert.match(ex.headers.get('content-disposition'), /attachment/);
  assert.equal(ex.body.account.phone, A164);
  assert.equal(ex.body.account.displayName, 'سارة');
  assert.equal(ex.body.reportsYouMade.length, 1);

  assert.equal((await a.del('/api/me', {})).body.error, 'confirm_required');
  assert.equal((await a.del('/api/me', { confirm: true })).status, 200);
  assert.equal((await a.get('/api/me')).status, 401);
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM users WHERE phone = ?').get(A164).n, 0);
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM reports').get().n, 0);
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM sessions').get().n, 1); // only B's session

  const s = await b.post('/api/search', { phone: A });
  assert.equal(s.body.community.name, null);
});

test('Twilio Lookup: carrier shown to logged-in users and cached', async (t) => {
  const calls = [];
  const fakeFetch = async (url, opts) => {
    calls.push({ url, opts });
    return new Response(JSON.stringify({ line_type_intelligence: { carrier_name: 'Saudi Telecom Company (STC)', type: 'mobile', mobile_country_code: '420', mobile_network_code: '01' } }), { status: 200 });
  };
  const app = await startApp({ twilio: { accountSid: 'AC123', authToken: 'tok', lookupEnabled: true } }, { fetch: fakeFetch });
  t.after(app.close);
  const c = app.client();

  // Anonymous search does not call the paid API.
  assert.equal((await c.post('/api/search', { phone: B })).body.carrier, null);
  assert.equal(calls.length, 0);

  await c.login(A);
  const r = await c.post('/api/search', { phone: B });
  assert.equal(r.body.carrier.carrierName, 'Saudi Telecom Company (STC)');
  assert.equal(r.body.carrier.lineTypeLabel, 'جوال');
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /^https:\/\/lookups\.twilio\.com\/v2\/PhoneNumbers\/%2B966552222222\?Fields=line_type_intelligence$/);
  assert.equal(calls[0].opts.headers.Authorization, 'Basic ' + Buffer.from('AC123:tok').toString('base64'));

  await c.post('/api/search', { phone: B });
  assert.equal(calls.length, 1, 'second search uses the cache');
});

test('Twilio Verify provider sends and checks codes through Twilio', async (t) => {
  const calls = [];
  const fakeFetch = async (url, opts) => {
    calls.push({ url, body: String(opts.body || '') });
    if (url.endsWith('/Verifications')) return new Response(JSON.stringify({ status: 'pending' }), { status: 201 });
    const code = new URLSearchParams(String(opts.body)).get('Code');
    return new Response(JSON.stringify({ status: code === '123456' ? 'approved' : 'pending' }), { status: 200 });
  };
  const app = await startApp({ otp: { provider: 'twilio_verify' }, twilio: { accountSid: 'AC1', authToken: 't', verifyServiceSid: 'VA1' } }, { fetch: fakeFetch });
  t.after(app.close);
  const c = app.client();
  const r1 = await c.post('/api/auth/request-otp', { phone: A, acceptTerms: true });
  assert.equal(r1.status, 200);
  assert.equal(r1.body.devCode, undefined);
  assert.match(calls[0].url, /verify\.twilio\.com\/v2\/Services\/VA1\/Verifications$/);
  assert.match(calls[0].body, /To=%2B966501111111/);

  assert.equal((await c.post('/api/auth/verify-otp', { phone: A164, code: '654321' })).body.error, 'wrong_code');
  assert.equal((await c.post('/api/auth/verify-otp', { phone: A164, code: '123456' })).status, 200);
  assert.equal((await c.get('/api/me')).body.user.e164, A164);
});

test('pages are served with security headers', async (t) => {
  const app = await startApp();
  t.after(app.close);
  for (const p of ['/', '/account', '/privacy', '/terms']) {
    const r = await app.client().get(p);
    assert.equal(r.status, 200, p);
    assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
  }
  assert.equal((await app.client().get('/nope')).status, 404);
  assert.equal((await app.client().get('/api/nope')).status, 404);
});
