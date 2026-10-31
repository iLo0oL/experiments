'use strict';
/*
  صراحة — ألعاب وسوالف للشلة.
  • الرسائل تنتقل عبر ntfy.sh (خدمة رسائل مجانية) وتُحفظ هناك 12 ساعة.
  • كل شي مشفر في المتصفح: مفتاح الجلسة في الرابط بعد # (ما يوصل للسيرفر أبد).
  • المشاركات تنشفر بمفتاح المشرف العام، فمحد يقراها قبل الكشف إلا المشرف.
  • الكشف = المشرف ينشر مفتاحه الخاص (مشفر بمفتاح الجلسة) مع قائمة المشاركات المعتمدة.
  • التصحيح وتوحيد الأسلوب يصير على جوال الكاتب قبل التشفير، فالنص الأصلي ما يطلع منه.
*/
const SERVER = (localStorage.getItem('saraha.server') || 'https://ntfy.sh').replace(/\/+$/, '');
const MAX_LEN = 500, MAX_NAMES = 30, NAME_LEN = 24, TITLE_LEN = 40, Q_LEN = 120, OPT_LEN = 60;
const MAX_Q = 15, MAX_OPTS = 10, KEEP_HOURS = 12;
const RUDE_MSG = 'فيها ألفاظ جارحة. الصراحة ما تحتاج سب، عدّلها وأرسلها 🙏';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const app = $('#app');

let toastTimer;
function toast(msg, bad) {
  const t = $('#toast');
  t.textContent = msg; t.classList.toggle('bad', !!bad); t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch {}
    ta.remove();
  }
  toast('تم النسخ ✓');
}
function shuffle(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ============ التشفير ============ */
const enc = new TextEncoder(), dec = new TextDecoder();
const b64u = buf => {
  const b = new Uint8Array(buf); let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64u = str => {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const s = atob(str), b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
};
const Crypto = {
  ec: { name: 'ECDH', namedCurve: 'P-256' },
  aes(raw) { return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']); },
  async seal(key, obj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
    return { iv: b64u(iv), ct: b64u(ct) };
  },
  async open(key, env) {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64u(env.iv) }, key, unb64u(env.ct));
    return JSON.parse(dec.decode(pt));
  },
  async hostKeys() {
    const kp = await crypto.subtle.generateKey(this.ec, true, ['deriveBits']);
    const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
    return { d: jwk.d, pk: b64u(await crypto.subtle.exportKey('raw', kp.publicKey)) };
  },
  pub(pk) { return crypto.subtle.importKey('raw', unb64u(pk), this.ec, false, []); },
  priv(d, pk) {
    const p = unb64u(pk);
    return crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', d, x: b64u(p.slice(1, 33)), y: b64u(p.slice(33, 65)), ext: true }, this.ec, false, ['deriveBits']);
  },
  async shared(priv, pub, e) {
    const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: pub }, priv, 256));
    const ep = unb64u(e), mat = new Uint8Array(bits.length + ep.length);
    mat.set(bits); mat.set(ep, bits.length);
    return this.aes(new Uint8Array(await crypto.subtle.digest('SHA-256', mat)));
  },
  async sealTo(pk, obj) {
    const eph = await crypto.subtle.generateKey(this.ec, true, ['deriveBits']);
    const e = b64u(await crypto.subtle.exportKey('raw', eph.publicKey));
    const key = await this.shared(eph.privateKey, await this.pub(pk), e);
    return { e, ...(await this.seal(key, obj)) };
  },
  async openFrom(priv, env) { return this.open(await this.shared(priv, await this.pub(env.e), env.e), env); },
  async sha(s) { return b64u(await crypto.subtle.digest('SHA-256', enc.encode('saraha:' + s))); }
};

/* ============ النقل (ntfy) ============ */
const Relay = {
  async post(topic, env) {
    const body = JSON.stringify(env);
    let wait = 1500;
    for (let i = 0; i < 4; i++) {
      try {
        const r = await fetch(`${SERVER}/${topic}`, { method: 'POST', body });
        if (r.ok) return await r.json();
        if (r.status !== 429 && r.status < 500) throw Object.assign(new Error('HTTP ' + r.status), { fatal: true });
      } catch (e) { if (e.fatal) throw e; }
      await sleep(wait); wait *= 2;
    }
    throw new Error('network');
  },
  subscribe(topic, onMsg, onStatus) {
    let es = null, timer = null, closed = false, tries = 0, last = 'all';
    const connect = () => {
      if (closed) return;
      clearTimeout(timer);
      try { es && es.close(); } catch {}
      es = new EventSource(`${SERVER}/${topic}/sse?since=${encodeURIComponent(last)}`);
      es.onopen = () => { tries = 0; onStatus(true); };
      es.onmessage = e => {
        let m; try { m = JSON.parse(e.data); } catch { return; }
        if (m && m.event === 'message') { last = m.id; onMsg(m); }
      };
      es.onerror = () => {
        onStatus(false);
        if (es.readyState === 2) timer = setTimeout(connect, Math.min(30000, 2000 * 2 ** tries++));
      };
    };
    const wake = () => { if (!closed && document.visibilityState === 'visible' && (!es || es.readyState === 2)) connect(); };
    document.addEventListener('visibilitychange', wake);
    addEventListener('online', wake);
    connect();
    return () => {
      closed = true; clearTimeout(timer);
      try { es && es.close(); } catch {}
      document.removeEventListener('visibilitychange', wake);
      removeEventListener('online', wake);
    };
  }
};

/* ============ التخزين المحلي ============ */
const store = {
  list() { try { return JSON.parse(localStorage.getItem('saraha.sessions')) || []; } catch { return []; } },
  save(l) { try { localStorage.setItem('saraha.sessions', JSON.stringify(l.slice(0, 50))); } catch {} },
  get(topic) { return this.list().find(s => s.topic === topic); },
  upsert(rec) {
    const l = this.list(), i = l.findIndex(s => s.topic === rec.topic);
    if (i >= 0) l[i] = { ...l[i], ...rec, d: rec.d || l[i].d || null, token: rec.token || l[i].token || null }; else l.unshift(rec);
    this.save(l);
  },
  kv(k, v) {
    if (v === undefined) return localStorage.getItem('saraha.' + k);
    try { localStorage.setItem('saraha.' + k, v); } catch {}
  },
  remove(topic) {
    this.save(this.list().filter(s => s.topic !== topic));
    for (const k of ['sent', 'me', 'bid', 'voted', 'opened', 'wish', 'twish']) localStorage.removeItem(`saraha.${k}.${topic}`);
  },
  sent(topic) { return +this.kv('sent.' + topic) || 0; },
  addSent(topic) { this.kv('sent.' + topic, this.sent(topic) + 1); }
};

/* ============ أدوات مشتركة ============ */
let S = null;
const B64 = /^[\w-]+$/;
const baseUrl = () => location.href.split('#')[0];
const inviteLink = (my = S) => `${baseUrl()}#j=${my.topic}.${my.key}`;
const adminLink = (my = S) => `${baseUrl()}#h=${my.topic}.${my.key}.${my.d}`;
const shareText = link => `${S.M.icon} ${S.M.name}: «${S.setup.title}»\n${S.M.invite}\n${link}`;
const optsOf = (q, cfg) => q.opts || cfg.names;
const qText = (q, mode) => mode === 'wyr' ? `لو خيروك: ${q.opts[0]} ولا ${q.opts[1]}؟` : q.q;
const aboutOf = (M, to) => to === ALL ? '👥 للشلة كلها' : M.about(to);
const groupTitle = (M, n) => n === ALL ? '👥 للشلة كلها' : (M.groupTitle || M.about)(n);
const backLink = () => `<a class="back" href="#">→ الرئيسية</a>`;
const emptyCard = (t = 'ما أحد شارك هالمرة 😅') => `<div class="card center"><p>${t}</p></div>`;
const howCard = (M, open) => `<details class="card how"${open ? ' open' : ''}><summary>📖 وش هي وكيف نلعبها؟</summary>
  <p style="margin-top:10px">${M.desc}</p><ol>${M.steps.map(s => `<li>${s}</li>`).join('')}</ol>
  <p class="muted small">🔒 ${M.privacy}</p></details>`;
const privacyNote = M => M.faq ? `<details class="card faq"><summary>🤫 كيف نضمن الخصوصية؟</summary><ul>${M.faq.map(x => `<li>${x}</li>`).join('')}</ul></details>` : '';

function chipList(input, btn, box, arr, { max, len, empty, onChange }) {
  const draw = () => {
    box.innerHTML = arr.length
      ? arr.map((n, i) => `<button type="button" class="chip" data-i="${i}" aria-label="حذف ${esc(n)}">${esc(n)} <span class="x">✕</span></button>`).join('')
      : `<p class="hint">${empty}</p>`;
  };
  const add = () => {
    for (let n of input.value.split(/[,،\n]+/)) {
      n = n.replace(/\s+/g, ' ').trim().slice(0, len);
      if (n && n !== ALL && !arr.includes(n) && arr.length < max) arr.push(n);
    }
    input.value = ''; draw(); onChange && onChange();
  };
  btn.onclick = () => { add(); input.focus(); };
  input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); add(); } };
  box.onclick = e => { const b = e.target.closest('[data-i]'); if (b) { arr.splice(+b.dataset.i, 1); draw(); onChange && onChange(); } };
  draw();
  return { add };
}

function openSheet(html) {
  const m = document.createElement('div');
  m.className = 'modal';
  m.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(m);
  const close = () => m.remove();
  m.onclick = e => { if (e.target === m) close(); };
  return { m, close };
}

/* ============ الجلسة: البيانات ============ */
function validEnv(e) {
  if (!e || e.v !== 1 || typeof e.iv !== 'string' || typeof e.ct !== 'string' || !B64.test(e.iv) || !B64.test(e.ct)) return false;
  if (e.k === 'm' || e.k === 't') return typeof e.e === 'string' && B64.test(e.e);
  return ['s', 'r', 'w', 'x', 'q'].includes(e.k);
}
const strArr = (a, max, len) => Array.isArray(a) ? a.filter(x => typeof x === 'string' && x.trim()).map(x => x.slice(0, len)).slice(0, max) : [];

function normalizeSetup(s) {
  if (!s || typeof s.title !== 'string' || typeof s.pk !== 'string' || typeof s.rc !== 'string') return null;
  try { if (unb64u(s.pk).length !== 65) return null; } catch { return null; }
  const mode = s.mode || 'saraha', M = MODES[mode];
  if (!M || M.kind === 'offline') return null;
  const c = s.cfg || { names: s.names }, F = M.form, cfg = {};
  if (F.names) { cfg.names = strArr(c.names, MAX_NAMES, NAME_LEN); if (!cfg.names.length) return null; }
  if (F.prompt) cfg.prompt = typeof c.prompt === 'string' ? c.prompt.slice(0, Q_LEN) : '';
  if (F.note) cfg.note = typeof c.note === 'string' ? c.note.slice(0, 200) : '';
  const isDay = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
  if (F.subject) { cfg.subject = typeof c.subject === 'string' ? c.subject.slice(0, NAME_LEN) : ''; if (!cfg.subject) return null; }
  if (F.open) { if (!isDay(c.open)) return null; cfg.open = c.open; }
  if (F.cats) { cfg.cats = strArr(c.cats, 8, 14); if (!cfg.cats.length) return null; }
  if (F.amount) { cfg.amount = Number.isFinite(c.amount) && c.amount > 0 ? Math.min(c.amount, 1e7) : 0; if (!cfg.amount) return null; }
  if (F.month) { if (typeof c.start !== 'string' || !/^\d{4}-\d{2}$/.test(c.start)) return null; cfg.start = c.start; }
  if (M.board === 'daily') { if (!isDay(c.start)) return null; cfg.start = c.start; }
  if (F.challenge) {
    cfg.goal = typeof c.goal === 'string' ? c.goal.slice(0, 40) : '';
    cfg.unit = typeof c.unit === 'string' ? c.unit.slice(0, 12) : '';
    cfg.target = Number.isFinite(c.target) && c.target > 0 ? c.target : 0;
    cfg.end = isDay(c.end) ? c.end : '';
    if (!cfg.goal) return null;
  }
  if (F.days) { cfg.days = (Array.isArray(c.days) ? c.days : []).filter(isDay).slice(0, 21); if (!cfg.days.length) return null; }
  if (['vote', 'know', 'quiz', 'rank', 'funny', 'guess', 'auction'].includes(M.kind)) {
    cfg.questions = (Array.isArray(c.questions) ? c.questions : []).slice(0, MAX_Q).map(q => ({
      q: q && typeof q.q === 'string' ? q.q.slice(0, Q_LEN) : '',
      opts: q && Array.isArray(q.opts) ? strArr(q.opts, MAX_OPTS, OPT_LEN) : null
    })).filter(q => q.q && (q.opts ? q.opts.length >= 2 : ['funny', 'guess', 'auction'].includes(M.kind) || (cfg.names || []).length >= 2));
    if (!cfg.questions.length && !M.fromFacts) return null;
  }
  return { mode, title: s.title.slice(0, TITLE_LEN) || M.name, cfg, pk: s.pk, rc: s.rc };
}

