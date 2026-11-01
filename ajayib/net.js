'use strict';
/* أرض العجايب — اللعب الجماعي
   • يتصل بسيرفر MQTT عام ومجاني عن طريق WebSocket (ما يحتاج سيرفر خاص).
   • كل عالم له "قناة"، وكل منطقة 64×64 مربع لها قناة فرعية عشان توصلك بس أخبار اللي حولك.
   • اللوحات والقوارير تنحفظ بالسيرفر (retained) عشان اللاعبين الجايين يشوفونها.
*/
const BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://test.mosquitto.org:8081/mqtt'
];
const NET_VER = 'ajyb1';
const REGION = 64;

/* ============ عميل MQTT 3.1.1 صغير ============ */
class MiniMQTT {
  constructor(url, opts) {
    this.url = url; this.o = opts; this.buf = new Uint8Array(0); this.pid = 1; this.ok = false;
    this.te = new TextEncoder(); this.td = new TextDecoder();
  }
  str(s) { const b = this.te.encode(s); return [b.length >> 8, b.length & 255, ...b]; }
  pkt(type, body) {
    const len = []; let n = body.length;
    do { let d = n % 128; n = Math.floor(n / 128); if (n > 0) d |= 128; len.push(d); } while (n > 0);
    const out = new Uint8Array(1 + len.length + body.length);
    out[0] = type; out.set(len, 1); out.set(body, 1 + len.length);
    return out;
  }
  open() {
    return new Promise((res, rej) => {
      let done = false;
      const fail = e => { if (!done) { done = true; rej(e); } try { this.ws.close(); } catch {} };
      try { this.ws = new WebSocket(this.url, ['mqtt']); } catch (e) { return fail(e); }
      this.ws.binaryType = 'arraybuffer';
      const timer = setTimeout(() => fail(new Error('timeout')), 7000);
      this.ws.onopen = () => {
        const o = this.o, will = o.will;
        const flags = 0x02 | (will ? 0x04 : 0);
        const body = [...this.str('MQTT'), 4, flags, 0, 45, ...this.str(o.clientId)];
        if (will) body.push(...this.str(will.topic), ...this.str(will.msg));
        this.send(this.pkt(0x10, body));
      };
      this.onConnack = rc => {
        clearTimeout(timer);
        if (rc === 0) { done = true; this.ok = true; this.lastRx = Date.now(); this.ping = setInterval(() => this.keep(), 15000); res(); }
        else fail(new Error('refused ' + rc));
      };
      this.ws.onmessage = e => this.rx(new Uint8Array(e.data));
      this.ws.onerror = () => fail(new Error('ws error'));
      this.ws.onclose = () => {
        clearTimeout(timer); clearInterval(this.ping);
        const was = this.ok; this.ok = false;
        if (!done) fail(new Error('closed'));
        else if (was && this.o.onClose) this.o.onClose();
      };
    });
  }
  keep() {
    if (Date.now() - this.lastRx > 50000) { try { this.ws.close(); } catch {} return; }
    this.send(new Uint8Array([0xC0, 0]));
  }
  send(bytes) { try { if (this.ws && this.ws.readyState === 1) this.ws.send(bytes); } catch {} }
  rx(chunk) {
    this.lastRx = Date.now();
    const b = new Uint8Array(this.buf.length + chunk.length);
    b.set(this.buf); b.set(chunk, this.buf.length);
    let off = 0;
    while (b.length - off >= 2) {
      let mul = 1, len = 0, i = off + 1, byte;
      do { if (i >= b.length) { this.buf = b.slice(off); return; } byte = b[i++]; len += (byte & 127) * mul; mul *= 128; } while (byte & 128 && mul < 268435456);
      if (b.length < i + len) break;
      this.handle(b[off], b.subarray(i, i + len));
      off = i + len;
    }
    this.buf = b.slice(off);
  }
  handle(h, p) {
    const type = h >> 4;
    if (type === 2) this.onConnack && this.onConnack(p[1]);
    else if (type === 3) {
      const qos = (h >> 1) & 3, tl = (p[0] << 8) | p[1];
      const topic = this.td.decode(p.subarray(2, 2 + tl));
      let i = 2 + tl;
      if (qos) { const id = (p[i] << 8) | p[i + 1]; i += 2; if (qos === 1) this.send(this.pkt(0x40, [id >> 8, id & 255])); }
      let msg; try { msg = this.td.decode(p.subarray(i)); } catch { return; }
      this.o.onMessage && this.o.onMessage(topic, msg, !!(h & 1));
    }
  }
  nextId() { this.pid = (this.pid % 65000) + 1; return [this.pid >> 8, this.pid & 255]; }
  subscribe(topics) { if (!topics.length) return; const body = [...this.nextId()]; for (const t of topics) body.push(...this.str(t), 0); this.send(this.pkt(0x82, body)); }
  unsubscribe(topics) { if (!topics.length) return; const body = [...this.nextId()]; for (const t of topics) body.push(...this.str(t)); this.send(this.pkt(0xA2, body)); }
  publish(topic, msg, retain) { this.send(this.pkt(0x30 | (retain ? 1 : 0), [...this.str(topic), ...this.te.encode(msg)])); }
  close() { this.o.onClose = null; try { this.send(new Uint8Array([0xE0, 0])); this.ws.close(); } catch {} clearInterval(this.ping); }
}

