'use strict';
/*
  سيرفر أنميتي
  - حسابات (اسم مستخدم + كلمة سر + رمز استرجاع)
  - مزامنة القائمة بين الأجهزة
  - تنبيهات Web Push لما تنزل حلقة، وتذكير السهرات
  - الشلة المباشرة (برمز صداقة) والسهرات
  يحتاج: DATABASE_URL (Postgres). اختياري: PORT, ALLOW_ORIGINS, APP_URL, PGSSL, ANILIST_URL
*/
const http = require('node:http');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { Pool } = require('pg');
const webpush = require('web-push');

const PORT = +process.env.PORT || 8080;
const ORIGINS = (process.env.ALLOW_ORIGINS || 'https://ilo0ol.github.io').split(',').map(s => s.trim()).filter(Boolean);
const APP_URL = process.env.APP_URL || 'https://ilo0ol.github.io/experiments/anime/';
const ANILIST = process.env.ANILIST_URL || 'https://graphql.anilist.co';
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL مو موجود. ضيف قاعدة بيانات Postgres واربطها بالسيرفر.'); process.exit(1); }
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === '1' ? { rejectUnauthorized: false } : undefined, max: 10 });
const q = (text, params) => pool.query(text, params);
const now = () => Date.now();
const scrypt = promisify(crypto.scrypt);

/* ---------- قاعدة البيانات ---------- */
async function migrate() {
  await q(`
    create table if not exists users(id serial primary key, username text unique not null, name text not null default '', pass_hash text not null, recovery_hash text not null, friend_code text unique not null, created_at bigint not null);
    create table if not exists sessions(token_hash text primary key, user_id int not null references users(id) on delete cascade, created_at bigint not null, last_seen bigint not null);
    create table if not exists data(user_id int primary key references users(id) on delete cascade, rev int not null default 0, body jsonb not null, updated_at bigint not null);
    create table if not exists follows(user_id int not null references users(id) on delete cascade, friend_id int not null references users(id) on delete cascade, created_at bigint not null, primary key(user_id, friend_id));
    create table if not exists push_subs(endpoint text primary key, user_id int not null references users(id) on delete cascade, keys jsonb not null, created_at bigint not null);
    create table if not exists notified(user_id int not null, media_id int not null, episode int not null, at bigint not null, primary key(user_id, media_id, episode));
    create table if not exists parties(id serial primary key, owner_id int not null references users(id) on delete cascade, media_id int not null, media jsonb not null, episode int, starts_at bigint not null, note text not null default '', created_at bigint not null, reminded boolean not null default false);
    create table if not exists party_members(party_id int not null references parties(id) on delete cascade, user_id int not null references users(id) on delete cascade, going smallint not null default 0, primary key(party_id, user_id));
    create table if not exists kv(k text primary key, v jsonb not null);
  `);
}
async function kvGet(k) { const r = await q('select v from kv where k=$1', [k]); return r.rows[0] ? r.rows[0].v : null; }
async function kvSet(k, v) { await q('insert into kv(k,v) values($1,$2) on conflict(k) do update set v=excluded.v', [k, JSON.stringify(v)]); }

/* ---------- أدوات ---------- */
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const token = () => crypto.randomBytes(32).toString('base64url');
const CODE_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const code = (n = 8) => Array.from(crypto.randomBytes(n), b => CODE_ABC[b % CODE_ABC.length]).join('');
const recoveryCode = () => [code(4), code(4), code(4)].join('-');
async function hashPw(pw) { const salt = crypto.randomBytes(16); const h = await scrypt(pw, salt, 64); return 's1$' + salt.toString('base64') + '$' + h.toString('base64'); }
async function checkPw(pw, stored) {
  try { const [v, s, h] = String(stored).split('$'); if (v !== 's1') return false; const want = Buffer.from(h, 'base64'); const got = await scrypt(pw, Buffer.from(s, 'base64'), 64); return want.length === got.length && crypto.timingSafeEqual(want, got); } catch (e) { return false; }
}
const str = (x, n = 300) => typeof x === 'string' ? x.slice(0, n) : '';
const int = x => Number.isFinite(+x) ? Math.floor(+x) : null;
const cleanName = s => str(s, 30).replace(/[\u0000-\u001f<>]/g, '').trim();
const userOut = u => ({ id: u.id, username: u.username, name: u.name || u.username, code: u.friend_code });
class HttpError extends Error { constructor(status, code) { super(code); this.status = status; this.code = code; } }
const fail = (status, c) => { throw new HttpError(status, c); };

