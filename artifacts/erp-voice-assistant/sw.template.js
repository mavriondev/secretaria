/* Tato service worker (minimal, safe).
 * Caches only the app shell (index, manifest, icons, offline page) and the hashed static assets.
 * Never caches /api/*, audio or anything with company data: those always go to the network, and offline they simply fail.
 * A new version installs in the background and waits; the app activates it on its next opening (see src/lib/pwa.ts). */
const VERSION = '__VERSION__';
const BASE = '__BASE__';
const SHELL = 'tato-shell-' + VERSION;
const ASSETS = 'tato-assets-' + VERSION;
const OFFLINE = BASE + 'offline.html';
const PRECACHE = [BASE, BASE + 'index.html', OFFLINE, BASE + 'manifest.webmanifest', BASE + 'icons/icon-192.png', BASE + 'icons/icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL).then(cache => cache.addAll(PRECACHE)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== SHELL && k !== ASSETS).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', event => { if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting(); });

const isApi = url => url.pathname.startsWith(BASE + 'api/') || url.pathname.startsWith('/api/');
const isAsset = url => url.pathname.startsWith(BASE + 'assets/');

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || isApi(url)) return; // network only, no cache, no offline fallback
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match(BASE + 'index.html').then(hit => hit || caches.match(OFFLINE))));
    return;
  }
  if (isAsset(url)) {
    // Hashed file names: safe to keep for as long as this version lives.
    event.respondWith(caches.match(request).then(hit => hit || fetch(request).then(res => { if (res.ok) caches.open(ASSETS).then(c => c.put(request, res.clone())); return res; })));
    return;
  }
  if (PRECACHE.includes(url.pathname) || url.pathname.startsWith(BASE + 'icons/')) {
    event.respondWith(fetch(request).then(res => { if (res.ok) caches.open(SHELL).then(c => c.put(request, res.clone())); return res; }).catch(() => caches.match(request)));
  }
});
