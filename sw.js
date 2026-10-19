/* TimeBox service worker — makes the app open instantly and work offline.
   Your data is NOT stored here; it lives in the app's own storage. Bump VERSION when you deploy changes. */
const VERSION = 'tb-3.0.0-s3';
const SHELL = ['./', './index.html', './styles.css', './app.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== 'tb-fonts').map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);
  // Google Fonts: cache after first load so the app looks right offline
  if(url.hostname.endsWith('fonts.googleapis.com') || url.hostname.endsWith('fonts.gstatic.com')){
    e.respondWith(caches.open('tb-fonts').then(async c => {
      const hit = await c.match(req);
      const net = fetch(req).then(r => { c.put(req, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }
  if(url.origin !== location.origin) return;
  // App files: network first (so updates arrive), fall back to cache when offline
  // revalidate with the server so a new index.html never meets an old app.js from the browser cache
  e.respondWith(fetch(req.url, {cache:'no-cache', credentials:'same-origin'}).then(r => {
    if(r.ok){ const copy = r.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
    return r;
  }).catch(() => caches.match(req, {ignoreSearch:true}).then(hit => hit || caches.match('./index.html'))));
});
