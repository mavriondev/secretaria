/* Tato service worker (minimal, safe).
 * Caches only the app shell (index, manifest, icons, offline page) and the hashed static assets.
 * Never caches /api/*, audio or anything with company data: those always go to the network, and offline they simply fail.
 * A new version installs in the background and waits; the app activates it on its next opening (see src/lib/pwa.ts).
 *
 * CACHE_EPOCH: raising this number makes the next activation delete every tato-* cache (any version) and the app reload
 * once. Use it when a device may hold a bad copy of a file whose name did not change (e.g. served with a wrong type). */
const CACHE_EPOCH = __EPOCH__;
const VERSION = '__VERSION__';
const BASE = '__BASE__';
const PREFIX = 'tato-e' + CACHE_EPOCH + '-';
const SHELL = PREFIX + 'shell-' + VERSION;
const ASSETS = PREFIX + 'assets-' + VERSION;
const OFFLINE = BASE + 'offline.html';
const PRECACHE = [BASE, BASE + 'index.html', OFFLINE, BASE + 'manifest.json', BASE + 'icons/icon-192.png', BASE + 'icons/icon-512.png'];

/* Types the browser insists on. A module or wasm served as application/octet-stream is refused by the engine, so such a
 * response must never be stored, and a stored one must be thrown away. */
const REQUIRED_TYPES = {
  mjs: ['text/javascript', 'application/javascript'],
  js: ['text/javascript', 'application/javascript'],
  wasm: ['application/wasm'],
  css: ['text/css'],
};
const extensionOf = pathname => { const m = /\.([a-z0-9]+)$/i.exec(pathname); return m ? m[1].toLowerCase() : ''; };
const typeOf = response => ((response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase());
const wellTyped = (pathname, response) => {
  if (!response || !response.ok) return false;
  const required = REQUIRED_TYPES[extensionOf(pathname)];
  return !required || required.includes(typeOf(response));
};

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL).then(cache => cache.addAll(PRECACHE)));
});
self.addEventListener('activate', event => {
  // Every tato-* cache that is not this version's (older versions and older epochs alike) is removed.
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('tato-') && k !== SHELL && k !== ASSETS).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', event => { if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting(); });

const isApi = url => url.pathname.startsWith(BASE + 'api/') || url.pathname.startsWith('/api/');
/* TV panel addresses carry a secret: never cached, never answered from cache, not even the offline fallback. */
const isPainel = url => url.pathname.startsWith(BASE + 'painel/') || url.pathname.startsWith('/painel/');
const isAsset = url => url.pathname.startsWith(BASE + 'assets/');

/* Hashed assets: cache-first, but only well-typed responses are trusted. A bad network response is retried once with
 * cache: 'reload' to bypass the browser's own HTTP cache (Safari keeps the wrong copy otherwise). */
async function assetResponse(request, url) {
  const cache = await caches.open(ASSETS);
  const hit = await cache.match(request);
  if (hit) {
    if (wellTyped(url.pathname, hit)) return hit;
    await cache.delete(request);
  }
  let response = await fetch(request);
  if (!wellTyped(url.pathname, response)) {
    const retry = await fetch(new Request(request, { cache: 'reload' })).catch(() => null);
    if (retry) response = retry;
  }
  if (wellTyped(url.pathname, response)) cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || isApi(url) || isPainel(url)) return; // network only, no cache, no offline fallback
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match(BASE + 'index.html').then(hit => hit || caches.match(OFFLINE))));
    return;
  }
  if (isAsset(url)) {
    event.respondWith(assetResponse(request, url));
    return;
  }
  if (PRECACHE.includes(url.pathname) || url.pathname.startsWith(BASE + 'icons/')) {
    event.respondWith(fetch(request).then(res => { if (res.ok) caches.open(SHELL).then(c => c.put(request, res.clone())); return res; }).catch(() => caches.match(request)));
  }
});

/* Push (alerts on favourites). The payload carries only the favourite's title and the observed value; anything more is
 * read inside the authenticated app. A click opens (or focuses) the app on the page the notice points to. */
self.addEventListener('push', event => {
  let data = { title: 'Tato', body: 'Você tem um aviso novo.', url: BASE + 'avisos' };
  try { data = Object.assign(data, event.data ? event.data.json() : {}); } catch { /* texto simples ou vazio: usa o padrão */ }
  const url = data.url && data.url.startsWith('/') && !data.url.startsWith(BASE) ? BASE + data.url.slice(1) : data.url;
  event.waitUntil(self.registration.showNotification(data.title, {
    body: data.body, icon: BASE + 'icons/icon-192.png', badge: BASE + 'icons/icon-192.png', tag: 'tato-aviso', renotify: true, data: { url },
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || BASE + 'avisos';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const open = list.find(c => c.url.startsWith(self.location.origin + BASE));
    if (open) return open.navigate(target).then(c => (c || open).focus());
    return self.clients.openWindow(target);
  }));
});
