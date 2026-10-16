/* Cozy Island service worker (Phase 0, Order 18): near-instant repeat visits.
 * - assets/* are content-hashed and immutable: cache-first.
 * - the page itself: network-first (so a new release shows up), cached copy when offline.
 * - everything else same-origin: stale-while-revalidate.
 */
const VERSION = 'v1';
const ASSETS = `cozy-assets-${VERSION}`;
const PAGES = `cozy-pages-${VERSION}`;
const MAX_ASSETS = 160;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('cozy-') && k !== ASSETS && k !== PAGES) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data?.type !== 'cache-assets' || !Array.isArray(e.data.urls)) return;
  e.waitUntil((async () => {
    const cache = await caches.open(ASSETS);
    for (const u of e.data.urls) {
      try {
        if (new URL(u).origin !== self.location.origin || (await cache.match(u))) continue;
        const res = await fetch(u);
        if (res.ok) await cache.put(u, res);
      } catch { /* offline or gone: skip */ }
    }
    await trim(cache);
  })());
});

async function trim(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_ASSETS; i++) await cache.delete(keys[i]);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const scope = new URL(self.registration.scope);
  if (!url.pathname.startsWith(scope.pathname)) return;

  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      const cache = await caches.open(PAGES);
      try {
        const res = await fetch(req);
        if (res.ok) cache.put(scope.href, res.clone());
        return res;
      } catch {
        return (await cache.match(scope.href)) || (await cache.match(req)) || Response.error();
      }
    })());
    return;
  }

  if (url.pathname.startsWith(scope.pathname + 'assets/')) {
    e.respondWith((async () => {
      const cache = await caches.open(ASSETS);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) { await cache.put(req, res.clone()); trim(cache); }
      return res;
    })());
    return;
  }

  e.respondWith((async () => {
    const cache = await caches.open(PAGES);
    const hit = await cache.match(req);
    const net = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => hit);
    return hit || net;
  })());
});
