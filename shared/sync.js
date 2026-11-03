/*
  مكتبة المزامنة المشتركة لتطبيقات «تجارب»
  - كل مستند له مفتاح تعديل ومفتاح عرض
  - التعديلات تنحفظ بالجهاز على طول، وتنرسل للسيرفر لما يكون فيه نت
  - لكل عنصر ينحفظ الأحدث (حسب وقت التعديل u)، والحذف يبقى علامة {del:1}
  الاستخدام:
    const d = Tajarib.open({id, key, onChange, onStatus}).start();
    d.items(); d.item(id); d.meta(); d.set(id, obj); d.del(id); d.setMeta(obj);
*/
(function () {
  'use strict';
  const DEFAULT_SERVER = '';
  const ERR = {
    net: 'ما قدرت أوصل للسيرفر، تأكد من النت', bad_key: 'الرابط غلط أو انتهت صلاحيته', not_found: 'ما لقيته، يمكن انحذف',
    rate: 'محاولات كثيرة، استنى شوي وجرّب', too_big: 'البيانات كبيرة مرة', too_many: 'تعديلات كثيرة مرة وحدة',
    taken: 'هالموعد انحجز قبل شوي، اختار وقت ثاني', outside: 'هالوقت برا أوقات الدوام', closed: 'الحجز مقفل الحين',
    bad_time: 'اختار وقت بالمستقبل', bad_name: 'اكتب اسمك', bad_phone: 'رقم الجوال غلط', bad_service: 'الخدمة مو موجودة',
    bad_code: 'رمز الإلغاء غلط', noserver: 'المزامنة مو مفعّلة', nopush: 'متصفحك ما يدعم التنبيهات', denied: 'ما سمحت بالتنبيهات',
    nosw: 'ثبّت التطبيق أو افتحه من رابطه عشان تشتغل التنبيهات', server: 'صار خطأ بالسيرفر، جرّب بعد شوي'
  };
  const isObj = x => x && typeof x === 'object' && !Array.isArray(x);
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } }
  function parse(s) { try { return JSON.parse(s); } catch (e) { return null; } }
  function err(code, status) { const e = new Error(code); e.code = code; e.status = status; return e; }
  function server() { return String(ls('tajarib.server') || DEFAULT_SERVER).trim().replace(/\/+$/, ''); }
  async function req(method, path, body) {
    const base = server(); if (!base) throw err('noserver');
    let r; try { r = await fetch(base + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' }); } catch (e) { throw err('net'); }
    let j = null; try { j = await r.json(); } catch (e) { }
    if (!r.ok) throw err((j && j.error) || 'server', r.status); return j;
  }
  const enc = encodeURIComponent;
  function b64u(s) { const p = '='.repeat((4 - s.length % 4) % 4); const b = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, c => c.charCodeAt(0)); }

  class Doc {
    constructor(o) {
      this.id = o.id; this.key = o.key; this.onChange = o.onChange || (() => { }); this.onStatus = o.onStatus || (() => { });
      this.interval = o.poll || 4000; this.ck = 'tajarib.doc.' + o.id;
      const c = parse(ls(this.ck)) || {}; const cb = c.body || {}, cp = c.pending || {};
      this.body = { items: isObj(cb.items) ? cb.items : {}, meta: isObj(cb.meta) ? cb.meta : null };
      this.pending = { items: isObj(cp.items) ? cp.items : {}, meta: isObj(cp.meta) ? cp.meta : null };
      this.rev = c.rev || 0; this.role = c.role || null; this.kind = c.kind || o.kind || null;
      this.status = 'idle'; this.error = null; this._stopped = true;
      this._wake = () => { if (!document.hidden && !this._stopped) { this.pull(); if (this.hasPending()) this._schedulePush(0); } };
    }
    _save() { ls(this.ck, JSON.stringify({ body: this.body, pending: this.pending, rev: this.rev, role: this.role, kind: this.kind })); }
    _status(s, e) { this.error = e || null; if (this.status !== s || e) { this.status = s; try { this.onStatus(s, e ? (ERR[e.code] || ERR.server) : ''); } catch (x) { } } }
    _changed(how) { try { this.onChange(how); } catch (x) { console.error(x); } }
    view() {
      const items = { ...this.body.items };
      for (const [id, it] of Object.entries(this.pending.items)) if (!items[id] || +it.u >= +(items[id].u || 0)) items[id] = it;
      let meta = this.body.meta; const pm = this.pending.meta; if (pm && (!meta || +pm.u >= +(meta.u || 0))) meta = pm;
      return { items, meta };
    }
    items() { return Object.entries(this.view().items).filter(([, it]) => it && !it.del).map(([id, it]) => ({ ...it, id })); }
    item(id) { const it = this.view().items[id]; return it && !it.del ? { ...it, id } : null; }
    meta() { const m = this.view().meta; return m ? { ...m } : null; }
    canEdit() { return this.role !== 'view'; }
    hasPending() { return Object.keys(this.pending.items).length > 0 || !!this.pending.meta; }
    _edit(fn) { if (!this.canEdit()) throw err('bad_key'); fn(); this._save(); this._schedulePush(); this._changed({ local: true }); }
    set(id, obj) { let it; this._edit(() => { it = { ...obj, u: Date.now() }; delete it.id; this.pending.items[id] = it; }); return it; }
    del(id) { this._edit(() => { this.pending.items[id] = { del: 1, u: Date.now() }; }); }
    setMeta(obj) { this._edit(() => { this.pending.meta = { ...obj, u: Date.now() }; }); }
    start() { if (!this._stopped) return this; this._stopped = false; document.addEventListener('visibilitychange', this._wake); window.addEventListener('online', this._wake); this.pull(); return this; }
    stop() { this._stopped = true; clearTimeout(this._timer); clearTimeout(this._pushT); document.removeEventListener('visibilitychange', this._wake); window.removeEventListener('online', this._wake); }
    _loop() { clearTimeout(this._timer); if (!this._stopped) this._timer = setTimeout(() => this.pull(), document.hidden ? 30000 : this.interval); }
    _prune() {
      for (const [id, it] of Object.entries(this.pending.items)) { const s = this.body.items[id]; if (s && +s.u >= +it.u) delete this.pending.items[id]; }
      if (this.pending.meta && this.body.meta && +this.body.meta.u >= +this.pending.meta.u) this.pending.meta = null;
    }
    async pull() {
      if (this._stopped) return; if (this._pulling) { this._pullAgain = true; return; } this._pulling = true;
      try {
        const r = await req('GET', `/api/docs/${enc(this.id)}?k=${enc(this.key)}&rev=${this.rev}`); this.role = r.role;
        if (!r.same) { const b = r.body || {}; this.body = { items: isObj(b.items) ? b.items : {}, meta: isObj(b.meta) ? b.meta : null }; this.rev = r.rev; this.kind = r.kind || this.kind; this._prune(); this._save(); this._changed({ remote: true }); }
        this._status(this.hasPending() ? 'saving' : 'ok');
      } catch (e) {
        this._status(e.code === 'net' ? 'offline' : 'error', e);
        if (e.code === 'bad_key' || e.code === 'not_found') { this._pulling = false; this.stop(); return; }
      }
      this._pulling = false; if (this.hasPending()) this._schedulePush(0);
      if (this._pullAgain) { this._pullAgain = false; this.pull(); return; } this._loop();
    }
    _schedulePush(d = 500) { clearTimeout(this._pushT); if (!this._stopped) this._pushT = setTimeout(() => this.push(), d); }
    async push() {
      if (this._stopped || !this.hasPending()) return; if (this._pushing) { this._pushAgain = true; return; } this._pushing = true; this._status('saving');
      const items = { ...this.pending.items }, meta = this.pending.meta, base = this.rev;
      try {
        const r = await req('PATCH', `/api/docs/${enc(this.id)}`, { k: this.key, base, items, meta });
        for (const [id, it] of Object.entries(items)) { const s = this.body.items[id]; if (!s || +it.u >= +(s.u || 0)) this.body.items[id] = it; if (this.pending.items[id] && this.pending.items[id].u === it.u) delete this.pending.items[id]; }
        if (meta) { if (!this.body.meta || +meta.u >= +(this.body.meta.u || 0)) this.body.meta = meta; if (this.pending.meta && this.pending.meta.u === meta.u) this.pending.meta = null; }
        if (r.rev === base + (r.applied ? 1 : 0)) this.rev = r.rev; else this._needPull = true;
        this._save(); this._status(this.hasPending() ? 'saving' : 'ok');
      } catch (e) {
        this._pushing = false; this._status(e.code === 'net' ? 'offline' : 'error', e);
        if (e.code !== 'bad_key' && e.code !== 'not_found') this._pushT = setTimeout(() => this.push(), e.code === 'net' ? 8000 : 15000);
        return;
      }
      this._pushing = false;
      if (this._pushAgain || this.hasPending()) { this._pushAgain = false; this._schedulePush(150); }
      if (this._needPull) { this._needPull = false; this.pull(); }
    }
  }

  const Tajarib = {
    server, setServer(url) { ls('tajarib.server', url ? String(url).replace(/\/+$/, '') : null); },
    available() { return !!server(); },
    errorText(e) { return ERR[e && (e.code || e.message)] || ERR.server; },
    newId(prefix) { return (prefix || '') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); },
    async create(kind, body) { return req('POST', '/api/docs', { kind, body: body || {} }); },
    open(o) { return new Doc(o); },
    forget(id) { ls('tajarib.doc.' + id, null); },
    rotateKeys(id, key, which) { return req('POST', `/api/docs/${enc(id)}/keys`, { k: key, which }); },
    remove(id, key) { return req('DELETE', `/api/docs/${enc(id)}`, { k: key }); },
    /* رابط الانضمام: يحط المعرّف والمفتاح بعد # عشان ما يوصل للسيرفر في السجلات */
    joinLink(base, id, key, extra) { return `${base}#j=${enc(id)}.${enc(key)}${extra ? '&' + extra : ''}`; },
    parseJoin(hash) { const m = /[#&]j=([\w-]+)\.([\w-]+)/.exec(hash == null ? location.hash : hash); return m ? { id: m[1], key: m[2] } : null; },
    bookings: {
      busy(id, key, from, to) { return req('GET', `/api/docs/${enc(id)}/busy?k=${enc(key)}&from=${from}&to=${to}`).then(r => r.busy); },
      book(id, key, data) { return req('POST', `/api/docs/${enc(id)}/bookings`, { k: key, ...data }); },
      list(id, key) { return req('GET', `/api/docs/${enc(id)}/bookings?k=${enc(key)}`).then(r => r.bookings); },
      setStatus(id, key, bid, status) { return req('PATCH', `/api/docs/${enc(id)}/bookings/${enc(bid)}`, { k: key, status }); },
      cancel(bid, code) { return req('POST', `/api/bookings/${enc(bid)}/cancel`, { code }); }
    },
    push: {
      async subscribe(id, key) {
        if (!('serviceWorker' in navigator) || !('PushManager' in window) || !window.Notification) throw err('nopush');
        if (await Notification.requestPermission() !== 'granted') throw err('denied');
        const reg = await Promise.race([navigator.serviceWorker.ready, new Promise(r => setTimeout(() => r(null), 8000))]); if (!reg) throw err('nosw');
        const { key: vk } = await req('GET', '/api/push/key');
        let sub = await reg.pushManager.getSubscription(); if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(vk) });
        await req('POST', `/api/docs/${enc(id)}/push`, { k: key, sub: sub.toJSON() }); return true;
      },
      test(id, key) { return req('POST', `/api/docs/${enc(id)}/push/test`, { k: key }); }
    }
  };
  window.Tajarib = Tajarib;
})();
