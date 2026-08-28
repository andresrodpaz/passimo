import { expect, test } from '@playwright/test'
import { LOCALE_COOKIE } from '@/lib/i18n/locales'

/**
 * Counter and offline behaviour.
 *
 * These run unauthenticated and unseeded, so they assert the properties that
 * must hold on any deployment: the hardware-free promise is kept (the scanner
 * ships as part of the app, not as a separate download), the offline story is
 * real (a service worker and a manifest are actually served), and the counter is
 * never left without a way in.
 *
 * The camera itself cannot be asserted here — Playwright has no real one — so the
 * decoder is covered by unit tests and the *fallback* paths are covered here,
 * which is the half that has to work when something has already gone wrong.
 */

/*
 * Pinned to English, for the same reason the other specs pin it: these assert on
 * behaviour, and coupling them to whichever language ships as the default would
 * make them fail on a marketing decision rather than on a regression.
 */
test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([
    { name: LOCALE_COOKIE, value: 'en', url: baseURL ?? 'http://localhost:3000' },
  ])
})

test.describe('progressive web app', () => {
  test('serves an installable manifest pointing at the scanner', async ({ request }) => {
    const response = await request.get('/manifest.webmanifest')
    expect(response.ok()).toBeTruthy()

    const manifest = await response.json()
    // A counter device pinned to the till should open the till, not a marketing
    // page, and must run without browser chrome eating the viewport.
    expect(manifest.start_url).toBe('/pos')
    expect(manifest.display).toBe('standalone')
    expect(manifest.icons.length).toBeGreaterThan(0)
    expect(manifest.name).toContain('Passimo')
  })

  test('serves the offline service worker as executable JavaScript', async ({ request }) => {
    const response = await request.get('/sw.js')
    expect(response.ok()).toBeTruthy()
    expect(response.headers()['content-type']).toContain('javascript')

    const body = await response.text()
    // The guarantee that matters: authenticated customer data is never cached
    // onto a shared counter device.
    expect(body).toContain('/api/v1/counter/roster')
    expect(body).toContain("request.method !== 'GET'")
  })

  test('the offline page reassures the merchant their scans are safe', async ({ page }) => {
    await page.goto('/offline')
    await expect(page.getByRole('heading', { name: /you are offline/i })).toBeVisible()
    // A merchant who thinks they lost the morning's customers stops using the
    // product, so this promise is asserted explicitly.
    await expect(page.getByText(/no visit(s)? (is|are) lost/i)).toBeVisible()
    // A way straight back to the counter, labelled the same as the sidebar so a
    // merchant recognises it. The label itself is copy; that there *is* a link is
    // the contract.
    await expect(page.getByRole('link', { name: /scan/i }).first()).toBeVisible()
    await expect(page.getByRole('link', { name: /scan/i }).first()).toHaveAttribute('href', '/pos')
  })
})

test.describe('security headers for camera and worker use', () => {
  test('allows the camera on our own origin and nowhere else', async ({ request }) => {
    const response = await request.get('/login')
    const permissions = response.headers()['permissions-policy'] ?? ''
    // Without `camera=(self)` the scanner cannot open at all.
    expect(permissions).toContain('camera=(self)')
    expect(permissions).toContain('microphone=()')
  })

  test('the content policy permits the camera stream and the service worker', async ({
    request,
  }) => {
    const response = await request.get('/login')
    const csp = response.headers()['content-security-policy'] ?? ''
    expect(csp).toContain("media-src 'self' blob:")
    expect(csp).toContain("worker-src 'self'")
    expect(csp).toContain("manifest-src 'self'")
  })
})

test.describe('counter access control', () => {
  test('the scan endpoint refuses anonymous callers', async ({ request }) => {
    const response = await request.post('/api/v1/scan', {
      data: {
        businessId: '00000000-0000-0000-0000-000000000000',
        raw: 'anything',
        action: 'identify',
      },
    })
    expect([401, 403]).toContain(response.status())
  })

  test('a check-in without an idempotency key is rejected', async ({ request }) => {
    // This is what makes replaying the offline queue safe; a caller must not be
    // able to opt out of it.
    const response = await request.post('/api/v1/scan', {
      data: {
        businessId: '00000000-0000-0000-0000-000000000000',
        raw: 'anything',
        action: 'checkin',
      },
    })
    expect(response.status()).not.toBe(200)
  })

  test('the counter roster refuses anonymous callers', async ({ request }) => {
    const response = await request.get(
      '/api/v1/counter/roster?businessId=00000000-0000-0000-0000-000000000000'
    )
    expect([401, 403]).toContain(response.status())
  })
})
