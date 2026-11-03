'use strict';
/*
  سيرفر تجارب المشترك
  مستندات مشتركة (القطّة، شجرتنا، مقاضي، منيو، موعد) بمفتاحين:
  - مفتاح التعديل: لأصحاب المستند ومن يشاركونه معه
  - مفتاح العرض: للقراءة بس (مثل منيو الزبائن وصفحة الحجز)
  وحجوزات «موعد» مع منع التعارض، وتنبيهات للمالك.
  يحتاج: DATABASE_URL. اختياري: PORT, ALLOW_ORIGINS, SITE_URL, PGSSL
*/
const http = require('node:http');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const webpush = require('web-push');

const PORT = +process.env.PORT || 8080;
const ORIGINS = (process.env.ALLOW_ORIGINS || 'https://ilo0ol.github.io').split(',').map(s => s.trim()).filter(Boolean);
const SITE = process.env.SITE_URL || 'https://ilo0ol.github.io/experiments/';
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL مو موجود. ضيف قاعدة بيانات Postgres واربطها بالسيرفر.'); process.exit(1); }
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === '1' ? { rejectUnauthorized: false } : undefined, max: 10 });
const q = (t, p) => pool.query(t, p);
const now = () => Date.now();
const KINDS = ['qatta', 'shajara', 'maqadi', 'menu', 'mawid'];
const MAX_BODY = 3 * 1024 * 1024;

async function migrate() {
  await q(`
    create table if not exists docs(id text primary key, kind text not null, view_hash text not null, edit_hash text not null, rev int not null default 1, body jsonb not null, created_at bigint not null, updated_at bigint not null, last_read bigint not null);
    create table if not exists bookings(id text primary key, doc_id text not null references docs(id) on delete cascade, service text not null, starts bigint not null, ends bigint not null, name text not null, phone text not null, note text not null default '', status text not null default 'new', code_hash text not null, created_at bigint not null);
    create index if not exists bookings_doc_time on bookings(doc_id, starts);
    create table if not exists doc_subs(endpoint text not null, doc_id text not null references docs(id) on delete cascade, keys jsonb not null, created_at bigint not null, primary key(endpoint, doc_id));
    create table if not exists kv(k text primary key, v jsonb not null);
  `);
}
async function kvGet(k) { const r = await q('select v from kv where k=$1', [k]); return r.rows[0] ? r.rows[0].v : null; }
async function kvSet(k, v) { await q('insert into kv(k,v) values($1,$2) on conflict(k) do update set v=excluded.v', [k, JSON.stringify(v)]); }

/* ---------- أدوات ---------- */
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const ABC = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const rid = n => Array.from(crypto.randomBytes(n), b => ABC[b % ABC.length]).join('');
const str = (x, n = 300) => typeof x === 'string' ? x.slice(0, n) : '';
const int = x => Number.isFinite(+x) ? Math.floor(+x) : null;
class HttpError extends Error { constructor(status, code) { super(code); this.status = status; this.code = code; } }
const fail = (s, c) => { throw new HttpError(s, c); };
const same = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };
function roleOf(doc, key) { if (!key) return null; const h = sha(key); if (same(h, doc.edit_hash)) return 'edit'; if (same(h, doc.view_hash)) return 'view'; return null; }

const hits = new Map();
function limit(req, key, max, windowMs) {
  if (process.env.RATE_LIMIT_OFF === '1') return; /* للتجربة المحلية بس */
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const k = key + '|' + ip, t = now(); const a = (hits.get(k) || []).filter(x => t - x < windowMs);
  if (a.length >= max) fail(429, 'rate'); a.push(t); hits.set(k, a);
}
setInterval(() => { const t = now(); for (const [k, a] of hits) if (!a.some(x => t - x < 3600e3)) hits.delete(k); }, 600e3).unref();

