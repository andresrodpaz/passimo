import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from '@playwright/test'
import { LOCALE_COOKIE } from '@/lib/i18n/locales'

/**
 * Can a merchant find the Wallet card designer?
 *
 * This spec exists because "does it work" and "can it be found" turned out to be
 * different questions, and the product only shipped the first. The designer was
 * complete — editor, eleven templates, live Apple and Google previews, a real
 * endpoint, a real table — and it was the first tab of a screen the sidebar
 * called "Wallet & proximity", filed under "Configure". No route, no dashboard
 * card, no checklist row, and nothing anywhere in the navigation containing the
 * word *card*. Every existing test passed.
 *
 * So this asserts the journey rather than the component: arrive signed in, look
 * at the dashboard, click the thing a normal merchant would click, and land on an
 * editor that changes the card and remembers it.
 *
 * Two modes, matching the rest of the suite:
 *
 *   * **With a database.** A real merchant is created once and walked from the
 *     dashboard to the designer and back — including a save, a reload and a
 *     check that the change survived.
 *   * **Without one.** Signup answers 5xx and those tests skip *with a reason*.
 *     The contract tests still run: the route exists, it is protected, and the
 *     redirect carries the right `next`.
 *
 * The locale is pinned to English because these assert on behaviour, and
 * coupling them to whichever language ships as the default would make them fail
 * on a marketing decision.
 */

const DESIGNER = '/dashboard/wallet/design'

type Cookies = Awaited<ReturnType<BrowserContext['cookies']>>

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([
    { name: LOCALE_COOKIE, value: 'en', url: baseURL ?? 'http://localhost:3000' },
  ])
})

// -----------------------------------------------------------------------------
// Contract: true on every deployment, seeded or not
// -----------------------------------------------------------------------------

test.describe('the designer has an address of its own', () => {
  test('is a route, not a tab', async ({ page }) => {
    /*
     * The whole fix in one assertion. A tab has no URL, so nothing could link
     * to it — not the dashboard, not the checklist, not the end of onboarding.
     * Signed out this redirects, which is still proof the route is served and
     * carries the right return target.
     */
    await page.goto(DESIGNER)
    await expect(page).toHaveURL(/\/login/)
    await expect(page).toHaveURL(/next=%2Fdashboard%2Fwallet%2Fdesign/)
  })

  test('is protected, like every other design surface', async ({ request }) => {
    // The design is tenant data. An open endpoint here would let anyone repaint
    // somebody else's loyalty card.
    const response = await request.get('/api/v1/wallet/design?businessId=' + crypto.randomUUID(), {
      failOnStatusCode: false,
    })
    expect(response.status()).toBe(401)
  })
})

// -----------------------------------------------------------------------------
// The journey, which needs a real merchant
// -----------------------------------------------------------------------------

