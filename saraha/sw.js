/*
  عامل الخدمة: يخلي صراحة تنفتح بدون نت (ألعاب «جوال واحد» تشتغل كاملة).
  • ملفات الموقع: من الشبكة أول (عشان التحديثات توصل)، ولو ما فيه نت من النسخة المحفوظة.
  • الخطوط: من النسخة المحفوظة أول.
  • ما يلمس رسائل الجلسات (ntfy أو Firebase) ولا خادم الذكاء الاصطناعي.
*/
const CACHE = 'saraha-v7';
const V = '?v=7';
const CORE = ['./', 'index.html', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png',
  ...['config.js', 'vendor/qrcode.js', 'polish.js', 'banks.js', 'banks2.js', 'banks3.js', 'modes.js', 'banks4.js', 'games.js', 'games2.js',
    'games3.js', 'offline.js', 'offline2.js', 'offline3.js', 'extras.js', 'app.js'].map(f => f + V)];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(CORE.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('saraha-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  const font = u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com';
  if (u.origin !== location.origin && !font) return;
  if ((r.headers.get('accept') || '').includes('text/event-stream')) return;
  if (font) {
    e.respondWith(caches.open(CACHE).then(async c => {
      const hit = await c.match(r);
      if (hit) return hit;
      const res = await fetch(r);
      if (res.ok || res.type === 'opaque') c.put(r, res.clone());
      return res;
    }));
    return;
  }
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    try {
      const res = await fetch(r);
      if (res.ok) c.put(r, res.clone());
      return res;
    } catch (err) {
      const hit = await c.match(r) || (r.mode === 'navigate' ? (await c.match('./') || await c.match('index.html')) : null);
      if (hit) return hit;
      throw err;
    }
  })());
});