function validItem(M, cfg, p) {
  if (!p || typeof p !== 'object') return null;
  const str = (x, n) => typeof x === 'string' && x.trim() ? x.slice(0, n) : null;
  if (M.kind === 'know') {
    if (!(cfg.names.includes(p.by) || p.by === cfg.subject) || !Array.isArray(p.a) || p.a.length !== cfg.questions.length) return null;
    const ok = p.a.every((v, i) => Number.isInteger(v) && v >= -1 && v < optsOf(cfg.questions[i], cfg).length);
    return ok ? { by: p.by, a: p.a } : null;
  }
  if (M.kind === 'rank') {
    if (typeof p.bid !== 'string' || p.bid.length > 40 || !Array.isArray(p.r) || p.r.length !== cfg.questions.length) return null;
    const n = cfg.names.length;
    const ok = p.r.every(o => Array.isArray(o) && o.length <= n && new Set(o).size === o.length && o.every(v => Number.isInteger(v) && v >= 0 && v < n));
    return ok ? { bid: p.bid, r: p.r } : null;
  }
  if (M.kind === 'quiz') {
    const by = str(p.by, NAME_LEN);
    if (!by || !Number.isInteger(p.i) || p.i < 0 || p.i >= cfg.questions.length || !Number.isInteger(p.a) || p.a < 0 || p.a >= cfg.questions[p.i].opts.length) return null;
    return { by: by.trim(), i: p.i, a: p.a, t: typeof p.t === 'number' && p.t >= 0 ? Math.min(p.t, 600000) : 600000 };
  }
  if (M.kind === 'vote') {
    if (typeof p.bid !== 'string' || p.bid.length > 40 || !Array.isArray(p.a) || p.a.length !== cfg.questions.length) return null;
    const ok = p.a.every((v, i) => Number.isInteger(v) && v >= -1 && v < optsOf(cfg.questions[i], cfg).length);
    return ok ? { bid: p.bid, a: p.a } : null;
  }
  if (M.target === 'to') {
    const text = str(p.text, 1000);
    return text && (cfg.names.includes(p.to) || (M.allowAll && p.to === ALL)) ? { to: p.to, text } : null;
  }
  if (M.target === 'author') {
    if (!cfg.names.includes(p.by)) return null;
    if (M.fields === 'three') {
      if (!Array.isArray(p.items) || p.items.length !== 3 || !Number.isInteger(p.lie) || p.lie < 0 || p.lie > 2) return null;
      const items = p.items.map(x => str(x, 300));
      return items.every(Boolean) ? { by: p.by, items, lie: p.lie } : null;
    }
    const text = str(p.text, 1000);
    return text ? { by: p.by, text } : null;
  }
  const text = str(p.text, 1000);
  if (!text) return null;
  return M.signable && typeof p.by === 'string' && p.by.trim() ? { text, by: p.by.trim().slice(0, NAME_LEN) } : { text };
}
const validPairs = p => Array.isArray(p) && p.length >= 2 && p.length <= MAX_NAMES &&
  p.every(x => Array.isArray(x) && x.length === 2 && x.every(n => typeof n === 'string' && n)) ? p.map(([a, b]) => [a.slice(0, NAME_LEN), b.slice(0, NAME_LEN)]) : null;
const validOrder = (o, n) => Array.isArray(o) && o.length === n && new Set(o).size === n && o.every(i => Number.isInteger(i) && i >= 0 && i < n) ? o : null;

async function createSession(mode, title, cfg) {
  let secret = null;
  if (mode === 'santa') secret = { order: shuffle(cfg.names.map((_, i) => i)) };
  if (mode === 'guess') { secret = { a: cfg.questions.map(q => q.a) }; cfg = { ...cfg, questions: cfg.questions.map(({ q }) => ({ q, opts: null })) }; }
  if (mode === 'quiz') { secret = { c: cfg.questions.map(q => q.c) }; cfg = { ...cfg, questions: cfg.questions.map(({ q, opts }) => ({ q, opts })) }; }
  const topic = 'saraha_' + b64u(crypto.getRandomValues(new Uint8Array(15)));
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const key = b64u(raw);
  const { d, pk } = await Crypto.hostKeys();
  const rc = await Crypto.sha(d);
  const env = { v: 1, k: 's', ...(await Crypto.seal(await Crypto.aes(raw), { mode, title, cfg, pk, rc })) };
  if (JSON.stringify(env).length > 4000) throw Object.assign(new Error('too big'), { big: true });
  await Relay.post(topic, env);
  const rec = { topic, key, d, mode, title, created: Date.now() };
  if (secret) {
    // سر المشرف (القرعة أو الأجوبة الصحيحة) مشفر بمفتاحه هو بس
    await Relay.post(topic, { v: 1, k: 't', ...(await Crypto.sealTo(pk, secret)) });
    Object.assign(rec, { secret, cfg, pk, rc }, secret.order ? { order: secret.order } : {});
  }
  store.upsert(rec);
  location.hash = `h=${topic}.${key}.${d}`;
}

function closeSession() {
  if (S) { S.closed = true; S.unsub && S.unsub(); clearTimeout(S.timeout); }
  S = null;
  $$('.modal,.present').forEach(n => n.remove());
}

function useResults(my) {
  const R = my.results;
  my.mode = R.mode || 'saraha'; my.M = MODES[my.mode];
  my.cfg = R.cfg || { names: R.names || [] };
  my.setup = my.setup || { title: R.title, cfg: my.cfg };
}

async function openSession(topic, key, d, token) {
  const rec = store.get(topic) || {};
  d = d || rec.d || null;
  store.upsert({ topic, key, d, token: token || null, created: rec.created || Date.now() });
  const my = S = {
    topic, key, d, token, isHost: !!d && !token, raws: [], seen: new Set(), checkedR: new Set(), wseen: new Set(),
    msgs: [], wishes: {}, setup: null, setupIdx: -1, reveal: null, results: rec.results || null,
    secret: rec.secret || null, order: rec.order || (rec.secret && rec.secret.order) || null, online: false, phase: null
  };
  my.room = await Crypto.aes(unb64u(key));
  if (token) {
    await decodeToken(my);
    if (my.badToken) return brokenLink();
    my.mode = 'santa'; my.M = MODES.santa;
    store.upsert({ topic, mode: 'santa', title: rec.title || my.ttl, me: my.me });
  } else if (d && rec.mode === 'santa' && rec.cfg && rec.order && rec.pk) {
    // المشرف يقدر يفتح لوحته حتى لو انتهت مدة الرسائل على السيرفر
    my.setup = { mode: 'santa', title: rec.title, cfg: rec.cfg, pk: rec.pk, rc: rec.rc };
    my.mode = 'santa'; my.M = MODES.santa; my.cfg = rec.cfg;
  }
  if (!my.setup && !token && rec.setupCache && MODES[rec.setupCache.mode] && MODES[rec.setupCache.mode].kind === 'board') {
    const sc = rec.setupCache;
    my.setup = sc; my.mode = sc.mode; my.M = MODES[sc.mode]; my.cfg = sc.cfg;
  }
  if (my.results) { useResults(my); my.phase = 'revealed'; renderSession(); return; }
  my.phase = (my.setup || my.token) ? 'open' : 'loading';
  renderSession();
  my.unsub = Relay.subscribe(topic, m => onRaw(m, my), on => { my.online = on; if (S === my) updateLive(); });
  my.timeout = setTimeout(() => { if (S === my && !my.setup && !my.token) { my.phase = 'notfound'; renderSession(); } }, 15000);
}

async function decodeToken(my) {
  try {
    const b = unb64u(my.token);
    const x = await Crypto.open(my.room, { iv: b64u(b.slice(0, 12)), ct: b64u(b.slice(12)) });
    if (x && typeof x.m === 'string' && typeof x.g === 'string' && x.m !== x.g) {
      my.me = x.m.slice(0, NAME_LEN); my.give = x.g.slice(0, NAME_LEN);
      my.ttl = typeof x.t === 'string' ? x.t.slice(0, TITLE_LEN) : MODES.santa.name;
      my.trc = typeof x.rc === 'string' ? x.rc : null;
      return;
    }
  } catch {}
  my.badToken = true;
}

async function santaLinks(my) {
  const names = my.cfg.names, o = my.order, n = names.length, links = [];
  for (let k = 0; k < n; k++) {
    const mi = o[k], gi = o[(k + 1) % n];
    const env = await Crypto.seal(my.room, { m: names[mi], g: names[gi], t: my.setup.title, rc: my.setup.rc });
    const iv = unb64u(env.iv), ct = unb64u(env.ct), b = new Uint8Array(iv.length + ct.length);
    b.set(iv); b.set(ct, iv.length);
    links[mi] = `${baseUrl()}#p=${my.topic}.${my.key}.${b64u(b)}`;
  }
  return links;
}
const santaPairs = my => my.order.map((mi, k) => [my.cfg.names[mi], my.cfg.names[my.order[(k + 1) % my.order.length]]]);

function onRaw(m, my = S) {
  if (!my || my.closed || !m || m.event !== 'message' || my.seen.has(m.id)) return;
  my.seen.add(m.id);
  let env; try { env = JSON.parse(m.message); } catch { return; }
  if (!validEnv(env)) return;
  my.raws.push({ id: String(m.id), idx: my.raws.length, env, time: +m.time || 0 });
  process(my);
}

async function decryptMsgs(my, priv, list) {
  const out = [];
  for (const r of list) {
    try {
      const p = validItem(my.M, my.cfg, await Crypto.openFrom(priv, r.env));
      if (p) out.push({ id: r.id, ...p });
    } catch {}
  }
  return out;
}

async function processSanta(my) {
  for (const r of my.raws) {
    if (my.wseen.has(r.id)) continue;
    if (r.env.k === 'w') {
      my.wseen.add(r.id);
      try {
        const x = await Crypto.open(my.room, r.env);
        if (x && typeof x.by === 'string' && typeof x.wish === 'string') my.wishes[x.by.slice(0, NAME_LEN)] = x.wish.slice(0, 300);
      } catch {}
    }
  }
  if (!my.order && my.secret) {
    const o = validOrder(my.secret.order, my.cfg.names.length);
    if (o) { my.order = o; store.upsert({ topic: my.topic, order: o }); }
  }
}

