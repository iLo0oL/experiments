const C='malafati-v1';
const SHELL=['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png',
  './vendor/pdf-lib.min.js','./vendor/pdf.min.mjs','./vendor/pdf.worker.min.mjs'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith('malafati-')&&k!==C).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  const req=e.request;if(req.method!=='GET')return;
  const u=new URL(req.url);
  // خطوط Google: من الكاش أولًا عشان العربي يطلع حلو حتى بدون إنترنت
  if(u.hostname==='fonts.googleapis.com'||u.hostname==='fonts.gstatic.com'){
    e.respondWith(caches.open(C).then(c=>c.match(req).then(r=>r||fetch(req).then(res=>{if(res.ok||res.type==='opaque')c.put(req,res.clone());return res}))));
    return;
  }
  if(u.origin!==location.origin)return;
  if(req.mode==='navigate'){
    e.respondWith(fetch(req).then(r=>{if(r.ok){const cp=r.clone();caches.open(C).then(c=>c.put('./index.html',cp))}return r})
      .catch(()=>caches.match('./index.html').then(r=>r||caches.match('./'))));
    return;
  }
  e.respondWith(caches.match(req).then(r=>r||fetch(req).then(res=>{
    if(res.ok&&u.pathname.includes('/malafati/')){const cp=res.clone();caches.open(C).then(c=>c.put(req,cp))}
    return res;
  })));
});