async function signUpMerchant(request: APIRequestContext): Promise<boolean> {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`

  const response = await request.post('/api/v1/auth/signup', {
    data: {
      email: `e2e-card-${stamp}@passimo.test`,
      password: 'a-perfectly-fine-passphrase-2026',
      businessName: `E2E Card Café ${stamp}`,
      category: 'cafe',
      timezone: 'Europe/Madrid',
      locale: 'en',
    },
  })

  return response.ok()
}

/*
 * Serial, with **one authentication for the whole file**.
 *
 * `/api/v1/auth/*` is rate limited to 8 requests per five minutes per IP, which
 * is a deliberate security control on the most abuse-prone endpoint in the
 * product. Signing in per test spent eight of those before this file's last
 * assertion, so running it inside the full suite failed on our own rate limiter
 * rather than on the product — a test that reports a bug that is not there is
 * worse than no test.
 *
 * So the session is established exactly once, in `beforeAll`, and every test
 * replays its cookies. That is also closer to what a merchant does: they sign in
 * on Monday and use the dashboard all week.
 */
test.describe.configure({ mode: 'serial' })

/** Puts the shared session into a fresh browser context. */
async function useSession(page: Page, cookies: Cookies): Promise<void> {
  await page.context().addCookies(cookies)
}

test.describe('a merchant finding their card', () => {
  let session: Cookies | null = null

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext()
    // Signup establishes the session itself, so this is the file's only call to
    // a rate-limited auth endpoint.
    if (await signUpMerchant(context.request)) session = await context.cookies()
    await context.close()
  })

  test('the sidebar says the word "card"', async ({ page, isMobile }) => {
    test.skip(!session, 'no database: signup is unavailable on this deployment')
    await useSession(page, session!)
    await page.goto('/dashboard')

    if (isMobile) await page.getByRole('button', { name: 'Open menu' }).click()

    // Under a "Your card" heading. The old sidebar's only route to the designer
    // was a row labelled "Wallet & proximity".
    const link = page.getByRole('link', { name: 'Card design' })
    await expect(link).toBeVisible()
    await expect(link).toHaveAttribute('href', DESIGNER)
  })

  test('the dashboard shows the card and offers to change it', async ({ page }) => {
    test.skip(!session, 'no database: signup is unavailable on this deployment')
    await useSession(page, session!)
    await page.goto('/dashboard')

    const callout = page.getByRole('region', { name: 'Your Wallet card' })
    await expect(callout).toBeVisible()

    // One click, from the first screen a merchant opens.
    await callout.getByRole('link', { name: /Design your card|Customise card/ }).first().click()
    await expect(page).toHaveURL(new RegExp(DESIGNER.replace(/\//g, '\\/')))
  })

  test('the page says what it is for, in the merchant’s words', async ({ page }) => {
    test.skip(!session, 'no database: signup is unavailable on this deployment')
    await useSession(page, session!)
    await page.goto(DESIGNER)

    await expect(page.getByRole('heading', { name: 'Your Wallet card', level: 1 })).toBeVisible()
    await expect(page.getByText(/save to Apple Wallet and Google Wallet/i)).toBeVisible()
  })

  test('both wallet previews are offered, and labelled as previews', async ({ page }) => {
    test.skip(!session, 'no database: signup is unavailable on this deployment')
    await useSession(page, session!)
    await page.goto(DESIGNER)

    const tabs = page.getByRole('tablist', { name: 'Preview' }).last()
    await expect(tabs.getByRole('tab', { name: 'Apple Wallet' })).toBeVisible()
    await expect(tabs.getByRole('tab', { name: 'Google Wallet' })).toBeVisible()

    // A merchant must never mistake this for an installed pass.
    await expect(page.getByText(/A preview of your design/i)).toBeVisible()
  })

  test('a template changes the card, and the change survives a reload', async ({ page }) => {
    test.skip(!session, 'no database: signup is unavailable on this deployment')
    await useSession(page, session!)
    await page.goto(DESIGNER)

    // Luxury is the most distinct template in the set — tier only, no progress
    // bar — so a preview that ignored the click would be obvious.
    const luxury = page.getByRole('button', { name: /Luxury/ })
    await expect(luxury).toBeVisible()
    await luxury.click()
    await expect(luxury).toHaveAttribute('aria-pressed', 'true')

    // Local until saved: the badge is how that state is made legible.
    await expect(page.getByText('Unsaved changes')).toBeVisible()

    await page.getByRole('button', { name: 'Save design' }).click()
    await expect(page.getByText('Unsaved changes')).toBeHidden()

    // The real assertion. A design that only lives in React state is not a
    // saved design, whatever the toast said.
    await page.reload()
    await expect(page.getByRole('button', { name: /Luxury/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })

  test('the editor is usable on a phone', async ({ page, isMobile }) => {
    test.skip(!session, 'no database: signup is unavailable on this deployment')
    test.skip(!isMobile, 'this is the mobile projection of the same screen')
    await useSession(page, session!)
    await page.goto(DESIGNER)

    const save = page.getByRole('button', { name: 'Save design' })
    await expect(save).toBeVisible()

    // Nothing may overflow horizontally: a colour picker off the side of the
    // screen is a control that does not exist.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )
    expect(overflow, 'the designer scrolls sideways on a phone').toBeLessThanOrEqual(1)

    /*
     * Save has to still be reachable at the bottom of the editor.
     *
     * The preview column comes first on a narrow screen (`order-1`), because a
     * merchant should see what they are editing before the controls — which put
     * Save above every control, so after scrolling down through templates,
     * colours and toggles the only way to save was to scroll all the way back
     * up. A sticky bar after the controls fixes it, and this is the assertion
     * that keeps it fixed.
     */
    await page.getByLabel('Small print').scrollIntoViewIfNeeded()
    await expect(save).toBeInViewport()
  })

  test('the checklist row leads to the editor', async ({ page }) => {
    test.skip(!session, 'no database: signup is unavailable on this deployment')
    await useSession(page, session!)
    await page.goto('/dashboard')

    const row = page.getByRole('link', { name: /Customise your Wallet card/ })
    await expect(row).toBeVisible()
    await expect(row).toHaveAttribute('href', DESIGNER)
  })

  test('the checklist does not tick anything this merchant has not done', async ({ page }) => {
    test.skip(!session, 'no database: signup is unavailable on this deployment')
    await useSession(page, session!)
    await page.goto('/dashboard')

    /*
     * This account was created seconds ago and has done nothing. It used to
     * open on "Add your logo" already struck through, because the fact behind
     * it accepted "a colour that differs from the platform default" — and
     * signup seeds a trade-appropriate palette, so that was true for everybody
     * on day one. A checklist that disagrees with the product teaches merchants
     * to stop reading it.
     */
    const checklist = page.getByRole('region').filter({ hasText: 'First steps' }).first()
    await expect(checklist.getByText('0 of 6 done')).toBeVisible()
  })

  test('the whole screen is in the merchant’s language, with nothing left over', async ({
    page,
    context,
    baseURL,
  }) => {
    test.skip(!session, 'no database: signup is unavailable on this deployment')
    await useSession(page, session!)

    // Overwrites the 'en' cookie the beforeEach pins.
    await context.addCookies([
      { name: LOCALE_COOKIE, value: 'es', url: baseURL ?? 'http://localhost:3000' },
    ])
    await page.goto(DESIGNER)

    await expect(page.getByRole('heading', { name: 'Tu tarjeta Wallet', level: 1 })).toBeVisible()
    await expect(page.getByText(/Apple Wallet y Google Wallet/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Guardar diseño' })).toBeVisible()

    /*
     * The half that a "does the Spanish string appear?" test misses. A screen
     * built from thirty `t()` calls fails by rendering twenty-nine of them and
     * leaving one English literal behind, and the literal is invisible to a
     * test that only looks for what should be there.
     */
    const body = await page.locator('main').innerText()
    for (const leftover of ['Card design', 'Your Wallet card', 'Save design', 'Preview']) {
      expect(body, `English leaked into the Spanish designer: "${leftover}"`).not.toContain(
        leftover
      )
    }
  })
})