async function processSecret(my) {
  if (my.secret || !my.d || !my.setup || !my.setup.pk) return;
  for (const r of my.raws) {
    if (r.env.k !== 't') continue;
    try {
      const x = await Crypto.openFrom(await Crypto.priv(my.d, my.setup.pk), r.env);
      if (x && typeof x === 'object') { my.secret = x; store.upsert({ topic: my.topic, secret: x, cfg: my.cfg, pk: my.setup.pk, rc: my.setup.rc }); return; }
    } catch {}
  }
}

async function processOnce(my) {
  if (!my.setup) {
    for (const r of my.raws) {
      if (r.env.k !== 's') continue;
      try {
        const s = normalizeSetup(await Crypto.open(my.room, r.env));
        if (s) { my.setup = s; my.setupIdx = r.idx; break; }
      } catch {}
    }
    if (!my.setup) return;
    if (!my.token) { my.mode = my.setup.mode; my.M = MODES[my.mode]; }
    my.cfg = my.setup.cfg;
    clearTimeout(my.timeout);
    // القوائم المحفوظة تحتفظ بإعداداتها في الجوال عشان تنفتح حتى لو انتهت مدة السيرفر
    store.upsert({ topic: my.topic, mode: my.mode, title: my.setup.title, ...(my.M.kind === 'board' ? { setupCache: my.setup } : {}) });
  }
  const rc = my.setup.rc || my.trc;
  if (!my.reveal && rc) {
    for (const r of my.raws) {
      if (r.env.k !== 'r' || r.idx < my.setupIdx || my.checkedR.has(r.id)) continue;
      my.checkedR.add(r.id);
      try {
        const x = await Crypto.open(my.room, r.env);
        if (x && typeof x.d === 'string' && await Crypto.sha(x.d) === rc) {
          my.reveal = { ...x, ids: Array.isArray(x.ids) ? new Set(x.ids.map(String)) : null, hide: new Set(Array.isArray(x.hide) ? x.hide.map(String) : []), idx: r.idx, at: Date.now() };
          break;
        }
      } catch {}
    }
  }
  await processSecret(my);
  const K = KINDS[my.M.kind];
  if (K && K.process) return K.process(my);
  if (my.mode === 'santa') {
    await processSanta(my);
    const pairs = my.reveal && validPairs(my.reveal.pairs);
    if (pairs && !my.results) {
      my.results = { mode: 'santa', title: my.setup.title || my.ttl, pairs, at: Date.now() };
      store.upsert({ topic: my.topic, results: my.results });
    }
    return;
  }
  const all = my.raws.filter(r => r.env.k === 'm' && r.idx > my.setupIdx);
  my.msgs = my.reveal ? all.filter(r => r.idx < my.reveal.idx) : all;
  if (!my.reveal || my.results) return;
  const R = my.reveal;
  let list;
  if (R.ids) {
    list = all.filter(r => R.ids.has(r.id));
    // ننتظر شوي لو فيه مشاركات معتمدة ما وصلت لهذا الجهاز للحين
    if (list.length < R.ids.size && Date.now() - R.at < 4000) { setTimeout(() => process(my), 1000); return; }
  } else list = my.msgs.filter(r => !R.hide.has(r.id));
  const items = await decryptMsgs(my, await Crypto.priv(R.d, my.setup.pk), list);
  const base = { mode: my.mode, title: my.setup.title, cfg: my.cfg, at: Date.now() };
  if (my.M.kind === 'vote') {
    const latest = new Map();
    for (const b of items) latest.set(b.bid, b); // آخر تصويت لكل جهاز
    const tally = my.cfg.questions.map((q, qi) => {
      const c = new Array(optsOf(q, my.cfg).length).fill(0);
      for (const b of latest.values()) if (b.a[qi] >= 0) c[b.a[qi]]++;
      return c;
    });
    my.results = { ...base, tally, voters: latest.size };
  } else if (my.M.kind === 'rank') {
    const latest = new Map();
    for (const b of items) latest.set(b.bid, b);
    my.results = { ...base, tally: rankTally(my.cfg, [...latest.values()]), voters: latest.size };
  } else if (my.M.kind === 'know') {
    const latest = new Map();
    for (const b of items) latest.set(b.by, b);
    const key = latest.get(my.cfg.subject);
    const players = [...latest.values()].filter(b => b.by !== my.cfg.subject)
      .map(b => ({ by: b.by, a: b.a, score: key ? b.a.filter((v, i) => v >= 0 && v === key.a[i]).length : 0 }))
      .sort((x, y) => y.score - x.score);
    my.results = { ...base, key: key ? key.a : null, players };
  } else {
    const clean = items.map(({ id, ...x }) => {
      if (my.M.fields !== 'three') return x;
      const p = shuffle([0, 1, 2]); // نخلط ترتيب المعلومات عشان مكان الكذبة ما يكون ثابت
      return { by: x.by, items: p.map(i => x.items[i]), lie: p.indexOf(x.lie) };
    });
    my.results = { ...base, items: shuffle(clean), hidden: R.ids ? Math.max(0, my.msgs.length - R.ids.size) : R.hide.size };
  }
  store.upsert({ topic: my.topic, results: my.results });
}

async function process(my) {
  if (my.busy) { my.again = true; return; }
  my.busy = true;
  try { do { my.again = false; await processOnce(my); } while (my.again); }
  catch (e) { console.error(e); }
  finally { my.busy = false; }
  if (S !== my) return;
  const ph = my.results ? 'revealed' : (my.setup || my.token) ? 'open' : my.phase;
  if (ph !== my.phase) { my.phase = ph; renderSession(); } else updateLive();
}

/* ============ الجلسة: الواجهات ============ */
function renderSession() {
  if (!S) return;
  if (S.phase === 'loading') {
    app.innerHTML = `${backLink()}<div class="center"><div class="spin"></div><p class="muted">جاري فتح الجلسة…</p></div>`;
  } else if (S.phase === 'notfound') {
    app.innerHTML = `${backLink()}<div class="card center"><div class="big-ic">🫥</div><h3>ما لقينا الجلسة</h3>
      <p class="muted">يمكن الرابط ناقص، أو الجلسة انتهت (الجلسات تبقى ${KEEP_HOURS} ساعة بس)، أو فيه مشكلة بالنت.</p>
      <button class="btn" id="retry" style="margin-top:12px">جرّب مرة ثانية</button></div>`;
    $('#retry').onclick = () => route();
  } else if (S.mode === 'santa') {
    S.phase === 'revealed' ? renderSantaReveal() : S.token ? renderSantaPersonal() : renderSantaHost();
  } else {
    const K = KINDS[S.M.kind];
    if (S.phase === 'revealed') K && K.reveal ? K.reveal() : renderReveal();
    else K && K.open ? K.open() : renderOpen();
  }
}

function sessionHead(title) {
  return `${backLink()}
    ${title !== S.M.name ? `<div class="mchip">${S.M.icon} ${S.M.name}</div>` : ''}
    <h2 class="ttl">${esc(title)}</h2>
    ${S.isHost ? '<div class="role">👑 أنت المشرف على هذي الجلسة</div>' : ''}`;
}

function renderOpen() {
  const { setup, isHost, M } = S;
  document.title = `${setup.title} · صراحة`;
  app.innerHTML = `
    ${sessionHead(setup.title)}
    <div class="live"><span class="dot" id="dot"></span><span id="conn">يتصل…</span><span>·</span><span>وصل <b id="count">0</b> ${M.unit}</span></div>
    ${isHost ? hostPanel() : ''}
    ${M.kind === 'vote' ? voteCard() : M.kind === 'know' ? knowCard() : M.kind === 'rank' ? rankCard() : writeCard()}
    ${isHost ? `<button class="btn danger big" id="reveal">${M.revealBtn}</button>` : waitCard()}
    ${howCard(M)}
    ${privacyNote(M)}`;
  M.kind === 'vote' ? bindVote() : M.kind === 'know' ? bindKnow() : M.kind === 'rank' ? bindRank() : bindWrite();
  if (isHost) bindHost();
  updateLive();
}

function hostPanel() {
  const inv = inviteLink();
  return `<section class="card share">
    <h3>📨 أرسل الرابط للشلة</h3>
    <div class="linkbox" dir="ltr">${esc(inv)}</div>
    <div class="row multi">
      <button class="btn" id="cp">نسخ الرابط</button>
      <a class="btn wa" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(shareText(inv))}">واتساب</a>
      ${navigator.share ? '<button class="btn" id="sh">مشاركة</button>' : ''}
    </div>
    ${adminDetails()}
  </section>`;
}
function adminDetails() {
  return `<details class="admin"><summary>🔑 رابط المشرف (لك أنت بس)</summary>
    <p class="muted small">على هذا الجوال <b>ما تحتاجه</b>: الجلسة محفوظة عندك في «جلساتك» بالصفحة الرئيسية.</p>
    <p class="muted small">تحتاجه بس لو بتفتح الجلسة كمشرف من جوال أو متصفح ثاني (أو لو مسحت بيانات المتصفح). احفظه عندك، و<b>لا ترسله لأحد</b>، لأن اللي معه يقدر يقرأ المشاركات قبل الكشف ويكشفها.</p>
    <div class="linkbox" dir="ltr">${esc(adminLink())}</div>
    <button class="btn ghost" id="cpa" style="margin-top:10px">نسخ رابط المشرف</button>
  </details>`;
}

function writeCard() {
  const { M, cfg } = S;
  let chooser = '';
  if (M.target === 'to') {
    const list = [...cfg.names, ...(M.allowAll ? [ALL] : [])];
    chooser = `<h3>${M.chooseLabel}</h3><div class="chips" id="targets">${list.map(n => `<button class="chip" data-to="${esc(n)}">${n === ALL ? '👥 الشلة كلها' : esc(n)}</button>`).join('')}</div>`;
  } else if (M.target === 'author') {
    chooser = `<h3>${M.chooseLabel}</h3><p class="hint">${M.authorHint}</p><div class="chips" id="targets">${cfg.names.map(n => `<button class="chip" data-to="${esc(n)}">${esc(n)}</button>`).join('')}</div>`;
  }
  const prompt = M.kind === 'story'
    ? `<h3>📜 القصة لين الحين…</h3><div class="prompt" id="lastLine">${esc(cfg.prompt)}</div><p class="hint" id="lastHint">هذي بداية القصة. كمّل عليها 👇</p>`
    : cfg.prompt ? `<div class="prompt">${esc(cfg.prompt)}</div>` : '';
  const fields = M.fields === 'three'
    ? `<div class="three">${[0, 1, 2].map(i => `<div class="tline"><input class="ti" maxlength="160" placeholder="المعلومة ${i + 1}"><label class="lie"><input type="radio" name="lie" value="${i}"> كذبة</label></div>`).join('')}</div>`
    : `<textarea id="txt" maxlength="${M.maxLen || MAX_LEN}" placeholder="${esc(M.placeholder)}"></textarea>`;
  const sig = M.signable ? `<input id="sig" maxlength="${NAME_LEN}" placeholder="اسمك (اختياري، خلّه فاضي لو تبيها بدون اسم)" style="margin-top:10px">` : '';
  return `<section class="card write">${chooser}${prompt}${fields}${sig}
    <div class="err" id="err"></div>
    <div class="row between" id="nextRow"><small class="muted" id="len"></small><button class="btn primary" id="next">التالي ←</button></div>
    <div class="preview" id="pv" hidden>
      <small class="muted">كذا بتطلع بعد التصحيح وتوحيد الأسلوب. تأكد إن المعنى ما تغيّر:</small>
      <div class="pv-to" id="pvTo"></div>
      <div id="pvBody"></div>
      <div class="row"><button class="btn ghost" id="edit">تعديل</button><button class="btn primary grow" id="send">🔒 إرسال</button></div>
    </div>
    <p class="muted small" id="sent" style="margin-top:10px"></p>
  </section>`;
}

