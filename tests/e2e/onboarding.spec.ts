import { expect, test, type Page, type APIRequestContext } from '@playwright/test'
import { LOCALE_COOKIE } from '@/lib/i18n/locales'

/**
 * Signup → onboarding → the first scan.
 *
 * The path a merchant walks exactly once, and the one nobody notices is broken
 * until a real one walks it. Onboarding is four steps, two of them skippable,
 * and every screen shows the consequence of its choice (see `docs/ONBOARDING.md`).
 * This is what stops it growing back into a stack of forms and what proves the
 * flow still ends somewhere useful.
 *
 * The suite runs in two modes, because the rest of the e2e suite runs
 * **unseeded** — deliberately, so it asserts what is true of any deployment
 * rather than of a fixture — and creating a merchant needs a live database:
 *
 *   * **With a database.** `signUpMerchant` creates a real account and the flow
 *     is driven end to end: three steps, a location written, a card activated,
 *     the counter reached, and a scan attempted through the manual panel (the
 *     camera does not exist under Playwright, which is exactly the fallback the
 *     counter is built to survive).
 *   * **Without one.** Signup answers 5xx, those tests skip with a reason, and
 *     the contract tests below still run: the routes exist, they are protected,
 *     the redirect target is right, and the printed QR resolves.
 *
 * Skipping is stated rather than silent. A suite that quietly asserts nothing is
 * worse than one that says it could not.
 *
 * The locale is pinned to English for the same reason `public.spec.ts` pins it:
 * these assert on behaviour, and coupling them to whichever language ships as
 * the default would make them fail on a marketing decision.
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

// -----------------------------------------------------------------------------
// Contract: true on every deployment, seeded or not
// -----------------------------------------------------------------------------

test.describe('signup', () => {
  test('asks for the four things a business row needs, and nothing else', async ({ page }) => {
    // Every extra field here is a chance to close the tab. The trade is asked
    // once — the old onboarding asked for it a second time, with a different
    // list of options, which is the fastest way to teach a merchant that the
    // questions are not being read.
    await page.goto('/signup')

    await expect(page.getByLabel('Business name')).toBeVisible()
    await expect(page.getByLabel('What kind of business?')).toBeVisible()
    await expect(page.getByLabel('Email', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Password')).toBeVisible()

    const inputs = await page.locator('form input:not([type="hidden"])').count()
    expect(inputs, 'a fifth field has crept into signup').toBeLessThanOrEqual(4)
  })
})

test.describe('route protection', () => {
  test('onboarding is not reachable while signed out', async ({ page }) => {
    // It writes locations and plans, so it sits behind the same guard as the
    // dashboard. A public onboarding page would be a way to create rows in
    // somebody else's workspace.
    await page.goto('/onboarding')
    await expect(page).toHaveURL(/\/login/)
    await expect(page).toHaveURL(/next=%2Fonboarding/)
  })

  test('the counter is a route, not a download', async ({ page }) => {
    // The end of onboarding is a button to `/pos`. Signed out it redirects,
    // which is still proof the scanner ships as part of the app.
    await page.goto('/pos')
    await expect(page).toHaveURL(/next=%2Fpos/)
  })

  test('the installed app opens the counter, which is where onboarding ends', async ({
    request,
  }) => {
    const response = await request.get('/manifest.webmanifest')
    const manifest = await response.json()
    expect(manifest.start_url).toBe('/pos')
  })

  test('the QR a merchant prints at the end explains itself when wrong', async ({ page }) => {
    // The last screen hands over a code pointing at `/join/<slug>`. A merchant
    // testing their own printed code before a customer does is the point of
    // that screen, so an unknown slug must never be a crash.
    await page.goto('/join/definitely-not-a-real-slug')
    await expect(page.getByText(/does not exist/i)).toBeVisible()
  })
})

// -----------------------------------------------------------------------------
// The full walk, when a database is available
// -----------------------------------------------------------------------------

type Merchant = { email: string; password: string; businessName: string }

/**
 * Creates a merchant through the public signup endpoint.
 *
 * Returns null when the deployment has no database — which is the normal state
 * of a CI job that only builds the app — so the caller can skip with a reason
 * instead of failing on an environment it was never given.
 */