/* ============ طبقة الشبكة للعبة ============ */
const Net = {
  id: Math.random().toString(36).slice(2, 10),
  online: false, world: 'w1', broker: '', client: null, subs: new Set(), region: null,
  onMsg: null, onStatus: null, closed: true, tries: 0, sent: 0, received: 0,

  prefix() { return `${NET_VER}/${this.world}`; },
  brokers() {
    const q = new URLSearchParams(location.search).get('broker');
    if (q) return [q];
    const last = localStorage.getItem('ajayib.broker');
    return last && BROKERS.includes(last) ? [last, ...BROKERS.filter(b => b !== last)] : BROKERS;
  },
  async start(world) {
    this.world = String(world || 'w1').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16) || 'w1';
    this.closed = false;
    this.connect();
  },
  async connect() {
    if (this.closed) return;
    this.status('connecting');
    for (const url of this.brokers()) {
      if (this.closed) return;
      const c = new MiniMQTT(url, {
        clientId: 'aj_' + this.id + '_' + Math.random().toString(36).slice(2, 6),
        will: { topic: this.prefix() + '/g', msg: JSON.stringify({ t: 'bye', i: this.id }) },
        onMessage: (t, m, r) => this.rx(t, m, r),
        onClose: () => this.lost()
      });
      try {
        await c.open();
        if (this.closed) { c.close(); return; }
        this.client = c; this.broker = url; this.online = true; this.tries = 0;
        try { localStorage.setItem('ajayib.broker', url); } catch {}
        const base = this.prefix();
        this.subs = new Set([base + '/g', base + '/sign/+', base + '/bottle/+']);
        if (this.region) for (const t of this.regionTopics(this.region)) this.subs.add(t);
        c.subscribe([...this.subs]);
        this.status('online');
        return;
      } catch (e) { /* جرب اللي بعده */ }
    }
    this.status('offline');
    this.retry();
  },
  lost() {
    this.online = false; this.client = null;
    this.status('offline');
    this.retry();
  },
  retry() {
    if (this.closed) return;
    clearTimeout(this.rt);
    this.rt = setTimeout(() => this.connect(), Math.min(30000, 3000 * 2 ** this.tries++));
  },
  stop() {
    this.closed = true; clearTimeout(this.rt);
    if (this.client) { this.pub('g', { t: 'bye' }); this.client.close(); }
    this.client = null; this.online = false;
  },
  status(s) { this.onStatus && this.onStatus(s); },

  regionTopics([rx, ry]) {
    const out = [];
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const x = rx + i, y = ry + j;
      if (x >= 0 && y >= 0 && x < WORLD / REGION && y < WORLD / REGION) out.push(`${this.prefix()}/r/${x}_${y}`);
    }
    return out;
  },
  setRegion(px, py) {
    const r = [Math.floor(px / T / REGION), Math.floor(py / T / REGION)];
    if (this.region && r[0] === this.region[0] && r[1] === this.region[1]) return;
    const old = this.region ? this.regionTopics(this.region) : [];
    this.region = r;
    const neu = this.regionTopics(r);
    if (this.client && this.online) {
      const add = neu.filter(t => !this.subs.has(t)), del = old.filter(t => !neu.includes(t));
      this.client.unsubscribe(del); this.client.subscribe(add);
      for (const t of del) this.subs.delete(t);
      for (const t of add) this.subs.add(t);
    }
  },
  /* scope: g = العالم كله | r = منطقتي */
  pub(scope, obj) {
    if (!this.client || !this.online) return false;
    obj.i = this.id;
    let topic = this.prefix() + '/g';
    if (scope === 'r') { if (!this.region) return false; topic = `${this.prefix()}/r/${this.region[0]}_${this.region[1]}`; }
    this.client.publish(topic, JSON.stringify(obj));
    this.sent++;
    return true;
  },
  keep(kind, slot, obj) {
    if (!this.client || !this.online) return false;
    obj.i = this.id;
    this.client.publish(`${this.prefix()}/${kind}/${slot}`, JSON.stringify(obj), true);
    return true;
  },
  rate: new Map(),
  rx(topic, msg, retained) {
    if (msg.length > 2000) return;
    let o; try { o = JSON.parse(msg); } catch { return; }
    if (!o || typeof o !== 'object' || typeof o.i !== 'string' || o.i.length > 12) return;
    // منع الإغراق: 25 رسالة بالثانية كحد أقصى لكل لاعب
    const now = Date.now(), r = this.rate.get(o.i) || { t: now, n: 0 };
    if (now - r.t > 1000) { r.t = now; r.n = 0; }
    if (++r.n > 25 && !retained) return;
    this.rate.set(o.i, r);
    if (this.rate.size > 500) this.rate.clear();
    this.received++;
    const kind = topic.slice(this.prefix().length + 1).split('/')[0];
    this.onMsg && this.onMsg(o, kind, retained);
  }
};