function voteCard() {
  const { cfg, mode } = S;
  return `<section class="card vote">
    <h3>🗳️ صوّت بسرية</h3>
    ${cfg.questions.map((q, qi) => `<div class="vq"><div class="vqt">${esc(mode === 'wyr' ? 'لو خيروك…' : q.q)}</div>
      <div class="chips${mode === 'wyr' ? ' pair' : ''}" data-q="${qi}">${optsOf(q, cfg).map((o, oi) => `<button class="chip" data-o="${oi}">${esc(o)}</button>`).join(mode === 'wyr' ? '<span class="or">ولا</span>' : '')}</div></div>`).join('')}
    <div class="err" id="err"></div>
    <button class="btn primary big" id="vote">🔒 إرسال تصويتي</button>
    <p class="muted small" id="sent"></p>
  </section>`;
}

function sentText() {
  const { M, topic } = S;
  if (M.kind === 'vote' || M.kind === 'rank') return store.kv('voted.' + topic) ? 'صوّت من هذا الجوال ✓ لو غيّرت رأيك عدّل وأرسل مرة ثانية، ويُحسب آخر تصويت بس.' : '';
  if (M.kind === 'know') return store.kv('voted.' + topic) ? 'وصلت أجوبتك ✓ تقدر تعدّل وترسل مرة ثانية، ويُحسب آخر إرسال بس.' : '';
  const k = store.sent(topic);
  return k ? `أرسلت ${k} من هذا الجوال${M.target === 'author' ? '' : '، ومحد يعرف إنها منك 🤫'}` : '';
}

function updateLive() {
  if (!S) return;
  const c = $('#count'); if (c) c.textContent = S.msgs.length;
  const dot = $('#dot'), conn = $('#conn');
  if (dot) { dot.classList.toggle('on', S.online); conn.textContent = S.online ? 'متصل' : 'يتصل…'; }
  const sent = $('#sent'); if (sent && S.M) sent.textContent = sentText();
  if (S.mode === 'santa') updateSanta();
  const K = S.M && KINDS[S.M.kind];
  if (K && K.update && S.phase === 'open') K.update();
}