/* حد بسيط للمحاولات (لكل IP) */
const hits = new Map();
function limit(req, key, max, windowMs) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const k = key + '|' + ip, t = now(); const arr = (hits.get(k) || []).filter(x => t - x < windowMs);
  if (arr.length >= max) fail(429, 'rate'); arr.push(t); hits.set(k, arr);
}
setInterval(() => { const t = now(); for (const [k, a] of hits) if (!a.some(x => t - x < 3600e3)) hits.delete(k); }, 600e3).unref();

/* ---------- HTTP ---------- */
function cors(origin) {
  if (origin && ORIGINS.includes(origin)) return { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS', 'Access-Control-Max-Age': '600' };
  return { 'Vary': 'Origin' };
}
function send(res, status, obj, origin) { const b = JSON.stringify(obj); res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors(origin) }); res.end(b); }
function readBody(req, maxBytes = 3 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > maxBytes) { reject(new HttpError(413, 'too_big')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { if (!chunks.length) return resolve({}); try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(new HttpError(400, 'bad_json')); } });
    req.on('error', reject);
  });
}
async function auth(req) {
  const m = /^Bearer\s+(\S+)$/.exec(req.headers.authorization || ''); if (!m) fail(401, 'unauth');
  const r = await q('select u.*, s.last_seen from sessions s join users u on u.id=s.user_id where s.token_hash=$1', [sha(m[1])]);
  if (!r.rows[0]) fail(401, 'unauth');
  if (now() - r.rows[0].last_seen > 3600e3) q('update sessions set last_seen=$1 where token_hash=$2', [now(), sha(m[1])]).catch(() => {});
  return r.rows[0];
}
async function newSession(userId) { const t = token(); await q('insert into sessions(token_hash,user_id,created_at,last_seen) values($1,$2,$3,$3)', [sha(t), userId, now()]); return t; }

const routes = [];
const route = (method, path, fn) => routes.push({ method, re: new RegExp('^' + path.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), fn });

route('GET', '/', async () => ({ ok: true, app: 'أنميتي', msg: 'السيرفر شغّال' }));
route('GET', '/health', async () => { await q('select 1'); return { ok: true }; });

