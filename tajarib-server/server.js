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
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL مو موجود. أضف قاعدة بيانات Postgres واربطها بالسيرفر.'); process.exit(1); }
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
    create table if not exists suggestions(id text primary key, doc_id text not null references docs(id) on delete cascade, body jsonb not null, by_name text not null default '', status text not null default 'new', created_at bigint not null);
    create index if not exists suggestions_doc on suggestions(doc_id, status, created_at);
    alter table doc_subs add column if not exists news boolean not null default true;
    alter table doc_subs add column if not exists occ boolean not null default false;
    alter table doc_subs add column if not exists role text not null default 'edit';
    alter table doc_subs add column if not exists wq boolean not null default false;
    create table if not exists branch_keys(id text primary key, doc_id text not null references docs(id) on delete cascade, hash text not null unique, key text not null, root text not null, label text not null default '', created_at bigint not null);
    create index if not exists branch_keys_doc on branch_keys(doc_id);
    alter table branch_keys add column if not exists can_edit boolean not null default false;
    create table if not exists doc_snaps(doc_id text not null references docs(id) on delete cascade, tag text not null, rev int not null, people int not null default 0, body jsonb not null, created_at bigint not null, primary key(doc_id, tag));
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
/* رابط فرع (شجرتنا): مفتاح عرض يشوف ذرية شخص واحد بس */
async function branchOf(doc, k, db) { if (!k || doc.kind !== 'shajara') return null; const r = await (db || pool).query('select id, root, can_edit from branch_keys where hash=$1 and doc_id=$2', [sha(String(k)), doc.id]); return r.rows[0] || null; }
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
  const doc = await loadDoc(p.id); let role = roleOf(doc, url.searchParams.get('k')), br = null;
  if (!role) { br = await branchOf(doc, url.searchParams.get('k')); if (br) role = br.can_edit ? 'edit' : 'view'; } if (!role) fail(403, 'bad_key');
  if (now() - +doc.last_read > 864e5) q('update docs set last_read=$1 where id=$2', [now(), doc.id]).catch(() => {});
  /* رابط العرض بشجرتنا: رقم نسخة خاص يتغيّر كمان يوم تنفتح رسالة، عشان توصله بنصها */
  const vb = role === 'view' && doc.kind === 'shajara', rev = vb ? doc.rev * 1000 + openedCaps(doc.body) % 1000 : doc.rev;
  const bx = br && br.can_edit ? { branch: true } : {};
  if (int(url.searchParams.get('rev')) === rev) return { same: true, rev, role, ...bx };
  return { rev, kind: doc.kind, role, ...bx, body: vb ? viewBody(br ? branchBody(doc.body, br.root) : doc.body) : br ? branchBody(doc.body, br.root) : doc.body };
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
    const doc = r.rows[0]; if (!doc) fail(404, 'not_found');
    let br = null; if (roleOf(doc, b.k) !== 'edit') { br = await branchOf(doc, b.k, c); if (!br || !br.can_edit) fail(403, 'bad_key'); }
    const body = cleanBody(doc.body); let changed = 0, rejected = 0, dels = 0; const born = [];
    const allow = br ? branchAllow(body, br.root, items) : null;
    /* نسخة يومية (شجرتنا): أول تعديل باليوم يحفظ الشجرة مثل ما كانت قبله */
    if (doc.kind === 'shajara' && Object.keys(items).length) await snapIfNeeded(c, doc, 'd:' + todayISO());
    /* حماية من الحذف الكبير: 10 أشخاص أو أكثر خلال 10 دقائق → نسخة قبل الحذف وتنبيه لأصحاب التعديل */
    let bigDel = 0;
    if (doc.kind === 'shajara') {
      for (const [id, it] of Object.entries(items)) { const cur = body.items[id]; if (isObj(it) && it.del && cur && cur.t === 'p' && !cur.del && +it.u >= +(cur.u || 0) && (!allow || allow.has(id))) dels++; }
      if (dels) { bigDel = trackDeletes(doc.id, dels); if (bigDel) await snapIfNeeded(c, doc, 'x:' + now(), true); }
    }
    for (const [id, it] of Object.entries(items)) {
      if (id.length > 80 || !isObj(it) || !Number.isFinite(+it.u)) continue;
      if (allow && !allow.has(id)) { rejected++; continue; }
      const cur = body.items[id];
      if (!cur && doc.kind === 'shajara' && it.t === 'p' && !it.del && it.f && !it.unk) born.push(it);
      if (!cur || +it.u >= +(cur.u || 0)) { body.items[id] = it; changed++; }
    }
    if (!br && meta && Number.isFinite(+meta.u) && (!body.meta || +meta.u >= +(body.meta.u || 0))) { body.meta = meta; changed++; }
    const cut = now() - 60 * 864e5;
    for (const [id, it] of Object.entries(body.items)) if (it && it.del && +it.u < cut) delete body.items[id];
    if (Object.keys(body.items).length > 20000) fail(413, 'too_big');
    const json = JSON.stringify(body); if (json.length > MAX_BODY) fail(413, 'too_big');
    let rev = doc.rev;
    if (changed) { rev = doc.rev + 1; await c.query('update docs set body=$1, rev=$2, updated_at=$3 where id=$4', [json, rev, now(), doc.id]); }
    await c.query('commit');
    if (born.length) birthNews(doc.id, body, born);
    if (bigDel) notifyDoc(doc.id, { title: '⚠️ انحذف ناس كثير من الشجرة', body: `انحذف ${bigDel} شخص من «${str((body.meta && body.meta.name) || 'شجرتنا', 60)}» خلال دقائق. إذا كان بالغلط، رجّعها من «المزيد» ← «النسخ اليومية بالسيرفر».`, url: SITE + 'shajara/', tag: 'del-' + doc.id }, 'edit').catch(() => {});
    return { rev, applied: changed, ...(rejected ? { rejected } : {}) };
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
    /* قواعد صاحب المحل: أقل وقت قبل الموعد (مع سماح 10 دقائق لو تأخر الزبون بتعبئة البيانات)، وكم يوم قدام، والاستراحة بين المواعيد */
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
/* who: news (الإضافات والحجوزات) أو occ (المناسبات) أو edit (أصحاب رابط التعديل بس) */
async function notifyDoc(docId, payload, who = 'news') {
  await vapid(); const cond = who === 'occ' ? 'occ' : who === 'wq' ? 'wq' : who === 'edit' ? "news and role='edit'" : 'news';
  const subs = (await q(`select endpoint, keys from doc_subs where doc_id=$1 and ${cond}`, [docId])).rows; let n = 0;
  for (const s of subs) {
    try { await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify(payload), { TTL: 6 * 3600 }); n++; }
    catch (e) { if (e.statusCode === 404 || e.statusCode === 410) await q('delete from doc_subs where endpoint=$1', [s.endpoint]); else console.error('push', e.statusCode || e.message); }
  }
  return n;
}
/* تنبيه شجرتنا: «انضاف للشجرة …» — نجمع الإضافات 20 ثانية ونرسل تنبيه واحد */
const bornQ = new Map();
function birthNews(docId, body, born) {
  const q0 = bornQ.get(docId) || { names: [], body }; q0.body = body;
  for (const it of born) { const fa0 = it.fa && body.items[it.fa], fa = fa0 && !fa0.unk ? fa0 : null; q0.names.push(str(it.f, 40) + (fa && fa.f ? (it.g === 'f' ? ' بنت ' : ' بن ') + str(fa.f, 40) : '')); }
  if (q0.t) { bornQ.set(docId, q0); return; }
  q0.t = setTimeout(() => {
    bornQ.delete(docId); const n = q0.names.length, tree = str((q0.body.meta && q0.body.meta.name) || 'شجرتنا', 60);
    const txt = n <= 3 ? 'انضاف للشجرة: ' + q0.names.join('، ') : `انضاف للشجرة ${n <= 10 ? n + ' أشخاص' : n + ' شخص'}، منهم ${q0.names.slice(0, 2).join('، ')}`;
    notifyDoc(docId, { title: '🌳 ' + tree, body: txt, url: SITE + 'shajara/', tag: 'born-' + docId }).catch(() => {});
  }, 20000);
  bornQ.set(docId, q0);
}
route('GET', '/api/push/key', async () => ({ key: (await vapid()).publicKey }));

