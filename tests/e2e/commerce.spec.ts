import { expect, test } from '@playwright/test'

/**
 * The commerce and billing surfaces, tested for the properties that hold on any
 * deployment — no seeded data, no configured Stripe.
 *
 * The theme throughout: a workspace that has not configured billing must
 * degrade visibly, never crash and never silently no-op. A merchant self-hosting
 * without Stripe should still get a working loyalty product.
 */

test.describe('gift card shop', () => {
  test('an unknown business returns a clean 404 rather than a crash', async ({ request }) => {
    const response = await request.get('/api/v1/public/gift-cards?slug=definitely-not-real')
    expect(response.status()).toBe(404)
    expect((await response.json()).error.code).toBe('not_found')
  })

  test('the shop requires a slug', async ({ request }) => {
    const response = await request.get('/api/v1/public/gift-cards')
    expect(response.status()).toBe(422)
    expect((await response.json()).error.code).toBe('validation_failed')
  })

  test('a purchase rejects an invalid amount before touching Stripe', async ({ request }) => {
    const response = await request.post('/api/v1/public/gift-cards', {
      data: {
        slug: 'anything',
        amount: -50,
        purchaserEmail: 'buyer@example.com',
        purchaserName: 'Buyer',
        recipientEmail: 'friend@example.com',
        recipientName: 'Friend',
      },
    })
    // 422 for the bad amount, or 503 when Stripe is not configured at all —
    // both are correct refusals. What must never happen is a 500.
    expect([422, 503]).toContain(response.status())
  })

  test('the shop page renders without crashing for an unknown business', async ({ page }) => {
    await page.goto('/gift/definitely-not-a-real-slug')
    await expect(page.locator('main')).toHaveCount(1)

    /*
     * Scoped to `main`, because Next renders its own `<div role="alert"
     * id="__next-route-announcer__">` for screen readers on every navigation.
     * An unscoped `getByRole('alert')` matched both that and the page's error
     * panel, and Playwright's strict mode fails on two matches — so this test
     * passed or failed depending on whether the announcer happened to be in the
     * DOM when the assertion ran. It passed on mobile and failed on desktop in
     * the same run, which is the signature of a locator problem rather than a
     * product one.
     */
    await expect(page.locator('main').getByRole('alert')).toBeVisible()
  })
})

test.describe('billing', () => {
  test('the billing summary rejects anonymous callers', async ({ request }) => {
    const response = await request.get('/api/v1/billing?businessId=00000000-0000-0000-0000-000000000000')
    expect(response.status()).toBe(401)
  })

  test('checkout rejects anonymous callers', async ({ request }) => {
    const response = await request.post('/api/v1/billing/checkout', {
      data: {
        businessId: '00000000-0000-0000-0000-000000000000',
        plan: 'growth',
        interval: 'month',
      },
    })
    expect([401, 503]).toContain(response.status())
  })

  test('the Stripe webhook refuses an unsigned request', async ({ request }) => {
    // Without this, anyone could POST themselves an Enterprise plan.
    const response = await request.post('/api/v1/billing/webhook', {
      data: { id: 'evt_forged', type: 'customer.subscription.updated', data: { object: {} } },
    })
    expect([400, 503]).toContain(response.status())
    expect(response.status()).not.toBe(200)
  })

  test('the Stripe webhook refuses a forged signature', async ({ request }) => {
    const response = await request.post('/api/v1/billing/webhook', {
      headers: { 'stripe-signature': 't=1,v1=deadbeef' },
      data: { id: 'evt_forged', type: 'invoice.paid', data: { object: {} } },
    })
    expect(response.status()).not.toBe(200)
  })
})

test.describe('commerce endpoints require authentication', () => {
  const guarded = [
    '/api/v1/gift-cards?businessId=00000000-0000-0000-0000-000000000000',
    '/api/v1/memberships?businessId=00000000-0000-0000-0000-000000000000',
    '/api/v1/growth?businessId=00000000-0000-0000-0000-000000000000',
    '/api/v1/network?businessId=00000000-0000-0000-0000-000000000000',
    '/api/v1/notifications?businessId=00000000-0000-0000-0000-000000000000',
  ]

  for (const path of guarded) {
    test(`${path.split('?')[0]} rejects anonymous callers`, async ({ request }) => {
      const response = await request.get(path)
      expect(response.status()).toBe(401)
      expect((await response.json()).error.code).toBe('unauthorized')
    })
  }
})

test.describe('new dashboard routes', () => {
  const routes = [
    '/dashboard/billing',
    '/dashboard/gift-cards',
    '/dashboard/memberships',
    '/dashboard/growth',
    '/dashboard/network',
  ]

  for (const route of routes) {
    test(`${route} is not reachable while signed out`, async ({ page }) => {
      await page.goto(route)
      await expect(page).toHaveURL(/\/login/)
    })
  }
})

