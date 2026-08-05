/*
 * Service worker for offline canvassing.
 *
 * Hand-written rather than generated. The caching rules here are few and each
 * one is a deliberate decision about what a rep should see with no signal; a
 * build-time plugin would bury those decisions in configuration.
 *
 * THE RULE THAT MATTERS: API responses are never served from cache. A rep
 * looking at a door needs to know whether the data in front of them is live or
 * remembered, and a silently-cached lead list would show yesterday's state as
 * though it were today's. Offline lead data comes from IndexedDB, which the app
 * reads deliberately and labels as offline. The cache here is only for the
 * shell — the HTML, JS and CSS needed to boot the app at all.
 */

const SHELL_CACHE = 'roof-leads-shell-v1';

/*
 * Cached on install so a cold launch with no signal still boots. Deliberately
 * tiny: Next fingerprints its build output, so listing chunks here would mean
 * caching paths that change every deploy. Those are picked up at runtime
 * instead.
 */
const SHELL_URLS = ['/admin/map', '/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // Individually, because one 404 in addAll rejects the whole install and
      // would leave the worker permanently un-installed.
      .then((cache) => Promise.allSettled(SHELL_URLS.map((u) => cache.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache the API. See the note at the top: stale lead data presented as
  // live is worse than an honest failure the app can handle.
  if (url.pathname.startsWith('/api/')) return;

  // Build output is content-hashed, so a cache hit is always correct and a miss
  // is always worth storing. Cache-first keeps a cold offline launch fast.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(SHELL_CACHE).then((c) => c.put(request, copy));
            }
            return res;
          })
      )
    );
    return;
  }

  /*
   * Documents: network first, cache as a fallback.
   *
   * The other way round would serve a stale shell after a deploy, which is how
   * a rep ends up running last week's JavaScript against this week's API. The
   * cost is that an offline navigation waits for the network to fail first,
   * which is a moment — and only when there is no signal at all.
   */
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put(request, copy));
          }
          return res;
        })
        .catch(() => caches.match(request).then((hit) => hit || caches.match('/admin/map')))
    );
  }
});