async function signUpMerchant(request: APIRequestContext): Promise<Merchant | null> {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`
  const merchant: Merchant = {
    email: `e2e-${stamp}@passimo.test`,
    password: 'a-perfectly-fine-passphrase-2026',
    businessName: `E2E Café ${stamp}`,
  }

  const response = await request.post('/api/v1/auth/signup', {
    data: {
      email: merchant.email,
      password: merchant.password,
      businessName: merchant.businessName,
      category: 'cafe',
      timezone: 'Europe/Madrid',
      locale: 'en',
    },
  })

  if (!response.ok()) return null
  return merchant
}

async function signIn(page: Page, merchant: Merchant): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('Email').fill(merchant.email)
  await page.getByLabel('Password').fill(merchant.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/\/(dashboard|onboarding)/)
}

/*
 * Serial, with one merchant for all three tests.
 *
 * Signup is rate limited to 8 attempts per five minutes per IP — deliberately,
 * since it is the most abuse-prone endpoint in the product. Three tests × two
 * viewport projects was six signups from one address before this file even
 * reached the counter tests, which made the suite fail on its own security
 * control rather than on the product. One account, walked in order, is also
 * closer to what a real merchant does.
 */
test.describe.configure({ mode: 'serial' })

test.describe('the whole flow, end to end', () => {
  let shared: Merchant | null = null

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext()
    shared = await signUpMerchant(context.request)
    await context.close()
  })

  test('a new merchant reaches the counter through four steps, two skippable', async ({
    page,
  }) => {
    const merchant = shared
    test.skip(
      merchant === null,
      'no database on this deployment — the contract tests above still ran'
    )

    await signIn(page, merchant!)
    await page.goto('/onboarding')

    // --- Step 1: the program --------------------------------------------------
    //
    // Leads with the answer rather than a question: signup already collected the
    // trade, so this screen exists to *show* what it implies — the program, the
    // reward, the first campaign and the card — and to let a mis-tap be
    // corrected. The card preview is the point of the screen and must be there.
    await expect(page.getByRole('heading', { name: /here is your program/i })).toBeVisible()
    await expect(page.getByText(/a stamp per visit/i)).toBeVisible()
    await expect(page.getByRole('tab', { name: /apple wallet/i })).toBeVisible()

    // The progress rail states how far along they are and which steps they are
    // allowed to postpone. Both matter: a flow where everything looks mandatory
    // is a flow people abandon on the step they are not ready for.
    await expect(page.getByRole('progressbar', { name: /setup progress/i })).toBeVisible()
    expect(await page.getByText('Optional', { exact: true }).count()).toBeGreaterThanOrEqual(2)

    await page.getByRole('button', { name: /this looks right/i }).click()

    // --- Step 2: the plan -----------------------------------------------------
    //
    // The only decision with money attached, and it must be passable without
    // paying: a card form between a merchant and their first customer is the
    // single most expensive screen a loyalty product can have.
    await expect(page.getByRole('heading', { name: /pick a plan/i })).toBeVisible()
    await page.getByRole('button', { name: /start my 14-day trial/i }).click()

    // --- Step 3: the first location -------------------------------------------
    //
    // A card has to point somewhere and a geofence needs a centre. Both the
    // address and the whole step are explicitly optional — asking for a latitude
    // before the first customer would be absurd, and so would blocking on it.
    await expect(page.getByRole('heading', { name: /where do customers find you/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /i will add my shop later/i })).toBeVisible()
    await page.getByLabel('Store name').fill('Gran Vía')
    await page.getByLabel('City').fill('Madrid')
    /*
     * `exact` matters: Next.js injects a dev-tools button labelled "Open Next.js
     * Dev Tools", and a loose "Next" match resolves to both when the suite runs
     * against `pnpm dev` rather than a production build. The suite should be
     * runnable either way.
     */
    await page.getByRole('button', { name: 'Next', exact: true }).click()

    // --- Step 4: the card -----------------------------------------------------
    //
    // Prefilled from the trade signup already knows, so this is a confirmation
    // rather than a composition. The reward field must arrive populated, and the
    // preview must be the real one — the same renderer the pass resolves
    // through, not a decorative mock.
    await expect(page.getByRole('heading', { name: /activate your loyalty card/i })).toBeVisible()
    const reward = page.getByLabel('What do they earn?')
    await expect(reward).not.toHaveValue('')
    await expect(page.getByRole('tab', { name: /google wallet/i })).toBeVisible()
    await page.getByRole('button', { name: /activate the card/i }).click()

    // --- Done -----------------------------------------------------------------
    await expect(page.getByRole('heading', { name: /your loyalty program is live/i })).toBeVisible()
    // The QR is the deliverable: it is what goes on the counter.
    await expect(page.locator('img[alt*="QR"]')).toBeVisible()

    /*
     * There is still no rehearsal step. The old flow's — enrol yourself as a
     * fake customer, then scan yourself — is gone, and nothing replaced it.
     */
    await expect(page.getByText(/practice|rehearse|test customer|demo customer/i)).toHaveCount(0)

    // And the last thing on the screen is the way to the counter — pressing it
    // has to land there, because that is where onboarding is meant to end.
    await page.getByRole('button', { name: /start accepting customers/i }).click()
    await expect(page).toHaveURL(/\/pos/)
  })

  test('the first scan works from the counter, with no camera', async ({ page }) => {
    const merchant = shared
    test.skip(merchant === null, 'no database on this deployment')

    await signIn(page, merchant!)

    /*
     * Playwright has no camera, which is precisely the condition the counter is
     * built to survive: no camera, no signal, no phone — there is always a way
     * to serve the person in front of you. The scanner therefore opens straight
     * into its manual panel, and *that* is the first scan being simulated.
     */
    await page.goto('/pos')

    const search = page.getByLabel(/name, phone, email or code/i)
    await expect(search).toBeVisible({ timeout: 20_000 })

    // An empty list is the correct answer for a merchant with no customers yet,
    // and it has to say so rather than showing a blank rectangle.
    await expect(page.getByText(/no visits recorded yet|start typing/i).first()).toBeVisible()

    // Enter sends the raw text to the resolver, so a typed code behaves exactly
    // like a scanned one. An unknown one must be reported, never swallowed.
    await search.fill('not-a-real-code')
    await search.press('Enter')
    await expect(page.getByText(/not recognised|nobody matches/i).first()).toBeVisible()
  })

  test('the dashboard offers what onboarding stopped asking for', async ({ page }) => {
    const merchant = shared
    test.skip(merchant === null, 'no database on this deployment')

    await signIn(page, merchant!)
    await page.goto('/dashboard')

    // Deferring a decision must not be the same as losing it. Everything the
    // wizard dropped is on the checklist, on the first screen they land on.
    await expect(page.getByRole('heading', { name: /first steps/i })).toBeVisible({
      timeout: 20_000,
    })
    await expect(page.getByText(/serve your first customer/i)).toBeVisible()

    // And it never blocks: the metrics below it are reachable without touching it.
    await expect(page.getByText(/program health/i)).toBeVisible()
  })
})
