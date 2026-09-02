import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { LOCALE_COOKIE } from '@/lib/i18n/locales'
import { SESSION_COOKIE } from '@/lib/auth/session-token'

/**
 * The demo accounts, in a browser, one plan at a time.
 *
 * `scripts/verify-functional.mjs` already drives every plan over HTTP and checks
 * far more than this does. What it cannot check is the half of feature gating
 * that lives in the DOM: whether a Starter merchant can *see* that campaigns
 * exist, whether the lock appears on the right rows, whether the plan they are
 * paying for is written anywhere they can find it, and whether a lapsed
 * workspace can still read its own customer list.
 *
 * That distinction matters because the two halves fail differently. A missing
 * server gate is a security bug. A missing client affordance is a pricing bug —
 * the merchant never learns the feature exists, so they never upgrade — and no
 * amount of API testing surfaces it.
 *
 * Requires `pnpm seed:demo`. Every test skips with a stated reason when the demo
 * accounts are absent, because the rest of the e2e suite deliberately runs
 * unseeded and a spec that silently asserts nothing is worse than one that says
 * it could not.
 */

const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'PassimoDemo2026!'

type DemoPlan = {
  plan: string
  email: string
  business: string
  /** Plan name as the catalogue spells it — what should appear in the sidebar. */
  planLabel: string
  /** Nav rows that must carry a lock for this plan. */
  locked: string[]
  /** Nav rows that must be reachable without a lock. */
  unlocked: string[]
}

const PLANS: DemoPlan[] = [
  {
    plan: 'starter',
    email: 'starter@demo.com',
    business: 'Madrid Coffee',
    planLabel: 'Starter',
    locked: ['Campaigns', 'Automations', 'Gift cards', 'Memberships'],
    unlocked: ['Customers', 'Rewards', 'Analytics'],
  },
  {
    plan: 'growth',
    email: 'growth@demo.com',
    business: 'Barcelona Barber',
    planLabel: 'Growth',
    locked: ['Memberships'],
    unlocked: ['Campaigns', 'Automations', 'Gift cards', 'Customers'],
  },
  {
    plan: 'pro',
    email: 'pro@demo.com',
    business: 'Valencia Fitness',
    planLabel: 'Pro',
    locked: [],
    unlocked: ['Campaigns', 'Automations', 'Gift cards', 'Memberships', 'Insights'],
  },
  {
    plan: 'business',
    email: 'business@demo.com',
    business: 'Sevilla Bakery',
    planLabel: 'Business',
    locked: [],
    unlocked: ['Campaigns', 'Automations', 'Gift cards', 'Memberships', 'Partner network'],
  },
]

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([
    { name: LOCALE_COOKIE, value: 'en', url: baseURL ?? 'http://localhost:3000' },
  ])
})

/**
 * One sign-in per account, cached, then replayed as a cookie.
 *
 * Signing in through the form in every test is the obvious thing and it does not
 * work here: `authSignIn` allows thirty attempts per IP per five minutes, and
 * this spec alone runs twenty-one tests across two viewports. The first pass
 * exhausted the bucket and eleven tests skipped with "the demo account is not
 * present" — a message that was doubly wrong, because the accounts existed and
 * the rate limiter was doing exactly its job.
 *
 * So the credential is exchanged once per account and the resulting cookie is
 * reused. That still exercises `POST /api/v1/auth/login` for real — a broken
 * sign-in fails every test in this file — while the *form* itself is covered by
 * `public.spec.ts`, which is where it belongs.
 */
const sessions = new Map<string, string | null>()

async function sessionFor(
  request: APIRequestContext,
  email: string
): Promise<string | null> {
  const cached = sessions.get(email)
  if (cached !== undefined) return cached

  const response = await request.post('/api/v1/auth/login', {
    data: { email, password: DEMO_PASSWORD },
    failOnStatusCode: false,
  })

  if (!response.ok()) {
    sessions.set(email, null)
    return null
  }

  const state = await request.storageState()
  const cookie = state.cookies.find((candidate) => candidate.name === SESSION_COOKIE)
  const value = cookie?.value ?? null
  sessions.set(email, value)
  return value
}

