/* القطّة: يخزّن واجهة التطبيق عشان يشتغل بدون نت */
const C = 'qatta-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', '../shared/sync.js', './vendor/qrcode-generator-2.0.4.js'];
self.addEventListener('install', e => { e.waitUntil(caches.open(C).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  /* نمسح بس كاشات القطّة القديمة، لأن الكاش مشترك مع باقي التطبيقات بنفس الموقع */
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('qatta-') && k !== C).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, u = new URL(req.url);
  if (req.method !== 'GET' || u.origin !== location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(Promise.race([
      fetch(req).then(r => { if (r.ok) { const cp = r.clone(); caches.open(C).then(c => c.put('./index.html', cp)); } return r; }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 6000))
    ]).catch(() => caches.match('./index.html').then(r => r || fetch(req))));
    return;
  }
  /* باقي الملفات: من الكاش على طول، ونحدّثه بالخلفية */
  e.respondWith(caches.open(C).then(c => c.match(req).then(hit => {
    const net = fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; });
    if (hit) { net.catch(() => {}); return hit; }
    return net;
  })));
});