/* الحسابات */
route('POST', '/api/signup', async (req, b) => {
  limit(req, 'signup', 10, 3600e3);
  const username = str(b.username, 40).trim().toLowerCase(), password = str(b.password, 200), name = cleanName(b.name) || username;
  if (!/^[a-z0-9_.]{3,20}$/.test(username)) fail(400, 'bad_username');
  if (password.length < 6) fail(400, 'weak_password');
  const rec = recoveryCode();
  let u;
  for (let i = 0; i < 5 && !u; i++) {
    try { u = (await q('insert into users(username,name,pass_hash,recovery_hash,friend_code,created_at) values($1,$2,$3,$4,$5,$6) returning *', [username, name, await hashPw(password), await hashPw(rec), code(), now()])).rows[0]; }
    catch (e) { if (e.code !== '23505') throw e; if (/username/.test(e.constraint || e.detail || '')) fail(409, 'taken'); }
  }
  if (!u) fail(500, 'server');
  return { token: await newSession(u.id), user: userOut(u), recovery: rec };
});
route('POST', '/api/login', async (req, b) => {
  limit(req, 'login', 20, 600e3);
  const r = await q('select * from users where username=$1', [str(b.username, 40).trim().toLowerCase()]);
  const u = r.rows[0]; if (!u || !(await checkPw(str(b.password, 200), u.pass_hash))) fail(401, 'bad_login');
  return { token: await newSession(u.id), user: userOut(u) };
});
route('POST', '/api/reset', async (req, b) => {
  limit(req, 'reset', 10, 3600e3);
  const r = await q('select * from users where username=$1', [str(b.username, 40).trim().toLowerCase()]);
  const u = r.rows[0]; if (!u || !(await checkPw(str(b.recovery, 40).trim().toUpperCase(), u.recovery_hash))) fail(401, 'bad_recovery');
  const password = str(b.password, 200); if (password.length < 6) fail(400, 'weak_password');
  const rec = recoveryCode();
  await q('update users set pass_hash=$1, recovery_hash=$2 where id=$3', [await hashPw(password), await hashPw(rec), u.id]);
  await q('delete from sessions where user_id=$1', [u.id]);
  return { token: await newSession(u.id), user: userOut(u), recovery: rec };
});
route('POST', '/api/logout', async req => { const m = /^Bearer\s+(\S+)$/.exec(req.headers.authorization || ''); if (m) await q('delete from sessions where token_hash=$1', [sha(m[1])]); return { ok: true }; });
route('GET', '/api/me', async req => ({ user: userOut(await auth(req)) }));
route('PATCH', '/api/me', async (req, b) => { const u = await auth(req); const name = cleanName(b.name); if (!name) fail(400, 'bad_name'); await q('update users set name=$1 where id=$2', [name, u.id]); return { user: userOut({ ...u, name }) }; });
route('POST', '/api/me/code', async req => {
  const u = await auth(req); let c;
  for (let i = 0; i < 5; i++) { c = code(); try { await q('update users set friend_code=$1 where id=$2', [c, u.id]); break; } catch (e) { if (e.code !== '23505') throw e; } }
  await q('delete from follows where friend_id=$1', [u.id]);
  return { user: userOut({ ...u, friend_code: c }) };
});
route('DELETE', '/api/me', async (req, b) => { const u = await auth(req); if (!(await checkPw(str(b.password, 200), u.pass_hash))) fail(401, 'bad_login'); await q('delete from users where id=$1', [u.id]); return { ok: true }; });

/* المزامنة */
route('GET', '/api/data', async req => { const u = await auth(req); const r = await q('select rev, body, updated_at from data where user_id=$1', [u.id]); return r.rows[0] ? { rev: r.rows[0].rev, body: r.rows[0].body, updatedAt: +r.rows[0].updated_at } : { rev: 0, body: null }; });
route('PUT', '/api/data', async (req, b) => {
  const u = await auth(req); const rev = int(b.rev) || 0;
  if (!b.body || typeof b.body !== 'object' || Array.isArray(b.body)) fail(400, 'bad_body');
  const body = JSON.stringify(b.body); if (body.length > 2.5 * 1024 * 1024) fail(413, 'too_big');
  const r = rev === 0
    ? await q('insert into data(user_id,rev,body,updated_at) values($1,1,$2,$3) on conflict(user_id) do nothing returning rev', [u.id, body, now()])
    : await q('update data set rev=rev+1, body=$2, updated_at=$3 where user_id=$1 and rev=$4 returning rev', [u.id, body, now(), rev]);
  if (r.rows[0]) return { rev: r.rows[0].rev };
  const cur = await q('select rev, body from data where user_id=$1', [u.id]);
  throw Object.assign(new HttpError(409, 'conflict'), { data: { rev: cur.rows[0] ? cur.rows[0].rev : 0, body: cur.rows[0] ? cur.rows[0].body : null } });
});

