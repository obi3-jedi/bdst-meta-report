// Offline cache for the BDST Meta Report. The app shell is served from cache and refreshed in the
// background (so a new version shows on the next visit); card art is cached once; live data is never cached.
const SHELL = 'bdst-shell-v1', ART = 'bdst-art-v1';
const FILES = ['./', 'index.html', 'css/app.css', 'js/core.js', 'js/data.js', 'js/images.js', 'js/ui.js', 'js/overlay.js', 'js/sample.js', 'cards.js', 'bdst-logo.png', 'bdst-icon.png', 'manifest.webmanifest'];

self.addEventListener('install', e => { e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => ![SHELL, ART].includes(k)).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;   // relay, fonts, CDN: straight to the network
  if (url.pathname.includes('/art/')) {
    e.respondWith(caches.open(ART).then(async c => (await c.match(e.request)) || fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; })));
    return;
  }
  e.respondWith(caches.open(SHELL).then(async c => {
    const cached = await c.match(e.request, { ignoreSearch: true });
    const fresh = fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => cached);
    return cached || fresh;
  }));
});
