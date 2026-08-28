import { expect, test } from '@playwright/test'
import { LOCALE_COOKIE } from '@/lib/i18n/locales'

/**
 * End-to-end coverage of the paths that must never break, because a failure is
 * immediately visible to a paying merchant or their customer.
 *
 * These run without seeded data, so they assert on behaviour that is true of
 * any deployment: routing, auth enforcement, error handling and accessibility.
 *
 * The locale is pinned to English for every test. These assert on *behaviour* —
 * that a redirect happens, that validation runs in-app rather than in the
 * browser, that a message never leaks whether an account exists — and coupling
 * those assertions to whichever language the product ships as its default would
 * make them fail on a marketing decision. Pinning it also means the assertions
 * keep reading as documentation of the behaviour under test.
 */

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([
    {
      name: LOCALE_COOKIE,
      value: 'en',
      url: baseURL ?? 'http://localhost:3000',
    },
  ])
})

test.describe('authentication', () => {
  test('the dashboard is not reachable while signed out', async ({ page }) => {
    // The original build shipped a completely public dashboard. This is the
    // regression test for that.
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible()
  })

  test('the point of sale is not reachable while signed out', async ({ page }) => {
    await page.goto('/pos')
    await expect(page).toHaveURL(/\/login/)
  })

  test('the intended destination survives the redirect', async ({ page }) => {
    await page.goto('/dashboard/customers')
    await expect(page).toHaveURL(/next=%2Fdashboard%2Fcustomers/)
  })

  test('sign-in rejects bad credentials without revealing whether the account exists', async ({
    page,
  }) => {
    await page.goto('/login')
    await page.getByLabel('Email').fill('nobody@example.com')
    await page.getByLabel('Password').fill('definitely-not-the-password')
    await page.getByRole('button', { name: 'Sign in' }).click()

    // Scoped to the form: Next renders an always-present, empty route announcer
    // with role="alert", so an unscoped query matches two elements.
    const alert = page.locator('form').getByRole('alert')
    await expect(alert).toBeVisible()
    await expect(alert).not.toContainText(/no user|not found|does not exist/i)
  })

  test('signup validates the password itself rather than deferring to the browser', async ({
    page,
  }) => {
    await page.goto('/signup')
    await page.getByLabel('Business name').fill('Test Café')
    await page.getByLabel('Email', { exact: true }).fill('owner@example.com')
    await page.getByLabel('Password').fill('short')
    await page.getByRole('button', { name: /create my account/i }).click()
    // Our own message, in our own styling, reachable by a screen reader — not a
    // native browser tooltip, which is neither.
    await expect(page.locator('form').getByRole('alert')).toContainText(/10 characters/i)
  })

  test('signup rejects a long but guessable password', async ({ page }) => {
    // The real rule is a strength score, which `minLength` cannot express.
    await page.goto('/signup')
    await page.getByLabel('Business name').fill('Test Café')
    await page.getByLabel('Email', { exact: true }).fill('owner@example.com')
    await page.getByLabel('Password').fill('aaaaaaaaaaaa')
    await page.getByRole('button', { name: /create my account/i }).click()
    await expect(page.locator('form').getByRole('alert')).toContainText(/too easy to guess/i)
  })

  test('signup reports a malformed email before contacting the server', async ({ page }) => {
    await page.goto('/signup')
    await page.getByLabel('Business name').fill('Test Café')
    await page.getByLabel('Email', { exact: true }).fill('not-an-email')
    await page.getByLabel('Password').fill('a-perfectly-fine-passphrase')
    await page.getByRole('button', { name: /create my account/i }).click()
    await expect(page.locator('form').getByRole('alert')).toContainText(/does not look right/i)
  })
})

test.describe('security headers', () => {
  test('baseline headers are present on every response', async ({ request }) => {
    const response = await request.get('/login')
    const headers = response.headers()
    expect(headers['x-content-type-options']).toBe('nosniff')
    expect(headers['x-frame-options']).toBe('DENY')
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin')
    expect(headers['content-security-policy']).toContain("object-src 'none'")
  })
})

test.describe('API contract', () => {
  test('protected endpoints reject anonymous callers', async ({ request }) => {
    const response = await request.get('/api/v1/me')
    expect(response.status()).toBe(401)
    const body = await response.json()
    expect(body.error.code).toBe('unauthorized')
  })

  test('errors use the documented envelope', async ({ request }) => {
    const response = await request.get('/api/v1/public/business/definitely-not-a-real-slug')
    expect(response.status()).toBe(404)
    const body = await response.json()
    expect(body).toHaveProperty('error.code', 'not_found')
    expect(body).toHaveProperty('error.message')
  })

  test('invalid input returns a field-level validation error', async ({ request }) => {
    const response = await request.post('/api/v1/public/join', {
      data: { businessSlug: '', email: 'not-an-email', acceptedTerms: false },
    })
    expect(response.status()).toBe(422)
    const body = await response.json()
    expect(body.error.code).toBe('validation_failed')
    expect(Array.isArray(body.error.details)).toBe(true)
  })

  test('cron endpoints refuse callers without the shared secret', async ({ request }) => {
    const response = await request.post('/api/v1/jobs/run')
    expect([401, 503]).toContain(response.status())
  })

  test('an expired or forged card token is rejected', async ({ request }) => {
    const response = await request.get('/api/v1/public/card/card.forged.signature')
    // 400 when signing is configured and the signature simply does not verify;
    // 503 when APP_TOKEN_SECRET is absent, because there is no key to check
    // against. What must never happen is a 200, or a 500 that hides either.
    expect([400, 503]).toContain(response.status())
  })

  test('every response carries a request id for support triage', async ({ request }) => {
    const response = await request.get('/api/v1/me')
    expect(response.headers()['x-request-id']).toBeTruthy()
  })
})

test.describe('public pages', () => {
  test('an unknown business shows a message rather than a crash', async ({ page }) => {
    await page.goto('/join/definitely-not-a-real-slug')
    await expect(page.getByText(/does not exist/i)).toBeVisible()
  })

  test('the landing page renders and links to signup', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('body')).toBeVisible()
    expect(await page.locator('a[href*="/signup"], a[href*="/login"]').count()).toBeGreaterThan(0)
  })
})

test.describe('accessibility basics', () => {
  test('the login form is fully keyboard operable and labelled', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByLabel('Email')).toBeVisible()
    await expect(page.getByLabel('Password')).toBeVisible()

    await page.getByLabel('Email').focus()
    await page.keyboard.press('Tab')
    // Focus must land somewhere interactive rather than being trapped.
    await expect(page.locator(':focus')).toHaveCount(1)
  })

  test('pages expose exactly one main landmark', async ({ page }) => {
    await page.goto('/login')
    await expect(page.locator('main')).toHaveCount(1)
  })

  test('the mobile viewport does not scroll horizontally', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/login')
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    )
    expect(overflows).toBe(false)
  })
})