function bindWrite() {
  const my = S, M = my.M;
  let target = null, payload = null;
  const err = $('#err'), pv = $('#pv'), nextRow = $('#nextRow'), txt = $('#txt');
  const showErr = m => { err.textContent = m || ''; };
  const closePreview = () => { pv.hidden = true; nextRow.hidden = false; };
  const single = M.target === 'to' && !M.allowAll && my.cfg.names.length === 1;
  const pick = name => {
    target = name;
    $$('#targets .chip').forEach(c => c.classList.toggle('on', c.dataset.to === name));
    showErr(''); if (!pv.hidden) closePreview();
  };
  const tg = $('#targets');
  if (tg) {
    tg.onclick = e => {
      const b = e.target.closest('[data-to]'); if (!b) return;
      pick(b.dataset.to);
      if (M.target === 'author') store.kv('me.' + my.topic, b.dataset.to);
    };
    const saved = M.target === 'author' && store.kv('me.' + my.topic);
    if (saved && my.cfg.names.includes(saved)) pick(saved);
    else if (single) pick(my.cfg.names[0]);
  }
  const maxLen = M.maxLen || MAX_LEN, sig = $('#sig');
  const setLen = () => { if (txt) $('#len').textContent = `${txt.value.length}/${maxLen}`; };
  $$('#txt, .ti, input[name=lie], #sig').forEach(f => f.addEventListener('input', () => { setLen(); if (!pv.hidden) closePreview(); showErr(''); }));
  setLen();
  $('#next').onclick = () => {
    if (M.target !== 'none' && !target) return showErr(M.target === 'author' ? 'اختر اسمك أول' : 'اختر الشخص أول');
    let body;
    if (M.fields === 'three') {
      const vals = $$('.ti').map(i => i.value.trim());
      if (vals.some(v => v.length < 2)) return showErr('اكتب الثلاث معلومات');
      const lie = $('input[name=lie]:checked');
      if (!lie) return showErr('حدد أي وحدة فيهم الكذبة');
      const items = vals.map(v => Polish.polish(v).slice(0, 300));
      if (items.some(x => !x)) return showErr('فيه معلومة فاضية بعد التصحيح');
      if (items.some(Polish.isRude)) return showErr(RUDE_MSG);
      payload = { by: target, items, lie: +lie.value };
      body = `<ol class="tl">${items.map((t, i) => `<li class="${i === payload.lie ? 'isLie' : ''}">${esc(t)}${i === payload.lie ? ' <em>(الكذبة)</em>' : ''}</li>`).join('')}</ol>`;
    } else {
      const raw = txt.value.trim(), signed = sig && sig.value.trim().slice(0, NAME_LEN);
      if (raw.length < 2) return showErr('اكتب شي أول');
      // الرسالة الموقّعة تبقى بأسلوب صاحبها، والمجهولة تتصحح وتتوحّد
      const text = signed ? raw.slice(0, maxLen) : Polish.polish(raw).slice(0, maxLen + 200);
      if (!text) return showErr('الرسالة فاضية بعد التصحيح. اكتب كلام مو بس إيموجي 🙂');
      if (Polish.isRude(text)) return showErr(RUDE_MSG);
      payload = M.target === 'to' ? { to: target, text } : M.target === 'author' ? { by: target, text } : signed ? { text, by: signed } : { text };
      body = `<div class="msg">${esc(text)}</div>`;
    }
    $('#pvTo').textContent = M.target === 'to' ? aboutOf(M, target) : M.target === 'author' ? `من: ${target} (ما ينكشف إلا وقت اللعب)` : payload.by ? `من: ${payload.by}` : '';
    $('#pvBody').innerHTML = body;
    nextRow.hidden = true; pv.hidden = false;
    pv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  $('#edit').onclick = closePreview;
  $('#send').onclick = async e => {
    if (my.reveal) return toast('الجلسة انتهت', true);
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = 'جاري الإرسال…';
    try {
      const env = M.kind === 'story'
        ? { v: 1, k: 'x', ...(await Crypto.seal(my.room, payload)) }
        : { v: 1, k: 'm', ...(await Crypto.sealTo(my.setup.pk, payload)) };
      const res = await Relay.post(my.topic, env);
      store.addSent(my.topic);
      onRaw(res, my);
      if (S !== my) return;
      if (txt) txt.value = '';
      $$('.ti').forEach(i => { i.value = ''; });
      $$('input[name=lie]').forEach(i => { i.checked = false; });
      if (M.target === 'to' && !single) { target = null; $$('#targets .chip').forEach(c => c.classList.remove('on')); }
      setLen(); closePreview(); updateLive();
      toast('وصلت ✓');
    } catch (err) {
      console.error(err);
      toast('ما وصلت… تأكد من النت وجرّب مرة ثانية', true);
    } finally { btn.disabled = false; btn.textContent = '🔒 إرسال'; }
  };
}

function bindVote() {
  const my = S, ans = my.cfg.questions.map(() => -1);
  $$('.vote .chips').forEach(box => {
    box.onclick = e => {
      const b = e.target.closest('[data-o]'); if (!b) return;
      const qi = +box.dataset.q, oi = +b.dataset.o;
      ans[qi] = ans[qi] === oi ? -1 : oi;
      $$('.chip', box).forEach(c => c.classList.toggle('on', +c.dataset.o === ans[qi]));
      $('#err').textContent = '';
    };
  });
  $('#vote').onclick = async e => {
    if (my.reveal) return toast('التصويت انتهى', true);
    if (ans.every(a => a < 0)) { $('#err').textContent = 'اختر جواب واحد على الأقل'; return; }
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = 'جاري الإرسال…';
    try {
      let bid = store.kv('bid.' + my.topic);
      if (!bid) { bid = b64u(crypto.getRandomValues(new Uint8Array(12))); store.kv('bid.' + my.topic, bid); }
      const res = await Relay.post(my.topic, { v: 1, k: 'm', ...(await Crypto.sealTo(my.setup.pk, { bid, a: ans })) });
      store.kv('voted.' + my.topic, '1');
      onRaw(res, my);
      toast('وصل تصويتك ✓');
      updateLive();
    } catch (err) {
      console.error(err);
      toast('ما وصل… تأكد من النت وجرّب مرة ثانية', true);
    } finally { btn.disabled = false; btn.textContent = '🔒 إرسال تصويتي'; }
  };
}

function bindHost() {
  const cp = $('#cp'); if (cp) cp.onclick = () => copyText(inviteLink());
  $('#cpa').onclick = () => copyText(adminLink());
  const sh = $('#sh');
  if (sh) sh.onclick = () => navigator.share({ title: S.M.name, text: shareText(inviteLink()) }).catch(() => {});
  const rv = $('#reveal'); if (rv) rv.onclick = startReveal;
}

async function postReveal(my, payload, btn, close) {
  const old = btn.textContent;
  btn.disabled = true; btn.textContent = 'لحظة…';
  try {
    const res = await Relay.post(my.topic, { v: 1, k: 'r', ...(await Crypto.seal(my.room, payload)) });
    close();
    onRaw(res, my);
  } catch (err) {
    console.error(err);
    toast('ما قدرنا نكشفها، تأكد من النت وجرّب مرة ثانية', true);
    btn.disabled = false; btn.textContent = old;
  }
}

async function startReveal() {
  const my = S, btn = $('#reveal');
  btn.disabled = true;
  try {
    if (my.mode === 'santa') return santaRevealSheet(my);
    const K = KINDS[my.M.kind];
    if (K && K.startReveal) return K.startReveal(my);
    const items = await decryptMsgs(my, await Crypto.priv(my.d, my.setup.pk), my.msgs);
    if (S === my) reviewSheet(my, shuffle(items));
  } catch (e) { console.error(e); toast('صار خطأ، جرّب مرة ثانية', true); }
  finally { btn.disabled = false; }
}

function reviewSheet(my, items) {
  const M = my.M, vote = ['vote', 'know', 'rank'].includes(M.kind);
  const txt = x => M.fields === 'three' ? x.items.map((t, i) => `${i + 1}. ${t}`).join('\n') : x.text;
  let body;
  if (vote) body = `<p class="muted">${M.kind === 'know' ? 'شارك' : 'صوّت'} ${new Set(items.map(b => b.bid || b.by)).size}. متأكد تبي تنهي وتكشف النتائج؟</p>`;
  else if (items.length) body = `<p class="muted">وصل ${items.length} ${M.unit}. تقدر تخفي أي شي جارح قبل لا يشوفه الكل.</p>
    <div class="review">${items.map(x => `<label class="rv"><input type="checkbox" data-id="${esc(x.id)}"><span>${M.target === 'to' ? `<small>${esc(aboutOf(M, x.to))}</small>` : ''}${esc(txt(x))}</span><em>إخفاء</em></label>`).join('')}</div>`;
  else body = `<p class="muted">ما وصل شي للحين. متأكد تبي تنهي الجلسة؟</p>`;
  const { m, close } = openSheet(`<h3>جاهز للكشف؟</h3>${body}
    <div class="row"><button class="btn ghost" id="rvBack">رجوع</button><button class="btn primary grow" id="rvGo">${M.revealBtn}</button></div>
    <p class="muted small" style="margin-top:10px">بعد الكشف ما تقدر تضيف مشاركات جديدة.</p>`);
  $('#rvBack', m).onclick = close;
  $('#rvGo', m).onclick = e => {
    const hidden = new Set($$('input:checked', m).map(i => i.dataset.id));
    const ids = items.map(x => x.id).filter(id => !hidden.has(id));
    // قائمة المشاركات المعتمدة تخلي النتيجة نفسها على كل الأجهزة (والحد الأعلى لحجم الرسالة 4KB)
    const payload = ids.length <= 190 ? { d: my.d, ids } : { d: my.d, hide: [...hidden] };
    postReveal(my, payload, e.currentTarget, close);
  };
}

/* ============ الكشف ============ */
function barsHtml(q, counts, cfg, max = 8) {
  const opts = optsOf(q, cfg), total = counts.reduce((a, b) => a + b, 0);
  if (!total) return '<p class="muted">محد صوّت على هذا السؤال</p>';
  const top = Math.max(...counts);
  return opts.map((_, i) => i).sort((a, b) => counts[b] - counts[a])
    .filter(i => counts[i] > 0 || opts.length <= 4).slice(0, max)
    .map(i => {
      const pct = Math.round(counts[i] * 100 / total), win = counts[i] === top;
      return `<div class="bar${win ? ' top' : ''}"><i style="width:${pct}%"></i><span>${win ? '👑 ' : ''}${esc(opts[i])}</span><b>${pct}% · ${counts[i]}</b></div>`;
    }).join('');
}

function renderReveal() {
  const R = S.results, M = S.M, cfg = S.cfg;
  document.title = `${R.title} · صراحة`;
  if (M.reveal === 'capsule') return renderCapsule(R);
  const summary = M.kind === 'vote' || M.kind === 'rank' ? `صوّت ${R.voters}` : M.kind === 'know' ? `خمّن ${R.players.length}`
    : `انكشف ${R.items.length} ${M.unit}${R.hidden ? ` · ${R.hidden} مخفية من المشرف` : ''}`;
  const prompt = cfg.prompt ? `<div class="prompt">${esc(cfg.prompt)}</div>` : '';
  let body = '', slides = [], after = null;

  if (M.reveal === 'grouped') {
    const groups = [...cfg.names, ...(M.allowAll ? [ALL] : [])].map(n => ({ n, items: R.items.filter(x => x.to === n) }));
    const filled = groups.filter(g => g.items.length);
    const none = groups.filter(g => !g.items.length && g.n !== ALL).map(g => g.n);
    let filter = '';
    body = R.items.length ? `${prompt}
      <div class="chips" id="flt"><button class="chip on" data-f="">الكل (${R.items.length})</button>${filled.map(g => `<button class="chip" data-f="${esc(g.n)}">${esc(g.n === ALL ? 'الشلة كلها' : g.n)} (${g.items.length})</button>`).join('')}</div>
      <button class="btn big" id="present" style="margin-top:16px">📽️ اعرضها وحدة وحدة</button>
      ${filled.map(g => `<section class="grp" data-g="${esc(g.n)}"><div class="gh"><h3>${esc(groupTitle(M, g.n))} <span class="muted">(${g.items.length})</span></h3>${M.image ? `<button class="btn ghost sm" data-img="${esc(g.n)}">📸 صورة</button>` : ''}</div>${g.items.map(x => `<div class="msg">${esc(x.text)}</div>`).join('')}</section>`).join('')}
      ${none.length ? `<p class="muted small center" style="margin-top:18px">ما وصلهم شي: ${none.map(esc).join('، ')}</p>` : ''}` : emptyCard();
    slides = () => filled.filter(g => !filter || g.n === filter).flatMap(g => g.items.map(x => ({ kick: esc(aboutOf(M, x.to)), body: `<p>${esc(x.text)}</p>` })));
    after = () => {
      const flt = $('#flt');
      if (flt) flt.onclick = e => {
        const b = e.target.closest('[data-f]'); if (!b) return;
        filter = b.dataset.f;
        $$('.chip', flt).forEach(c => c.classList.toggle('on', c === b));
        $$('.grp').forEach(s => { s.hidden = !!filter && s.dataset.g !== filter; });
      };
      $$('[data-img]').forEach(b => {
        b.onclick = async () => {
          b.disabled = true;
          try {
            const n = b.dataset.img, g = filled.find(x => x.n === n);
            const blob = await cardImage(`${M.icon} ${n === ALL ? 'الشلة كلها' : n}`, R.title === M.name ? M.name : `${M.name} · ${R.title}`, g.items.map(x => x.text));
            await shareImage(blob, `${M.name} - ${n === ALL ? 'الشلة' : n}.png`);
          } catch (e) { console.error(e); toast('ما قدرنا نسوي الصورة', true); }
          finally { b.disabled = false; }
        };
      });
    };
  } else if (M.reveal === 'list') {
    body = R.items.length ? `${prompt}<button class="btn big" id="present" style="margin-top:16px">📽️ اعرضها وحدة وحدة</button>
      ${R.items.map(x => `<div class="msg">${esc(x.text)}</div>`).join('')}` : emptyCard();
    slides = R.items.map(x => ({ kick: esc(cfg.prompt || M.name), body: `<p>${esc(x.text)}</p>` }));
  } else if (M.reveal === 'guess') {
    const none = cfg.names.filter(n => !R.items.some(x => x.by === n));
    body = R.items.length ? `${prompt}<button class="btn primary big" id="present">🕵️ ابدأ اللعب: خمّنوا مين كتبها</button>
      ${R.items.map(x => `<div class="msg"><div>${esc(x.text)}</div><details class="ans"><summary>مين كتبها؟</summary><b>✍️ ${esc(x.by)}</b></details></div>`).join('')}
      ${none.length ? `<p class="muted small center" style="margin-top:18px">ما شارك: ${none.map(esc).join('، ')}</p>` : ''}` : emptyCard();
    slides = R.items.map(x => ({ kick: esc(cfg.prompt || M.name), body: `<p>${esc(x.text)}</p>`, ans: `✍️ ${esc(x.by)}`, ansBtn: '🕵️ مين كتبها؟' }));
  } else if (M.reveal === 'truths') {
    const plain = x => `<ol class="tl">${x.items.map(t => `<li>${esc(t)}</li>`).join('')}</ol>`;
    const marked = x => `<ol class="tl">${x.items.map((t, i) => `<li class="${i === x.lie ? 'isLie' : 'isTrue'}">${i === x.lie ? '❌' : '✅'} ${esc(t)}</li>`).join('')}</ol>`;
    body = R.items.length ? `<button class="btn primary big" id="present">🤥 ابدأ اللعب</button>
      ${R.items.map(x => `<section class="card"><h3>${esc(x.by)}</h3>${plain(x)}<details class="ans"><summary>وين الكذبة؟</summary>${marked(x)}</details></section>`).join('')}` : emptyCard();
    slides = R.items.map(x => ({ kick: `صدق ولا كذب: ${esc(x.by)}`, body: plain(x), ans: marked(x), replace: true, ansBtn: '🤥 اكشف الكذبة' }));
  } else if (M.reveal === 'votes') {
    body = R.voters ? `<button class="btn primary big" id="present">${M.ceremony ? '🏅 ابدأ حفل الجوائز' : '📽️ اعرض النتائج سؤال سؤال'}</button>
      ${cfg.questions.map((q, qi) => `<section class="card"><h3>${esc(qText(q, S.mode))}</h3>${barsHtml(q, R.tally[qi], cfg)}</section>`).join('')}` : emptyCard('محد صوّت هالمرة 😅');
    slides = cfg.questions.map((q, qi) => {
      if (!M.ceremony) return { kick: `سؤال ${qi + 1}`, body: `<p>${esc(qText(q, S.mode))}</p>`, ans: barsHtml(q, R.tally[qi], cfg, 5), ansBtn: '🏆 اكشف النتيجة' };
      const c = R.tally[qi], top = Math.max(...c), win = top ? optsOf(q, cfg).filter((_, i) => c[i] === top) : [];
      return { kick: `🏅 ${esc(q.q)}`, body: '<p>🥁</p>', replace: true, ansBtn: '🥁 والجائزة تروح لـ…',
        ans: `<p class="winner">${win.length ? '🏆 ' + win.map(esc).join(' و ') : 'محد صوّت 😅'}</p>${barsHtml(q, c, cfg, 4)}` };
    });
  } else if (M.reveal === 'know') {
    ({ body, slides } = knowReveal(R, M, cfg));
  } else if (M.reveal === 'rank') {
    ({ body, slides } = rankReveal(R, M, cfg));
  }

  app.innerHTML = `${backLink()}
    <header class="hero small"><div class="big-ic">${M.icon}</div>${R.title !== M.name ? `<div class="mchip">${M.name}</div>` : ''}<h2 class="ttl">${esc(R.title)}</h2><p class="muted">${summary}</p></header>
    ${body}
    <a class="btn primary big" href="#" style="margin-top:24px">✨ جرّب لعبة ثانية</a>`;
  const pb = $('#present');
  if (pb) pb.onclick = () => present(typeof slides === 'function' ? slides() : slides);
  if (after) after();
}

function present(slides) {
  if (!slides.length) return;
  let i = 0, shown = false;
  const ov = document.createElement('div');
  ov.className = 'present';
  const draw = () => {
    const s = slides[i], pending = !!s.ans && !shown;
    const body = shown && s.ans ? (s.replace ? s.ans : `${s.body}<div class="pans">${s.ans}</div>`) : s.body;
    const last = !pending && i >= slides.length - 1;
    ov.innerHTML = `
      <div class="ptop"><span>${i + 1} من ${slides.length}</span><button class="btn ghost" data-a="x">✕ إغلاق</button></div>
      <div class="pcard" data-a="n"><small>${s.kick || ''}</small><div class="pbody">${body}</div></div>
      <div class="row"><button class="btn ghost grow" data-a="p" ${i ? '' : 'disabled'}>→ السابق</button><button class="btn primary grow" data-a="n" ${last ? 'disabled' : ''}>${pending ? (s.ansBtn || '👀 اكشف') : 'التالي ←'}</button></div>`;
  };
  const next = () => {
    if (slides[i].ans && !shown) { shown = true; draw(); }
    else if (i < slides.length - 1) { i++; shown = false; draw(); }
  };
  const prev = () => { if (i > 0) { i--; shown = false; draw(); } };
  const close = () => { ov.remove(); removeEventListener('keydown', key); };
  const key = e => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft' || e.key === ' ') { e.preventDefault(); next(); }
    else if (e.key === 'ArrowRight') prev();
  };
  ov.onclick = e => {
    const a = e.target.closest('[data-a]'); if (!a || a.disabled) return;
    if (e.target.closest('details')) return;
    a.dataset.a === 'x' ? close() : a.dataset.a === 'n' ? next() : prev();
  };
  addEventListener('keydown', key);
  draw();
  document.body.appendChild(ov);
}