/* ---------- اقتراحات (شجرتنا): اللي معه رابط العرض يقترح، وصاحب رابط التعديل يعتمد أو يرفض ---------- */
route('POST', '/api/docs/:id/suggest', async (req, b, p) => {
  limit(req, 'suggest', 20, 3600e3);
  const doc = await loadDoc(p.id); if (doc.kind !== 'shajara') fail(400, 'bad_kind'); if (!roleOf(doc, b.k) && !(await branchOf(doc, b.k))) fail(403, 'bad_key');
  const body = isObj(b.body) ? b.body : null; if (!body) fail(400, 'bad_body');
  const json = JSON.stringify(body); if (json.length > 300 * 1024) fail(413, 'too_big');
  const pend = await q("select count(*)::int as n from suggestions where doc_id=$1 and status='new'", [doc.id]); if (pend.rows[0].n >= 200) fail(429, 'rate');
  const id = rid(12), by = str(b.by, 60).trim();
  await q('insert into suggestions(id, doc_id, body, by_name, status, created_at) values($1,$2,$3,$4,$5,$6)', [id, doc.id, json, by, 'new', now()]);
  /* تاريخ مخفي: اللي اقترح يشوفه كأنه انقبل عنده بس، وصاحب الشجرة يجيه تذكير */
  const items = (doc.body && doc.body.items) || {}, cos = (Array.isArray(body.fixes) ? body.fixes : []).filter(x => x && items[x.p] && isHid(items[x.p], doc.body.meta && doc.body.meta.hdr) && x.set && ['by', 'dy'].some(k => k in x.set)).map(x => str(x.p, 40));
  const names = cos.map(pid => str(items[pid].f, 40)).join(' و');
  notifyDoc(doc.id, cos.length ? { title: '🙈 تذكير: التاريخ مخفي', body: `${by || 'واحد من العائلة'} اقترح تاريخ لـ${names}، وأنت مخفي تاريخ${cos.length > 1 ? 'هم' : items[cos[0]].g === 'f' ? 'ها' : 'ه'}. اقتراحه يبان عنده كأنه انقبل، وما تغيّر شي عند الباقين`, url: SITE + 'shajara/', tag: 'sugg-' + id }
    : { title: '✍️ اقتراح جديد للشجرة', body: (by ? by + ' ' : '') + 'اقترح إضافة على الشجرة', url: SITE + 'shajara/', tag: 'sugg-' + id }, 'edit').catch(() => {});
  return { id, cos };
});
route('GET', '/api/docs/:id/suggest', async (req, b, p, url) => {
  limit(req, 'read', 3000, 600e3);
  const doc = await loadDoc(p.id); if (roleOf(doc, url.searchParams.get('k')) !== 'edit') fail(403, 'bad_key');
  const r = await q("select id, body, by_name, created_at from suggestions where doc_id=$1 and status='new' order by created_at limit 200", [doc.id]);
  return { suggestions: r.rows.map(x => ({ id: x.id, body: x.body, by: x.by_name, createdAt: +x.created_at })) };
});
route('POST', '/api/docs/:id/suggest/:sid', async (req, b, p) => {
  const doc = await loadDoc(p.id); if (roleOf(doc, b.k) !== 'edit') fail(403, 'bad_key');
  const st = str(b.status, 20); if (!['accepted', 'rejected'].includes(st)) fail(400, 'bad_status');
  const r = await q('update suggestions set status=$1 where id=$2 and doc_id=$3', [st, str(p.sid, 40), doc.id]); if (!r.rowCount) fail(404, 'not_found');
  return { ok: true };
});
/* التنبيهات: صاحب رابط التعديل، أو أي أحد معه رابط شجرتنا (عشان تنبيه المواليد للعائلة) */
const canSub = (doc, k) => { const r = roleOf(doc, k); return r === 'edit' || (r === 'view' && doc.kind === 'shajara'); };
route('POST', '/api/docs/:id/push', async (req, b, p) => {
  const doc = await loadDoc(p.id); if (!canSub(doc, b.k)) { if (await branchOf(doc, b.k)) fail(403, 'branch_push'); fail(403, 'bad_key'); }
  const s = b.sub || {}; if (!/^https:\/\//.test(s.endpoint || '') || !s.keys || !s.keys.p256dh || !s.keys.auth) fail(400, 'bad_sub');
  const o = isObj(b.opts) ? b.opts : null, news = o && typeof o.news === 'boolean' ? o.news : true, occ = !!(o && o.occ === true && doc.kind === 'shajara'), wq = !!(o && o.wq === true && doc.kind === 'shajara');
  if (o && !news && !occ && !wq) { await q('delete from doc_subs where endpoint=$1 and doc_id=$2', [str(s.endpoint, 1000), doc.id]); return { ok: true, off: true }; }
  await q(`insert into doc_subs(endpoint,doc_id,keys,created_at,news,occ,role,wq) values($1,$2,$3,$4,$5,$6,$7,$8) on conflict(endpoint,doc_id) do update set keys=excluded.keys, role=excluded.role${o ? ', news=excluded.news, occ=excluded.occ, wq=excluded.wq' : ''}`,
    [str(s.endpoint, 1000), doc.id, JSON.stringify({ p256dh: str(s.keys.p256dh, 200), auth: str(s.keys.auth, 100) }), now(), news, occ, roleOf(doc, b.k), wq]);
  return { ok: true };
});
route('DELETE', '/api/docs/:id/push', async (req, b, p) => { const doc = await loadDoc(p.id); if (!canSub(doc, b.k)) fail(403, 'bad_key'); await q('delete from doc_subs where endpoint=$1 and doc_id=$2', [str(b.endpoint, 1000), doc.id]); return { ok: true }; });
route('POST', '/api/docs/:id/push/test', async (req, b, p) => { const doc = await loadDoc(p.id); if (roleOf(doc, b.k) !== 'edit') fail(403, 'bad_key'); limit(req, 'ptest', 10, 600e3); return { sent: await notifyDoc(doc.id, { title: '🔔 التنبيهات شغّالة', body: 'بيوصلك تنبيه أول ما يجيك حجز جديد.', url: SITE + 'mawid/', tag: 'test' }) }; });

/* شجرتنا لأصحاب رابط العرض: التواريخ المخفية ما توصلهم أبد (ولا علامة إنها مخفية)، والرسائل المقفلة توصل بدون نصها */
const DATE_KEYS = ['by', 'bmo', 'bda', 'dy', 'dmo', 'dda', 'hd'];
/* مخفي: hd=1 لشخص بعينه، أو قاعدة عامة (meta.hdr) إلا إذا كان مستثنى (hd=-1) */
function isHid(it, rule) {
  if (!it || it.t !== 'p') return false; if (+it.hd === 1) return true; if (+it.hd === -1) return false;
  const alive = !(it.dead || it.dy), f = it.g === 'f';
  return rule === 'all' || (rule === 'alive' && alive) || (rule === 'women' && f) || (rule === 'wa' && f && alive);
}
const todayISO = () => { const g = ymd('g'); return `${g.y}-${String(g.m).padStart(2, '0')}-${String(g.d).padStart(2, '0')}`; };
function openedCaps(body) { const t = todayISO(); let n = 0; for (const it of Object.values((body && body.items) || {})) if (it && it.t === 'cap' && !it.del && it.open && it.open <= t) n++; return n; }
function viewBody(body) {
  const items = (body && body.items) || {}, out = {}, today = todayISO(), rule = body && body.meta && body.meta.hdr;
  for (const [id, it] of Object.entries(items)) {
    if (it && it.t === 'p') { const c = { ...it }; if (isHid(it, rule)) for (const k of DATE_KEYS) delete c[k]; else delete c.hd; delete c.tel; out[id] = c; }
    else if (it && it.t === 'cap' && it.open > today) { const c = { ...it }; delete c.txt; out[id] = c; }
    else if (it && it.t === 'doc' && !it.pub) continue;
    else out[id] = it;
  }
  let meta = body && body.meta; if (meta && 'hdr' in meta) { meta = { ...meta }; delete meta.hdr; }
  return { ...body, meta, items: out };
}

/* ---------- النسخ اليومية والحماية من الحذف ---------- */
async function snapIfNeeded(c, doc, tag, force) {
  if (!force) { const e = await c.query('select 1 from doc_snaps where doc_id=$1 and tag=$2', [doc.id, tag]); if (e.rows[0]) return; }
  const people = Object.values((doc.body && doc.body.items) || {}).filter(x => x && x.t === 'p' && !x.del).length;
  await c.query('insert into doc_snaps(doc_id,tag,rev,people,body,created_at) values($1,$2,$3,$4,$5,$6) on conflict(doc_id,tag) do nothing', [doc.id, tag, doc.rev, people, JSON.stringify(doc.body), now()]);
  await c.query(`delete from doc_snaps where doc_id=$1 and (created_at < $2 or tag in (select tag from doc_snaps where doc_id=$1 order by created_at desc offset 45))`, [doc.id, now() - 31 * 864e5]);
}
const delLog = new Map();
function trackDeletes(docId, n) {
  const t = now(), o = delLog.get(docId) || { l: [], at: 0 }; o.l = o.l.filter(x => t - x.t < 600e3); o.l.push({ t, n }); delLog.set(docId, o);
  const sum = o.l.reduce((s2, x) => s2 + x.n, 0); if (sum < 10 || t - o.at < 600e3) return 0; o.at = t; return sum;
}
route('GET', '/api/docs/:id/snaps', async (req, b, p, url) => {
  const doc = await loadDoc(p.id); if (roleOf(doc, url.searchParams.get('k')) !== 'edit') fail(403, 'bad_key');
  const r = await q('select tag, rev, people, created_at, length(body::text) as size from doc_snaps where doc_id=$1 order by created_at desc limit 45', [doc.id]);
  return { snaps: r.rows.map(x => ({ tag: x.tag, rev: x.rev, people: x.people, size: +x.size, createdAt: +x.created_at })) };
});
route('POST', '/api/docs/:id/restore', async (req, b, p) => {
  limit(req, 'restore', 20, 3600e3);
  const c = await pool.connect();
  try {
    await c.query('begin');
    const doc = (await c.query('select * from docs where id=$1 for update', [str(p.id, 40)])).rows[0]; if (!doc) fail(404, 'not_found'); if (roleOf(doc, b.k) !== 'edit') fail(403, 'bad_key');
    const sn = (await c.query('select body from doc_snaps where doc_id=$1 and tag=$2', [doc.id, str(b.tag, 40)])).rows[0]; if (!sn) fail(404, 'not_found');
    await snapIfNeeded(c, doc, 'r:' + now(), true);
    /* نرجّعها بوقت جديد لكل عنصر عشان تغلب أي نسخة أقدم عند الأجهزة، والعناصر الجديدة تنحذف بعلامة */
    const t = now(), old = cleanBody(sn.body), cur = cleanBody(doc.body), items = {};
    for (const [id, it] of Object.entries(old.items)) if (it) items[id] = { ...it, u: t };
    for (const [id, it] of Object.entries(cur.items)) if (it && !it.del && !(id in old.items)) items[id] = { del: 1, u: t };
    const body = { items, meta: old.meta ? { ...old.meta, u: t } : cur.meta }, rev = doc.rev + 1;
    await c.query('update docs set body=$1, rev=$2, updated_at=$3 where id=$4', [JSON.stringify(body), rev, t, doc.id]);
    await c.query('commit'); return { rev };
  } catch (e) { await c.query('rollback').catch(() => {}); throw e; } finally { c.release(); }
});

/* رابط تعديل لفرع: يقدر يعدّل الشخص وذريته وأزواجهم وكل اللي يخصهم بس */
function branchAllow(body, root, incoming) {
  const items = body.items, P = new Map(); for (const [id, it] of Object.entries(items)) if (it && !it.del && it.t === 'p') P.set(id, it);
  const kids = new Map(); for (const [id, it] of P) for (const par of [it.fa, it.mo]) if (par) { if (!kids.has(par)) kids.set(par, []); kids.get(par).push(id); }
  const blood = new Set(), st = P.has(root) ? [root] : [];
  while (st.length) { const x = st.pop(); if (blood.has(x)) continue; blood.add(x); for (const k of kids.get(x) || []) st.push(k); }
  const inc = new Set(blood); for (const it of Object.values(items)) if (it && !it.del && it.t === 'm') { if (blood.has(it.a)) inc.add(it.b); if (blood.has(it.b)) inc.add(it.a); }
  const N = Object.entries(incoming).filter(([, it]) => isObj(it)), newP = new Map(N.filter(([id, it]) => it.t === 'p' && !it.del && !P.has(id)));
  /* أشخاص جدد: عيال (أبوهم أو أمهم من الدم) أو أزواج (زواج جديد مع واحد من الدم) */
  let grew = true; while (grew) { grew = false; for (const [id, it] of newP) if (!blood.has(id) && (blood.has(it.fa) || blood.has(it.mo))) { blood.add(id); inc.add(id); grew = true; } }
  for (const [, it] of N) if (it.t === 'm' && !it.del) { if (blood.has(it.a) && newP.has(it.b)) inc.add(it.b); if (blood.has(it.b) && newP.has(it.a)) inc.add(it.a); }
  const inS = x => !x || inc.has(x), evOk = new Set();
  for (const [id, it] of [...Object.entries(items), ...N]) if (it && it.t === 'ev' && Array.isArray(it.people) && it.people.length && it.people.every(x => inc.has(x))) evOk.add(id);
  const scope = it => {
    if (!it) return false; switch (it.t) {
      case 'm': return blood.has(it.a) || blood.has(it.b);
      case 'rs': return inc.has(it.a) && inc.has(it.b);
      case 'r': return inc.has(it.c) && inS(it.m) && inS(it.f);
      case 'mem': case 'ph': case 'au': case 'doc': case 'lk': return inc.has(it.p);
      case 'cap': return !!it.to && inc.has(it.to);
      case 'ev': return Array.isArray(it.people) && it.people.length > 0 && it.people.every(x => inc.has(x));
      case 'evp': return evOk.has(it.ev);
      default: return false;
    }
  };
  const ok = new Set();
  for (const [id, it] of N) {
    const cur = items[id] && !items[id].del ? items[id] : null;
    if (it.del) { if (cur && id !== root && (cur.t === 'p' ? inc.has(id) : scope(cur))) ok.add(id); continue; }
    if (it.t === 'p') {
      if (cur) { if (!inc.has(id)) continue; const same = k => (it[k] || '') === (cur[k] || ''); if (id === root || !blood.has(id)) { if (!same('fa') || !same('mo')) continue; } else if (!(same('fa') || inS(it.fa)) || !(same('mo') || inS(it.mo))) continue; ok.add(id); }
      else if (inc.has(id)) ok.add(id);
      continue;
    }
    if (scope(it) && (!cur || scope(cur))) ok.add(id);
  }
  return ok;
}

/* ذرية شخص + أزواجهم، وكل اللي يخصهم بس (الباقي ما يوصل أبد) */
function branchBody(body, root) {
  const items = (body && body.items) || {}, P = new Map();
  for (const [id, it] of Object.entries(items)) if (it && !it.del && it.t === 'p') P.set(id, it);
  const kids = new Map(); for (const [id, it] of P) for (const par of [it.fa, it.mo]) if (par) { if (!kids.has(par)) kids.set(par, []); kids.get(par).push(id); }
  const blood = new Set(), st = P.has(root) ? [root] : [];
  while (st.length) { const x = st.pop(); if (blood.has(x)) continue; blood.add(x); for (const k of kids.get(x) || []) st.push(k); }
  const inc = new Set(blood);
  for (const it of Object.values(items)) if (it && !it.del && it.t === 'm') { if (blood.has(it.a) && P.has(it.b)) inc.add(it.b); if (blood.has(it.b) && P.has(it.a)) inc.add(it.a); }
  const ok = (...ids) => ids.every(x => !x || inc.has(x)), out = {};
  for (const [id, it] of Object.entries(items)) {
    if (!it || it.del) continue; const t = it.t;
    if (t === 'p') { if (inc.has(id)) out[id] = it; }
    else if (t === 'm' || t === 'rs') { if (inc.has(it.a) && inc.has(it.b)) out[id] = it; }
    else if (t === 'r') { if (inc.has(it.c) && ok(it.m, it.f)) out[id] = it; }
    else if (t === 'mem' || t === 'ph' || t === 'au' || t === 'doc' || t === 'lk') { if (inc.has(it.p)) out[id] = it; }
    else if (t === 'cap') { if (it.to && inc.has(it.to)) out[id] = it; }
    else if (t === 'ev') { const ps = (it.people || []).filter(x => inc.has(x)); if (ps.length) out[id] = { ...it, people: ps }; }
  }
  for (const [id, it] of Object.entries(items)) if (it && !it.del && it.t === 'evp' && out[it.ev]) out[id] = it;
  const rp = P.get(root), meta = { ...(body.meta || {}) }; if (rp) meta.name = `${str(meta.name || 'شجرتنا', 60)} · فرع ${str(rp.f, 30)}`; delete meta.vk;
  return { meta, items: out };
}
route('POST', '/api/docs/:id/branch', async (req, b, p) => {
  limit(req, 'branch', 60, 3600e3);
  const doc = await loadDoc(p.id); if (roleOf(doc, b.k) !== 'edit') fail(403, 'bad_key'); if (doc.kind !== 'shajara') fail(400, 'bad_kind');
  const root = str(b.root, 80), it = doc.body && doc.body.items && doc.body.items[root]; if (!it || it.del || it.t !== 'p') fail(400, 'bad_body');
  const n = await q('select count(*)::int as n from branch_keys where doc_id=$1', [doc.id]); if (n.rows[0].n >= 60) fail(429, 'rate');
  const id = rid(10), key = rid(20); await q('insert into branch_keys(id,doc_id,hash,key,root,label,created_at,can_edit) values($1,$2,$3,$4,$5,$6,$7,$8)', [id, doc.id, sha(key), key, root, str(b.label, 80), now(), b.edit === true]);
  return { id, key };
});
route('GET', '/api/docs/:id/branch', async (req, b, p, url) => {
  const doc = await loadDoc(p.id); if (roleOf(doc, url.searchParams.get('k')) !== 'edit') fail(403, 'bad_key');
  const r = await q('select id, key, root, label, created_at, can_edit from branch_keys where doc_id=$1 order by created_at desc', [doc.id]);
  return { branches: r.rows.map(x => ({ id: x.id, key: x.key, root: x.root, label: x.label, edit: x.can_edit, createdAt: +x.created_at })) };
});
route('DELETE', '/api/docs/:id/branch/:bid', async (req, b, p) => {
  const doc = await loadDoc(p.id); if (roleOf(doc, b.k) !== 'edit') fail(403, 'bad_key');
  await q('delete from branch_keys where id=$1 and doc_id=$2', [str(p.bid, 40), doc.id]); return { ok: true };
});

/* ---------- غرف «مين هذا؟» الجماعية (بالذاكرة، تنمسح بعد 4 ساعات) ---------- */
const rooms = new Map(), QDUR = 20000;
const roomCode = () => { let c, n = 0; do c = String(1000 + crypto.randomInt(9000)); while (rooms.has(c) && n++ < 50); return c; };
function getRoom(code) { const r = rooms.get(str(code, 8)); if (!r) fail(404, 'not_found'); return r; }
function roomTick(r) { if (r.state === 'q' && (now() > r.ends || (r.players.size && [...r.players.values()].every(p => p.ans[r.qi])))) r.state = 'r'; }
route('POST', '/api/rooms', async (req, b) => {
  limit(req, 'room-new', 30, 3600e3);
  const qs = Array.isArray(b.qs) ? b.qs.slice(0, 20).map(x => ({ q: str(x && x.q, 200), o: Array.isArray(x && x.o) ? x.o.slice(0, 4).map(t => str(t, 60)) : [], a: int(x && x.a) })).filter(x => x.q && x.o.length >= 2 && x.a >= 0 && x.a < x.o.length) : [];
  if (!qs.length) fail(400, 'bad_body');
  if (rooms.size >= 400) { const old = [...rooms.entries()].sort((x, y) => x[1].t - y[1].t)[0]; rooms.delete(old[0]); }
  const code = roomCode(), host = rid(16); rooms.set(code, { code, host, qs, players: new Map(), state: 'lobby', qi: -1, ends: 0, t: now() });
  return { code, host };
});
route('GET', '/api/rooms/:code', async (req, b, p, url) => {
  limit(req, 'room', 40000, 600e3);
  const r = getRoom(p.code); roomTick(r); const q = r.qs[r.qi], pid = url.searchParams.get('p'), me = pid && r.players.get(pid);
  const players = [...r.players.values()].map(x => ({ name: x.name, score: x.score, got: r.state === 'r' || r.state === 'end' ? !!(x.ans[r.qi] && x.ans[r.qi].ok) : undefined })).sort((x, y) => y.score - x.score);
  const out = { state: r.state, qi: r.qi, n: r.qs.length, left: r.state === 'q' ? Math.max(0, r.ends - now()) : 0, players, answered: q ? [...r.players.values()].filter(x => x.ans[r.qi]).length : 0 };
  if (q && (r.state === 'q' || r.state === 'r')) out.q = { q: q.q, o: q.o };
  if (q && r.state === 'r') out.a = q.a;
  if (me) { const a = me.ans[r.qi]; out.me = { score: me.score, ans: a ? a.k : null, ok: r.state === 'r' && a ? a.ok : undefined, pts: r.state === 'r' && a ? a.pts : 0, rank: players.findIndex(x => x.name === me.name) + 1 }; }
  return out;
});
route('POST', '/api/rooms/:code/join', async (req, b, p) => {
  limit(req, 'room-join', 200, 600e3);
  const r = getRoom(p.code); if (r.state === 'end') fail(409, 'ended'); if (r.players.size >= 40) fail(429, 'full');
  let name = str(b.name, 24).trim() || 'لاعب'; const taken = new Set([...r.players.values()].map(x => x.name)); let i = 2, base = name; while (taken.has(name)) name = base + ' ' + i++;
  const pid = rid(10), tok = rid(16); r.players.set(pid, { name, tok, score: 0, ans: {} }); return { pid, tok, name };
});
route('POST', '/api/rooms/:code/answer', async (req, b, p) => {
  const r = getRoom(p.code), pl = r.players.get(str(b.pid, 20)); if (!pl || !same(sha(pl.tok), sha(str(b.tok, 40)))) fail(403, 'bad_key');
  roomTick(r); if (r.state !== 'q' || int(b.qi) !== r.qi) fail(409, 'late'); if (pl.ans[r.qi]) fail(409, 'done');
  const k = int(b.k), q = r.qs[r.qi]; if (!(k >= 0 && k < q.o.length)) fail(400, 'bad_body');
  const ok = k === q.a, pts = ok ? 500 + Math.round(500 * Math.max(0, r.ends - now()) / QDUR) : 0; pl.ans[r.qi] = { k, ok, pts }; pl.score += pts; roomTick(r);
  return { ok: true };
});
route('POST', '/api/rooms/:code/next', async (req, b, p) => {
  const r = getRoom(p.code); if (!same(sha(r.host), sha(str(b.host, 40)))) fail(403, 'bad_key'); roomTick(r);
  if (r.state === 'q') r.state = 'r';
  else if (r.state === 'lobby' || r.state === 'r') { r.qi++; if (r.qi >= r.qs.length) { r.state = 'end'; r.qi = r.qs.length - 1; } else { r.state = 'q'; r.ends = now() + QDUR; } }
  return { state: r.state, qi: r.qi };
});
setInterval(() => { const t = now(); for (const [c, r] of rooms) if (t - r.t > 4 * 3600e3) rooms.delete(c); }, 600e3).unref();

/* ---------- مناسبات شجرتنا: كل يوم الساعة 9 الصبح بتوقيت الرياض ---------- */
function ymd(cal, d = new Date()) {
  const f = new Intl.DateTimeFormat(cal === 'h' ? 'en-u-ca-islamic-umalqura-nu-latn' : 'en-u-nu-latn', { timeZone: 'Asia/Riyadh', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(d);
  const g = t => parseInt((f.find(x => x.type === t) || {}).value, 10); return { y: g('year'), m: g('month'), d: g('day') };
}
function occasionsToday(body, d = new Date()) {
  const items = (body && body.items) || {}, rule = body && body.meta && body.meta.hdr, T = { h: ymd('h', d), g: ymd('g', d) }, born = [], died = [];
  for (const it of Object.values(items)) {
    if (!it || it.del || it.t !== 'p' || !it.f || isHid(it, rule)) continue; const t = T[it.cal === 'g' ? 'g' : 'h'];
    const fa = it.fa && items[it.fa] && !items[it.fa].del ? items[it.fa] : null, nm = str(it.f, 40) + (fa && fa.f ? (it.g === 'f' ? ' بنت ' : ' بن ') + str(fa.f, 40) : '');
    if (!it.dead && !it.dy && +it.bmo === t.m && +it.bda === t.d) born.push({ nm, age: +it.by > 0 ? t.y - it.by : 0 });
    if ((it.dead || it.dy) && +it.dmo === t.m && +it.dda === t.d) died.push({ nm, f: it.g === 'f', n: +it.dy > 0 ? t.y - it.dy : 0 });
  }
  const today = `${T.g.y}-${String(T.g.m).padStart(2, '0')}-${String(T.g.d).padStart(2, '0')}`, caps = [];
  for (const it of Object.values(items)) if (it && !it.del && it.t === 'cap' && it.open === today) { const to = it.to && items[it.to] && !items[it.to].del ? str(items[it.to].f, 40) : ''; caps.push({ to, from: str(it.from, 40) }); }
  return { born, died, caps };
}
function occasionText(o) {
  const L = [], join = a => a.length <= 3 ? a.join(' و') : a.slice(0, 3).join('، ') + ` و${a.length - 3} غيرهم`;
  if (o.born.length) L.push('🎂 اليوم عيد ميلاد ' + join(o.born.map(x => x.nm + (x.age > 0 && x.age < 130 ? ` (${x.age})` : ''))));
  if (o.died.length) L.push('🤲 اليوم ذكرى وفاة ' + join(o.died.map(x => x.nm)) + '، ' + (o.died.length > 1 ? 'الله يرحمهم' : o.died[0].f ? 'الله يرحمها' : 'الله يرحمه'));
  for (const c of o.caps || []) L.push('💌 انفتحت اليوم رسالة' + (c.to ? ' لـ' + c.to : ' للعائلة') + (c.from ? ' من ' + c.from : ''));
  return L.join('\n');
}
async function occasionTick(force) {
  try {
    const d = new Date(), hr = parseInt(new Intl.DateTimeFormat('en-u-nu-latn', { timeZone: 'Asia/Riyadh', hour: 'numeric', hourCycle: 'h23' }).format(d), 10), g = ymd('g', d), day = `${g.y}-${g.m}-${g.d}`;
    if (!force) { if (hr < 9) return 0; if ((await kvGet('occ_day')) === day) return 0; await kvSet('occ_day', day); }
    const docs = (await q("select d.id, d.body from docs d where d.kind='shajara' and exists(select 1 from doc_subs s where s.doc_id=d.id and s.occ)")).rows; let sent = 0;
    for (const doc of docs) {
      const txt = occasionText(occasionsToday(doc.body, d)); if (!txt) continue;
      const tree = str((doc.body.meta && doc.body.meta.name) || 'شجرتنا', 60);
      sent += await notifyDoc(doc.id, { title: '🌳 ' + tree, body: txt, url: SITE + 'shajara/#occ', tag: 'occ-' + doc.id + '-' + day }, 'occ');
    }
    return sent;
  } catch (e) { console.error('occ', e.message); return 0; }
}

/* ---------- سؤال الأسبوع: كل جمعة الساعة 4 العصر بتوقيت الرياض ---------- */
const mulberry = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
function weeklyQuestion(body, seed) {
  const items = (body && body.items) || {}, P = new Map(); for (const [id, it] of Object.entries(items)) if (it && !it.del && it.t === 'p' && it.f && !it.unk) P.set(id, it);
  if (P.size < 5) return null;
  const rnd = mulberry(seed), mix = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const nm = id => { const p = P.get(id), fa = p.fa && P.get(p.fa); return str(p.f, 30) + (fa ? (p.g === 'f' ? ' بنت ' : ' بن ') + str(fa.f, 30) : ''); };
  const sp = new Map(); for (const it of Object.values(items)) if (it && !it.del && it.t === 'm' && !it.x && P.has(it.a) && P.has(it.b)) { for (const [x, y] of [[it.a, it.b], [it.b, it.a]]) { if (!sp.has(x)) sp.set(x, []); sp.get(x).push(y); } }
  const ids = [...P.keys()], byG = g => ids.filter(x => (P.get(x).g === 'f') === (g === 'f')), c = [];
  for (const id of ids) {
    const p = P.get(id), f = p.g === 'f';
    if (p.mo && P.has(p.mo)) c.push({ q: `مين أم ${nm(id)}؟`, a: p.mo, g: 'f' });
    const fa = p.fa && P.get(p.fa); if (fa && fa.fa && P.has(fa.fa)) c.push({ q: `مين جد ${nm(id)} (أبو ${f ? 'أبوها' : 'أبوه'})؟`, a: fa.fa, g: 'm' });
    const s = sp.get(id) || []; if (s.length === 1) c.push({ q: `مين ${f ? 'زوج' : 'زوجة'} ${nm(id)}؟`, a: s[0], g: f ? 'm' : 'f' });
  }
  for (const x of mix(c)) {
    const right = nm(x.a), seen = new Set([right]), wrong = [];
    for (const y of mix(byG(x.g).slice())) { if (wrong.length >= 3) break; const t = nm(y); if (y === x.a || seen.has(t)) continue; seen.add(t); wrong.push(t); }
    if (wrong.length < 2) continue; const o = mix([right, ...wrong]); return { q: x.q, o, a: o.indexOf(right) };
  }
  return null;
}
async function weeklyTick(force) {
  try {
    const d = new Date(), wd = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Riyadh', weekday: 'short' }).format(d), hr = parseInt(new Intl.DateTimeFormat('en-u-nu-latn', { timeZone: 'Asia/Riyadh', hour: 'numeric', hourCycle: 'h23' }).format(d), 10), wk = todayISO();
    if (!force) { if (wd !== 'Fri' || hr < 16) return 0; if ((await kvGet('wq_week')) === wk) return 0; await kvSet('wq_week', wk); }
    const docs = (await q("select d.id, d.body from docs d where d.kind='shajara' and exists(select 1 from doc_subs s where s.doc_id=d.id and s.wq)")).rows; let sent = 0;
    for (const doc of docs) {
      const seed = parseInt(sha(doc.id + wk).slice(0, 8), 16), qq = weeklyQuestion(viewBody(doc.body), seed); if (!qq) continue;
      sent += await notifyDoc(doc.id, { title: '🎯 سؤال الأسبوع', body: qq.q + ' افتح الشجرة وجاوب', url: SITE + 'shajara/#wq=' + encodeURIComponent(JSON.stringify(qq)), tag: 'wq-' + doc.id + '-' + wk }, 'wq');
    }
    return sent;
  } catch (e) { console.error('wq', e.message); return 0; }
}

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
  setTimeout(occasionTick, 90e3).unref(); setInterval(occasionTick, 10 * 60e3).unref();
  setTimeout(weeklyTick, 120e3).unref(); setInterval(weeklyTick, 10 * 60e3).unref();
}
if (require.main === module) start().catch(e => { console.error(e); process.exit(1); });
module.exports = { start, server, pool, checkHours, occasionsToday, occasionText, occasionTick, branchBody, branchAllow, weeklyQuestion, weeklyTick };
