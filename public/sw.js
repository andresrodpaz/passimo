/**
 * Passimo service worker.
 *
 * Its only job is to keep a merchant working when the connection does not. A
 * counter tablet on café wifi will lose the network mid-shift, and without a
 * service worker a single reload at the wrong moment leaves the shop with no
 * till at all.
 *
 * Scope is deliberately narrow, because a service worker that gets caching wrong
 * is worse than none:
 *
 *   - hashed build assets     cache-first    (immutable by construction)
 *   - navigations             network-first  (falls back to the cached shell)
 *   - the counter roster      stale-while-revalidate (offline fallback list)
 *   - everything else         straight to the network, never cached
 *
 * Authenticated API responses are never stored. Customer balances and personal
 * data must not outlive the session on a shared counter device, and a stale
 * balance read from a cache is worse than an honest "you are offline" — staff
 * would quote a wrong number to a customer's face. The one exception is the
 * roster, which the scanner needs to stay usable and which contains only what is
 * already on screen when it is fetched.
 */

const VERSION = 'v1'
const SHELL_CACHE = `passimo-shell-${VERSION}`
const ASSET_CACHE = `passimo-assets-${VERSION}`
const DATA_CACHE = `passimo-data-${VERSION}`

/** The screens a merchant must be able to open with no connection. */
const SHELL_ROUTES = ['/pos', '/offline']

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE)
      // Individually, so one failed route cannot abort the whole install and
      // leave the merchant with no offline support at all.
      await Promise.allSettled(SHELL_ROUTES.map((route) => cache.add(new Request(route))))
      await self.skipWaiting()
    })()
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, ASSET_CACHE, DATA_CACHE])
      const names = await caches.keys()
      await Promise.all(names.filter((name) => !keep.has(name)).map((name) => caches.delete(name)))
      await self.clients.claim()
    })()
  )
})

/** Lets a newly deployed worker take over without waiting for every tab to close. */
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') void self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const request = event.request

  // Only GET is ever cacheable, and a scan submission must always hit the
  // network so the offline queue — not the cache — decides what happens next.
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // Never interfere with authentication.
  if (url.pathname.startsWith('/auth') || url.pathname.includes('/callback')) return

  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/fonts/')) {
    event.respondWith(cacheFirst(request, ASSET_CACHE))
    return
  }

  if (url.pathname === '/api/v1/counter/roster') {
    event.respondWith(staleWhileRevalidate(request, DATA_CACHE))
    return
  }

  // Every other API call goes to the network untouched.
  if (url.pathname.startsWith('/api/')) return

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request))
    return
  }
})

/** Hashed assets never change under a given URL, so a hit is always correct. */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  const hit = await cache.match(request)
  if (hit) return hit

  const response = await fetch(request)
  if (response.ok) void cache.put(request, response.clone())
  return response
}

/**
 * Serves the cached roster immediately and refreshes it in the background, so
 * the manual fallback list is present the instant the camera fails — including
 * when the network is already gone.
 */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName)
  const hit = await cache.match(request)

  const update = fetch(request)
    .then((response) => {
      if (response.ok) void cache.put(request, response.clone())
      return response
    })
    .catch(() => null)

  if (hit) return hit

  const fresh = await update
  return fresh ?? Response.error()
}

/**
 * Fresh pages when online, the last known good page when not.
 *
 * The cached copy is updated on every successful navigation, so "offline" shows
 * the shell the merchant last actually used rather than whatever was cached at
 * install time.
 */
async function networkFirstNavigation(request) {
  const cache = await caches.open(SHELL_CACHE)

  try {
    const response = await fetch(request)
    if (response.ok) void cache.put(request, response.clone())
    return response
  } catch {
    const hit = (await cache.match(request, { ignoreSearch: true })) ?? (await cache.match('/pos'))
    if (hit) return hit

    const offline = await cache.match('/offline')
    if (offline) return offline

    return new Response(
      '<!doctype html><meta charset="utf-8"><title>Offline</title>' +
        '<p style="font:16px system-ui;padding:2rem">You are offline. Reconnect to continue.</p>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    )
  }
}