/* ============ بطاقة صورة ============ */
async function cardImage(title, subtitle, texts) {
  try { await Promise.all([document.fonts.load('800 60px Tajawal'), document.fonts.load('500 38px Tajawal')]); } catch {}
  const W = 1080, PAD = 70, LH = 60, BP = 34, GAP = 30, FONT = '500 38px Tajawal, sans-serif';
  const c = document.createElement('canvas'), ctx = c.getContext('2d');
  ctx.font = FONT; ctx.direction = 'rtl';
  const maxW = W - PAD * 2 - 64;
  const wrap = t => {
    const lines = [];
    for (const para of t.split('\n')) {
      let cur = '';
      for (const w of para.split(/\s+/)) {
        const test = cur ? cur + ' ' + w : w;
        if (ctx.measureText(test).width > maxW && cur) { lines.push(cur); cur = w; } else cur = test;
      }
      if (cur) lines.push(cur);
    }
    return lines;
  };
  const blocks = texts.map(wrap);
  const hOf = b => b.length * LH + BP * 2 + GAP;
  let H = 300 + blocks.reduce((h, b) => h + hOf(b), 0) + 140, extra = 0;
  while (H > 3600 && blocks.length > 1) { H -= hOf(blocks.pop()); extra++; }
  if (extra) H += 70;
  c.width = W; c.height = Math.max(H, 1080);
  const g = ctx.createLinearGradient(0, 0, W, c.height);
  g.addColorStop(0, '#1e1238'); g.addColorStop(1, '#3b1530');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, c.height);
  ctx.direction = 'rtl'; ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff'; ctx.font = '800 64px Tajawal, sans-serif'; ctx.fillText(title, W / 2, 150);
  ctx.fillStyle = '#f9a8d4'; ctx.font = '500 34px Tajawal, sans-serif'; ctx.fillText(subtitle, W / 2, 215);
  let y = 280;
  for (const b of blocks) {
    const h = b.length * LH + BP * 2, r = 30, x = PAD, w = W - PAD * 2;
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,.09)'; ctx.fill();
    ctx.fillStyle = '#f4f1ff'; ctx.font = FONT; ctx.textAlign = 'right';
    b.forEach((ln, k) => ctx.fillText(ln, x + w - 32, y + BP + LH * (k + 1) - 16));
    y += h + GAP;
  }
  ctx.textAlign = 'center';
  if (extra) { ctx.fillStyle = '#a59fc0'; ctx.font = FONT; ctx.fillText(`+ ${extra} رسائل ثانية`, W / 2, y + 30); }
  ctx.fillStyle = '#a59fc0'; ctx.font = '700 30px Tajawal, sans-serif'; ctx.fillText('صراحة 🤫', W / 2, c.height - 50);
  return new Promise(r => c.toBlob(r, 'image/png'));
}
async function shareImage(blob, name) {
  const file = new File([blob], name, { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast('تم حفظ الصورة ✓');
}

/* ============ الصديق الخفي ============ */
const santaText = (my, name, link) => `🎁 الصديق الخفي: «${my.setup.title}»\nهذا رابطك الخاص يا ${name}، لا ترسله لأحد:\n${link}`;

function renderSantaHost() {
  const my = S;
  if (!my.isHost) {
    app.innerHTML = `${backLink()}<div class="card center"><div class="big-ic">🎁</div><h3>هذي قرعة «الصديق الخفي»</h3>
      <p class="muted">افتح رابطك الخاص اللي وصلك من المشرف، عشان تشوف مين طلع لك.</p></div>`;
    return;
  }
  const { cfg, setup } = my;
  document.title = `${setup.title} · صراحة`;
  app.innerHTML = `
    ${sessionHead(setup.title)}
    ${cfg.note ? `<div class="card note">📝 ${esc(cfg.note)}</div>` : ''}
    <section class="card">
      <h3>📨 أرسل لكل واحد رابطه الخاص</h3>
      <p class="muted small">كل رابط يفتح لصاحبه بس اسم الشخص اللي بيجيب له هدية. أرسله له على الخاص، و<b>لا تفتح روابط غيرك</b> عشان ما تنكشف لك المفاجأة 😉</p>
      <div id="plinks"><div class="spin" style="margin:20px auto"></div></div>
    </section>
    <section class="card">
      <h3>🙋 أنت من ضمنهم؟</h3>
      <p class="hint" style="margin-top:0">اضغط اسمك عشان تفتح رابطك أنت.</p>
      <div class="chips" id="mine">${cfg.names.map((n, i) => `<button class="chip" data-i="${i}">${esc(n)}</button>`).join('')}</div>
    </section>
    <div class="live"><span class="dot" id="dot"></span><span id="conn">يتصل…</span><span>·</span><span>💭 كتب أمنيته <b id="wcount">0</b> من ${cfg.names.length}</span></div>
    <section class="card">${adminDetails()}</section>
    <button class="btn danger big" id="reveal">🎉 يوم التسليم: اكشف القرعة للكل</button>
    ${howCard(my.M)}
    ${privacyNote(my.M)}`;
  $('#cpa').onclick = () => copyText(adminLink());
  $('#reveal').onclick = startReveal;
  $('#plinks').onclick = e => {
    const b = e.target.closest('[data-cp]');
    if (b && my.links) copyText(my.links[+b.dataset.cp]);
  };
  $('#mine').onclick = e => {
    const b = e.target.closest('[data-i]');
    if (!b || !my.links) return;
    const n = cfg.names[+b.dataset.i];
    if (confirm(`متأكد إنك ${n}؟ لو فتحت رابط غيرك بتنكشف لك المفاجأة.`)) location.href = my.links[+b.dataset.i];
  };
  updateLive();
}

function drawLinks() {
  const my = S, pl = $('#plinks');
  if (!pl || !my.links) return;
  pl.innerHTML = my.cfg.names.map((n, i) => `<div class="prow"><b>${esc(n)}</b>${my.wishes[n] ? '<span title="كتب أمنيته">💭</span>' : ''}
    <button class="btn sm" data-cp="${i}">نسخ</button>
    <a class="btn wa sm" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(santaText(my, n, my.links[i]))}">واتساب</a></div>`).join('');
}

function updateSanta() {
  const my = S;
  if ($('#plinks') && my.order && my.cfg) {
    if (my.links) drawLinks();
    else if (!my.linksBusy) {
      my.linksBusy = true;
      santaLinks(my).then(l => { my.links = l; if (S === my) drawLinks(); }).catch(console.error);
    }
  }
  const wc = $('#wcount');
  if (wc && my.cfg) wc.textContent = my.cfg.names.filter(n => my.wishes[n]).length;
  const tw = $('#theirWish');
  if (tw) {
    if (my.wishes[my.give]) store.kv('twish.' + my.topic, my.wishes[my.give]);
    const w = my.wishes[my.give] || store.kv('twish.' + my.topic);
    tw.textContent = w || `ما كُتبت أمنية ${my.give} للحين.`;
    tw.classList.toggle('muted', !w);
  }
  const nt = $('#snote');
  if (nt && my.cfg && my.cfg.note && nt.hidden) { nt.textContent = '📝 ' + my.cfg.note; nt.hidden = false; }
}

function ownWish(my) { try { return JSON.parse(store.kv('wish.' + my.topic)) || null; } catch { return null; } }
async function saveWish(my, wish) {
  const res = await Relay.post(my.topic, { v: 1, k: 'w', ...(await Crypto.seal(my.room, { by: my.me, wish })) });
  store.kv('wish.' + my.topic, JSON.stringify({ wish, at: Date.now() }));
  onRaw(res, my);
}

function renderSantaPersonal() {
  const my = S, title = (my.setup && my.setup.title) || my.ttl;
  const opened = !!store.kv('opened.' + my.topic), own = ownWish(my);
  document.title = `${title} · صراحة`;
  const gift = () => `<small>هديتك لـ</small><div class="gname">${esc(my.give)}</div><p class="muted small">لا تقول لأحد 🤫</p>`;
  app.innerHTML = `
    ${sessionHead(title)}
    <p class="hello">أهلًا ${esc(my.me)} 👋</p>
    <div class="card gift${opened ? ' open' : ''}" id="gift">${opened ? gift() : '<div class="big-ic">🎁</div><b>اضغط عشان تشوف مين طلع لك</b>'}</div>
    <div class="card note" id="snote" hidden></div>
    <section class="card" id="twCard"${opened ? '' : ' hidden'}><h3>💭 أمنية ${esc(my.give)}</h3><p id="theirWish" class="muted">…</p></section>
    <section class="card">
      <h3>✍️ وش تتمنى أنت؟</h3>
      <textarea id="wish" maxlength="300" placeholder="مثلًا: عطر، كتاب، شي للقهوة… أو «أي شي منك حلو» 😄">${esc(own ? own.wish : '')}</textarea>
      <div class="row"><button class="btn primary grow" id="saveWish">حفظ أمنيتي</button></div>
      <p class="hint">اللي طلعت له بيشوف أمنيتك. الصفحة تحفظها وتجددها كل ما فتحت رابطك.</p>
    </section>
    ${my.d ? `<a class="btn ghost big" href="#h=${my.topic}.${my.key}.${my.d}">👑 لوحة المشرف</a>` : ''}
    <div class="live"><span class="dot" id="dot"></span><span id="conn">يتصل…</span></div>
    ${howCard(my.M)}
    ${privacyNote(my.M)}`;
  $('#gift').onclick = () => {
    if (store.kv('opened.' + my.topic)) return;
    store.kv('opened.' + my.topic, '1');
    const g = $('#gift'); g.classList.add('open'); g.innerHTML = gift();
    $('#twCard').hidden = false;
    updateSanta();
  };
  $('#saveWish').onclick = async e => {
    const wish = $('#wish').value.trim();
    if (!wish) return toast('اكتب أمنيتك أول', true);
    const btn = e.currentTarget; btn.disabled = true;
    try { await saveWish(my, wish); toast('تم حفظ أمنيتك ✓'); }
    catch (err) { console.error(err); toast('ما تم الحفظ… تأكد من النت', true); }
    finally { btn.disabled = false; }
  };
  // الرسائل تُحفظ على السيرفر 12 ساعة، فنجدد الأمنية لو صار لها وقت
  if (own && !my.wishRefreshed && Date.now() - own.at > 10 * 3600e3) {
    my.wishRefreshed = true;
    saveWish(my, own.wish).catch(() => {});
  }
  updateLive();
}

function santaRevealSheet(my) {
  if (!my.order) return toast('القرعة للحين ما وصلت لهذا الجهاز', true);
  const { m, close } = openSheet(`<h3>يوم التسليم؟ 🎁</h3>
    <p class="muted">بتنكشف القرعة كاملة للكل: مين كان الصديق الخفي لمين.</p>
    <div class="row"><button class="btn ghost" id="rvBack">رجوع</button><button class="btn primary grow" id="rvGo">🎉 اكشفها</button></div>`);
  $('#rvBack', m).onclick = close;
  $('#rvGo', m).onclick = e => postReveal(my, { d: my.d, pairs: santaPairs(my) }, e.currentTarget, close);
}

function renderSantaReveal() {
  const R = S.results, M = MODES.santa;
  document.title = `${R.title} · صراحة`;
  app.innerHTML = `${backLink()}
    <header class="hero small"><div class="big-ic">🎁</div>${R.title !== M.name ? `<div class="mchip">${M.name}</div>` : ''}<h2 class="ttl">${esc(R.title)}</h2><p class="muted">انكشفت القرعة 🎉</p></header>
    ${S.me ? `<div class="card gift open"><small>أنت ${esc(S.me)}، وطلع لك</small><div class="gname">${esc(S.give)}</div></div>` : ''}
    <button class="btn primary big" id="present">🥁 اكشفوها وحدة وحدة</button>
    ${R.pairs.map(([g, r]) => `<div class="msg">🎁 <b>${esc(g)}</b> كان الصديق الخفي لـ <b>${esc(r)}</b></div>`).join('')}
    <a class="btn primary big" href="#" style="margin-top:24px">✨ جرّب لعبة ثانية</a>`;
  $('#present').onclick = () => present(shuffle(R.pairs).map(([g, r]) => ({
    kick: `الصديق الخفي لـ ${esc(r)} هو…`, body: '<p>🎁</p>', ans: `<p>${esc(g)}</p>`, replace: true, ansBtn: '🥁 اكشف'
  })));
}

/* ============ الرئيسية وإنشاء الجلسات ============ */
function viewHome() {
  document.title = 'صراحة';
  const list = store.list();
  app.innerHTML = `
    <header class="hero">
      <div class="logo">صراحة</div>
      <p class="tag">ألعاب وسوالف للشلة… وأغلبها بدون ما يُعرف مين</p>
    </header>
    ${list.length ? `<h3 class="sec">جلساتك</h3><div class="list">${list.map(sessItem).join('')}</div>` : ''}
    <div class="chips gfilter" id="gf"><button class="chip on" data-g="">الكل (${Object.keys(MODES).length})</button>${GROUPS.map(g => `<button class="chip" data-g="${g.id}">${g.title.replace(/\s*\(.*\)$/, '')}</button>`).join('')}</div>
    ${GROUPS.map(g => `<section class="mgroup" data-g="${g.id}"><h3 class="sec">${g.title}</h3><div class="modes">${Object.entries(MODES).filter(([, M]) => M.group === g.id).map(([id, M]) => `
      <a class="mcard" href="#${M.kind === 'offline' ? 'play/' : 'new/'}${id}"><span class="mi">${M.icon}</span><span class="mt"><b>${M.name}</b><small>${M.tag}</small></span><span class="go">←</span></a>`).join('')}</div></section>`).join('')}
    <p class="fine">🔒 كل شي مشفر من جوالك، والجلسات تبقى ${KEEP_HOURS} ساعة. ألعاب «جوال واحد» ما تحتاج نت.</p>`;
  $$('[data-del]').forEach(b => {
    b.onclick = () => { if (confirm('تبي تحذف الجلسة من القائمة؟')) { store.remove(b.dataset.del); viewHome(); } };
  });
  $('#gf').onclick = e => {
    const b = e.target.closest('[data-g]'); if (!b) return;
    $$('#gf .chip').forEach(c => c.classList.toggle('on', c === b));
    $$('.mgroup').forEach(sec => { sec.hidden = !!b.dataset.g && sec.dataset.g !== b.dataset.g; });
  };
}
function sessItem(s) {
  const M = MODES[s.mode || 'saraha'] || MODES.saraha;
  const href = s.caplink ? s.caplink : s.d ? `#h=${s.topic}.${s.key}.${s.d}` : s.token ? `#p=${s.topic}.${s.key}.${s.token}` : `#j=${s.topic}.${s.key}`;
  const expired = !s.results && M.kind !== 'santa' && M.kind !== 'board' && Date.now() - (s.created || 0) > KEEP_HOURS * 3600e3;
  const cap = s.mode === 'capsule' && s.results && s.results.cfg;
  const cdLeft = s.mode === 'countdown' && s.at ? Math.ceil((s.at - Date.now()) / 864e5) : null;
  const st = cdLeft !== null ? (cdLeft > 0 ? `⏳ باقي ${cdLeft} يوم` : '🎉 جا اليوم') : cap ? (capLocked(cap.open) ? `🔒 تنفتح ${fmtDay(cap.open, { day: 'numeric', month: 'short', year: 'numeric' })}` : '🔓 مفتوحة')
    : M.kind === 'board' ? '📌 محفوظة' : s.results ? (s.mode === 'when' ? '📌 تثبّت الموعد' : s.mode === 'quiz' ? '🏁 خلصت' : '✅ انكشفت') : expired ? '⌛ انتهت' : '🟣 شغالة';
  return `<div class="item"><a href="${esc(href)}"><b>${M.icon} ${esc(s.title || M.name)}</b><small>${M.name} · ${s.mode === 'countdown' ? 'عدّاد' : s.caplink ? 'كبسولة محفوظة' : M.kind === 'board' ? 'قائمة مشتركة' : s.d ? 'أنت المشرف' : 'مشارك'} · ${st}</small></a><button class="x" data-del="${esc(s.topic)}" aria-label="حذف">✕</button></div>`;
}

function viewMode(id) {
  const M = MODES[id], F = M.form;
  document.title = `${M.name} · صراحة`;
  app.innerHTML = `${backLink()}
    <header class="mhead"><div class="big-ic">${M.icon}</div><h2 class="ttl">${M.name}</h2><p class="muted">${M.tag}</p></header>
    ${howCard(M, true)}
    <h3 class="sec">ابدأ جلسة</h3>
    <div class="card" id="form">
      <label for="title">اسم الجلسة</label>
      <input id="title" maxlength="${TITLE_LEN}" placeholder="${esc(M.name)}">
      ${F.subject ? `<label for="subj">${F.subject.label}</label><input id="subj" maxlength="${NAME_LEN}" placeholder="اسمه">` : ''}
      ${F.open ? `<label for="open">متى تنفتح الكبسولة؟</label>
        <div class="chips" id="openQuick"><button type="button" class="chip" data-m="1">بعد شهر</button><button type="button" class="chip" data-m="6">بعد 6 شهور</button><button type="button" class="chip on" data-m="12">بعد سنة</button><button type="button" class="chip" data-m="60">بعد 5 سنين</button></div>
        <input type="date" id="open" style="margin-top:10px">` : ''}
      ${F.cats ? `<label>الخانات</label><p class="hint" style="margin:-4px 0 8px">اختر الخانات، أو أضف خانة من عندك.</p><div class="chips" id="cats"></div>
        <div class="addrow" style="margin-top:8px"><input id="catIn" maxlength="14" placeholder="خانة جديدة (مثلًا: لاعب كورة)"><button class="btn" id="catAdd" type="button">إضافة</button></div>` : ''}
      ${F.amount ? `<label for="amt">المبلغ الشهري لكل عضو (ريال)</label><input id="amt" inputmode="numeric" placeholder="مثلًا: 1000">` : ''}
      ${F.month ? `<label for="mstart">أول شهر</label><input type="month" id="mstart" value="${isoDay(new Date()).slice(0, 7)}">` : ''}
      ${F.draw ? `<label class="qrow"><input type="checkbox" id="mdraw" checked><span>🎲 سوّ قرعة على ترتيب الدور (لو تشيلها، الدور بنفس ترتيب الأسماء)</span></label>` : ''}
      ${F.challenge ? `<label>الهدف</label><div class="chips" id="goals">${CHALLENGE_GOALS.map(([g], i) => `<button type="button" class="chip${i ? '' : ' on'}" data-g="${i}">${esc(g)}</button>`).join('')}</div>
        <div class="addrow" style="margin-top:10px"><input id="cgoal" maxlength="40" value="${esc(CHALLENGE_GOALS[0][0])}" placeholder="الهدف"><input id="cunit" maxlength="12" value="${esc(CHALLENGE_GOALS[0][1])}" placeholder="الوحدة"></div>
        <label for="ctarget">الهدف اليومي (اختياري)</label><input id="ctarget" inputmode="numeric" value="${CHALLENGE_GOALS[0][2]}">
        <label for="cend">آخر يوم بالتحدي (اختياري)</label><input type="date" id="cend">` : ''}
      ${F.days ? `<label>الأيام المقترحة</label><p class="hint" style="margin:-4px 0 8px">اختر الأيام اللي تبي الشلة تختار منها.</p><div class="chips" id="days"></div>` : ''}
      ${F.names ? `<label for="nm">${F.names.label}</label>${F.names.hint ? `<p class="hint" style="margin:-4px 0 8px">${F.names.hint}</p>` : ''}
        <div class="addrow"><input id="nm" maxlength="400" placeholder="اكتب اسم واضغط إضافة" enterkeyhint="done"><button class="btn" id="add" type="button">إضافة</button></div>
        <p class="hint">تقدر تلصق كذا اسم مرة وحدة، وافصل بينها بفاصلة.</p><div class="chips" id="chips"></div>` : ''}
      ${F.prompt ? `<label>${F.prompt.label}</label>
        <div class="chips" id="prompts">${F.prompt.presets.map((p, i) => `<button type="button" class="chip${i ? '' : ' on'}" data-p="${i}">${esc(p)}</button>`).join('')}</div>
        <input id="promptCustom" maxlength="${Q_LEN}" placeholder="أو اكتب سؤالك أنت" style="margin-top:10px">` : ''}
      ${F.questions ? `<label>${F.questions.label}</label><p class="hint" style="margin:-4px 0 8px">اختر الأسئلة اللي تبيها (لين ${MAX_Q} سؤال)، أو أضف أسئلتك.</p>
        ${F.questions.packs ? `<div class="chips" id="packs" style="margin-bottom:10px">${F.questions.packs.map(([n], i) => `<button type="button" class="chip${i ? '' : ' on'}" data-k="${i}">${esc(n)}</button>`).join('')}</div>` : ''}
        <div id="qlist"></div>
        ${F.questions.kind === 'pair'
          ? `<div class="addrow"><input id="qa" maxlength="${OPT_LEN}" placeholder="الخيار الأول"><input id="qb" maxlength="${OPT_LEN}" placeholder="الخيار الثاني"></div><button class="btn ghost" id="qadd" type="button" style="margin-top:8px">+ أضف سؤال</button>`
          : F.questions.kind === 'guess'
            ? `<input id="qa" maxlength="${Q_LEN}" placeholder="سؤالك (جوابه رقم)"><div class="addrow" style="margin-top:8px"><input id="qnum" inputmode="decimal" placeholder="الجواب الصحيح (رقم)"><button class="btn" id="qadd" type="button">إضافة</button></div>`
          : F.questions.kind === 'quiz'
            ? `<input id="qa" maxlength="${Q_LEN}" placeholder="سؤالك"><div class="qgrid"><input id="qc0" maxlength="${OPT_LEN}" placeholder="✅ الجواب الصح"><input id="qc1" maxlength="${OPT_LEN}" placeholder="❌ جواب غلط"><input id="qc2" maxlength="${OPT_LEN}" placeholder="❌ جواب غلط"><input id="qc3" maxlength="${OPT_LEN}" placeholder="❌ جواب غلط"></div><button class="btn ghost" id="qadd" type="button" style="margin-top:8px">+ أضف سؤال</button>`
            : `<div class="addrow"><input id="qa" maxlength="${Q_LEN}" placeholder="${esc(F.questions.placeholder || '')}"><button class="btn" id="qadd" type="button">إضافة</button></div>`}` : ''}
      ${F.poll ? `<label for="pq">السؤال</label><input id="pq" maxlength="${Q_LEN}" placeholder="مثلًا: وين نطلع الخميس؟">
        <label for="po">الخيارات</label>
        <div class="addrow"><input id="po" maxlength="200" placeholder="اكتب خيار واضغط إضافة" enterkeyhint="done"><button class="btn" id="poAdd" type="button">إضافة</button></div>
        <div class="chips" id="pchips"></div>` : ''}
      ${F.note ? `<label for="note">ملاحظة للكل (اختياري)</label><input id="note" maxlength="200" placeholder="مثلًا: الميزانية 100 ريال، والتسليم يوم الخميس">` : ''}
    </div>
    <button class="btn primary big" id="create">إنشاء الجلسة</button>`;

  const names = [], opts = [];
  const namesCtl = F.names && chipList($('#nm'), $('#add'), $('#chips'), names, { max: MAX_NAMES, len: NAME_LEN, empty: 'ما أضفت أحد للحين' });
  const optsCtl = F.poll && chipList($('#po'), $('#poAdd'), $('#pchips'), opts, { max: MAX_OPTS, len: OPT_LEN, empty: 'ما أضفت خيارات للحين' });

  let promptSel = 0;
  if (F.prompt) {
    $('#prompts').onclick = e => {
      const b = e.target.closest('[data-p]'); if (!b) return;
      promptSel = +b.dataset.p; $('#promptCustom').value = '';
      $$('#prompts .chip').forEach(c => c.classList.toggle('on', c === b));
    };
    $('#promptCustom').oninput = e => $$('#prompts .chip').forEach(c => c.classList.toggle('on', !e.target.value.trim() && +c.dataset.p === promptSel));
  }

  let qs = [];
  if (F.questions) {
    qs = F.questions.presets.map((v, i) => ({ v, on: i < F.questions.pick }));
    const label = v => !Array.isArray(v) ? esc(v) : F.questions.kind === 'guess' ? `${esc(v[0])} <em>(${fmtNum(v[1])})</em>` : v.length > 2 ? `${esc(v[0])} <em>✅ ${esc(v[1])}</em>` : `${esc(v[0])} <em>ولا</em> ${esc(v[1])}`;
    const draw = () => {
      $('#qlist').innerHTML = qs.map((q, i) => `<label class="qrow"><input type="checkbox" data-i="${i}"${q.on ? ' checked' : ''}><span>${label(q.v)}</span></label>`).join('');
    };
    $('#qlist').onchange = e => {
      const i = e.target.dataset.i; if (i === undefined) return;
      if (e.target.checked && qs.filter(q => q.on).length >= MAX_Q) { e.target.checked = false; return toast(`الحد ${MAX_Q} أسئلة`, true); }
      qs[+i].on = e.target.checked;
    };
    $('#qadd').onclick = () => {
      let v;
      if (F.questions.kind === 'pair') {
        const a = $('#qa').value.trim(), b = $('#qb').value.trim();
        if (!a || !b) return toast('اكتب الخيارين', true);
        v = [a.slice(0, OPT_LEN), b.slice(0, OPT_LEN)];
        $('#qa').value = $('#qb').value = '';
      } else if (F.questions.kind === 'guess') {
        const q = $('#qa').value.trim(), a = numIn($('#qnum').value);
        if (!q || a === null) return toast('اكتب السؤال وجوابه (رقم)', true);
        v = [q.slice(0, Q_LEN), a];
        $('#qa').value = $('#qnum').value = '';
      } else if (F.questions.kind === 'quiz') {
        const q = $('#qa').value.trim(), ans = [0, 1, 2, 3].map(i => $('#qc' + i).value.trim().slice(0, OPT_LEN));
        if (!q || ans.some(x => !x)) return toast('اكتب السؤال والأربع أجوبة', true);
        if (new Set(ans).size < 4) return toast('الأجوبة لازم تكون مختلفة', true);
        v = [q.slice(0, Q_LEN), ...ans];
        ['qa', 'qc0', 'qc1', 'qc2', 'qc3'].forEach(id => { $('#' + id).value = ''; });
      } else {
        const Q = F.questions;
        v = $('#qa').value.trim().replace(/[؟?]+$/, '');
        if (!v) return;
        if (Q.starts && !v.startsWith(Q.starts)) v = (Q.prefix || '') + v;
        v = (v + (Q.suffix || '')).slice(0, Q_LEN);
        $('#qa').value = '';
      }
      if (qs.filter(q => q.on).length >= MAX_Q) return toast(`الحد ${MAX_Q} أسئلة، شيل سؤال أول`, true);
      qs.unshift({ v, on: true, custom: true }); draw();
    };
    if (F.questions.packs) {
      $('#packs').onclick = e => {
        const b = e.target.closest('[data-k]'); if (!b) return;
        $$('#packs .chip').forEach(c => c.classList.toggle('on', c === b));
        // المختار من قبل يبقى، وتنضاف أسئلة الباقة الجديدة تحته (مختارة لو ما فيه شي مختار)
        const keep = qs.filter(q => q.on || q.custom), have = new Set(keep.map(q => JSON.stringify(q.v)));
        const pack = F.questions.packs[+b.dataset.k][1].filter(v => !have.has(JSON.stringify(v)));
        const auto = keep.some(q => q.on) ? 0 : F.questions.pick;
        qs = [...keep, ...pack.map((v, i) => ({ v, on: i < auto }))];
        draw();
      };
    }
    $('#qa').onkeydown = e => { if (e.key === 'Enter' && F.questions.kind === 'text') { e.preventDefault(); $('#qadd').click(); } };
    draw();
  }

  if (F.open) {
    const setIn = months => { const d = new Date(); d.setMonth(d.getMonth() + months); $('#open').value = isoDay(d); };
    const tmr = new Date(); tmr.setDate(tmr.getDate() + 1); $('#open').min = isoDay(tmr);
    setIn(12);
    $('#openQuick').onclick = e => { const b = e.target.closest('[data-m]'); if (!b) return; setIn(+b.dataset.m); $$('#openQuick .chip').forEach(c => c.classList.toggle('on', c === b)); };
    $('#open').oninput = () => $$('#openQuick .chip').forEach(c => c.classList.remove('on'));
  }
  const cats = F.cats ? ABC_CATS.map((c, i) => ({ c, on: i < 5 })) : [];
  if (F.cats) {
    const drawCats = () => { $('#cats').innerHTML = cats.map((x, i) => `<button type="button" class="chip${x.on ? ' on' : ''}" data-i="${i}">${esc(x.c)}</button>`).join(''); };
    $('#cats').onclick = e => { const b = e.target.closest('[data-i]'); if (!b) return; cats[+b.dataset.i].on = !cats[+b.dataset.i].on; drawCats(); };
    $('#catAdd').onclick = () => { const v = $('#catIn').value.trim().slice(0, 14); if (!v) return; if (!cats.some(x => x.c === v)) cats.push({ c: v, on: true }); $('#catIn').value = ''; drawCats(); };
    drawCats();
  }
  if (F.challenge) {
    $('#goals').onclick = e => {
      const b = e.target.closest('[data-g]'); if (!b) return;
      const [g, u, t] = CHALLENGE_GOALS[+b.dataset.g];
      $('#cgoal').value = g; $('#cunit').value = u; $('#ctarget').value = t;
      $$('#goals .chip').forEach(c => c.classList.toggle('on', c === b));
    };
  }
  const days = new Set();
  if (F.days) {
    const list = Array.from({ length: 21 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i); return isoDay(d); });
    $('#days').innerHTML = list.map((d, i) => `<button type="button" class="chip" data-d="${d}">${i === 0 ? 'اليوم · ' : i === 1 ? 'بكرة · ' : ''}${esc(fmtDay(d, { weekday: 'short', day: 'numeric', month: 'short' }))}</button>`).join('');
    $('#days').onclick = e => { const b = e.target.closest('[data-d]'); if (!b) return; const d = b.dataset.d; days.has(d) ? days.delete(d) : days.add(d); b.classList.toggle('on', days.has(d)); };
  }

  $('#create').onclick = async e => {
    const cfg = {};
    if (F.subject) {
      cfg.subject = $('#subj').value.trim().slice(0, NAME_LEN);
      if (!cfg.subject) return toast('اكتب اسم صاحب الأسئلة', true);
    }
    if (F.names) {
      if ($('#nm').value.trim()) namesCtl.add();
      const min = F.names.min;
      if (names.length < min) return toast(min === 1 ? 'أضف اسم واحد على الأقل' : min === 2 ? 'أضف شخصين على الأقل' : `أضف ${min} أشخاص على الأقل`, true);
      cfg.names = names.filter(n => n !== cfg.subject);
      if (cfg.names.length < min) return toast('أضف اللي بيخمّنون (غير صاحب الأسئلة)', true);
    }
    if (F.open) {
      const o = $('#open').value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(o) || !capLocked(o)) return toast('اختر تاريخ بعد اليوم', true);
      cfg.open = o;
    }
    if (F.cats) {
      cfg.cats = cats.filter(x => x.on).map(x => x.c).slice(0, 8);
      if (cfg.cats.length < 2) return toast('اختر خانتين على الأقل', true);
    }
    if (F.days) {
      if (!days.size) return toast('اختر يوم واحد على الأقل', true);
      cfg.days = [...days].sort();
    }
    if (F.prompt) cfg.prompt = ($('#promptCustom').value.trim() || F.prompt.presets[promptSel]).slice(0, Q_LEN);
    if (F.questions) {
      const chosen = qs.filter(q => q.on).map(q => q.v);
      if (!chosen.length) return toast('اختر سؤال واحد على الأقل', true);
      if (F.questions.kind === 'guess') cfg.questions = chosen.map(([q, a]) => ({ q, a }));
      else if (F.questions.kind === 'quiz') {
        cfg.questions = chosen.map(([q, ...ans]) => { const o = shuffle([0, 1, 2, 3]); return { q, opts: o.map(i => ans[i]), c: o.indexOf(0) }; });
      } else cfg.questions = F.questions.kind === 'pair' ? chosen.map(v => ({ q: 'لو خيروك', opts: v })) : chosen.map(q => ({ q, opts: null }));
    }
    if (F.poll) {
      if ($('#po').value.trim()) optsCtl.add();
      const q = $('#pq').value.trim();
      if (!q) return toast('اكتب السؤال', true);
      if (opts.length < 2) return toast('أضف خيارين على الأقل', true);
      cfg.questions = [{ q: q.slice(0, Q_LEN), opts: opts.slice() }];
    }
    if (F.note) cfg.note = $('#note').value.trim().slice(0, 200);
    if (F.amount) { cfg.amount = numIn($('#amt').value); if (!(cfg.amount > 0)) return toast('اكتب المبلغ الشهري', true); }
    if (F.month) { cfg.start = $('#mstart').value; if (!/^\d{4}-\d{2}$/.test(cfg.start)) return toast('اختر أول شهر', true); }
    if (M.board === 'tourney' || (F.draw && $('#mdraw').checked)) cfg.names = shuffle(cfg.names); // قرعة
    if (M.board === 'daily') cfg.start = isoDay(new Date());
    if (F.challenge) {
      cfg.goal = $('#cgoal').value.trim().slice(0, 40); cfg.unit = $('#cunit').value.trim().slice(0, 12) || 'مرة';
      cfg.target = numIn($('#ctarget').value) || 0; cfg.end = $('#cend').value || '';
      if (!cfg.goal) return toast('اكتب الهدف', true);
    }
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = 'جاري الإنشاء…';
    try { await createSession(id, ($('#title').value.trim() || M.name).slice(0, TITLE_LEN), cfg); }
    catch (err) {
      console.error(err);
      toast(err.big ? 'الإعدادات كبيرة، قلّل الأسئلة أو الأسماء' : 'ما قدرنا ننشئ الجلسة، تأكد من النت وجرّب مرة ثانية', true);
      btn.disabled = false; btn.textContent = 'إنشاء الجلسة';
    }
  };
}

