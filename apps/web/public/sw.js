/**
 * A service worker for the driver surface.
 *
 * ── what it caches, and what it deliberately does not ────────────────────────
 *
 * It caches the app shell -- the static assets a page needs to render at all --
 * and nothing else. It does not cache a navigation response and serve it later.
 *
 * That restraint is the whole design. A driver offline who opens the app must be
 * told "you are offline and here is what is queued", not shown a stale copy of the
 * stop list from this morning, because a stop list that has changed since it was
 * cached is how a van drives to a pharmacy it already served. The queued work is
 * in IndexedDB (see src/lib/delivery/offline-queue.ts) and the run itself is
 * re-fetched; what the worker provides is the code to draw that screen when the
 * fetch fails.
 *
 * ── never cached ────────────────────────────────────────────────────────────
 *
 * Anything under /api or Supabase: a delivery record read from a cache is not
 * evidence, and this application is about records people get asked to defend.
 */

const CACHE = 'pharmaflow-shell-v1';

/** Hashed build assets are safe to keep forever; they cannot go stale. */
const PRECACHE = ['/ar/driver', '/en/driver'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE).catch(() => undefined)),
  );
  // Take over promptly rather than leaving a stale worker in charge of a driver.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.includes('/rest/v1/')) return;

  // Only immutable build output is cached. A navigation response is never served
  // from the cache, for the reason in the header comment.
  if (!url.pathname.startsWith('/_next/static/') && !url.pathname.endsWith('.svg')) return;

  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ??
        fetch(request).then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});