/* الشلة المباشرة */
function publicList(body) {
  const items = [], media = {}; const list = (body && body.list) || {};
  const S = ['CURRENT', 'PLANNING', 'COMPLETED', 'PAUSED', 'DROPPED'];
  for (const e of Object.values(list)) {
    if (!e || !e.media || S.indexOf(e.status) < 0) continue; const id = int(e.id); if (!id) continue;
    items.push([id, S.indexOf(e.status), int(e.progress) || 0, int(e.score) || 0, int(e.updatedAt) || 0]);
    const m = e.media, t = m.title || {};
    media[id] = { type: m.type === 'MANGA' ? 'MANGA' : 'ANIME', title: { romaji: str(t.romaji), english: str(t.english), native: str(t.native) }, cover: str(m.cover, 500), color: str(m.color, 9), episodes: int(m.episodes), format: str(m.format, 20) };
  }
  return { items, media };
}
route('GET', '/api/friends', async req => {
  const u = await auth(req);
  const r = await q('select u.id, u.username, u.name, d.body, d.updated_at from follows f join users u on u.id=f.friend_id left join data d on d.user_id=u.id where f.user_id=$1 order by f.created_at', [u.id]);
  return { friends: r.rows.map(x => ({ id: x.id, username: x.username, name: x.name || x.username, at: +x.updated_at || 0, ...publicList(x.body) })) };
});
route('POST', '/api/friends', async (req, b) => {
  const u = await auth(req); limit(req, 'follow', 30, 600e3);
  const c = str(b.code, 20).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const r = await q('select id, username, name from users where friend_code=$1', [c]); const f = r.rows[0];
  if (!f) fail(404, 'bad_code'); if (f.id === u.id) fail(400, 'self');
  await q('insert into follows(user_id,friend_id,created_at) values($1,$2,$3) on conflict do nothing', [u.id, f.id, now()]);
  return { friend: { id: f.id, username: f.username, name: f.name || f.username } };
});
route('DELETE', '/api/friends/:id', async (req, b, p) => { const u = await auth(req); await q('delete from follows where user_id=$1 and friend_id=$2', [u.id, int(p.id)]); return { ok: true }; });

