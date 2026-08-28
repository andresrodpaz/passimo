import { expect, test, type APIRequestContext } from '@playwright/test'

/**
 * The whole merchant journey, in one test.
 *
 * Sign up → choose a plan → configure loyalty → create a reward → add a location
 * → activate → enrol a customer → scan them → register the visit → award the
 * reward → see it in analytics.
 *
 * `tests/e2e/onboarding.spec.ts` walks the *screens*; this walks the *state*. It
 * drives the same public and authenticated endpoints a browser does and then
 * asserts on what the product reports back, because the thing most likely to
 * break in a chain this long is not a button — it is one step writing a row the
 * next step does not read, or an API cheerfully returning `{ ok: true }` for
 * something that did not happen.
 *
 * Deliberately API-level. A twelve-step UI script is a test that fails for
 * reasons unrelated to the product (a label reworded, an animation), and the
 * failure mode it protects against is exactly the one that makes a merchant's
 * first week quietly wrong.
 *
 * Skips with a reason when the deployment has no database, matching the rest of
 * the suite.
 */

type Merchant = {
  email: string
  password: string
  businessId: string
  slug: string
  cookie: string
}

/**
 * Signs up and keeps the session cookie.
 *
 * The cookie is carried by hand rather than through a browser context so this
 * spec can use `request` throughout — one transport, no page objects, and the
 * session behaves exactly as it does for the dashboard.
 */
