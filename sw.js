/**
 * Meta Ads Dashboard — Service Worker
 *
 * Strategy:
 *   - HTML and own-origin CSS/JS: stale-while-revalidate
 *     (serve cached copy instantly, refresh in background for next visit)
 *   - Meta Graph API calls: network-only
 *     (never cache live ad data here — APP already does daily localStorage cache)
 *   - Tailwind CDN + Anthropic SDK / fonts: cache-first
 *     (immutable URLs, can be cached aggressively)
 *
 * Bump CACHE_VERSION whenever you change the strategy or want to nuke
 * old caches. Old caches are purged on the next 'activate' event.
 */
const CACHE_VERSION = 'meta-ads-v30';
const ASSET_CACHE   = `${CACHE_VERSION}-assets`;
const HTML_CACHE    = `${CACHE_VERSION}-html`;

self.addEventListener('install', () => {
  /* Skip the default waiting state so a refreshed sw.js takes effect
     immediately for the next page load. */
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    /* Delete any caches from prior CACHE_VERSION. */
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(k => !k.startsWith(CACHE_VERSION))
      .map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  /* Never cache the Meta Graph API. Live data must hit the network. */
  if (url.hostname === 'graph.facebook.com' || url.hostname === 'api.anthropic.com') {
    return;
  }

  /* HTML: stale-while-revalidate. The user sees the cached version
     instantly (< 50 ms) while the network refreshes the cache for
     the next visit. */
  const accept = req.headers.get('accept') || '';
  const isHTML = req.mode === 'navigate'
              || accept.includes('text/html')
              || url.pathname === '/'
              || url.pathname.endsWith('/')
              || url.pathname.endsWith('.html');

  if (isHTML) {
    e.respondWith(staleWhileRevalidate(req, HTML_CACHE));
    return;
  }

  /* Own-origin static assets (CSS, JS, SVG, fonts): stale-while-revalidate
     keyed on full URL. Cross-origin CDN assets: cache-first (they're
     versioned by URL hash, so they're immutable). */
  if (url.origin === self.location.origin) {
    e.respondWith(staleWhileRevalidate(req, ASSET_CACHE));
  } else {
    e.respondWith(cacheFirst(req, ASSET_CACHE));
  }
});

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const networkP = fetch(req).then(res => {
    /* Only cache successful, basic-or-cors responses. Avoid caching
       partial / redirected / opaque-error responses which can poison
       the cache. */
    if (res && res.ok && (res.type === 'basic' || res.type === 'cors')) {
      cache.put(req, res.clone());
    }
    return res;
  }).catch(() => cached);  // fall back to cache if network fails
  return cached || networkP;
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (_) {
    /* If both cache miss AND network fail, return a useful error. */
    return new Response('Offline and not cached.', { status: 503 });
  }
}