function brokenLink() {
  app.innerHTML = `${backLink()}<div class="card center"><div class="big-ic">🔗</div><h3>الرابط ناقص أو تغيّر</h3>
    <p class="muted">يمكن نقص منه حرف وقت النسخ. ارجع للرسالة وانسخ الرابط كامل، أو اضغط عليه مباشرة بدل النسخ.</p></div>`;
}

/* ============ التوجيه ============ */
function route() {
  closeSession();
  [offTimer, capTimer, quizTimer].forEach(t => clearInterval(t));
  scrollTo(0, 0);
  let h = location.hash.slice(1);
  try { h = decodeURIComponent(h); } catch {}
  if (h === 'tod') return OFFLINE.tod();
  if (h.startsWith('play/')) { const id = h.slice(5).replace(/[^a-z]/g, ''); return OFFLINE[id] ? OFFLINE[id]() : viewHome(); }
  if (h.startsWith('bill=')) return OFFLINE.bill(h.slice(5).replace(/[^\w-]/g, ''));
  if (!window.crypto || !crypto.subtle) {
    app.innerHTML = `<div class="card center"><h3>المتصفح ما يدعم التشفير</h3><p class="muted">افتح الصفحة برابط https من متصفح حديث.</p></div>`;
    return;
  }
  if (h.startsWith('cd=')) return OFFLINE.countdown(h.slice(3).replace(/[^\w-]/g, ''));
  if (h.startsWith('c=')) return openCapsuleLink(h.slice(2).replace(/[^\w-]/g, ''));
  if (h.startsWith('new/')) {
    const id = h.slice(4).replace(/[^a-z]/g, '');
    if (OFFLINE[id]) return OFFLINE[id]();
    return MODES[id] ? viewMode(id) : viewHome();
  }
  // تطبيقات الدردشة أحيانًا تضيف محارف مخفية (اتجاه النص) أو علامات في آخر الرابط
  h = h.replace(/[^\w.=-]/g, '');
  const m = h.match(/^([jhp])=([\w-]{8,64})\.([\w-]{43})(?:\.([\w-]{20,800}))?/);
  const go = (d, token) => openSession(m[2], m[3], d, token).catch(e => { console.error(e); brokenLink(); });
  if (m && m[1] === 'h') return m[4] && m[4].length >= 43 ? go(m[4].slice(0, 43), null) : brokenLink();
  if (m && m[1] === 'p') return m[4] ? go(null, m[4]) : brokenLink();
  if (m) return go(null, null);
  if (/^[jhp]=/.test(h)) return brokenLink();
  viewHome();
}
addEventListener('hashchange', route);
route();