/* التنبيهات */
let VAPID = null;
async function vapid() {
  if (VAPID) return VAPID;
  let k = await kvGet('vapid'); if (!k) { k = webpush.generateVAPIDKeys(); await kvSet('vapid', k); }
  webpush.setVapidDetails(APP_URL.startsWith('https://') ? APP_URL : 'mailto:noreply@example.com', k.publicKey, k.privateKey);
  return (VAPID = k);
}
async function pushUser(userId, payload) {
  await vapid(); const subs = (await q('select endpoint, keys from push_subs where user_id=$1', [userId])).rows; let sent = 0;
  for (const s of subs) {
    try { await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify(payload), { TTL: 6 * 3600 }); sent++; }
    catch (e) { if (e.statusCode === 404 || e.statusCode === 410) await q('delete from push_subs where endpoint=$1', [s.endpoint]); else console.error('push', e.statusCode || e.message); }
  }
  return sent;
}
route('GET', '/api/push/key', async () => ({ key: (await vapid()).publicKey }));
route('POST', '/api/push/sub', async (req, b) => {
  const u = await auth(req); const s = b.sub || {};
  if (!/^https:\/\//.test(s.endpoint || '') || !s.keys || !s.keys.p256dh || !s.keys.auth) fail(400, 'bad_sub');
  await q('insert into push_subs(endpoint,user_id,keys,created_at) values($1,$2,$3,$4) on conflict(endpoint) do update set user_id=excluded.user_id, keys=excluded.keys', [str(s.endpoint, 1000), u.id, JSON.stringify({ p256dh: str(s.keys.p256dh, 200), auth: str(s.keys.auth, 100) }), now()]);
  return { ok: true };
});
route('DELETE', '/api/push/sub', async (req, b) => { const u = await auth(req); await q('delete from push_subs where endpoint=$1 and user_id=$2', [str(b.endpoint, 1000), u.id]); return { ok: true }; });
route('POST', '/api/push/test', async req => { const u = await auth(req); const n = await pushUser(u.id, { title: '🔔 أنميتي', body: 'التنبيهات شغّالة! بيجيك تنبيه لما تنزل حلقة من اللي تتابعه.', url: APP_URL, tag: 'test' }); return { sent: n }; });

/* السهرات */
async function partyOut(p) {
  const m = await q('select pm.user_id, pm.going, u.name, u.username from party_members pm join users u on u.id=pm.user_id where pm.party_id=$1', [p.id]);
  const o = await q('select name, username from users where id=$1', [p.owner_id]);
  return { id: p.id, ownerId: p.owner_id, owner: o.rows[0] ? (o.rows[0].name || o.rows[0].username) : '', mediaId: p.media_id, media: p.media, episode: p.episode, startsAt: +p.starts_at, note: p.note, members: m.rows.map(x => ({ id: x.user_id, name: x.name || x.username, going: x.going })) };
}
route('GET', '/api/parties', async req => {
  const u = await auth(req);
  const r = await q('select p.* from parties p where p.starts_at > $2 and (p.owner_id=$1 or exists(select 1 from party_members m where m.party_id=p.id and m.user_id=$1)) order by p.starts_at limit 50', [u.id, now() - 3 * 3600e3]);
  return { parties: await Promise.all(r.rows.map(partyOut)) };
});
route('POST', '/api/parties', async (req, b) => {
  const u = await auth(req); limit(req, 'party', 30, 3600e3);
  const startsAt = int(b.startsAt), mediaId = int(b.mediaId); const m = b.media || {}, t = m.title || {};
  if (!mediaId || !startsAt || startsAt < now() - 600e3 || startsAt > now() + 366 * 864e5) fail(400, 'bad_time');
  const media = { type: m.type === 'MANGA' ? 'MANGA' : 'ANIME', title: { romaji: str(t.romaji), english: str(t.english), native: str(t.native) }, cover: str(m.cover, 500), color: str(m.color, 9) };
  const invite = Array.isArray(b.invite) ? b.invite.map(int).filter(Boolean).slice(0, 50) : [];
  const ok = invite.length ? (await q('select friend_id from follows where user_id=$1 and friend_id = any($2::int[])', [u.id, invite])).rows.map(x => x.friend_id) : [];
  const p = (await q('insert into parties(owner_id,media_id,media,episode,starts_at,note,created_at) values($1,$2,$3,$4,$5,$6,$7) returning *', [u.id, mediaId, JSON.stringify(media), int(b.episode), startsAt, str(b.note, 300), now()])).rows[0];
  for (const id of ok) await q('insert into party_members(party_id,user_id) values($1,$2) on conflict do nothing', [p.id, id]);
  const title = media.title.english || media.title.romaji || 'أنمي';
  for (const id of ok) pushUser(id, { title: '🍿 عزيمة سهرة', body: `${u.name || u.username} يعزمك على «${title}»${p.episode ? ' الحلقة ' + p.episode : ''}`, url: APP_URL + '#/friends', tag: 'party-' + p.id }).catch(() => {});
  return { party: await partyOut(p) };
});
route('POST', '/api/parties/:id/rsvp', async (req, b, p) => {
  const u = await auth(req); const going = int(b.going) === 1 ? 1 : int(b.going) === -1 ? -1 : 0;
  const r = await q('update party_members set going=$1 where party_id=$2 and user_id=$3', [going, int(p.id), u.id]); if (!r.rowCount) fail(404, 'not_found');
  return { ok: true };
});
route('DELETE', '/api/parties/:id', async (req, b, p) => { const u = await auth(req); const r = await q('delete from parties where id=$1 and owner_id=$2', [int(p.id), u.id]); if (!r.rowCount) fail(404, 'not_found'); return { ok: true }; });

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (req.method === 'OPTIONS') { res.writeHead(204, cors(origin)); return res.end(); }
  const url = new URL(req.url, 'http://x'); const r = routes.find(x => x.method === req.method && x.re.test(url.pathname));
  if (!r) return send(res, 404, { error: 'not_found' }, origin);
  try { const body = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) ? await readBody(req) : {}; const out = await r.fn(req, body, r.re.exec(url.pathname).groups || {}); send(res, 200, out, origin); }
  catch (e) { if (e instanceof HttpError) return send(res, e.status, { error: e.code, ...(e.data || {}) }, origin); console.error(e); send(res, 500, { error: 'server' }, origin); }
});