/* ---------- HTTP ---------- */
function cors(origin) {
  if (origin && ORIGINS.includes(origin)) return { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS', 'Access-Control-Max-Age': '600' };
  return { 'Vary': 'Origin' };
}
function send(res, status, obj, origin) { const b = JSON.stringify(obj); res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors(origin) }); res.end(b); }
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0, tooBig = false; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 12 * 1024 * 1024) { req.destroy(); return; } if (size > MAX_BODY + 65536) { tooBig = true; chunks.length = 0; } else if (!tooBig) chunks.push(c); });
    req.on('end', () => { if (tooBig) return reject(new HttpError(413, 'too_big')); if (!chunks.length) return resolve({}); try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(new HttpError(400, 'bad_json')); } });
    req.on('error', reject);
  });
}
const routes = [];
const route = (method, path, fn) => routes.push({ method, re: new RegExp('^' + path.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), fn });

route('GET', '/', async () => ({ ok: true, app: 'تجارب', msg: 'السيرفر شغّال' }));
route('GET', '/health', async () => { await q('select 1'); return { ok: true }; });

/* ---------- المستندات ---------- */
const isObj = x => x && typeof x === 'object' && !Array.isArray(x);
function cleanBody(b) { const body = isObj(b) ? b : {}; return { items: isObj(body.items) ? body.items : {}, meta: isObj(body.meta) ? body.meta : null }; }
async function loadDoc(id) { const r = await q('select * from docs where id=$1', [str(id, 40)]); if (!r.rows[0]) fail(404, 'not_found'); return r.rows[0]; }

route('POST', '/api/docs', async (req, b) => {
  limit(req, 'create', 30, 3600e3);
  const kind = str(b.kind, 20); if (!KINDS.includes(kind)) fail(400, 'bad_kind');
  const body = cleanBody(b.body); const json = JSON.stringify(body); if (json.length > MAX_BODY) fail(413, 'too_big');
  const id = rid(10), view = rid(16), edit = rid(24), t = now();
  await q('insert into docs(id,kind,view_hash,edit_hash,rev,body,created_at,updated_at,last_read) values($1,$2,$3,$4,1,$5,$6,$6,$6)', [id, kind, sha(view), sha(edit), json, t]);
  return { id, view, edit, rev: 1 };
});
route('GET', '/api/docs/:id', async (req, b, p, url) => {
  limit(req, 'read', 3000, 600e3);
  const doc = await loadDoc(p.id); const role = roleOf(doc, url.searchParams.get('k')); if (!role) fail(403, 'bad_key');
  if (now() - +doc.last_read > 864e5) q('update docs set last_read=$1 where id=$2', [now(), doc.id]).catch(() => {});
  if (int(url.searchParams.get('rev')) === doc.rev) return { same: true, rev: doc.rev, role };
  return { rev: doc.rev, kind: doc.kind, role, body: doc.body };
});
/* دمج: لكل عنصر ينحفظ الأحدث حسب u (وقت التعديل بالملي ثانية)، والمحذوف يبقى علامة {del:1} */
route('PATCH', '/api/docs/:id', async (req, b, p) => {
  limit(req, 'write', 600, 600e3);
  const items = isObj(b.items) ? b.items : {}, meta = isObj(b.meta) ? b.meta : null;
  if (Object.keys(items).length > 2000) fail(400, 'too_many');
  const c = await pool.connect();
  try {
    await c.query('begin');
    const r = await c.query('select * from docs where id=$1 for update', [str(p.id, 40)]);
    const doc = r.rows[0]; if (!doc) fail(404, 'not_found'); if (roleOf(doc, b.k) !== 'edit') fail(403, 'bad_key');
    const body = cleanBody(doc.body); let changed = 0;
    for (const [id, it] of Object.entries(items)) {
      if (id.length > 80 || !isObj(it) || !Number.isFinite(+it.u)) continue;
      const cur = body.items[id];
      if (!cur || +it.u >= +(cur.u || 0)) { body.items[id] = it; changed++; }
    }
    if (meta && Number.isFinite(+meta.u) && (!body.meta || +meta.u >= +(body.meta.u || 0))) { body.meta = meta; changed++; }
    const cut = now() - 60 * 864e5;
    for (const [id, it] of Object.entries(body.items)) if (it && it.del && +it.u < cut) delete body.items[id];
    if (Object.keys(body.items).length > 20000) fail(413, 'too_big');
    const json = JSON.stringify(body); if (json.length > MAX_BODY) fail(413, 'too_big');
    let rev = doc.rev;
    if (changed) { rev = doc.rev + 1; await c.query('update docs set body=$1, rev=$2, updated_at=$3 where id=$4', [json, rev, now(), doc.id]); }
    await c.query('commit');
    return { rev, applied: changed };
  } catch (e) { await c.query('rollback').catch(() => {}); throw e; }
  finally { c.release(); }
});
route('POST', '/api/docs/:id/keys', async (req, b, p) => {
  const doc = await loadDoc(p.id); if (roleOf(doc, b.k) !== 'edit') fail(403, 'bad_key');
  const out = {};
  if (b.which === 'view' || b.which === 'both') { out.view = rid(16); await q('update docs set view_hash=$1 where id=$2', [sha(out.view), doc.id]); }
  if (b.which === 'edit' || b.which === 'both') { out.edit = rid(24); await q('update docs set edit_hash=$1 where id=$2', [sha(out.edit), doc.id]); }
  if (!out.view && !out.edit) fail(400, 'bad_which');
  return out;
});
route('DELETE', '/api/docs/:id', async (req, b, p) => { const doc = await loadDoc(p.id); if (roleOf(doc, b.k) !== 'edit') fail(403, 'bad_key'); await q('delete from docs where id=$1', [doc.id]); return { ok: true }; });

