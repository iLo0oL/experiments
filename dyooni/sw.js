/* ديوني: يخزّن واجهة التطبيق عشان يشتغل بدون نت، ويعرض تنبيهات الأقساط */
const C = 'dyooni-v3';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', '../shared/sync.js'];
self.addEventListener('install', e => { e.waitUntil(caches.open(C).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  /* نمسح بس كاشات ديوني القديمة، لأن الكاش مشترك مع باقي التطبيقات بنفس الموقع */
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('dyooni-') && k !== C).map(k => caches.delete(k)))).then(() => self.clients.claim()));
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
/* تنبيهات: القسط اليوم، ويوم الراتب، وتأكيد الاستلام، ودفعة جديدة بكشف وصلك */
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) { d = { title: 'ديوني', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'ديوني', { body: d.body || '', icon: 'icon-192.png', badge: 'icon-192.png', dir: 'rtl', lang: 'ar', tag: d.tag || 'dyooni', data: { url: d.url || self.registration.scope } }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close(); const url = (e.notification.data && e.notification.data.url) || self.registration.scope;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if (c.url.startsWith(self.registration.scope) && 'focus' in c) { const h = url.split('#')[1]; if (h) c.postMessage({ go: h }); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