/* ---------- المهام الدورية ---------- */
async function anilist(query, variables) {
  const r = await fetch(ANILIST, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ query, variables }) });
  if (!r.ok) throw new Error('anilist ' + r.status); const j = await r.json(); if (!j.data) throw new Error('anilist no data'); return j.data;
}
const Q_AIRED = 'query($ids:[Int],$from:Int,$to:Int,$page:Int){Page(page:$page,perPage:50){pageInfo{hasNextPage}airingSchedules(mediaId_in:$ids,airingAt_greater:$from,airingAt_lesser:$to,sort:TIME){mediaId episode airingAt}}}';
const titleOf = m => { const t = (m && m.title) || {}; return t.english || t.romaji || t.native || 'أنمي'; };
let ticking = false;
async function airingTick() {
  if (ticking) return; ticking = true;
  try {
    const to = now(), last = (await kvGet('airLast')) || to - 30 * 60e3, from = Math.max(last, to - 6 * 3600e3);
    const rows = (await q('select d.user_id, d.body from data d where exists(select 1 from push_subs s where s.user_id=d.user_id)')).rows;
    const watch = new Map();
    for (const r of rows) for (const e of Object.values((r.body && r.body.list) || {})) {
      if (!e || e.status !== 'CURRENT' || !e.media || e.media.type === 'MANGA') continue; const id = int(e.id); if (!id) continue;
      if (!watch.has(id)) watch.set(id, []); watch.get(id).push({ uid: r.user_id, title: titleOf(e.media), progress: int(e.progress) || 0 });
    }
    const ids = [...watch.keys()];
    for (let i = 0; i < ids.length; i += 50) {
      for (let page = 1; page <= 5; page++) {
        const d = await anilist(Q_AIRED, { ids: ids.slice(i, i + 50), from: Math.floor(from / 1000) - 1, to: Math.floor(to / 1000), page });
        for (const s of d.Page.airingSchedules || []) for (const w of watch.get(s.mediaId) || []) {
          if (w.progress >= s.episode) continue;
          const ins = await q('insert into notified(user_id,media_id,episode,at) values($1,$2,$3,$4) on conflict do nothing', [w.uid, s.mediaId, s.episode, now()]);
          if (ins.rowCount) await pushUser(w.uid, { title: '📺 نزلت حلقة جديدة', body: `الحلقة ${s.episode} من «${w.title}»`, url: APP_URL + '#/anime/' + s.mediaId, tag: 'ep-' + s.mediaId });
        }
        if (!d.Page.pageInfo.hasNextPage) break;
      }
    }
    await kvSet('airLast', to);
  } catch (e) { console.error('airing', e.message); }
  ticking = false;
}
async function partyTick() {
  try {
    const r = await q('update parties set reminded=true where reminded=false and starts_at <= $1 and starts_at > $2 returning *', [now() + 15 * 60e3, now() - 10 * 60e3]);
    for (const p of r.rows) {
      const ids = [p.owner_id, ...(await q('select user_id from party_members where party_id=$1 and going >= 0', [p.id])).rows.map(x => x.user_id)];
      const mins = Math.max(0, Math.round((+p.starts_at - now()) / 60e3));
      for (const id of ids) await pushUser(id, { title: '🍿 السهرة قرّبت', body: `«${titleOf(p.media)}»${p.episode ? ' الحلقة ' + p.episode : ''} ${mins ? 'بعد ' + mins + ' دقيقة' : 'الحين'}`, url: APP_URL + '#/friends', tag: 'party-' + p.id });
    }
  } catch (e) { console.error('party', e.message); }
}
async function cleanupTick() {
  try { await q('delete from sessions where last_seen < $1', [now() - 180 * 864e5]); await q('delete from notified where at < $1', [now() - 60 * 864e5]); await q('delete from parties where starts_at < $1', [now() - 7 * 864e5]); } catch (e) { console.error('cleanup', e.message); }
}

process.on('unhandledRejection', e => console.error('unhandled', e));
async function start() {
  await migrate(); await vapid();
  server.listen(PORT, () => console.log('أنميتي: السيرفر شغّال على المنفذ ' + PORT));
  const every = (fn, ms, first) => { setTimeout(fn, first).unref(); setInterval(fn, ms).unref(); };
  every(airingTick, +process.env.AIRING_EVERY_MS || 10 * 60e3, 30e3);
  every(partyTick, +process.env.PARTY_EVERY_MS || 60e3, 10e3);
  every(cleanupTick, 6 * 3600e3, 60e3);
}
if (require.main === module) start().catch(e => { console.error(e); process.exit(1); });
module.exports = { start, server, airingTick, partyTick, pool };