/* ---------- حجوزات «موعد» ---------- */
function tzParts(ms, tz) {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' });
  const o = {}; for (const x of f.formatToParts(new Date(ms))) o[x.type] = x.value;
  return { date: `${o.year}-${o.month}-${o.day}`, wd: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(o.weekday), min: (+o.hour) * 60 + (+o.minute) };
}
const hm = s => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '')); return m ? (+m[1]) * 60 + (+m[2]) : null; };
function checkHours(meta, start, end) {
  let tz = str(meta.tz, 60) || 'Asia/Riyadh'; try { new Intl.DateTimeFormat('en', { timeZone: tz }); } catch (e) { tz = 'Asia/Riyadh'; }
  const a = tzParts(start, tz), z = tzParts(end - 1, tz);
  if (a.date !== z.date) return false;
  if (Array.isArray(meta.off) && meta.off.includes(a.date)) return false;
  const hours = isObj(meta.hours) ? meta.hours[a.wd] || meta.hours[String(a.wd)] : null;
  if (!Array.isArray(hours)) return false;
  return hours.some(r => Array.isArray(r) && hm(r[0]) != null && hm(r[1]) != null && a.min >= hm(r[0]) && z.min + 1 <= hm(r[1]));
}
route('GET', '/api/docs/:id/busy', async (req, b, p, url) => {
  limit(req, 'read', 3000, 600e3);
  const doc = await loadDoc(p.id); if (!roleOf(doc, url.searchParams.get('k'))) fail(403, 'bad_key');
  const from = int(url.searchParams.get('from')) || now(), to = Math.min(int(url.searchParams.get('to')) || from + 31 * 864e5, from + 92 * 864e5);
  const r = await q("select starts, ends from bookings where doc_id=$1 and status<>'cancelled' and ends > $2 and starts < $3 order by starts", [doc.id, from, to]);
  return { busy: r.rows.map(x => [+x.starts, +x.ends]) };
});
route('POST', '/api/docs/:id/bookings', async (req, b, p) => {
  limit(req, 'book', 30, 3600e3);
  const name = str(b.name, 60).trim(), phone = str(b.phone, 20).replace(/[^\d+]/g, ''), note = str(b.note, 300).trim(), start = int(b.start);
  if (name.length < 2) fail(400, 'bad_name'); if (!/^\+?\d{7,15}$/.test(phone)) fail(400, 'bad_phone');
  if (!start || start < now() + 5 * 60e3 || start > now() + 121 * 864e5) fail(400, 'bad_time');
  const c = await pool.connect();
  try {
    await c.query('begin');
    const r = await c.query('select * from docs where id=$1 for update', [str(p.id, 40)]); const doc = r.rows[0];
    if (!doc) fail(404, 'not_found'); if (doc.kind !== 'mawid') fail(400, 'bad_kind'); if (!roleOf(doc, b.k)) fail(403, 'bad_key');
    const meta = isObj(doc.body.meta) ? doc.body.meta : {}; if (meta.closed) fail(400, 'closed');
    const svc = Object.entries(isObj(doc.body.items) ? doc.body.items : {}).find(([id, it]) => id === str(b.service, 80) && it && !it.del && it.type === 'service');
    if (!svc) fail(400, 'bad_service');
    const dur = int(svc[1].dur); if (!dur || dur < 5 || dur > 600) fail(400, 'bad_service');
    const end = start + dur * 60e3;
    /* قواعد صاحب المحل: أقل وقت قبل الموعد (مع سماح 10 دقايق لو تأخر الزبون بتعبئة البيانات)، وكم يوم قدام، والاستراحة بين المواعيد */
    const notice = Math.min(Math.max(int(meta.notice) || 0, 0), 20160), ahead = Math.min(Math.max(int(meta.ahead) || 120, 1), 120), buf = Math.min(Math.max(int(meta.buffer) || 0, 0), 240) * 60e3;
    if (start < now() + Math.max(notice - 10, 5) * 60e3) fail(400, 'too_soon');
    if (start > now() + (ahead + 1) * 864e5) fail(400, 'bad_time');
    if (!checkHours(meta, start, end)) fail(400, 'outside');
    const busy = await c.query("select 1 from bookings where doc_id=$1 and status<>'cancelled' and starts < $3 and ends > $2 limit 1", [doc.id, start - buf, end + buf]);
    if (busy.rows[0]) fail(409, 'taken');
    const id = rid(12), code = String(crypto.randomInt(100000, 1000000));
    await c.query('insert into bookings(id,doc_id,service,starts,ends,name,phone,note,status,code_hash,created_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [id, doc.id, svc[0], start, end, name, phone, note, 'new', sha(code), now()]);
    await c.query('commit');
    notifyDoc(doc.id, { title: '📅 حجز جديد', body: `${name} · ${str(svc[1].name, 60)} · ${fmtTime(start, meta.tz)}`, url: SITE + 'mawid/', tag: 'booking-' + id }).catch(() => {});
    return { id, code, start, end };
  } catch (e) { await c.query('rollback').catch(() => {}); throw e; }
  finally { c.release(); }
});
function fmtTime(ms, tz) { try { return new Intl.DateTimeFormat('ar-SA-u-nu-latn-ca-gregory', { timeZone: str(tz, 60) || 'Asia/Riyadh', weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' }).format(new Date(ms)); } catch (e) { return new Date(ms).toISOString(); } }
route('GET', '/api/docs/:id/bookings', async (req, b, p, url) => {
  const doc = await loadDoc(p.id); if (roleOf(doc, url.searchParams.get('k')) !== 'edit') fail(403, 'bad_key');
  const r = await q('select id, service, starts, ends, name, phone, note, status, created_at from bookings where doc_id=$1 and starts > $2 order by starts limit 1000', [doc.id, now() - 30 * 864e5]);
  return { bookings: r.rows.map(x => ({ id: x.id, service: x.service, start: +x.starts, end: +x.ends, name: x.name, phone: x.phone, note: x.note, status: x.status, createdAt: +x.created_at })) };
});
route('PATCH', '/api/docs/:id/bookings/:bid', async (req, b, p) => {
  const doc = await loadDoc(p.id); if (roleOf(doc, b.k) !== 'edit') fail(403, 'bad_key');
  const st = str(b.status, 20); if (!['new', 'confirmed', 'done', 'cancelled', 'noshow'].includes(st)) fail(400, 'bad_status');
  const r = await q('update bookings set status=$1 where id=$2 and doc_id=$3', [st, str(p.bid, 40), doc.id]); if (!r.rowCount) fail(404, 'not_found');
  return { ok: true };
});
route('POST', '/api/bookings/:bid/cancel', async (req, b, p) => {
  limit(req, 'cancel', 20, 3600e3);
  const r = await q('select b.*, d.body from bookings b join docs d on d.id=b.doc_id where b.id=$1', [str(p.bid, 40)]); const x = r.rows[0];
  if (!x || !same(sha(str(b.code, 10)), x.code_hash)) fail(403, 'bad_code');
  if (x.status === 'cancelled') return { ok: true };
  await q("update bookings set status='cancelled' where id=$1", [x.id]);
  notifyDoc(x.doc_id, { title: '❌ انلغى حجز', body: `${x.name} لغى موعده: ${fmtTime(+x.starts, x.body && x.body.meta && x.body.meta.tz)}`, url: SITE + 'mawid/', tag: 'booking-' + x.id }).catch(() => {});
  return { ok: true };
});

/* ---------- تنبيهات المالك ---------- */
let VAPID = null;
async function vapid() {
  if (VAPID) return VAPID; let k = await kvGet('vapid'); if (!k) { k = webpush.generateVAPIDKeys(); await kvSet('vapid', k); }
  webpush.setVapidDetails(SITE.startsWith('https://') ? SITE : 'mailto:noreply@example.com', k.publicKey, k.privateKey); return (VAPID = k);
}
async function notifyDoc(docId, payload) {
  await vapid(); const subs = (await q('select endpoint, keys from doc_subs where doc_id=$1', [docId])).rows; let n = 0;
  for (const s of subs) {
    try { await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify(payload), { TTL: 6 * 3600 }); n++; }
    catch (e) { if (e.statusCode === 404 || e.statusCode === 410) await q('delete from doc_subs where endpoint=$1', [s.endpoint]); else console.error('push', e.statusCode || e.message); }
  }
  return n;
}
route('GET', '/api/push/key', async () => ({ key: (await vapid()).publicKey }));
route('POST', '/api/docs/:id/push', async (req, b, p) => {
  const doc = await loadDoc(p.id); if (roleOf(doc, b.k) !== 'edit') fail(403, 'bad_key');
  const s = b.sub || {}; if (!/^https:\/\//.test(s.endpoint || '') || !s.keys || !s.keys.p256dh || !s.keys.auth) fail(400, 'bad_sub');
  await q('insert into doc_subs(endpoint,doc_id,keys,created_at) values($1,$2,$3,$4) on conflict(endpoint,doc_id) do update set keys=excluded.keys', [str(s.endpoint, 1000), doc.id, JSON.stringify({ p256dh: str(s.keys.p256dh, 200), auth: str(s.keys.auth, 100) }), now()]);
  return { ok: true };
});
route('DELETE', '/api/docs/:id/push', async (req, b, p) => { const doc = await loadDoc(p.id); if (roleOf(doc, b.k) !== 'edit') fail(403, 'bad_key'); await q('delete from doc_subs where endpoint=$1 and doc_id=$2', [str(b.endpoint, 1000), doc.id]); return { ok: true }; });
route('POST', '/api/docs/:id/push/test', async (req, b, p) => { const doc = await loadDoc(p.id); if (roleOf(doc, b.k) !== 'edit') fail(403, 'bad_key'); limit(req, 'ptest', 10, 600e3); return { sent: await notifyDoc(doc.id, { title: '🔔 التنبيهات شغّالة', body: 'بيوصلك تنبيه أول ما يجيك حجز جديد.', url: SITE + 'mawid/', tag: 'test' }) }; });

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (req.method === 'OPTIONS') { res.writeHead(204, cors(origin)); return res.end(); }
  const url = new URL(req.url, 'http://x'); const r = routes.find(x => x.method === req.method && x.re.test(url.pathname));
  if (!r) return send(res, 404, { error: 'not_found' }, origin);
  try { const body = ['POST', 'PATCH', 'DELETE'].includes(req.method) ? await readBody(req) : {}; send(res, 200, await r.fn(req, body, r.re.exec(url.pathname).groups || {}, url), origin); }
  catch (e) { if (e instanceof HttpError) return send(res, e.status, { error: e.code }, origin); console.error(e); send(res, 500, { error: 'server' }, origin); }
});

async function cleanupTick() {
  try { await q('delete from docs where last_read < $1', [now() - 400 * 864e5]); await q('delete from bookings where starts < $1', [now() - 400 * 864e5]); } catch (e) { console.error('cleanup', e.message); }
}
process.on('unhandledRejection', e => console.error('unhandled', e));
async function start() {
  await migrate(); await vapid();
  server.listen(PORT, () => console.log('تجارب: السيرفر شغّال على المنفذ ' + PORT));
  setTimeout(cleanupTick, 60e3).unref(); setInterval(cleanupTick, 12 * 3600e3).unref();
}
if (require.main === module) start().catch(e => { console.error(e); process.exit(1); });
module.exports = { start, server, pool, checkHours };
