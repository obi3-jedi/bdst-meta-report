// Offline support for the BDST Meta Report.
// Page, styles and scripts: always fetched fresh when online (so updates show straight away), cached for offline use.
// Card data and art: served from cache, refreshed in the background (large and rarely change).
// Live data from the relay, fonts and CDN scripts are never cached here.
const SHELL = 'bdst-shell-v15', ART = 'bdst-art-v1';
const FILES = ['./', 'index.html', 'css/app.css', 'js/core.js', 'js/data.js', 'js/images.js', 'js/ui.js', 'js/overlay.js', 'js/sample.js', 'cards.js', 'bdst-logo.png', 'bdst-icon.png', 'manifest.webmanifest'];

self.addEventListener('install', e => { e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => ![SHELL, ART].includes(k)).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const slow = url.pathname.includes('/art/') || url.pathname.endsWith('/cards.js') || /\.png$/.test(url.pathname);
  if (slow) {
    e.respondWith(caches.open(url.pathname.includes('/art/') ? ART : SHELL).then(async c => {
      const cached = await c.match(e.request, { ignoreSearch: true });
      const fresh = fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => cached);
      return cached || fresh;
    }));
    return;
  }
  // Network first, cache as a fallback when offline
  e.respondWith(caches.open(SHELL).then(c => fetch(e.request, { cache: 'no-cache' })
    .then(r => { if (r.ok) c.put(e.request, r.clone()); return r; })
    .catch(() => c.match(e.request, { ignoreSearch: true }))));
});