test.describe('pricing page', () => {
  test('renders every purchasable tier from the plan catalogue', async ({ page }) => {
    await page.goto('/#pricing')
    // The three purchasable plans in lib/billing/plans.ts. `lapsed` is an internal
    // state and must never appear on a pricing page.
    for (const name of ['Starter', 'Growth', 'Pro']) {
      await expect(page.getByText(name, { exact: true }).first()).toBeVisible()
    }
    // And the fourth tier is gone. A stale "Business" card would be a $99 column
    // beside Pro's $99 column, with no way for a visitor to tell them apart.
    await expect(page.getByText('Business', { exact: true })).toHaveCount(0)
  })

  test('publishes exactly $29, $59 and $99', async ({ page }) => {
    /*
     * The three official prices, on the page a visitor actually reads. Rendered
     * from `lib/billing/plans.ts`, so this failing means either the catalogue
     * moved or a surface stopped reading it — and the second is the dangerous
     * one, because it is how a pricing page comes to advertise a number checkout
     * will not honour.
     */
    await page.goto('/#pricing')

    for (const price of ['$29', '$59', '$99'] as const) {
      await expect(page.getByText(price, { exact: false }).first()).toBeVisible()
    }
    // The prices the catalogue used to carry. Any of them still on the page is a
    // surface that was not regenerated.
    for (const stale of [/\$5(?!\d)/, /\$19(?!\d)/, /\$49(?!\d)/] as const) {
      await expect(page.getByText(stale)).toHaveCount(0)
    }
  })

  test('offers no free tier, and shows the entry price', async ({ page }) => {
    /*
     * The product decision this pins: there is no free plan, and the entry price
     * is $29/month. A "Free" card reappearing on the pricing page — from a
     * copy-paste, a stale translation, a reverted plan definition — would be a
     * pricing claim the product does not honour, and the merchant would find out
     * at checkout.
     *
     * "14-day trial" is fine and deliberate: a trial is not a tier.
     *
     * The assertions are *structural* rather than a search for the word "free",
     * because the FAQ asks "Is there a free plan?" and answers "No" — copy that
     * exists precisely to settle this question, and which a keyword sweep flags as
     * the thing it was written to deny. So: no zero price anywhere, no card named
     * Free, and the FAQ answer must actually be a refusal.
     */
    await page.goto('/#pricing')

    await expect(page.getByText('Free', { exact: true })).toHaveCount(0)
    await expect(page.getByText('$0', { exact: false })).toHaveCount(0)
    await expect(page.getByText(/0\s*\/\s*month/i)).toHaveCount(0)
    await expect(page.getByText(/from .?.?29\s*\/?\s*month/i).first()).toBeVisible()

    // And the question is answered, in the negative, where a visitor looks for it.
    await page.getByText(/is there a free plan/i).click()
    await expect(page.getByText(/^No\./i).first()).toBeVisible()
  })

  test('says what every plan includes, so Starter does not read as a teaser', async ({
    page,
  }) => {
    /*
     * The pricing cards list only differences, which means the shared floor has to
     * be stated somewhere or a visitor reading the Starter column reasonably
     * concludes the wallet card designer is a paid extra. That misreading is the
     * difference between "$29 is reasonable" and "$29 is the crippled one".
     */
    await page.goto('/#pricing')
    await expect(page.getByText(/in every plan/i).first()).toBeVisible()
    await expect(page.getByText(/card designer/i).first()).toBeVisible()
  })

  test('shows the ROI example as an example', async ({ page }) => {
    // The arithmetic is allowed; a claim about real merchants is not. The heading
    // and the disclaimer both have to be present, because the number without the
    // framing is a promise we cannot keep.
    await page.goto('/#pricing')
    await expect(page.getByText(/example, not a promise/i).first()).toBeVisible()
    await expect(page.getByText(/illustrative/i).first()).toBeVisible()
  })

  test('does not scroll horizontally on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/#pricing')

    /*
     * `documentElement.scrollWidth`, not `body`'s. An absolutely positioned
     * descendant with no positioned ancestor escapes its container and stretches
     * the *viewport* scroll while `body.scrollWidth` still reads clean — which is
     * exactly the bug this caught in the comparison table (see the note on that
     * wrapper in components/landing/landing-page.tsx).
     */
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    )
    expect(overflows, 'the landing page must not scroll sideways on a phone').toBe(false)

    // And confirm it the way a thumb would: the page must not move.
    await page.evaluate(() => window.scrollTo({ left: 2000, top: window.scrollY }))
    expect(await page.evaluate(() => window.scrollX)).toBe(0)
  })
})