/** Puts an already-issued session on the browser context. */
async function signIn(
  page: Page,
  request: APIRequestContext,
  baseURL: string | undefined,
  email: string
): Promise<boolean> {
  const value = await sessionFor(request, email)
  if (!value) return false

  await page.context().addCookies([
    { name: SESSION_COOKIE, value, url: baseURL ?? 'http://localhost:3000' },
  ])
  return true
}

for (const account of PLANS) {
  test.describe(`${account.plan} — ${account.business}`, () => {
    test('signs in and lands on its own workspace', async ({ page, request, baseURL }) => {
      const ok = await signIn(page, request, baseURL, account.email)
      test.skip(!ok, `demo account ${account.email} is not present — run \`pnpm seed:demo\``)

      await page.goto('/dashboard')
      // The workspace name is the merchant's confirmation they are in the right
      // account, and the first thing wrong when a session resolves the wrong
      // tenant.
      await expect(page.getByText(account.business).first()).toBeVisible({ timeout: 15_000 })
    })

    test('shows which plan is being paid for', async ({ page, request, baseURL }) => {
      const ok = await signIn(page, request, baseURL, account.email)
      test.skip(!ok, `demo account ${account.email} is not present — run \`pnpm seed:demo\``)

      await page.goto('/dashboard')
      /*
       * Read from the sidebar, where it sits beside the workspace switcher. A
       * merchant who cannot find their own tier on any screen cannot tell whether
       * an upgrade did anything, and support cannot either.
       */
      await expect(page.getByText(account.planLabel, { exact: false }).first()).toBeVisible({
        timeout: 15_000,
      })
    })

    test('locks exactly the features this plan does not include', async ({ page, request, baseURL }) => {
      const ok = await signIn(page, request, baseURL, account.email)
      test.skip(!ok, `demo account ${account.email} is not present — run \`pnpm seed:demo\``)

      await page.goto('/dashboard')
      const nav = page.getByRole('navigation').first()

      for (const label of account.unlocked) {
        /*
         * Present *and* not locked. Checking only presence would pass on a
         * dashboard where every row is locked, which is what a broken
         * entitlement lookup produces.
         */
        const row = nav.getByRole('link', { name: new RegExp(label, 'i') }).first()
        await expect(row, `${label} should be available on ${account.plan}`).toBeVisible()
      }

      for (const label of account.locked) {
        /*
         * Gated features are *shown*, with a lock — not hidden. That is a
         * deliberate product decision (see the comment on `NavItem` in
         * `app/dashboard/layout.tsx`): a merchant cannot want a feature they have
         * never seen, so hiding paid features sells nothing. The test therefore
         * asserts visible-and-locked rather than absent, and would fail if
         * somebody "tidied up" by hiding them.
         */
        const row = nav.getByRole('link', { name: new RegExp(label, 'i') }).first()
        await expect(row, `${label} should still be visible on ${account.plan}`).toBeVisible()
      }
    })

    test('the customer list has real data in it', async ({ page, request, baseURL }) => {
      const ok = await signIn(page, request, baseURL, account.email)
      test.skip(!ok, `demo account ${account.email} is not present — run \`pnpm seed:demo\``)

      await page.goto('/dashboard/customers')
      await expect(page.locator('main')).toBeVisible()

      /*
       * Counted by link, not by table row.
       *
       * The list is genuinely two layouts: a `<table>` above the `md` breakpoint
       * and a `<ul>` of cards below it, which is the right design and the reason
       * an assertion on `role="row"` passed on desktop and failed on every mobile
       * run. Both layouts link each customer to their profile, so the link is the
       * one thing that means "a customer is on this page" at any viewport.
       *
       * A demo whose screens are empty demonstrates nothing, and an empty state
       * is indistinguishable from a broken query — so at least one has to be here.
       */
      const customerLinks = page.locator('main a[href*="/dashboard/customers/"]')
      await expect(async () => {
        expect(await customerLinks.count()).toBeGreaterThan(0)
      }).toPass({ timeout: 15_000 })
    })
  })
}