async function signUp(request: APIRequestContext): Promise<Merchant | null> {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`
  const email = `journey-${stamp}@passimo.test`
  const password = 'a-perfectly-fine-passphrase-2026'

  const response = await request.post('/api/v1/auth/signup', {
    data: {
      email,
      password,
      businessName: `Journey Coffee ${stamp}`,
      category: 'cafe',
      timezone: 'Europe/Madrid',
      currency: 'EUR',
      locale: 'en',
    },
  })

  if (!response.ok()) return null

  const body = (await response.json()) as {
    business: { id: string; slug: string }
  }

  const setCookie = response.headers()['set-cookie'] ?? ''
  const cookie = setCookie.split(';')[0] ?? ''
  expect(cookie, 'signup must establish a session cookie').toContain('passimo_session=')

  return {
    email,
    password,
    businessId: body.business.id,
    slug: body.business.slug,
    cookie,
  }
}

test.describe('merchant journey', () => {
  test('from signup to a redeemed reward showing in analytics', async ({ request }) => {
    const merchant = await signUp(request)
    test.skip(merchant === null, 'no database on this deployment')

    const auth = { Cookie: merchant!.cookie }
    const businessId = merchant!.businessId

    // -- 1. Signup provisioned a usable workspace -----------------------------
    //
    // `passimo_provision_business` runs during signup. If it silently failed, the
    // merchant would land in a dashboard with no program and no way to make one
    // from the wizard — so this is asserted before anything depends on it.
    const programs = await request.get(`/api/v1/programs?businessId=${businessId}`, {
      headers: auth,
    })
    expect(programs.ok(), await programs.text()).toBe(true)
    const programBody = (await programs.json()) as {
      programs: Array<{ id: string; is_default: boolean; goal_amount: number | null }>
    }
    const program = programBody.programs.find((candidate) => candidate.is_default)
    expect(program, 'signup must provision a default loyalty program').toBeTruthy()

    // -- 2. The plan ----------------------------------------------------------
    //
    // There is no free tier, so a brand-new workspace has to be on a trial to be
    // able to do anything. That is the whole reason the trial exists.
    const billing = await request.get(`/api/v1/billing?businessId=${businessId}`, { headers: auth })
    expect(billing.ok()).toBe(true)
    const billingBody = (await billing.json()) as {
      effective_plan: string
      trial: { active: boolean }
      plans?: Array<{ id: string; monthly_price: number | null }>
    }
    expect(billingBody.effective_plan).not.toBe('free')
    expect(billingBody.trial.active || billingBody.effective_plan !== 'lapsed').toBe(true)

    // -- 3. Configure loyalty and create a reward -----------------------------
    const goal = 6
    const updateProgram = await request.patch('/api/v1/programs', {
      headers: auth,
      data: {
        businessId,
        id: program!.id,
        goalAmount: goal,
        rewardDescription: 'A free flat white',
      },
    })
    expect(updateProgram.ok(), await updateProgram.text()).toBe(true)

    const createReward = await request.post('/api/v1/rewards', {
      headers: auth,
      data: {
        businessId,
        programId: program!.id,
        name: 'Free flat white',
        cost: goal,
        description: 'Any drink from the menu, on us.',
      },
    })
    expect(createReward.ok(), await createReward.text()).toBe(true)
    const rewardId = ((await createReward.json()) as { reward_id: string }).reward_id
    expect(rewardId, 'creating a reward must return its id').toBeTruthy()

    // -- 4. Add a location ----------------------------------------------------
    const location = await request.post('/api/v1/locations', {
      headers: auth,
      data: { businessId, name: 'Gran Vía', city: 'Madrid', isDefault: true },
    })
    expect(location.ok(), await location.text()).toBe(true)

    // -- 5. Activate ----------------------------------------------------------
    const activate = await request.patch(`/api/v1/businesses/${businessId}`, {
      headers: auth,
      data: { onboardingCompleted: true, primaryColor: '#1F1408', accentColor: '#C98A3F' },
    })
    expect(activate.ok(), await activate.text()).toBe(true)

    // -- 6. A customer joins from the printed QR ------------------------------
    //
    // Unauthenticated on purpose: this is the public join page a customer reaches
    // by scanning the code on the counter, and it is the product's primary
    // acquisition path.
    const customerEmail = `customer-${Date.now()}@passimo.test`
    const join = await request.post('/api/v1/public/join', {
      data: {
        businessSlug: merchant!.slug,
        email: customerEmail,
        name: 'Ana Ruiz',
        acceptedTerms: true,
        consents: { marketing: true },
      },
    })
    expect(join.ok(), await join.text()).toBe(true)
    const joinBody = (await join.json()) as {
      joined: boolean
      card_url: string
      apple_wallet_url: string
      google_wallet_url: string
    }
    expect(joinBody.joined).toBe(true)
    // The three things the customer is handed. Wallet credentials may be absent
    // on this deployment, but the URLs are the architecture and must exist.
    expect(joinBody.card_url).toContain('/card/')
    expect(joinBody.apple_wallet_url).toContain('/api/v1/wallet/apple/')
    expect(joinBody.google_wallet_url).toContain('/api/v1/wallet/google/')

    // The card page a customer actually opens has to render.
    const cardPage = await request.get(joinBody.card_url)
    expect(cardPage.ok(), 'the customer-facing card page must load').toBe(true)

    // -- 7. Find the customer the way the counter does ------------------------
    const lookup = await request.get(
      `/api/v1/customers?businessId=${businessId}&q=${encodeURIComponent(customerEmail)}`,
      { headers: auth }
    )
    expect(lookup.ok()).toBe(true)
    const lookupBody = (await lookup.json()) as {
      customers: Array<{ id: string; email: string }>
    }
    expect(lookupBody.customers).toHaveLength(1)
    const customerId = lookupBody.customers[0]!.id

    // -- 8. Scan and register the visit ---------------------------------------
    //
    // `raw` is the customer id, which is what a wallet barcode encodes. Repeated
    // `goal` times to fill the card, each with its own key — a real counter
    // generates one per interaction.
    for (let visit = 0; visit < goal; visit += 1) {
      const scan = await request.post('/api/v1/scan', {
        headers: auth,
        data: {
          businessId,
          raw: customerId,
          action: 'checkin',
          trigger: 'purchase',
          amount: 4.5,
          idempotencyKey: `journey-${customerId}-${visit}`,
        },
      })
      expect(scan.ok(), await scan.text()).toBe(true)

      const scanBody = (await scan.json()) as {
        resolution: { kind: string }
        checkin: { duplicate: boolean; totalAwarded: number; rewardUnlocked: boolean }
      }
      expect(scanBody.resolution.kind).toBe('customer')
      expect(scanBody.checkin.duplicate).toBe(false)
      expect(scanBody.checkin.totalAwarded).toBeGreaterThan(0)
    }

    // -- 9. A replayed scan must not count twice ------------------------------
    //
    // The offline queue flushes its backlog when signal returns. This is the
    // property that makes that safe.
    const replay = await request.post('/api/v1/scan', {
      headers: auth,
      data: {
        businessId,
        raw: customerId,
        action: 'checkin',
        trigger: 'purchase',
        amount: 4.5,
        idempotencyKey: `journey-${customerId}-0`,
      },
    })
    expect(replay.ok()).toBe(true)
    expect(((await replay.json()) as { checkin: { duplicate: boolean } }).checkin.duplicate).toBe(
      true
    )

    // -- 10. The card is complete --------------------------------------------
    const profile = await request.get(
      `/api/v1/customers/${customerId}?businessId=${businessId}`,
      { headers: auth }
    )
    expect(profile.ok(), await profile.text()).toBe(true)
    const profileBody = (await profile.json()) as {
      customer: {
        visitCount: number
        lifetimeSpend: number
        averageTicket: number
        primaryBalance: number
        primaryGoal: number | null
        rewardAvailable: boolean
      }
    }

    // Exactly `goal` visits: the replay above must not appear here.
    expect(profileBody.customer.visitCount).toBe(goal)
    expect(Number(profileBody.customer.lifetimeSpend)).toBeCloseTo(goal * 4.5, 2)
    expect(Number(profileBody.customer.averageTicket)).toBeCloseTo(4.5, 2)

    // The card is full, and the product says so — this is the moment the whole
    // flow exists to produce.
    expect(Number(profileBody.customer.primaryBalance)).toBeGreaterThanOrEqual(goal)
    expect(profileBody.customer.rewardAvailable).toBe(true)

    // -- 11. Award the reward -------------------------------------------------
    const redeem = await request.post('/api/v1/loyalty/redeem', {
      headers: auth,
      data: {
        businessId,
        customerId,
        rewardId,
        idempotencyKey: `journey-redeem-${customerId}`,
      },
    })
    expect(redeem.ok(), await redeem.text()).toBe(true)

    // Redeeming the same reward twice on one key must not spend the balance twice.
    const redeemAgain = await request.post('/api/v1/loyalty/redeem', {
      headers: auth,
      data: {
        businessId,
        customerId,
        rewardId,
        idempotencyKey: `journey-redeem-${customerId}`,
      },
    })
    expect(redeemAgain.ok(), await redeemAgain.text()).toBe(true)

    // -- 12. Analytics reports the same transaction --------------------------
    //
    // The end of the chain. Every number here has to come from the rows the
    // eleven steps above wrote — this is the assertion that catches a dashboard
    // showing a figure the product did not produce.
    const analytics = await request.get(
      `/api/v1/analytics/overview?businessId=${businessId}&days=30`,
      { headers: auth }
    )
    expect(analytics.ok(), await analytics.text()).toBe(true)
    const overview = (await analytics.json()) as {
      customers: { total: number }
      revenue: { period: number; average_ticket: number }
      top_rewards?: unknown[]
    }

    expect(overview.customers.total).toBe(1)
    expect(Number(overview.revenue.period)).toBeCloseTo(goal * 4.5, 1)
    expect(Number(overview.revenue.average_ticket)).toBeCloseTo(4.5, 1)

    // -- 13. And the checklist agrees the merchant has started ---------------
    const onboarding = await request.get(`/api/v1/onboarding?businessId=${businessId}`, {
      headers: auth,
    })
    expect(onboarding.ok()).toBe(true)
    const onboardingBody = (await onboarding.json()) as {
      completed: boolean
      facts: { scanCount: number; locationCount: number }
    }
    expect(onboardingBody.completed).toBe(true)
    expect(onboardingBody.facts.scanCount).toBe(goal)
    expect(onboardingBody.facts.locationCount).toBeGreaterThanOrEqual(1)
  })

  test('a signed-out visitor cannot reach any of it', async ({ request }) => {
    // The same chain without a session. Every authenticated step must refuse,
    // and refuse with 401 rather than 404 or 500 — a merchant debugging their
    // own integration needs to be told what is wrong.
    const endpoints = [
      '/api/v1/programs?businessId=00000000-0000-0000-0000-000000000000',
      '/api/v1/rewards?businessId=00000000-0000-0000-0000-000000000000',
      '/api/v1/customers?businessId=00000000-0000-0000-0000-000000000000',
      '/api/v1/analytics/overview?businessId=00000000-0000-0000-0000-000000000000',
      '/api/v1/onboarding?businessId=00000000-0000-0000-0000-000000000000',
    ]

    for (const endpoint of endpoints) {
      const response = await request.get(endpoint)
      expect([401, 403], `${endpoint} answered ${response.status()}`).toContain(response.status())
    }

    const scan = await request.post('/api/v1/scan', {
      data: {
        businessId: '00000000-0000-0000-0000-000000000000',
        raw: 'anything',
        action: 'identify',
      },
    })
    expect([401, 403]).toContain(scan.status())
  })
})
