'use strict';
process.env.KASHIF_SKIP_ENV_FILE = '1';

const { loadConfig } = require('../src/config');
const { openDb } = require('../src/db');
const { createApp } = require('../src/app');

const silent = { log() {}, error() {}, warn() {} };

async function startApp(overrides = {}, { fetch } = {}) {
  const cfg = loadConfig({
    quiet: true,
    secret: 'test-secret',
    limits: { apiPerMinute: 10000, searchesPerMinute: 1000, searchesPerDay: 1000, anonSearchesPerDay: 1000, otpPerPhonePer15Min: 100, otpPerIpPerHour: 1000, reportsPerDay: 1000 },
    reports: { minToShow: 2 },
    ...overrides,
  });
  const db = openDb(':memory:');
  const app = createApp({ cfg, db, fetch, log: silent });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    cfg,
    db,
    base,
    client: () => new Client(base),
    close: () => new Promise((r) => server.close(() => { db.close(); r(); })),
  };
}

// Tiny HTTP client that keeps the session cookie.
class Client {
  constructor(base) {
    this.base = base;
    this.cookie = '';
  }
  async req(method, path, body, headers = {}) {
    const res = await fetch(this.base + path, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(this.cookie ? { Cookie: this.cookie } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.getSetCookie();
    for (const c of set) {
      const [pair] = c.split(';');
      this.cookie = pair.endsWith('=') ? '' : pair;
    }
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, body: json, text, headers: res.headers };
  }
  get(p) { return this.req('GET', p); }
  post(p, b) { return this.req('POST', p, b || {}); }
  put(p, b) { return this.req('PUT', p, b || {}); }
  del(p, b) { return this.req('DELETE', p, b); }

  async login(phone) {
    const r1 = await this.post('/api/auth/request-otp', { phone, acceptTerms: true });
    if (r1.status !== 200) throw new Error('request-otp failed: ' + r1.text);
    const r2 = await this.post('/api/auth/verify-otp', { phone: r1.body.e164, code: r1.body.devCode });
    if (r2.status !== 200) throw new Error('verify-otp failed: ' + r2.text);
    return r1.body.e164;
  }
}

module.exports = { startApp };