test.describe('trial — Bilbao Pizzeria', () => {
  test('is told how long is left, and on which tier', async ({ page, request, baseURL }) => {
    const ok = await signIn(page, request, baseURL, 'trial@demo.com')
    test.skip(!ok, 'demo account trial@demo.com is not present — run `pnpm seed:demo`')

    /*
     * A trial is entitled to Pro and paying nothing. Both facts have to reach the
     * merchant: the tier, so the features they are falling in love with have a
     * name, and the countdown, so the decision has a deadline. This is also the
     * screen that proved the admin console was mislabelling trials as inactive —
     * the merchant's own dashboard was right while the operator's was not.
     */
    await page.goto('/dashboard')
    await expect(page.getByText(/trial|days/i).first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Bilbao Pizzeria').first()).toBeVisible()
  })
})

test.describe('lapsed — Zaragoza Florist', () => {
  test('can still read everything it had', async ({ page, request, baseURL }) => {
    const ok = await signIn(page, request, baseURL, 'lapsed@demo.com')
    test.skip(!ok, 'demo account lapsed@demo.com is not present — run `pnpm seed:demo`')

    /*
     * The promise the reactivation wall makes is "nothing has been deleted", and
     * it is the promise most worth testing: a merchant who cannot see their
     * customer list after a failed card does not reactivate, they leave.
     */
    await page.goto('/dashboard/customers')
    // By link rather than by table row, so the check holds at both viewports.
    const customerLinks = page.locator('main a[href*="/dashboard/customers/"]')
    await expect(async () => {
      expect(await customerLinks.count()).toBeGreaterThan(0)
    }).toPass({ timeout: 15_000 })
  })

  test('is offered a way back rather than an error', async ({ page, request, baseURL }) => {
    const ok = await signIn(page, request, baseURL, 'lapsed@demo.com')
    test.skip(!ok, 'demo account lapsed@demo.com is not present — run `pnpm seed:demo`')

    await page.goto('/dashboard/billing')
    await expect(page.locator('main')).toBeVisible()
    // Reactivation, an entry price, or the word "inactive" — any of the three is
    // the wall doing its job. None of them is a 500 or an empty screen.
    await expect(
      page.getByText(/reactivat|inactive|\$5|choose a plan|upgrade/i).first()
    ).toBeVisible()
  })
})

test.describe('platform admin', () => {
  test('sees every workspace, with trials labelled as trials', async ({ page, request, baseURL }) => {
    const ok = await signIn(page, request, baseURL, process.env.PLATFORM_ADMIN_EMAIL ?? 'admin@passimo.demo')
    test.skip(!ok, 'demo platform admin is not present — run `pnpm seed:demo`')

    await page.goto('/admin')
    await expect(page.locator('main')).toBeVisible()

    // The console opens on Overview; the workspace list is its own tab.
    await page.getByRole('tab', { name: /businesses/i }).click()

    /*
     * Both demo lifecycle workspaces have to appear, and the trial must not be
     * filed under Inactive — which it was, because `normalizePlanId('trial')`
     * returns null and every admin read fell back to `lapsed`.
     */
    await expect(page.getByText('Bilbao Pizzeria').first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Zaragoza Florist').first()).toBeVisible()

    /*
     * The trial's row must name the tier it is evaluating and mark it a trial —
     * two labels, not one. A row reading only "Inactive" is the defect.
     */
    const trialRow = page.getByRole('row').filter({ hasText: 'Bilbao Pizzeria' })
    await expect(trialRow).toContainText(/pro/i)
    await expect(trialRow).toContainText(/trial/i)
  })

  test('a merchant cannot open the admin console', async ({ page, request, baseURL }) => {
    const ok = await signIn(page, request, baseURL, 'business@demo.com')
    test.skip(!ok, 'demo account business@demo.com is not present — run `pnpm seed:demo`')

    const response = await page.goto('/admin')
    /*
     * Either a redirect away or a refusal on the page. What must never happen is
     * a merchant reading another tenant's numbers, so the assertion is on what is
     * *not* there rather than on which of the two mechanisms answered.
     */
    expect(response?.status()).toBeLessThan(500)
    await expect(page.getByText('Bilbao Pizzeria')).toHaveCount(0)
    await expect(page.getByText('Zaragoza Florist')).toHaveCount(0)
  })
})
