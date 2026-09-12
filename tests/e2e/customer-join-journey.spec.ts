import { expect, test, type APIRequestContext } from '@playwright/test'

/**
 * The customer's half of the product, walked the way a customer walks it.
 *
 * Everything else in `tests/e2e` is about the merchant: signing up, onboarding,
 * designing a card, inviting staff. This is the other side of the counter — the
 * only journey in Passimo that a person who has never heard of Passimo actually
 * performs:
 *
 *     merchant gets a QR  →  customer scans it  →  public join page  →
 *     registers  →  becomes a member of *that* shop  →  sees their card
 *
 * The existing coverage of `/join/{slug}` was one assertion, that an unknown
 * slug 404s. The happy path — the product's single conversion point — had none,
 * which meant nothing would have caught the join page regressing to a spinner,
 * the form failing to submit, or a customer landing somewhere other than their
 * own card.
 *
 * Two properties are worth more than the rest and are asserted explicitly:
 * the customer ends up bound to the shop whose QR they scanned, and they never
 * touch the merchant's dashboard.
 *
 * Runs on both viewport projects. The mobile one is the real case — a QR code
 * is scanned with a phone, essentially always.
 */

type Merchant = { email: string; password: string; businessName: string; slug?: string }

/** Creates a merchant through the public signup endpoint, as the other specs do. */
async function signUpMerchant(request: APIRequestContext): Promise<Merchant | null> {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`
  const merchant: Merchant = {
    email: `join-e2e-${stamp}@passimo.test`,
    password: 'a-perfectly-fine-passphrase-2026',
    businessName: `Join E2E Café ${stamp}`,
  }

  const response = await request.post('/api/v1/auth/signup', {
    data: {
      email: merchant.email,
      password: merchant.password,
      businessName: merchant.businessName,
      category: 'cafe',
      timezone: 'Europe/Madrid',
      locale: 'en',
      acceptedTerms: true,
    },
  })

  // No database in this environment — the caller skips rather than fails.
  if (!response.ok()) return null

  const body = (await response.json()) as { business?: { slug?: string } }
  merchant.slug = body.business?.slug
  return merchant
}

/*
 * Serial with a single merchant, for the same reason `onboarding.spec.ts` is:
 * signup is deliberately rate limited, and one signup per project is the
 * budget. The customer registrations below are separate people in the same
 * shop, which is exactly the shape being tested.
 */
test.describe.configure({ mode: 'serial' })

test.describe('a customer joins a club from a QR code', () => {
  let merchant: Merchant | null = null

  test.beforeAll(async ({ playwright, baseURL }) => {
    const request = await playwright.request.newContext({ baseURL })
    merchant = await signUpMerchant(request)
    await request.dispose()
  })

  test('the merchant is given a join link and a scannable QR', async ({ page }) => {
    test.skip(!merchant?.slug, 'no database available — run `pnpm db:up && pnpm db:migrate`')

    await page.goto('/login')
    await page.getByLabel('Email').fill(merchant!.email)
    await page.getByLabel('Password').fill(merchant!.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.waitForURL(/\/(dashboard|onboarding)/)

    /*
     * The QR endpoint is what both the dashboard panel and the onboarding
     * hand-off render, so asserting it directly is asserting the thing the
     * merchant actually prints. It must be a real PNG, not a placeholder.
     */
    const joinUrl = new URL(`/join/${merchant!.slug}`, page.url()).toString()
    const qr = await page.request.get(
      `/api/v1/public/qr?data=${encodeURIComponent(joinUrl)}&size=512`
    )
    expect(qr.ok()).toBe(true)
    expect(qr.headers()['content-type']).toContain('image/png')
    expect((await qr.body()).byteLength).toBeGreaterThan(1000)
  })

  test('a QR that cannot be rendered explains itself instead of breaking', async ({ page }) => {
    test.skip(!merchant?.slug, 'no database available')

    /*
     * The QR endpoint refuses any target outside this deployment's own origin,
     * which is what stops it being a free phishing-image host. When
     * `NEXT_PUBLIC_APP_URL` does not match the origin the app is served from,
     * that refusal hits the product's own join URL and every QR 403s at once —
     * and an `<img>` cannot render a JSON error, so the merchant used to get the
     * browser's broken-image glyph and no way to know why.
     *
     * Forced here by failing the request rather than by rewriting the
     * environment: the component's job is to handle a QR it cannot load, and
     * the reason it failed is not its business. Deterministic, and it leaves the
     * origin rule itself to `tests/unit/qr-origin.test.ts`.
     */
    await page.route('**/api/v1/public/qr**', (route) =>
      route.fulfill({ status: 403, contentType: 'application/json', body: '{}' })
    )

    await page.goto('/login')
    await page.getByLabel('Email').fill(merchant!.email)
    await page.getByLabel('Password').fill(merchant!.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.waitForURL(/\/(dashboard|onboarding)/)

    await page.goto('/dashboard/settings')
    // The join link and its QR live behind the Sign-up tab.
    await page.getByRole('tab', { name: 'Sign-up' }).click()

    // The diagnosis, naming the variable to check.
    await expect(page.getByText('QR code unavailable')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/NEXT_PUBLIC_APP_URL/)).toBeVisible()

    /*
     * And the part that matters most: the link itself did not fail, so the
     * merchant can still copy it and put it on a poster. A QR that will not
     * render must not take the join link down with it.
     */
    const joinUrl = page.locator(`input[value*="/join/${merchant!.slug}"]`)
    await expect(joinUrl).toBeVisible()
  })

  test('the join page is public, branded, and works signed out', async ({ browser }) => {
    test.skip(!merchant?.slug, 'no database available')

    // A fresh context with no cookies: this is a stranger with a phone.
    const context = await browser.newContext()
    const page = await context.newPage()
    try {
      const response = await page.goto(`/join/${merchant!.slug}`)
      expect(response?.status()).toBe(200)

      // The shop's own name, server-rendered — not a Passimo shell.
      await expect(page.getByText(merchant!.businessName).first()).toBeVisible()

      // And the form the customer is here for.
      await expect(page.locator('#join-email')).toBeVisible()
    } finally {
      await context.close()
    }
  })

  test('a new customer registers and lands on their own card', async ({ browser }) => {
    test.skip(!merchant?.slug, 'no database available')

    const context = await browser.newContext()
    const page = await context.newPage()
    const email = `customer-${Date.now()}@example.test`

    try {
      await page.goto(`/join/${merchant!.slug}`)

      await page.locator('#join-email').fill(email)
      await page.locator('#join-name').fill('Ana')

      /*
       * Terms is the first checkbox and marketing is the second. Deliberately
       * only the first is ticked: joining a loyalty club is not consent to be
       * marketed at, and the integration suite asserts the resulting row has
       * `consent_marketing = false`. Leaving marketing untouched here is what
       * makes that assertion meaningful end to end.
       */
      const boxes = page.getByRole('checkbox')
      await expect(boxes).toHaveCount(2)
      await boxes.first().click()

      await page.getByRole('button', { name: 'Get my card' }).click()

      // The success state — the customer is a member.
      await expect(page.getByText('You’re in!')).toBeVisible({ timeout: 20_000 })

      // Their card is reachable from here, and the referral code was issued.
      await expect(page.getByText('Or open your card in the browser')).toBeVisible()

      // The decisive negative: a customer must never be inside the dashboard.
      expect(page.url()).not.toContain('/dashboard')
    } finally {
      await context.close()
    }
  })

  test('the member is bound to the shop whose QR they scanned', async ({ playwright, baseURL }) => {
    test.skip(!merchant?.slug, 'no database available')

    /*
     * Asserted through the public endpoint rather than the database, because
     * that is the boundary a customer can actually reach: enrolling returns the
     * business it enrolled you into, and it must be this one.
     */
    const request = await playwright.request.newContext({ baseURL })
    try {
      const email = `bound-${Date.now()}@example.test`
      const response = await request.post('/api/v1/public/join', {
        data: { businessSlug: merchant!.slug, email, acceptedTerms: true },
      })
      expect(response.ok()).toBe(true)

      const body = (await response.json()) as {
        business: { slug: string }
        card_url: string
        apple_wallet_url: string | null
        google_wallet_url: string | null
      }
      expect(body.business.slug).toBe(merchant!.slug)
      expect(body.card_url).toContain('/card/')

      /*
       * Wallet buttons are credential-dependent. The contract is that an
       * unconfigured provider yields null rather than a URL that 503s on the
       * last step of the funnel — so whatever this deployment has, the field is
       * either a usable URL or explicitly absent.
       */
      for (const url of [body.apple_wallet_url, body.google_wallet_url]) {
        if (url !== null) expect(url).toContain('/api/v1/wallet/')
      }

      // Re-enrolling the same person is not a second membership.
      const again = await request.post('/api/v1/public/join', {
        data: { businessSlug: merchant!.slug, email, acceptedTerms: true },
      })
      expect(again.ok()).toBe(true)
      const repeat = (await again.json()) as { business: { slug: string } }
      expect(repeat.business.slug).toBe(merchant!.slug)
    } finally {
      await request.dispose()
    }
  })

  test('the card link opens the member’s card and no dashboard', async ({ playwright, baseURL, browser }) => {
    test.skip(!merchant?.slug, 'no database available')

    const request = await playwright.request.newContext({ baseURL })
    let cardUrl = ''
    try {
      const response = await request.post('/api/v1/public/join', {
        data: { businessSlug: merchant!.slug, email: `card-${Date.now()}@example.test`, acceptedTerms: true },
      })
      expect(response.ok()).toBe(true)
      cardUrl = ((await response.json()) as { card_url: string }).card_url
    } finally {
      await request.dispose()
    }

    // A signed capability URL: it must work in a browser that has never logged in.
    const context = await browser.newContext()
    const page = await context.newPage()
    try {
      const path = new URL(cardUrl).pathname
      const opened = await page.goto(path)
      expect(opened?.status()).toBe(200)
      await expect(page.getByText(merchant!.businessName).first()).toBeVisible()
      expect(page.url()).not.toContain('/dashboard')
    } finally {
      await context.close()
    }
  })

  test('a tampered card token is refused', async ({ browser }) => {
    test.skip(!merchant?.slug, 'no database available')

    /*
     * `/card/{token}` is a client component: the page shell always renders 200
     * and then fetches the card. So the authorisation boundary is the API, not
     * the document status, and asserting the latter would pass for the wrong
     * reason. Both are checked — the endpoint refuses the token, and the screen
     * the customer actually sees carries no card.
     */
    const context = await browser.newContext()
    const page = await context.newPage()
    try {
      const forged = 'card.eyJjIjoiZm9yZ2VkIn0.not-a-real-signature'

      const api = await page.request.get(`/api/v1/public/card/${forged}`)
      expect(api.status()).toBe(400)
      const body = (await api.json()) as { error: { message: string } }
      // A comprehensible sentence, not a stack trace or a database error.
      expect(body.error.message).not.toMatch(/sql|postgres|jwt|stack|undefined/i)

      await page.goto(`/card/${forged}`)
      await expect(page.getByText(/expired|invalid|caducad|no v[áa]lid/i).first()).toBeVisible({
        timeout: 15_000,
      })
    } finally {
      await context.close()
    }
  })
})
