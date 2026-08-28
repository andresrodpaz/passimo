'use client'

import * as React from 'react'

/**
 * Registers the offline service worker.
 *
 * Deliberately silent: there is no toast, no prompt and nothing to accept. A
 * merchant should never be asked to opt in to their till continuing to work.
 *
 * Registration is deferred until the page is idle so it never competes with the
 * camera starting up — on a mid-range phone those milliseconds are visible.
 */
export function ServiceWorkerRegistrar() {
  React.useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
    // A worker registered against a dev server caches half-built assets and then
    // serves them after a rebuild, which looks exactly like a broken app.
    if (process.env.NODE_ENV !== 'production') return

    let cancelled = false

    const register = () => {
      if (cancelled) return
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .then((registration) => {
          // Take a new deploy on the next navigation rather than stranding a
          // counter device on last week's build until someone closes every tab.
          registration.addEventListener('updatefound', () => {
            registration.installing?.addEventListener('statechange', function onChange() {
              if (this.state === 'installed' && navigator.serviceWorker.controller) {
                registration.waiting?.postMessage('skip-waiting')
              }
            })
          })
        })
        .catch(() => {
          // Offline support is an enhancement; failing to register must never
          // affect the page the merchant is looking at.
        })
    }

    if ('requestIdleCallback' in window) {
      const handle = (window as unknown as {
        requestIdleCallback: (callback: () => void, options?: { timeout: number }) => number
      }).requestIdleCallback(register, { timeout: 4000 })
      return () => {
        cancelled = true
        ;(window as unknown as { cancelIdleCallback?: (handle: number) => void }).cancelIdleCallback?.(
          handle
        )
      }
    }

    const timer = setTimeout(register, 1500)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [])

  return null
}
