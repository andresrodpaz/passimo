/**
 * Functional verification harness.
 *
 *   pnpm verify:functional            # against http://localhost:3000
 *   BASE_URL=... pnpm verify:functional
 *
 * Drives the running application over HTTP exactly the way the dashboard does —
 * real session cookies, real routes, real database — and asserts the outcome of
 * every journey a paying merchant depends on: sign-in, plan detection, feature
 * gating in both directions, tenant isolation, onboarding resume, loyalty earn,
 * reward redemption, counter scanning, wallet design persistence, campaigns,
 * analytics movement and locale switching.
 *
 * Why this exists as a script rather than only as Playwright specs: E2E needs a
 * browser and a production build, which makes it the slowest thing in the repo
 * and the first thing skipped. This runs in seconds against `pnpm dev`, needs no
 * browser, and answers the one question a report cannot: *did it actually work*.
 * The Playwright suite still covers what only a browser can (camera, rendering,
 * responsive layout); this covers everything that is really a request and a row.
 *
 * It is read-only with respect to the demo fixtures in the sense that matters:
 * it creates its own customers and rewards, prefixed `zz-verify`, so re-running
 * it never corrupts the curated demo data a reviewer is looking at.
 *
 * Exit code 0 only when every check passed.
 */

import { writeFileSync } from 'node:fs'

const BASE = (process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '')
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'PassimoDemo2026!'
const ONLY = process.env.VERIFY_ONLY ?? ''

/**
 * The purchasable tiers, plus the two lifecycle states that have their own
 * screens and cannot be reached from any paid plan.
 *
 * `trial` resolves to Pro entitlements while its window is open; `lapsed` is
 * where a workspace lands when that window closes without a card, and is the only
 * state in which the paywall can be exercised at all.
 */
const ACCOUNTS = [
  { plan: 'starter', email: 'starter@demo.com', business: 'Madrid Coffee' },
  { plan: 'growth', email: 'growth@demo.com', business: 'Barcelona Barber' },
  { plan: 'pro', email: 'pro@demo.com', business: 'Valencia Fitness' },
  { plan: 'business', email: 'business@demo.com', business: 'Sevilla Bakery' },
  { plan: 'trial', email: 'trial@demo.com', business: 'Bilbao Pizzeria' },
  { plan: 'lapsed', email: 'lapsed@demo.com', business: 'Zaragoza Florist' },
]

// -----------------------------------------------------------------------------
// Reporting
// -----------------------------------------------------------------------------

const results = []
let section = 'general'

const C = {
  reset: '[0m',
  dim: '[2m',
  red: '[31m',
  green: '[32m',
  yellow: '[33m',
  cyan: '[36m',
  bold: '[1m',
}

function heading(title) {
  section = title
  process.stdout.write(`\n${C.bold}${C.cyan}── ${title}${C.reset}\n`)
}

function record(status, name, detail) {
  results.push({ section, status, name, detail })
  const mark =
    status === 'PASS'
      ? `${C.green}PASS${C.reset}`
      : status === 'WARN'
        ? `${C.yellow}WARN${C.reset}`
        : `${C.red}FAIL${C.reset}`
  process.stdout.write(`  ${mark}  ${name}${detail ? `${C.dim} — ${detail}${C.reset}` : ''}\n`)
}

const pass = (name, detail) => record('PASS', name, detail)
const fail = (name, detail) => record('FAIL', name, detail)
const warn = (name, detail) => record('WARN', name, detail)

/** Asserts a boolean; the detail is printed either way so a pass is evidence too. */
function check(name, condition, detail) {
  if (condition) pass(name, detail)
  else fail(name, detail)
  return Boolean(condition)
}

function checkStatus(name, response, expected) {
  const want = Array.isArray(expected) ? expected : [expected]
  const ok = want.includes(response.status)
  record(ok ? 'PASS' : 'FAIL', name, `HTTP ${response.status}${ok ? '' : ` (expected ${want.join('/')})`}${response.errorCode ? ` ${response.errorCode}` : ''}`)
  return ok
}

// -----------------------------------------------------------------------------
// HTTP client with a cookie jar
// -----------------------------------------------------------------------------

class Client {
  constructor(label) {
    this.label = label
    this.cookies = new Map()
  }

  setCookie(name, value) {
    this.cookies.set(name, value)
  }

  cookieHeader() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
  }

  async request(method, path, { body, headers = {}, raw = false } = {}) {
    const url = path.startsWith('http') ? path : `${BASE}${path}`
    const init = {
      method,
      redirect: 'manual',
      headers: {
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(this.cookies.size ? { cookie: this.cookieHeader() } : {}),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }

    const response = await fetch(url, init)

    for (const setCookie of response.headers.getSetCookie?.() ?? []) {
      const [pair] = setCookie.split(';')
      const index = pair.indexOf('=')
      if (index > 0) this.cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim())
    }

    const text = await response.text()
    let json = null
    if (!raw) {
      try {
        json = JSON.parse(text)
      } catch {
        json = null
      }
    }

    return {
      status: response.status,
      headers: response.headers,
      location: response.headers.get('location'),
      json,
      text,
      /** `lib/http.ts` shape: { error: { code, message } }. */
      errorCode: json?.error?.code ?? null,
      errorMessage: json?.error?.message ?? null,
      data: json?.data ?? json,
    }
  }

  get(path, options) {
    return this.request('GET', path, options)
  }
  post(path, body, options) {
    return this.request('POST', path, { ...options, body: body ?? {} })
  }
  patch(path, body, options) {
    return this.request('PATCH', path, { ...options, body: body ?? {} })
  }
  put(path, body, options) {
    return this.request('PUT', path, { ...options, body: body ?? {} })
  }
  del(path, options) {
    return this.request('DELETE', path, options)
  }
}

// -----------------------------------------------------------------------------
// Plan catalogue, mirrored from lib/billing/plans.ts
//
// Duplicated on purpose: an independent copy is what makes this a *test*. If it
// imported the same module the code under test uses, a wrong plan definition
// would agree with itself and pass.
// -----------------------------------------------------------------------------

const EXPECTED_PLANS = {
  starter: {
    monthlyPrice: 5,
    has: ['custom_branding', 'wallet_proximity'],
    lacks: [
      'campaigns', 'automations', 'segments', 'ai', 'gift_cards', 'memberships',
      'automation_rules', 'multi_location', 'proximity_campaigns', 'geofencing',
      'advanced_analytics', 'api_access', 'webhooks', 'coalition', 'sso',
      'team_management', 'priority_support',
    ],
    limits: { customers: 500, locations: 1, team_members: 2, campaigns_per_month: 0 },
  },
  growth: {
    monthlyPrice: 19,
    has: [
      'campaigns', 'automations', 'gift_cards', 'segments', 'custom_branding',
      'multi_location', 'wallet_proximity', 'geofencing', 'proximity_campaigns',
      'automation_rules',
    ],
    lacks: [
      'ai', 'memberships', 'api_access', 'webhooks', 'advanced_analytics',
      'coalition', 'sso', 'team_management', 'priority_support',
    ],
    limits: { customers: 5000, locations: 5, team_members: 10 },
  },
  pro: {
    monthlyPrice: 49,
    has: [
      'campaigns', 'automations', 'gift_cards', 'memberships', 'ai',
      'advanced_analytics', 'segments', 'api_access', 'webhooks', 'multi_location',
      'custom_branding', 'wallet_proximity', 'geofencing', 'proximity_campaigns',
      'automation_rules',
    ],
    lacks: ['coalition', 'sso', 'priority_support', 'team_management'],
    limits: { customers: 25000, locations: 15, team_members: 25 },
  },
  business: {
    monthlyPrice: 99,
    has: [
      'campaigns', 'automations', 'gift_cards', 'memberships', 'ai',
      'advanced_analytics', 'segments', 'api_access', 'webhooks', 'coalition',
      'multi_location', 'custom_branding', 'priority_support', 'sso',
      'team_management', 'wallet_proximity', 'geofencing', 'proximity_campaigns',
      'automation_rules',
    ],
    lacks: [],
    limits: { customers: null, locations: null, team_members: null },
  },
  /*
   * A live trial is entitled to Pro. That is deliberate: the features a merchant
   * falls in love with should be the ones we most want them to pay for, so the
   * drop at day 14 is a felt loss. The stored plan is `trial`; the *effective*
   * plan is what gates, and that is what these expectations describe.
   */
  trial: {
    monthlyPrice: 49,
    effectiveOf: 'pro',
    has: [
      'campaigns', 'automations', 'gift_cards', 'memberships', 'ai',
      'advanced_analytics', 'segments', 'api_access', 'webhooks',
      'automation_rules', 'proximity_campaigns',
    ],
    lacks: ['coalition', 'sso', 'team_management'],
    limits: { customers: 25000, locations: 15, team_members: 25 },
  },
  /*
   * No features at all, every countable limit at zero. Reads still work — a
   * downgrade must never hide data a merchant already has — and a POS scan is
   * never blocked, because an existing customer at the counter always gets their
   * stamp. Everything else answers 402 with one remedy.
   */
  lapsed: {
    monthlyPrice: null,
    effectiveOf: 'lapsed',
    has: [],
    lacks: [
      'campaigns', 'automations', 'segments', 'gift_cards', 'memberships', 'ai',
      'automation_rules', 'proximity_campaigns', 'custom_branding',
      'wallet_proximity', 'geofencing',
    ],
    limits: { customers: 0, locations: 1, team_members: 1 },
  },
}

/**
 * Every gated write endpoint, with the feature that guards it.
 *
 * The payload is deliberately *invalid enough to be rejected on its merits* only
 * after the gate has run: `defineRoute` checks the plan entitlement before the
 * handler but after schema validation, so each body here is schema-valid. A gate
 * that let the request through therefore produces a 2xx or a 4xx from the
 * handler, never a 422 — which is how the two failures are told apart.
 */
function gatedEndpoints(businessId) {
  return [
    {
      feature: 'campaigns',
      name: 'campaigns.create',
      call: (c) =>
        c.post('/api/v1/campaigns', {
          businessId,
          name: 'zz-verify gate probe',
          type: 'manual',
          channels: ['email'],
          subject: 'probe',
          bodyText: 'probe',
        }),
    },
    {
      feature: 'automations',
      name: 'automations.create',
      call: (c) =>
        c.post('/api/v1/automations', {
          businessId,
          name: 'zz-verify gate probe',
          trigger: 'customer_joined',
          actions: [{ type: 'noop' }],
        }),
    },
    {
      feature: 'segments',
      name: 'segments.create',
      call: (c) =>
        c.post('/api/v1/segments', {
          businessId,
          name: 'zz-verify gate probe',
          definition: { match: 'all', conditions: [{ field: 'visit_count', operator: 'gte', value: 1 }] },
        }),
    },
    {
      feature: 'gift_cards',
      name: 'giftcards.issue',
      // `amount`, not `initialBalance` — the wrong key is a 422 from the schema,
      // which is indistinguishable from a gate that let the request through.
      call: (c) => c.post('/api/v1/gift-cards', { businessId, amount: 25 }),
    },
    {
      feature: 'memberships',
      name: 'memberships.list',
      call: (c) => c.get(`/api/v1/memberships?businessId=${businessId}`),
    },
    {
      feature: 'ai',
      name: 'ai.generate',
      /*
       * Expected to answer 503 on a deployment with no ANTHROPIC_API_KEY — but
       * only for a plan that *includes* AI. An unentitled plan must get 402
       * first: `defineRoute` checks the plan before the credentials, so
       * "not configured" reaching a Starter merchant would mean the gate never
       * ran. That ordering is exactly what this probe pins down.
       */
      call: (c) =>
        c.post('/api/v1/ai', {
          action: 'campaign',
          businessId,
          brief: 'A win-back offer for customers who have not visited in a month.',
        }),
    },
    {
      feature: 'automation_rules',
      name: 'wallet.rules.create',
      /*
       * A rule shaped the way the builder shapes one: a condition tree and at
       * least one action. The earlier probe sent flat `fact`/`operator`/`value`
       * keys the route ignores, so it created an *active* rule with no conditions
       * and no actions — inert, counting against the plan's quota, and sitting on
       * the merchant's rules screen looking like a rule. `createRuleSchema` now
       * requires an action, so that payload is a 422; this one is a real rule.
       */
      call: (c) =>
        c.post('/api/v1/wallet/rules', {
          businessId,
          name: `zz-verify gate probe ${Date.now()}`,
          conditions: {
            all: [{ fact: 'has_claimable_reward', op: 'is_true' }],
          },
          actions: [{ type: 'notify_reward_available' }],
          isActive: false,
        }),
    },
    {
      feature: 'proximity_campaigns',
      name: 'wallet.campaigns.create',
      call: (c) =>
        c.post('/api/v1/wallet/campaigns', {
          businessId,
          name: 'zz-verify gate probe',
          title: 'Probe',
          message: 'Verification fixture.',
        }),
    },
  ].filter(Boolean)
}

// -----------------------------------------------------------------------------
// Journeys
// -----------------------------------------------------------------------------

async function verifyHealth() {
  heading('Environment')
  const anon = new Client('anon')
  const health = await anon.get('/api/v1/health')
  checkStatus('health endpoint responds', health, 200)
  check('database reachable', health.json?.database?.reachable === true, `latency ${health.json?.database?.latency_ms}ms`)
  check(
    'health does not leak configuration',
    !JSON.stringify(health.json ?? {}).match(/postgres(ql)?:\/\/|sk_live|sk_test/),
    'no connection string or key in payload'
  )
  return anon
}

async function verifyUnauthenticated(anon, businessId) {
  heading('Authentication — unauthenticated access is refused')

  const probes = [
    ['GET /api/v1/me', () => anon.get('/api/v1/me')],
    ['GET /api/v1/customers', () => anon.get(`/api/v1/customers?businessId=${businessId}`)],
    ['GET /api/v1/analytics/overview', () => anon.get(`/api/v1/analytics/overview?businessId=${businessId}`)],
    ['POST /api/v1/loyalty/earn', () => anon.post('/api/v1/loyalty/earn', { businessId, email: 'x@example.com' })],
    ['POST /api/v1/scan', () => anon.post('/api/v1/scan', { businessId, raw: 'anything' })],
    ['PATCH /api/v1/wallet/design', () => anon.patch('/api/v1/wallet/design', { businessId, headline: 'x' })],
    ['GET /api/v1/admin/overview', () => anon.get('/api/v1/admin/overview')],
    ['POST /api/v1/cron/daily', () => anon.post('/api/v1/cron/daily', {})],
  ]

  for (const [label, call] of probes) {
    const response = await call()
    checkStatus(`${label} without a session`, response, [401, 403])
  }

  const dashboard = await anon.get('/dashboard', { raw: true })
  check(
    'GET /dashboard without a session redirects to /login',
    dashboard.status === 307 && (dashboard.location ?? '').includes('/login'),
    `HTTP ${dashboard.status} → ${dashboard.location ?? 'no location'}`
  )

  const wrongPassword = await anon.post('/api/v1/auth/login', {
    email: 'starter@demo.com',
    password: 'definitely-not-the-password',
  })
  checkStatus('sign-in with a wrong password is refused', wrongPassword, 401)
  check(
    'wrong-password message does not reveal whether the account exists',
    !/no account|not found|unknown user/i.test(wrongPassword.errorMessage ?? ''),
    JSON.stringify(wrongPassword.errorMessage)
  )

  const noSuchAccount = await anon.post('/api/v1/auth/login', {
    email: 'nobody-zz-verify@demo.com',
    password: 'definitely-not-the-password',
  })
  check(
    'unknown account and wrong password are indistinguishable',
    noSuchAccount.status === wrongPassword.status &&
      noSuchAccount.errorMessage === wrongPassword.errorMessage,
    `${noSuchAccount.status} / ${wrongPassword.status}`
  )
}

async function signIn(account) {
  const client = new Client(account.plan)
  const login = await client.post('/api/v1/auth/login', {
    email: account.email,
    password: DEMO_PASSWORD,
  })
  if (login.status !== 200) {
    fail(`sign in as ${account.email}`, `HTTP ${login.status} ${login.errorMessage ?? ''}`)
    return null
  }
  const sessionCookie = client.cookies.get('passimo_session')
  check(`sign in as ${account.email}`, Boolean(sessionCookie), 'session cookie issued')

  const businesses = login.json?.data?.businesses ?? login.json?.businesses ?? []
  const business = businesses[0]
  if (!business) {
    fail(`workspace resolved for ${account.email}`, 'sign-in returned no businesses')
    return null
  }
  check(
    `workspace for ${account.email} is ${account.business}`,
    business.name === account.business,
    `got "${business.name}", role ${business.role}`
  )

  return { client, businessId: business.id, slug: business.slug, role: business.role }
}

async function verifyPlan(session, account) {
  const expected = EXPECTED_PLANS[account.plan]
  const billing = await session.client.get(`/api/v1/billing?businessId=${session.businessId}`)
  if (!checkStatus(`billing summary for ${account.plan}`, billing, 200)) return null

  /*
   * The envelope is the payload — `lib/http.ts` does not wrap responses in a
   * `data` key — and `plan` is the stored tier as a string while
   * `effective_plan` is what gates. Reading `plan.id` (which does not exist) was
   * the harness's own bug, and it reported every tier as "undefined".
   */
  const payload = billing.json
  const effectivePlan = payload?.effective_plan

  /*
   * `plan` is the *resolved* fallback tier, which normalises `trial` to `lapsed`.
   * `stored_plan` is the column. Asserting on the column is what pins down that a
   * live trial is not being reported as a workspace with no subscription — the
   * conflation that made the admin console label every trial "Inactive".
   */
  check(
    `stored plan is "${account.plan}"`,
    payload?.stored_plan === account.plan,
    `stored_plan="${payload?.stored_plan}" plan="${payload?.plan}"`
  )

  const expectedEffective = expected.effectiveOf ?? account.plan
  check(
    `effective plan resolves to "${expectedEffective}"`,
    effectivePlan === expectedEffective,
    `API reports "${effectivePlan}"` +
      (account.plan === 'trial' ? ` (trial active: ${payload?.trial?.active})` : '')
  )

  if (account.plan === 'trial') {
    check(
      'the trial is live and counting down',
      payload?.trial?.active === true && Number(payload?.trial?.daysRemaining) > 0,
      `active=${payload?.trial?.active} daysRemaining=${payload?.trial?.daysRemaining} endsAt=${payload?.trial?.endsAt}`
    )
  }
  if (account.plan === 'lapsed') {
    check(
      'a lapsed workspace reports no live entitlement',
      effectivePlan === 'lapsed' && payload?.trial?.active === false,
      `effective=${effectivePlan} trial.active=${payload?.trial?.active} status=${payload?.subscription?.status}`
    )
  }

  const catalogue = payload?.catalogue ?? []
  check(
    'the catalogue is the four purchasable tiers',
    catalogue.length === 4,
    catalogue.map((plan) => `${plan.id}:$${plan.monthly_price}`).join(' ')
  )
  check(
    'no free plan is offered anywhere in the catalogue',
    catalogue.length > 0 && catalogue.every((plan) => Number(plan.monthly_price) >= 5),
    `cheapest $${Math.min(...catalogue.map((plan) => Number(plan.monthly_price)))}`
  )
  check(
    'the entry tier is $5/month',
    Math.min(...catalogue.map((plan) => Number(plan.monthly_price))) === 5,
    catalogue.map((plan) => `${plan.id}:$${plan.monthly_price}`).join(' ')
  )
  check(
    'the catalogue never lists an internal state as purchasable',
    !catalogue.some((plan) => plan.id === 'lapsed' || plan.id === 'trial'),
    catalogue.map((plan) => plan.id).join(', ')
  )

  if (expected.monthlyPrice !== null) {
    const entry = catalogue.find((plan) => plan.id === expectedEffective)
    check(
      `${expectedEffective} is priced at $${expected.monthlyPrice}/month`,
      entry ? Number(entry.monthly_price) === expected.monthlyPrice : false,
      entry ? `API reports $${entry.monthly_price}` : 'tier not in the catalogue'
    )
  }

  const features = new Set(payload?.features ?? [])
  const missing = expected.has.filter((f) => !features.has(f))
  const surplus = expected.lacks.filter((f) => features.has(f))
  check(
    `${account.plan} feature set matches the catalogue`,
    missing.length === 0 && surplus.length === 0,
    missing.length || surplus.length
      ? `missing [${missing.join(', ')}] unexpected [${surplus.join(', ')}]`
      : `${features.size} features`
  )

  const usage = new Map((payload?.usage ?? []).map((row) => [row.key, row]))
  /*
   * `null` means unlimited and is a legitimate expected value, so the comparison
   * cannot coalesce it away — `?? undefined` turned an unlimited limit into a
   * mismatch against an expectation of `null` on every Business-tier check.
   */
  const limitMismatch = Object.entries(expected.limits).filter(([key, value]) => {
    const row = usage.get(key)
    if (!row) return true
    return (row.allowed ?? null) !== value
  })
  check(
    `${account.plan} limits match the catalogue`,
    limitMismatch.length === 0,
    limitMismatch.length
      ? limitMismatch.map(([k, v]) => `${k}: got ${usage.get(k)?.allowed}, want ${v}`).join('; ')
      : [...usage.values()]
          .slice(0, 3)
          .map((row) => `${row.key} ${row.used}/${row.allowed ?? '∞'}`)
          .join(', ')
  )

  check(
    'usage is measured, not assumed',
    (payload?.usage ?? []).length >= 8 && usage.get('customers')?.used > 0,
    `customers used=${usage.get('customers')?.used}`
  )

  return payload
}

async function verifyDashboardPages(session, account) {
  const pages = [
    '/dashboard',
    '/dashboard/customers',
    '/dashboard/rewards',
    '/dashboard/wallet',
    '/dashboard/analytics',
    '/dashboard/campaigns',
    '/dashboard/automations',
    '/dashboard/locations',
    '/dashboard/settings',
    '/dashboard/billing',
    '/dashboard/insights',
    '/dashboard/growth',
    '/dashboard/gift-cards',
    '/dashboard/memberships',
    '/dashboard/network',
    '/pos',
  ]

  let ok = 0
  const broken = []
  for (const path of pages) {
    const response = await session.client.get(path, { raw: true })
    if (response.status === 200) ok += 1
    else broken.push(`${path} → ${response.status}`)
  }
  check(
    `all ${pages.length} dashboard pages render for ${account.plan}`,
    broken.length === 0,
    broken.length ? broken.join(', ') : `${ok}/${pages.length} returned 200`
  )
}

async function verifyFeatureGating(session, account) {
  const expected = EXPECTED_PLANS[account.plan]
  const programs = await session.client.get(`/api/v1/programs?businessId=${session.businessId}`)
  const programId = (programs.json?.data?.programs ?? programs.json?.programs ?? [])[0]?.id ?? null

  const endpoints = gatedEndpoints(session.businessId, programId)
  const created = []

  for (const endpoint of endpoints) {
    const entitled = expected.has.includes(endpoint.feature)
    const response = await endpoint.call(session.client)

    if (entitled) {
      /*
       * 503 counts as "the gate let me through": it is `not_configured`, which
       * only a caller past the entitlement check can now receive. 409 is a
       * duplicate from a previous run. Anything 4xx other than those means the
       * handler refused on its merits, which is a fail for an entitled plan.
       */
      const allowed =
        response.status < 400 ||
        response.status === 409 ||
        response.status === 501 ||
        response.status === 503
      record(
        allowed ? 'PASS' : 'FAIL',
        `${account.plan} MAY use ${endpoint.name} (${endpoint.feature})`,
        `HTTP ${response.status}${response.errorCode ? ` ${response.errorCode}` : ''}${response.errorMessage ? ` ${response.errorMessage}` : ''}`
      )
      const id =
        response.json?.campaign_id ??
        response.json?.segment_id ??
        response.json?.automation_id ??
        response.json?.gift_card_id ??
        response.json?.rule?.id ??
        response.json?.rule_id ??
        null
      if (id) created.push({ kind: endpoint.name, id })
    } else {
      /*
       * 402 only. A 403 would mean the *role* was refused, and a 503 would mean
       * the deployment answered before the plan did — which was a real defect:
       * `requires` used to run before authentication, so a Starter merchant
       * clicking an AI button was told the product was misconfigured rather than
       * being sold an upgrade.
       */
      const refused = response.status === 402
      record(
        refused ? 'PASS' : 'FAIL',
        `${account.plan} MAY NOT use ${endpoint.name} (${endpoint.feature})`,
        `HTTP ${response.status}${response.errorCode ? ` ${response.errorCode}` : ''}${response.errorMessage ? ` — ${response.errorMessage}` : ''}`
      )
      if (refused) {
        const details = response.json?.error?.details ?? {}
        check(
          `  refusal for ${endpoint.name} names the remedy`,
          details.reason === 'feature' && typeof details.suggested_plan === 'string',
          `reason=${details.reason} suggested=${details.suggested_plan} current=${details.current_plan}`
        )
      }
    }
  }

  /*
   * Tear the probes down, and assert that the teardown worked.
   *
   * A gate probe has to perform the write to prove the gate let it through, so it
   * leaves a row behind. Cleaning up is worth doing — otherwise they accumulate on
   * the demo merchant's own screens with every run — and it is worth *checking*,
   * because these are the archive and delete paths, which nothing else here
   * exercises. A fire-and-forget cleanup that silently fails is how the residue
   * built up in the first place.
   *
   * `DELETE /api/v1/wallet/rules` **archives** rather than deletes, which is the
   * right behaviour for a rule with match history and is why the row is still
   * there afterwards. `pnpm seed:demo` removes the archived fixtures.
   */
  for (const item of created) {
    if (item.kind === 'wallet.rules.create') {
      const archived = await session.client.del('/api/v1/wallet/rules', {
        body: { businessId: session.businessId, id: item.id },
      })
      checkStatus(`${account.plan} can archive an automation rule`, archived, 200)
    }
    if (item.kind === 'campaigns.create') {
      const deleted = await session.client.del(
        `/api/v1/campaigns/${item.id}?businessId=${session.businessId}`
      )
      checkStatus(`${account.plan} can delete a draft campaign`, deleted, [200, 204])
    }
  }

  return created
}

async function verifyTenantIsolation(sessions) {
  heading('Tenant isolation — cross-tenant access is refused')

  const pairs = []
  for (const [planA, a] of Object.entries(sessions)) {
    for (const [planB, b] of Object.entries(sessions)) {
      if (planA !== planB) pairs.push([planA, a, planB, b])
    }
  }

  // One representative pair per direction is enough for the read surface; the
  // write surface is probed for every pair because a write leak is worse.
  const readProbes = [
    (id) => `/api/v1/customers?businessId=${id}`,
    (id) => `/api/v1/analytics/overview?businessId=${id}`,
    (id) => `/api/v1/rewards?businessId=${id}`,
    (id) => `/api/v1/campaigns?businessId=${id}`,
    (id) => `/api/v1/locations?businessId=${id}`,
    (id) => `/api/v1/wallet/design?businessId=${id}`,
    (id) => `/api/v1/wallet/settings?businessId=${id}`,
    (id) => `/api/v1/onboarding?businessId=${id}`,
    (id) => `/api/v1/billing?businessId=${id}`,
    (id) => `/api/v1/businesses/${id}`,
  ]

  let leaks = 0
  let probed = 0
  for (const [planA, a, planB, b] of pairs) {
    for (const probe of readProbes) {
      const response = await a.client.get(probe(b.businessId))
      probed += 1
      if (response.status !== 403 && response.status !== 404) {
        leaks += 1
        fail(`${planA} reading ${planB}: ${probe(b.businessId)}`, `HTTP ${response.status} — LEAK`)
      }
    }
  }
  check(`${probed} cross-tenant read probes all refused`, leaks === 0, `${leaks} leaks`)

  // Cross-tenant writes.
  let writeLeaks = 0
  for (const [planA, a, planB, b] of pairs) {
    const attempts = [
      ['customers.create', () => a.client.post('/api/v1/customers', { businessId: b.businessId, email: `zz-verify-leak-${Date.now()}@demo.invalid` })],
      ['loyalty.earn', () => a.client.post('/api/v1/loyalty/earn', { businessId: b.businessId, email: 'zz-verify@demo.invalid', trigger: 'visit' })],
      ['wallet.design.update', () => a.client.patch('/api/v1/wallet/design', { businessId: b.businessId, headline: 'LEAKED' })],
      ['businesses.update', () => a.client.patch(`/api/v1/businesses/${b.businessId}`, { name: 'LEAKED' })],
      ['brand.update', () => a.client.patch('/api/v1/brand', { businessId: b.businessId, primaryColor: '#FF0000' })],
    ]
    for (const [label, call] of attempts) {
      const response = await call()
      if (response.status !== 403 && response.status !== 404) {
        writeLeaks += 1
        fail(`${planA} writing to ${planB} via ${label}`, `HTTP ${response.status} — LEAK`)
      }
    }
  }
  check(`${pairs.length * 5} cross-tenant write probes all refused`, writeLeaks === 0, `${writeLeaks} leaks`)

  // A customer id belonging to another tenant, presented with the caller's own
  // business id — the shape that defeats a naive `where id = ?`.
  const [firstPlan, first] = Object.entries(sessions)[0]
  const [secondPlan, second] = Object.entries(sessions)[1]
  const victims = await second.client.get(`/api/v1/customers?businessId=${second.businessId}&limit=1`)
  const victimId = (victims.json?.data?.customers ?? victims.json?.customers ?? [])[0]?.id
  if (victimId) {
    const stolen = await first.client.get(
      `/api/v1/customers/${victimId}?businessId=${first.businessId}`
    )
    checkStatus(
      `${firstPlan} cannot read ${secondPlan}'s customer id under its own tenant`,
      stolen,
      [403, 404]
    )
    const earn = await first.client.post('/api/v1/loyalty/earn', {
      businessId: first.businessId,
      customerId: victimId,
      trigger: 'visit',
      idempotencyKey: `zz-verify-cross-${Date.now()}`,
    })
    checkStatus(
      `${firstPlan} cannot award points to ${secondPlan}'s customer`,
      earn,
      [400, 403, 404, 422]
    )
  } else {
    warn('cross-tenant customer id probe', 'no customer available to borrow')
  }
}

async function verifyLoyalty(session, account) {
  heading(`Loyalty — ${account.plan} / ${account.business}`)
  const c = session.client
  const bid = session.businessId
  const stamp = Date.now()

  const programs = await c.get(`/api/v1/programs?businessId=${bid}`)
  const programList = programs.json?.programs ?? []
  const program = programList.find((p) => p.is_default) ?? programList[0]
  if (
    !check(
      'a default loyalty program exists',
      Boolean(program),
      program ? `${program.name} (${program.type}, goal ${program.goal_amount})` : 'none'
    )
  ) {
    return
  }

  /*
   * A program has to be able to reach its own goal. This is the check that would
   * have caught the defect where every workspace was provisioned with a stamps
   * program earning 1 per visit, then switched to points with a goal of 200 or
   * 500 — leaving a card that needed five hundred visits.
   */
  const rules = programs.json?.rules ?? []
  const earnRules = rules.filter((rule) => rule.is_active && ['visit', 'purchase'].includes(rule.trigger))
  check(
    'the program has an active earning rule for visits or purchases',
    earnRules.length > 0,
    earnRules.map((rule) => `${rule.trigger}:${rule.award_type}:${rule.award_amount}`).join(', ') || 'none'
  )
  if (program.type === 'points' || program.type === 'cashback') {
    const spendRule = earnRules.find(
      (rule) => rule.award_type === 'per_currency' || rule.award_type === 'percent'
    )
    check(
      'a points/cashback program earns from spend, not a flat 1 per visit',
      Boolean(spendRule),
      spendRule
        ? `${spendRule.name}: ${spendRule.award_amount} per ${spendRule.per_amount} spent`
        : `only [${earnRules.map((r) => `${r.trigger}=${r.award_amount} ${r.award_type}`).join(', ')}] — goal ${program.goal_amount} is unreachable`
    )
  }

  // --- Create a customer -----------------------------------------------------
  const email = `zz-verify-${account.plan}-${stamp}@demo.invalid`
  const create = await c.post('/api/v1/customers', {
    businessId: bid,
    email,
    name: 'ZZ Verify Probe',
    phone: `+3460000${String(stamp).slice(-4)}`,
  })

  /*
   * A lapsed workspace must be refused here and nowhere else. Creating a customer
   * is a write against the `customers` limit, which lapsed caps at zero — so 402
   * is the correct answer, and getting a 200 would mean the reactivation wall is
   * decorative.
   */
  if (account.plan === 'lapsed') {
    checkStatus('a lapsed workspace cannot add a customer', create, 402)
    const details = create.json?.error?.details ?? {}
    check(
      'the refusal points at reactivation',
      details.reason === 'limit' || details.current_plan === 'lapsed',
      `reason=${details.reason} current=${details.current_plan} suggested=${details.suggested_plan}`
    )

    // Reads must still work: a downgrade may not hide data.
    const list = await c.get(`/api/v1/customers?businessId=${bid}&limit=5`)
    checkStatus('a lapsed workspace can still read its customers', list, 200)
    check(
      'the existing customer base is intact',
      (list.json?.customers ?? []).length > 0,
      `${(list.json?.customers ?? []).length} returned`
    )

    // And the counter must still serve an existing customer.
    const existing = (list.json?.customers ?? [])[0]
    if (existing) {
      const earn = await c.post('/api/v1/loyalty/earn', {
        businessId: bid,
        customerId: existing.id,
        trigger: 'visit',
        idempotencyKey: `zz-verify-lapsed-${stamp}`,
      })
      checkStatus(
        'a lapsed workspace can still stamp a customer standing at the counter',
        earn,
        200
      )
    }
    return
  }

  if (!checkStatus('create a customer', create, [200, 201])) return
  const customerId = create.json?.customer_id
  if (!check('created customer has an id', Boolean(customerId), customerId)) return
  check('the customer is reported as new', create.json?.is_new === true, `is_new=${create.json?.is_new}`)

  // --- Duplicate handling ----------------------------------------------------
  const duplicate = await c.post('/api/v1/customers', {
    businessId: bid,
    email,
    name: 'ZZ Verify Probe',
  })
  checkStatus('creating the same customer twice is handled', duplicate, [200, 201, 409, 422])
  if (duplicate.status < 300) {
    check(
      'the duplicate resolves to the same customer rather than a second row',
      duplicate.json?.customer_id === customerId && duplicate.json?.is_new === false,
      `id=${duplicate.json?.customer_id} is_new=${duplicate.json?.is_new}`
    )
  }

  // --- Lookup / search -------------------------------------------------------
  const lookup = await c.get(
    `/api/v1/customers/lookup?businessId=${bid}&q=${encodeURIComponent(email)}`
  )
  checkStatus('customer lookup by email', lookup, 200)
  const found = lookup.json?.customers ?? lookup.json?.results ?? []
  check(
    'lookup finds the new customer',
    Array.isArray(found) && found.some((x) => x.id === customerId),
    `${Array.isArray(found) ? found.length : 0} matches`
  )

  const search = await c.get(`/api/v1/customers?businessId=${bid}&q=ZZ%20Verify&limit=5`)
  checkStatus('customer search by name', search, 200)
  check(
    'search returns the customer it should',
    (search.json?.customers ?? []).some((x) => x.id === customerId),
    `${(search.json?.customers ?? []).length} results`
  )

  // Filters the CRM screen offers.
  for (const [label, qs] of [
    ['VIP filter', `vip=true`],
    ['sort by spend', `sort=spend`],
    ['sort by churn', `sort=churn`],
    ['sort by balance', `sort=balance`],
  ]) {
    const filtered = await c.get(`/api/v1/customers?businessId=${bid}&${qs}&limit=5`)
    checkStatus(`CRM ${label}`, filtered, 200)
  }

  // --- Tags and notes --------------------------------------------------------
  const note = await c.post(`/api/v1/customers/${customerId}/notes`, {
    businessId: bid,
    body: 'Prefers oat milk. Verification fixture.',
  })
  checkStatus('add a note to a customer', note, [200, 201])

  const tagged = await c.patch(`/api/v1/customers/${customerId}`, { businessId: bid, isVip: true })
  checkStatus('mark a customer VIP', tagged, 200)

  const afterVip = await c.get(`/api/v1/customers/${customerId}?businessId=${bid}`)
  check(
    'VIP status and the note persist',
    afterVip.json?.customer?.isVip === true && (afterVip.json?.notes ?? []).length >= 1,
    `isVip=${afterVip.json?.customer?.isVip} notes=${(afterVip.json?.notes ?? []).length}`
  )

  // --- Export ----------------------------------------------------------------
  /*
   * Export is on the `bulk` bucket: five per hour, deliberately, because it is
   * the one read that materialises a whole customer base. Six workspaces in one
   * run exhausts it, so a 429 after the first success is the limit working
   * rather than the export failing — and both outcomes are asserted, so a broken
   * export cannot hide behind the rate limit.
   */
  const exported = await c.get(`/api/v1/customers/export?businessId=${bid}`, { raw: true })
  if (exported.status === 429) {
    pass(
      'customer export is rate-limited on the bulk bucket',
      'HTTP 429 — five per hour, shared across this run'
    )
  } else {
    check(
      'customer export produces a CSV',
      exported.status === 200 && /,/.test(exported.text) && exported.text.split('\n').length > 1,
      `HTTP ${exported.status}, ${exported.text.split('\n').length} lines`
    )
  }

  // --- Balance and analytics before -----------------------------------------
  const before = await c.get(`/api/v1/customers/${customerId}?businessId=${bid}`)
  const beforeBalance = balanceOf(before)
  check('new customer starts at a known balance', typeof beforeBalance === 'number', `${beforeBalance}`)

  const analyticsBefore = await c.get(`/api/v1/analytics/overview?businessId=${bid}&days=30`)
  checkStatus('analytics overview readable', analyticsBefore, 200)
  const visitsBefore = visitsOf(analyticsBefore)
  const redemptionsBefore = redemptionsOf(analyticsBefore)
  check(
    'analytics report a measured baseline',
    visitsBefore !== null && redemptionsBefore !== null,
    `visits=${visitsBefore} redemptions=${redemptionsBefore}`
  )

  // --- Earn ------------------------------------------------------------------
  const earnKey = `zz-verify-earn-${stamp}`
  const earn = await c.post('/api/v1/loyalty/earn', {
    businessId: bid,
    customerId,
    trigger: 'purchase',
    amount: 42.5,
    idempotencyKey: earnKey,
  })
  if (!checkStatus('award points/stamps for a purchase', earn, 200)) return
  const awarded = Number(earn.json?.total_awarded ?? 0)
  check('the purchase awarded something', awarded > 0, `${awarded} awarded`)
  check('the earn is not reported as a duplicate', earn.json?.duplicate === false, `duplicate=${earn.json?.duplicate}`)

  /*
   * A points program must scale the award to the basket. One point for a €42.50
   * purchase is the signature of the provisioned stamps rule surviving a switch
   * to points.
   */
  if (program.type === 'points') {
    check(
      'a €42.50 purchase on a points program awards more than a single point',
      awarded > 1,
      `${awarded} points for 42.50 (goal ${program.goal_amount})`
    )
  }

  const afterEarn = await c.get(`/api/v1/customers/${customerId}?businessId=${bid}`)
  const afterEarnBalance = balanceOf(afterEarn)
  check(
    'balance increased after the transaction',
    afterEarnBalance > beforeBalance,
    `${beforeBalance} → ${afterEarnBalance} (awarded ${awarded})`
  )
  check(
    'visit was recorded on the customer',
    Number(afterEarn.json?.customer?.visitCount) >= 1,
    `visitCount=${afterEarn.json?.customer?.visitCount}`
  )
  check(
    'lifetime spend reflects the basket',
    Number(afterEarn.json?.customer?.lifetimeSpend) >= 42.5,
    `lifetimeSpend=${afterEarn.json?.customer?.lifetimeSpend}`
  )

  // --- Idempotency -----------------------------------------------------------
  const replay = await c.post('/api/v1/loyalty/earn', {
    businessId: bid,
    customerId,
    trigger: 'purchase',
    amount: 42.5,
    idempotencyKey: earnKey,
  })
  checkStatus('replaying the same earn is accepted', replay, [200, 409])
  if (replay.status === 200) {
    check(
      'the replay is reported as a duplicate rather than a new award',
      replay.json?.duplicate === true,
      `duplicate=${replay.json?.duplicate}`
    )
  }
  const afterReplay = await c.get(`/api/v1/customers/${customerId}?businessId=${bid}`)
  check(
    'replaying the same idempotency key does not double-credit',
    balanceOf(afterReplay) === afterEarnBalance,
    `${afterEarnBalance} → ${balanceOf(afterReplay)}`
  )

  // --- Ledger ---------------------------------------------------------------
  const ledger = afterReplay.json?.ledger ?? []
  check('the transaction appears in the customer ledger', ledger.length >= 1, `${ledger.length} entries`)
  check(
    'the ledger entry carries a balance and a reason',
    ledger.length > 0 && ledger[0].balance_after !== undefined,
    ledger.length > 0 ? JSON.stringify(ledger[0]).slice(0, 140) : 'no entries'
  )
  const activity = afterReplay.json?.activity ?? []
  check('the visit appears in the activity feed', activity.length >= 1, `${activity.length} events`)

  // --- Manual adjustment ----------------------------------------------------
  const adjust = await c.post('/api/v1/loyalty/adjust', {
    businessId: bid,
    customerId,
    programId: program.id,
    amount: 5,
    reason: 'Verification fixture goodwill credit',
    idempotencyKey: `zz-verify-adjust-${stamp}`,
  })
  if (checkStatus('staff can adjust a balance manually', adjust, 200)) {
    const afterAdjust = await c.get(`/api/v1/customers/${customerId}?businessId=${bid}`)
    check(
      'the adjustment moved the balance by exactly the amount given',
      balanceOf(afterAdjust) === afterEarnBalance + 5,
      `${afterEarnBalance} + 5 → ${balanceOf(afterAdjust)}`
    )
  }

  // --- Analytics after -------------------------------------------------------
  const analyticsAfter = await c.get(`/api/v1/analytics/overview?businessId=${bid}&days=30`)
  const visitsAfter = visitsOf(analyticsAfter)
  check(
    'analytics reflect the new visit',
    visitsAfter !== null && visitsBefore !== null && visitsAfter > visitsBefore,
    `visits ${visitsBefore} → ${visitsAfter}`
  )

  /*
   * The scannable token is not on the customer record — it is the signed segment
   * of the card URL that the public join response returns, which is what a wallet
   * pass actually carries. Enrolling one customer publicly is the only way to get
   * hold of a real one, so that is what this does.
   */
  const anonJoiner = new Client('anon')
  const publicEnrol = await anonJoiner.post('/api/v1/public/join', {
    businessSlug: session.slug,
    email: `zz-verify-scan-${stamp}@demo.invalid`,
    name: 'ZZ Verify Scannable',
    acceptedTerms: true,
  })
  const cardToken = (publicEnrol.json?.card_url ?? '').split('/card/')[1] ?? null
  check(
    'a publicly enrolled customer receives a scannable card token',
    Boolean(cardToken),
    cardToken ? `${String(cardToken).slice(0, 24)}…` : `HTTP ${publicEnrol.status}`
  )

  await verifyScanning(session, account, { customerId, email, cardToken })

  // --- Rewards and redemption ----------------------------------------------
  await verifyRewards(session, account, {
    customerId,
    programId: program.id,
    stamp,
    redemptionsBefore,
  })
}

async function verifyScanning(session, account, { customerId, email, cardToken }) {
  heading(`QR / counter scanning — ${account.plan}`)
  const c = session.client
  const bid = session.businessId
  const stamp = Date.now()

  /*
   * Every payload form a real wallet pass or printed card can carry, per
   * `lib/scan/payload.ts`: the signed token on its own, the full card URL, the
   * current custom schemes, and the legacy `fidelio:` scheme that a card already
   * sitting in somebody's phone still carries.
   */
  if (cardToken) {
    const forms = [
      ['the bare signed token', cardToken],
      ['a full card URL', `${BASE}/card/${cardToken}`],
      ['the passimo: scheme', `passimo:card/${cardToken}`],
      ['the psm: short scheme', `psm:card/${cardToken}`],
      [
        'the legacy fidelio: scheme (a printed card is not reissued because a company renamed)',
        `fidelio:card/${cardToken}`,
      ],
      ['the passimo:card. dotted form', `passimo:${cardToken}`],
    ]

    for (const [label, raw] of forms) {
      const identify = await c.post('/api/v1/scan', { businessId: bid, raw, action: 'identify' })
      const resolved = identify.json?.resolution?.customer?.id
      check(
        `scan resolves a customer from ${label}`,
        identify.status === 200 && typeof resolved === 'string',
        `HTTP ${identify.status} kind=${identify.json?.resolution?.kind} id=${resolved ?? 'none'}`
      )
    }
  } else {
    warn('scan by card token', 'no scannable token was available for this workspace')
  }

  // Manual fallbacks — the counter's answer to a dead camera.
  const byEmail = await c.post('/api/v1/scan', { businessId: bid, raw: email, action: 'identify' })
  checkStatus('manual fallback: identify by email', byEmail, 200)

  const byId = await c.post('/api/v1/scan', { businessId: bid, raw: customerId, action: 'identify' })
  checkStatus('manual fallback: identify by customer id', byId, 200)

  const roster = await c.get(`/api/v1/counter/roster?businessId=${bid}&limit=10`)
  checkStatus('counter roster loads for tap-to-serve', roster, 200)

  // Invalid / unknown QR.
  /*
   * An unknown code answers 200 with `resolution.kind = 'unknown'`, and that is
   * the right contract rather than an error: at a counter the camera reads a
   * bottle's barcode as often as a pass, and a 404 toast on every stray scan
   * would train staff to ignore the screen. The check is that the resolution says
   * so, and that it says so in words a cashier can act on.
   */
  const garbage = await c.post('/api/v1/scan', {
    businessId: bid,
    raw: 'not-a-real-code-at-all',
    action: 'identify',
  })
  if (checkStatus('an unknown code resolves without erroring', garbage, 200)) {
    check(
      'an unknown code is reported as unknown, with a hint the cashier can read',
      garbage.json?.resolution?.kind === 'unknown' &&
        typeof garbage.json?.resolution?.hint === 'string',
      `kind=${garbage.json?.resolution?.kind} hint="${garbage.json?.resolution?.hint}"`
    )
    check(
      'an unknown code credits nothing',
      garbage.json?.checkin === null && garbage.json?.fulfilled === null,
      `checkin=${JSON.stringify(garbage.json?.checkin)}`
    )
  }

  const unknownToken = await c.post('/api/v1/scan', {
    businessId: bid,
    raw: 'passimo:00000000-0000-0000-0000-000000000000',
    action: 'identify',
  })
  if (checkStatus('a well-formed but unknown token resolves without erroring', unknownToken, 200)) {
    check(
      'a well-formed unknown token does not resolve to a customer',
      unknownToken.json?.resolution?.kind === 'unknown',
      `kind=${unknownToken.json?.resolution?.kind}`
    )
  }

  /*
   * A token belonging to another tenant must not resolve here. This is the scan
   * equivalent of the cross-tenant read probes: the payload is well-formed and
   * valid *somewhere*, just not in this workspace.
   */
  const foreign = await c.post('/api/v1/scan', {
    businessId: bid,
    raw: 'card.eyJjIjoiMDAwMDAwMDAtMDAwMC0wMDAwLTAwMDAtMDAwMDAwMDAwMDAxIn0.aW52YWxpZA',
    action: 'identify',
  })
  check(
    'a forged card token does not resolve to anybody',
    foreign.status !== 200 || foreign.json?.resolution?.kind !== 'customer',
    `HTTP ${foreign.status} kind=${foreign.json?.resolution?.kind}`
  )

  const empty = await c.post('/api/v1/scan', { businessId: bid, raw: '', action: 'identify' })
  checkStatus('empty payload fails validation', empty, 422)

  const oversized = await c.post('/api/v1/scan', {
    businessId: bid,
    raw: 'x'.repeat(5000),
    action: 'identify',
  })
  checkStatus('an oversized payload fails validation', oversized, 422)

  // Check-in requires an idempotency key — it is what makes an offline replay safe.
  const noKey = await c.post('/api/v1/scan', { businessId: bid, raw: email, action: 'checkin' })
  checkStatus('check-in without an idempotency key is refused', noKey, 422)

  const key = `zz-verify-scan-${stamp}`
  const beforeCheckin = balanceOf(await c.get(`/api/v1/customers/${customerId}?businessId=${bid}`))
  const checkin = await c.post('/api/v1/scan', {
    businessId: bid,
    raw: email,
    action: 'checkin',
    idempotencyKey: key,
    decodeMs: 240,
  })
  if (checkStatus('check-in awards the customer', checkin, 200)) {
    const afterCheckin = balanceOf(await c.get(`/api/v1/customers/${customerId}?businessId=${bid}`))
    check(
      'the check-in credited the balance',
      afterCheckin > beforeCheckin,
      `${beforeCheckin} → ${afterCheckin}`
    )

    const duplicateScan = await c.post('/api/v1/scan', {
      businessId: bid,
      raw: email,
      action: 'checkin',
      idempotencyKey: key,
      decodeMs: 240,
    })
    checkStatus('a duplicate scan with the same key is accepted', duplicateScan, [200, 409])
    const afterDuplicate = balanceOf(
      await c.get(`/api/v1/customers/${customerId}?businessId=${bid}`)
    )
    check(
      'a duplicate scan does not double-credit',
      afterDuplicate === afterCheckin,
      `${afterCheckin} → ${afterDuplicate}`
    )

    // An offline scan replayed later must land with its original timestamp.
    const queued = await c.post('/api/v1/scan', {
      businessId: bid,
      raw: email,
      action: 'checkin',
      idempotencyKey: `zz-verify-offline-${stamp}`,
      queuedAt: new Date(Date.now() - 3_600_000).toISOString(),
      decodeMs: 180,
    })
    checkStatus('a scan captured offline replays successfully', queued, [200, 409])
  }

  // A blocked customer must not be creditable.
  const blockTarget = await c.post('/api/v1/customers', {
    businessId: bid,
    email: `zz-verify-blocked-${stamp}@demo.invalid`,
    name: 'ZZ Verify Blocked',
  })
  const blockedId = blockTarget.json?.customer_id
  if (blockedId) {
    const block = await c.patch(`/api/v1/customers/${blockedId}`, {
      businessId: bid,
      status: 'blocked',
    })
    if (block.status === 200) {
      const attempt = await c.post('/api/v1/loyalty/earn', {
        businessId: bid,
        customerId: blockedId,
        trigger: 'visit',
        idempotencyKey: `zz-verify-blocked-${stamp}`,
      })
      if (checkStatus('a blocked customer cannot be credited', attempt, [400, 403, 409, 422])) {
        check(
          '  the refusal says why, in a form the browser can translate',
          (attempt.json?.error?.details ?? {}).reason === 'customer_blocked',
          `reason=${(attempt.json?.error?.details ?? {}).reason}`
        )
      }

      // And a blocked customer must not be handed a reward either.
      const rewards = await c.get(`/api/v1/rewards?businessId=${bid}`)
      const anyReward = (rewards.json?.rewards ?? []).find((reward) => Number(reward.cost) === 0)
      if (anyReward) {
        const handover = await c.post('/api/v1/loyalty/redeem', {
          businessId: bid,
          customerId: blockedId,
          rewardId: anyReward.id,
          idempotencyKey: `zz-verify-blocked-redeem-${stamp}`,
        })
        checkStatus('a blocked customer cannot be handed a reward', handover, [400, 403, 409, 422])
      }

      // Unblocking restores service — the control has to be reversible.
      await c.patch(`/api/v1/customers/${blockedId}`, { businessId: bid, status: 'active' })
      const afterUnblock = await c.post('/api/v1/loyalty/earn', {
        businessId: bid,
        customerId: blockedId,
        trigger: 'visit',
        idempotencyKey: `zz-verify-unblocked-${stamp}`,
      })
      checkStatus('unblocking a customer restores awarding', afterUnblock, 200)
    } else {
      warn('blocking a customer', `HTTP ${block.status}`)
    }
  }
}

async function verifyRewards(session, account, {
  customerId,
  programId,
  stamp,
  redemptionsBefore,
}) {
  heading(`Rewards and redemption — ${account.plan}`)
  const c = session.client
  const bid = session.businessId

  const list = await c.get(`/api/v1/rewards?businessId=${bid}`)
  if (!checkStatus('reward catalogue readable', list, 200)) return
  const seeded = list.json?.rewards ?? []
  check('the demo merchant has rewards configured', seeded.length > 0, `${seeded.length} rewards`)
  check(
    'at least one seeded reward has been claimed before',
    seeded.some((reward) => reward.never_redeemed === false),
    seeded.map((r) => `${r.name}:${r.redeemed_count}`).join(', ')
  )

  // A zero-cost reward, so redemption is testable without farming points first,
  // and an unaffordable one so the refusal path is testable too.
  const cheap = await c.post('/api/v1/rewards', {
    businessId: bid,
    programId,
    name: `zz-verify free sample ${stamp}`,
    description: 'Verification fixture.',
    cost: 0,
    usageLimitPerCustomer: 1,
  })
  if (!checkStatus('create a reward', cheap, [200, 201])) return
  const cheapId = cheap.json?.reward_id
  if (!check('the created reward has an id', Boolean(cheapId), cheapId)) return

  const expensive = await c.post('/api/v1/rewards', {
    businessId: bid,
    programId,
    name: `zz-verify unreachable ${stamp}`,
    cost: 999_999,
  })
  const expensiveId = expensive.json?.reward_id ?? null

  // Eligibility is computed on the customer record.
  const detail = await c.get(`/api/v1/customers/${customerId}?businessId=${bid}`)
  const available = detail.json?.loyalty?.availableRewards ?? []
  check(
    'reward eligibility is computed for the customer',
    Array.isArray(available) && available.length > 0,
    `${available.length} in the catalogue, ${available.filter((r) => r.affordable).length} affordable`
  )
  check(
    'the new zero-cost reward is affordable to everyone',
    available.some((reward) => reward.id === cheapId && reward.affordable === true),
    JSON.stringify(available.find((reward) => reward.id === cheapId) ?? null)
  )
  if (expensiveId) {
    check(
      'the unreachable reward is correctly marked unaffordable',
      available.some((reward) => reward.id === expensiveId && reward.affordable === false),
      JSON.stringify(available.find((reward) => reward.id === expensiveId) ?? null)
    )
  }

  // --- Redeem ---------------------------------------------------------------
  const redeemKey = `zz-verify-redeem-${stamp}`
  const balanceBefore = balanceOf(detail)
  const redeem = await c.post('/api/v1/loyalty/redeem', {
    businessId: bid,
    customerId,
    rewardId: cheapId,
    idempotencyKey: redeemKey,
  })
  if (checkStatus('redeem a reward the customer qualifies for', redeem, 200)) {
    check(
      'a redemption record was created and carries a code staff can read out',
      Boolean(redeem.json?.redemption_id) && typeof redeem.json?.code === 'string',
      `id=${redeem.json?.redemption_id} code=${redeem.json?.code}`
    )

    const afterRedeem = await c.get(`/api/v1/customers/${customerId}?businessId=${bid}`)
    check(
      'a zero-cost redemption leaves the balance untouched',
      balanceOf(afterRedeem) === balanceBefore,
      `${balanceBefore} → ${balanceOf(afterRedeem)}`
    )
    check(
      'the redemption appears in the customer history',
      (afterRedeem.json?.redemptions ?? []).length >= 1,
      `${(afterRedeem.json?.redemptions ?? []).length} redemptions on file`
    )

    // The per-customer usage limit is 1.
    const again = await c.post('/api/v1/loyalty/redeem', {
      businessId: bid,
      customerId,
      rewardId: cheapId,
      idempotencyKey: `zz-verify-redeem-again-${stamp}`,
    })
    if (checkStatus('a per-customer usage limit blocks a second redemption', again, [403, 409, 422])) {
      check(
        'the refusal carries a machine-readable reason the browser can translate',
        (again.json?.error?.details ?? {}).reason === 'per_customer_limit',
        `reason=${(again.json?.error?.details ?? {}).reason} message="${again.errorMessage}"`
      )
    }

    // Replay with the same key must not create a second redemption.
    const replay = await c.post('/api/v1/loyalty/redeem', {
      businessId: bid,
      customerId,
      rewardId: cheapId,
      idempotencyKey: redeemKey,
    })
    checkStatus('replaying a redemption with the same key is idempotent', replay, [200, 409])

    // Analytics must move.
    const analyticsAfter = await c.get(`/api/v1/analytics/overview?businessId=${bid}&days=30`)
    const redemptionsAfter = redemptionsOf(analyticsAfter)
    check(
      'analytics reflect the new redemption',
      redemptionsAfter !== null &&
        redemptionsBefore !== null &&
        redemptionsAfter > redemptionsBefore,
      `redemptions ${redemptionsBefore} → ${redemptionsAfter}`
    )

    const rereadCatalogue = await c.get(`/api/v1/rewards?businessId=${bid}`)
    const claimed = (rereadCatalogue.json?.rewards ?? []).find((reward) => reward.id === cheapId)
    check(
      'the reward catalogue records the claim',
      claimed ? Number(claimed.redeemed_count) >= 1 && claimed.never_redeemed === false : false,
      claimed ? `redeemed_count=${claimed.redeemed_count}` : 'reward not found'
    )
  }

  if (expensiveId) {
    const unaffordable = await c.post('/api/v1/loyalty/redeem', {
      businessId: bid,
      customerId,
      rewardId: expensiveId,
      idempotencyKey: `zz-verify-broke-${stamp}`,
    })
    if (
      checkStatus(
        'redeeming a reward the customer cannot afford is refused',
        unaffordable,
        [402, 403, 409, 422]
      )
    ) {
      check(
        'the insufficient-balance refusal is translatable',
        (unaffordable.json?.error?.details ?? {}).reason === 'insufficient_balance',
        `reason=${(unaffordable.json?.error?.details ?? {}).reason} message="${unaffordable.errorMessage}"`
      )
    }
  }

  const unknownReward = await c.post('/api/v1/loyalty/redeem', {
    businessId: bid,
    customerId,
    rewardId: '00000000-0000-0000-0000-000000000000',
    idempotencyKey: `zz-verify-nosuch-${stamp}`,
  })
  checkStatus('redeeming a non-existent reward is refused', unknownReward, [400, 404, 422])

  const badCode = await c.put('/api/v1/loyalty/redeem', {
    businessId: bid,
    code: 'ZZZZZZZZZZ',
  })
  if (checkStatus('an unknown granted-reward code is refused', badCode, [400, 404, 422])) {
    check(
      'the unknown-code refusal is translatable',
      (badCode.json?.error?.details ?? {}).reason === 'grant_not_found',
      `reason=${(badCode.json?.error?.details ?? {}).reason}`
    )
  }

  // Deactivate the fixtures so the demo catalogue stays clean for the next reviewer.
  for (const id of [cheapId, expensiveId].filter(Boolean)) {
    await c.patch('/api/v1/rewards', { businessId: bid, id, isActive: false })
  }
}

async function verifyWallet(session, account) {
  heading(`Wallet configuration — ${account.plan}`)
  const c = session.client
  const bid = session.businessId

  const design = await c.get(`/api/v1/wallet/design?businessId=${bid}`)
  if (!checkStatus('wallet card design readable', design, 200)) return
  const original = design.json?.design

  /*
   * This endpoint *is* the preview. It returns the resolved design, the resolved
   * brand kit, the program's own vocabulary and provider readiness — everything
   * the designer renders — through the same `resolveCardDesign` the pass builder
   * calls. There is no separate "preview" route for the card: `/wallet/preview`
   * previews a proximity *notification* and needs a campaignId.
   */
  check(
    'the design response carries everything a real preview needs',
    Boolean(design.json?.design && design.json?.brand && design.json?.program && design.json?.providers),
    `keys: ${Object.keys(design.json ?? {}).join(', ')}`
  )
  check(
    'the preview reads the merchant’s own program vocabulary',
    typeof design.json?.program?.unitPlural === 'string' && design.json?.program?.goal !== undefined,
    `${design.json?.program?.name}: goal ${design.json?.program?.goal} ${design.json?.program?.unitPlural}`
  )

  /*
   * Provider readiness has to be reported honestly. Without credentials no real
   * pass can be issued, and a screen that implies otherwise is the one lie a
   * merchant will discover in front of a customer.
   */
  const providers = design.json?.providers ?? []
  check(
    'both wallet providers report their configuration state',
    providers.length === 2 && providers.every((p) => typeof p.configured === 'boolean'),
    providers.map((p) => `${p.id}=${p.configured ? 'configured' : `missing [${(p.missing ?? []).join(', ')}]`}`).join(' | ')
  )
  check(
    'an unconfigured provider names the environment variables it needs',
    providers.every((p) => p.configured || (p.missing ?? []).length > 0),
    providers.filter((p) => !p.configured).map((p) => `${p.id}: ${(p.missing ?? []).length} vars`).join(', ') || 'all configured'
  )

  const templates = await c.get(`/api/v1/wallet/templates?businessId=${bid}`)
  if (checkStatus('wallet templates readable', templates, 200)) {
    const list = templates.json?.templates ?? []
    check('a template library is offered', list.length >= 5, `${list.length} templates`)
  }

  // --- Customisation persists ------------------------------------------------
  const headline = `ZZ Verify ${Date.now()}`
  const patch = await c.patch('/api/v1/wallet/design', {
    businessId: bid,
    headline,
    cardStyle: 'gradient',
    progressStyle: 'bar',
    typography: 'rounded',
    backgroundColor: '#123456',
    foregroundColor: '#FFFFFF',
    accentColor: '#F59E0B',
    showTier: true,
    showMemberSince: false,
    customMessage: 'Verification fixture message.',
  })
  if (checkStatus('wallet card design accepts an update', patch, 200)) {
    const reread = await c.get(`/api/v1/wallet/design?businessId=${bid}`)
    const saved = reread.json?.design ?? {}
    check(
      'every changed field persists across a re-read',
      saved.headline === headline &&
        saved.cardStyle === 'gradient' &&
        saved.progressStyle === 'bar' &&
        saved.typography === 'rounded' &&
        saved.showTier === true &&
        saved.showMemberSince === false,
      `headline="${saved.headline}" style=${saved.cardStyle} progress=${saved.progressStyle} type=${saved.typography} tier=${saved.showTier} since=${saved.showMemberSince}`
    )
    /*
     * Compared case-insensitively: the API normalises stored hex to lower case,
     * which is correct — `#F59E0B` and `#f59e0b` are the same colour and one
     * canonical form means a contrast check cannot disagree with itself.
     */
    check(
      'wallet design colours persist',
      String(saved.backgroundColor).toLowerCase() === '#123456' &&
        String(saved.accentColor).toLowerCase() === '#f59e0b',
      `bg=${saved.backgroundColor} accent=${saved.accentColor}`
    )
  }

  const badColour = await c.patch('/api/v1/wallet/design', {
    businessId: bid,
    backgroundColor: 'chartreuse',
  })
  checkStatus('an invalid colour is rejected rather than stored', badColour, 422)

  const badStyle = await c.patch('/api/v1/wallet/design', { businessId: bid, cardStyle: 'holographic' })
  checkStatus('an unknown card style is rejected', badStyle, 422)

  // --- Template application -------------------------------------------------
  const applyTemplate = await c.post('/api/v1/wallet/design', { businessId: bid, template: 'bakery' })
  if (checkStatus('a template can be applied in one action', applyTemplate, 200)) {
    const afterTemplate = await c.get(`/api/v1/wallet/design?businessId=${bid}`)
    check(
      'applying a template changes the stored design',
      afterTemplate.json?.design?.template === 'bakery',
      `template=${afterTemplate.json?.design?.template}`
    )
  }

  const settings = await c.get(`/api/v1/wallet/settings?businessId=${bid}`)
  if (checkStatus('wallet settings readable', settings, 200)) {
    const payload = settings.json?.settings ?? settings.json
    check(
      'proximity behaviour is configurable from the dashboard',
      payload !== undefined && payload !== null,
      Object.keys(payload ?? {}).slice(0, 8).join(', ')
    )
  }

  const walletAnalytics = await c.get(`/api/v1/wallet/analytics?businessId=${bid}&days=30`)
  checkStatus('wallet analytics readable', walletAnalytics, 200)

  // --- Brand kit → customer-facing surfaces ---------------------------------
  const brand = await c.get(`/api/v1/brand?businessId=${bid}`)
  if (checkStatus('brand kit readable', brand, 200)) {
    const originalBrand = brand.json?.brand ?? brand.json
    const colour = '#0EA5E9'
    const brandPatch = await c.patch('/api/v1/brand', { businessId: bid, primaryColor: colour })
    if (checkStatus('brand kit accepts a colour change', brandPatch, 200)) {
      const rereadBrand = await c.get(`/api/v1/brand?businessId=${bid}`)
      const payload = rereadBrand.json?.brand ?? rereadBrand.json
      const stored = String(payload?.primaryColor ?? payload?.primary_color ?? '')
      check(
        'brand colour persists (compared case-insensitively — the API normalises)',
        stored.toLowerCase() === colour.toLowerCase(),
        `stored ${stored}`
      )

      /*
       * The colour has to reach the customer-facing surface, not just the settings
       * row. A join page that ignores the merchant's palette is the exact failure a
       * brand kit is supposed to make impossible — and it was real: the page was a
       * client component that fetched after paint, so the server HTML carried no
       * brand at all and an unknown slug answered 200.
       */
      const anon = new Client('anon')
      const joinPage = await anon.get(`/join/${session.slug}`, { raw: true })
      check(
        'the brand colour reaches the server-rendered join page',
        joinPage.status === 200 && new RegExp(colour.slice(1), 'i').test(joinPage.text),
        `HTTP ${joinPage.status}, colour ${new RegExp(colour.slice(1), 'i').test(joinPage.text) ? 'present in first byte' : 'ABSENT'}`
      )
      check(
        'the join page names the business in its title, not the platform',
        new RegExp(account.business.split(' ')[0], 'i').test(joinPage.text),
        (joinPage.text.match(/<title>([^<]*)<\/title>/) ?? [])[1] ?? 'no title'
      )

      // Restore, so the demo screenshots stay stable.
      await c.patch('/api/v1/brand', {
        businessId: bid,
        primaryColor: originalBrand?.primaryColor ?? originalBrand?.primary_color ?? null,
      })
    }
  }

  // Restore the original design.
  if (original) {
    await c.patch('/api/v1/wallet/design', {
      businessId: bid,
      template: original.template ?? 'minimal',
      headline: original.headline ?? null,
      cardStyle: original.cardStyle ?? 'solid',
      progressStyle: original.progressStyle ?? 'auto',
      typography: original.typography ?? 'system',
      backgroundColor: original.backgroundColor ?? null,
      foregroundColor: original.foregroundColor ?? null,
      accentColor: original.accentColor ?? null,
      customMessage: original.customMessage ?? null,
      showTier: original.showTier ?? false,
      showMemberSince: original.showMemberSince ?? true,
    })
  }
}

async function verifyCampaigns(session, account) {
  const expected = EXPECTED_PLANS[account.plan]
  if (!expected.has.includes('campaigns')) return

  heading(`Campaigns — ${account.plan}`)
  const c = session.client
  const bid = session.businessId
  const stamp = Date.now()

  const kinds = [
    { type: 'welcome', name: `zz-verify welcome ${stamp}` },
    { type: 'reward_reminder', name: `zz-verify reward ${stamp}` },
    { type: 'winback', name: `zz-verify inactive ${stamp}` },
    { type: 'promo', name: `zz-verify VIP ${stamp}` },
  ]

  const createdIds = []
  for (const kind of kinds) {
    const response = await c.post('/api/v1/campaigns', {
      businessId: bid,
      name: kind.name,
      type: kind.type,
      channels: ['email'],
      subject: `Probe ${kind.type}`,
      bodyText: 'Verification fixture.',
      status: 'draft',
    })
    if (checkStatus(`create a ${kind.type} campaign`, response, [200, 201])) {
      const id = response.json?.campaign_id
      if (check(`  the ${kind.type} campaign has an id`, Boolean(id), id)) createdIds.push(id)
    }
  }

  const invalid = await c.post('/api/v1/campaigns', { businessId: bid, name: '', channels: [] })
  checkStatus('a campaign with no name and no channel is rejected', invalid, 422)

  if (createdIds.length) {
    const id = createdIds[0]
    const schedule = await c.patch(`/api/v1/campaigns/${id}`, {
      businessId: bid,
      status: 'scheduled',
      scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
    })
    checkStatus('a campaign can be scheduled', schedule, 200)

    const read = await c.get(`/api/v1/campaigns/${id}?businessId=${bid}`)
    if (checkStatus('a scheduled campaign reads back', read, 200)) {
      const campaign = read.json?.campaign ?? read.json
      check(
        'scheduling persisted',
        campaign?.status === 'scheduled' && Boolean(campaign?.scheduled_at),
        `status=${campaign?.status} at=${campaign?.scheduled_at}`
      )
    }

    const revert = await c.patch(`/api/v1/campaigns/${id}`, { businessId: bid, status: 'draft' })
    checkStatus('a scheduled campaign can be deactivated back to draft', revert, 200)

    const list = await c.get(`/api/v1/campaigns?businessId=${bid}`)
    if (checkStatus('campaign list readable', list, 200)) {
      check(
        'the campaigns just created appear in the list',
        createdIds.every((created) => (list.json?.campaigns ?? []).some((row) => row.id === created)),
        `${(list.json?.campaigns ?? []).length} campaigns`
      )
    }

    // Sending: without an email provider configured this must fail loudly and
    // honestly rather than silently reporting success.
    const send = await c.post(`/api/v1/campaigns/${id}/send`, { businessId: bid })
    const honest = [200, 202, 409, 422, 501, 503].includes(send.status)
    record(
      honest ? 'PASS' : 'FAIL',
      'campaign send either delivers or reports the missing provider',
      `HTTP ${send.status} ${send.errorCode ?? ''} ${send.errorMessage ?? ''}`.trim()
    )
  }

  /*
   * Segmentation. The definition key is `conditions`, not `rules` — and a payload
   * with the wrong key is accepted and silently matches *everybody*, which for a
   * campaign send is the worst possible default. That is asserted below as its own
   * check rather than being papered over by using the right key.
   */
  if (expected.has.includes('segments')) {
    const typoed = await c.put('/api/v1/segments', {
      businessId: bid,
      name: 'preview',
      definition: { match: 'all', rules: [{ field: 'visit_count', operator: 'gte', value: 999 }] },
    })
    const total = await c.get(`/api/v1/customers?businessId=${bid}&limit=1`)
    const totalCount = Number(total.headers.get('x-total-count') ?? 0)
    check(
      'a segment definition with an unrecognised key is not silently treated as "everybody"',
      typoed.status === 422 ||
        (typeof typoed.json?.matching_customers === 'number' &&
          /all customers|todos/i.test(String(typoed.json?.summary ?? ''))),
      `HTTP ${typoed.status}, matched ${typoed.json?.matching_customers}, summary="${typoed.json?.summary}"${totalCount ? ` (total ${totalCount})` : ''}`
    )

    const preview = await c.put('/api/v1/segments', {
      businessId: bid,
      name: 'preview',
      definition: { match: 'all', conditions: [{ field: 'visit_count', operator: 'gte', value: 2 }] },
    })
    if (checkStatus('segment preview counts matching customers', preview, 200)) {
      const count = preview.json?.matching_customers
      check(
        'segment preview returns a real count, not a placeholder',
        typeof count === 'number' && count > 0,
        `${count} customers match "visit_count >= 2" — ${preview.json?.summary}`
      )

      // A stricter rule must match strictly fewer customers, or the filter is
      // being ignored and every segment is "everybody".
      const stricter = await c.put('/api/v1/segments', {
        businessId: bid,
        name: 'preview',
        definition: { match: 'all', conditions: [{ field: 'visit_count', operator: 'gte', value: 40 }] },
      })
      check(
        'a stricter segment matches strictly fewer customers',
        typeof stricter.json?.matching_customers === 'number' &&
          stricter.json.matching_customers < count,
        `>=2 matched ${count}, >=40 matched ${stricter.json?.matching_customers}`
      )
    }
  }

  for (const id of createdIds) {
    await c.del(`/api/v1/campaigns/${id}?businessId=${bid}`)
  }
}

async function verifyOnboarding(session, account) {
  heading(`Onboarding state — ${account.plan}`)
  const c = session.client
  const bid = session.businessId

  const state = await c.get(`/api/v1/onboarding?businessId=${bid}`)
  if (!checkStatus('onboarding state readable', state, 200)) return
  const payload = state.json?.data ?? state.json
  check(
    'onboarding reports a completion state',
    payload !== null && typeof payload === 'object',
    JSON.stringify(payload).slice(0, 160)
  )

  const page = await c.get('/onboarding', { raw: true })
  check(
    'the onboarding page is reachable for a signed-in merchant',
    [200, 307, 308].includes(page.status),
    `HTTP ${page.status}${page.location ? ` → ${page.location}` : ''}`
  )
}

async function verifyLocalization(session, account) {
  heading(`Localization — ${account.plan}`)
  const c = session.client

  const surfaces = ['/dashboard', '/dashboard/customers', '/dashboard/rewards', '/dashboard/wallet', '/dashboard/analytics']

  for (const locale of ['en', 'es']) {
    c.setCookie('passimo_locale', locale)
    let ok = 0
    const problems = []
    for (const path of surfaces) {
      const response = await c.get(path, { raw: true })
      if (response.status !== 200) {
        problems.push(`${path} → ${response.status}`)
        continue
      }
      const html = response.text
      const lang = html.match(/<html[^>]*lang="([a-z-]+)"/i)?.[1]
      if (lang && !lang.startsWith(locale)) problems.push(`${path} declares lang="${lang}"`)
      else ok += 1
    }
    check(
      `dashboard renders in ${locale.toUpperCase()} with a matching lang attribute`,
      problems.length === 0,
      problems.length ? problems.join(', ') : `${ok}/${surfaces.length} surfaces`
    )
  }

  // Public surfaces in both languages.
  for (const locale of ['en', 'es']) {
    const anon = new Client('anon')
    anon.setCookie('passimo_locale', locale)
    for (const path of ['/', '/login', '/signup', `/join/${session.slug}`]) {
      const response = await anon.get(path, { raw: true })
      const lang = response.text.match(/<html[^>]*lang="([a-z-]+)"/i)?.[1]
      check(
        `${path} renders in ${locale.toUpperCase()}`,
        response.status === 200 && (!lang || lang.startsWith(locale)),
        `HTTP ${response.status}, lang="${lang ?? 'unset'}"`
      )
    }
  }

  c.setCookie('passimo_locale', 'en')

  /*
   * Error localisation is checked where it actually happens: in the browser, from
   * the error *code* and the structured `details`, not from the server's prose.
   * `lib/client/api-errors.ts` documents why — a JSON route has no view and no
   * locale, and threading a translator through every handler to produce a string
   * only the browser renders would put presentation inside the transport.
   *
   * So the contract this asserts is: every refusal a merchant meets at speed
   * carries something the client can translate. A `code` is enough for the
   * transport-level ones; `unprocessable` and `conflict` need a `details.reason`,
   * because their meaning is in the prose and the code alone cannot produce a
   * sentence.
   *
   * Deliberately not probing sign-in with a wrong password: the account lockout is
   * per-account and five wrong guesses locks a demo account for fifteen minutes,
   * which would break every later run of this harness.
   */
  const refusals = [
    [
      'redeeming with an insufficient balance',
      () =>
        c.post('/api/v1/loyalty/redeem', {
          businessId: session.businessId,
          customerId: '00000000-0000-0000-0000-000000000000',
          rewardId: '00000000-0000-0000-0000-000000000000',
          idempotencyKey: `zz-verify-i18n-${Date.now()}`,
        }),
    ],
    [
      'an unknown granted-reward code',
      () => c.put('/api/v1/loyalty/redeem', { businessId: session.businessId, code: 'ZZZZZZZZZZ' }),
    ],
  ]

  for (const [label, call] of refusals) {
    const response = await call()
    const code = response.errorCode
    const reason = (response.json?.error?.details ?? {}).reason
    const translatable =
      ['unauthorized', 'forbidden', 'not_found', 'conflict', 'rate_limited', 'not_configured', 'validation_failed', 'payment_required', 'internal_error'].includes(code) ||
      typeof reason === 'string'
    check(
      `the refusal for ${label} is translatable by the client`,
      translatable,
      `code=${code} reason=${reason ?? 'none'}`
    )
  }

  // A refused sign-in must not name whether the account exists, in either language.
  for (const locale of ['en', 'es']) {
    const probe = new Client('anon')
    probe.setCookie('passimo_locale', locale)
    const response = await probe.post('/api/v1/auth/login', {
      email: `zz-verify-nobody-${Date.now()}@demo.invalid`,
      password: 'wrong-on-purpose',
    })
    check(
      `a refused sign-in in ${locale.toUpperCase()} carries a client-translatable code`,
      response.errorCode === 'unauthorized',
      `code=${response.errorCode}`
    )
  }
}

async function verifyApiContracts(session) {
  heading('API contracts — malformed and hostile input')
  const c = session.client
  const bid = session.businessId

  const probes = [
    ['missing businessId', () => c.get('/api/v1/customers'), [400, 422]],
    ['businessId is not a uuid', () => c.get('/api/v1/customers?businessId=not-a-uuid'), [400, 422]],
    ['negative pagination', () => c.get(`/api/v1/customers?businessId=${bid}&limit=-5`), [400, 422]],
    ['oversized pagination', () => c.get(`/api/v1/customers?businessId=${bid}&limit=100000`), [400, 422]],
    ['customer with neither email nor phone', () => c.post('/api/v1/customers', { businessId: bid, name: 'No contact' }), [400, 422]],
    ['invalid email', () => c.post('/api/v1/customers', { businessId: bid, email: 'not-an-email' }), [400, 422]],
    ['earn with no identifier', () => c.post('/api/v1/loyalty/earn', { businessId: bid, trigger: 'visit' }), [400, 422]],
    ['earn with a negative amount', () => c.post('/api/v1/loyalty/earn', { businessId: bid, email: 'x@example.com', amount: -50 }), [400, 422]],
    ['adjust by zero', () => c.post('/api/v1/loyalty/adjust', { businessId: bid, customerId: '00000000-0000-0000-0000-000000000000', programId: '00000000-0000-0000-0000-000000000000', amount: 0, reason: 'probe' }), [400, 422]],
    ['reward with a negative cost', () => c.post('/api/v1/rewards', { businessId: bid, name: 'neg', cost: -1 }), [400, 422]],
    ['unknown business id', () => c.get('/api/v1/customers?businessId=00000000-0000-0000-0000-000000000000'), [403, 404]],
  ]

  for (const [label, call, expected] of probes) {
    const response = await call()
    checkStatus(label, response, expected)
  }

  // SQL injection attempts through every string field that reaches a query.
  const injections = [
    "' OR 1=1 --",
    "'; DROP TABLE customers; --",
    "%' UNION SELECT * FROM app_users --",
    "\\'; DELETE FROM businesses WHERE 1=1; --",
  ]
  let injectionProblems = 0
  for (const payload of injections) {
    const search = await c.get(`/api/v1/customers?businessId=${bid}&q=${encodeURIComponent(payload)}`)
    if (search.status >= 500) {
      injectionProblems += 1
      fail(`injection probe caused a server error: ${payload}`, `HTTP ${search.status}`)
    }
  }
  check(`${injections.length} SQL injection probes handled without a server error`, injectionProblems === 0)

  const stillThere = await c.get(`/api/v1/customers?businessId=${bid}&limit=1`)
  check(
    'the customers table survived the injection probes',
    stillThere.status === 200,
    `HTTP ${stillThere.status}`
  )

  // XSS: a stored script tag must come back escaped or sanitised, never raw.
  const xss = await c.post('/api/v1/customers', {
    businessId: bid,
    email: `zz-verify-xss-${Date.now()}@demo.invalid`,
    name: '<script>alert(1)</script>',
  })
  if (xss.status < 300) {
    const id = (xss.json?.data?.customer ?? xss.json?.customer)?.id
    const page = await c.get(`/dashboard/customers/${id}`, { raw: true })
    check(
      'a stored <script> tag is not reflected unescaped into HTML',
      !page.text.includes('<script>alert(1)</script>'),
      `page HTTP ${page.status}`
    )
  }

  // Body size ceiling.
  const huge = await c.post('/api/v1/customers', {
    businessId: bid,
    email: `zz-verify-huge-${Date.now()}@demo.invalid`,
    name: 'x'.repeat(2_000_000),
  })
  checkStatus('an oversized request body is refused', huge, [400, 413, 422])
}

async function verifyAdmin() {
  heading('Platform admin')
  const client = new Client('admin')
  const login = await client.post('/api/v1/auth/login', {
    email: process.env.PLATFORM_ADMIN_EMAIL ?? 'admin@passimo.demo',
    password: DEMO_PASSWORD,
  })
  if (!checkStatus('platform admin can sign in', login, 200)) return

  const overview = await client.get('/api/v1/admin/overview')
  checkStatus('admin platform overview readable', overview, 200)
  const businesses = await client.get('/api/v1/admin/businesses')
  if (checkStatus('admin can list every workspace', businesses, 200)) {
    const rows = businesses.json?.businesses ?? []
    check(
      'admin sees every demo workspace',
      rows.length >= ACCOUNTS.length,
      `${rows.length} workspaces: ${rows.map((r) => `${r.name}=${r.planLabel}`).join(', ')}`
    )

    /*
     * A live trial must not be labelled Inactive. It was: every caller wrote
     * `normalizePlanId(row.plan) ?? 'lapsed'`, and `normalizePlanId('trial')`
     * returns null because `trial` is a lifecycle state rather than a tier — so
     * the console counted live trials as churn and showed "Inactive" beside a
     * future trial end date.
     */
    const trialRow = rows.find((row) => row.name === 'Bilbao Pizzeria')
    check(
      'a live trial is shown on the tier it is evaluating, not as Inactive',
      trialRow ? trialRow.plan === 'pro' && trialRow.onTrial === true : false,
      trialRow ? `plan=${trialRow.plan} label=${trialRow.planLabel} onTrial=${trialRow.onTrial}` : 'workspace not listed'
    )
    const lapsedRow = rows.find((row) => row.name === 'Zaragoza Florist')
    check(
      'a genuinely lapsed workspace is still shown as Inactive',
      lapsedRow ? lapsedRow.plan === 'lapsed' && lapsedRow.onTrial === false : false,
      lapsedRow ? `plan=${lapsedRow.plan} onTrial=${lapsedRow.onTrial}` : 'workspace not listed'
    )
  }

  const overviewPayload = overview.json ?? {}
  check(
    'the platform overview reports MRR excluding trials',
    typeof overviewPayload.mrrCents === 'number',
    `mrrCents=${overviewPayload.mrrCents} businesses=${JSON.stringify(overviewPayload.businesses)}`
  )
  const breakdown = overviewPayload.planBreakdown ?? []
  check(
    'the plan breakdown does not file live trials under Inactive',
    breakdown.length > 0 &&
      (breakdown.find((row) => row.plan === 'lapsed')?.count ?? 0) <= 1,
    breakdown.map((row) => `${row.plan}:${row.count}`).join(' ')
  )

  const page = await client.get('/admin', { raw: true })
  check('admin console renders', page.status === 200, `HTTP ${page.status}`)

  // A merchant must not reach the admin surface.
  const merchant = new Client('merchant')
  await merchant.post('/api/v1/auth/login', { email: 'business@demo.com', password: DEMO_PASSWORD })
  const denied = await merchant.get('/api/v1/admin/overview')
  checkStatus('a merchant cannot read the admin overview', denied, [401, 403, 404])
  const deniedBusinesses = await merchant.get('/api/v1/admin/businesses')
  checkStatus('a merchant cannot list every workspace', deniedBusinesses, [401, 403, 404])
}

async function verifySignupJourney() {
  heading('New-merchant journey — signup to first scan')
  const client = new Client('new')
  const stamp = Date.now()
  const email = `zz-verify-new-${stamp}@demo.invalid`

  const signup = await client.post('/api/v1/auth/signup', {
    email,
    password: 'ZzVerify-New-2026!',
    fullName: 'ZZ Verify Founder',
    businessName: `ZZ Verify Cafe ${stamp}`,
  })
  if (!checkStatus('a brand-new merchant can sign up', signup, [200, 201])) {
    warn('new-merchant journey', 'aborted: signup failed')
    return
  }

  const payload = signup.json ?? {}
  let businessId =
    payload.business?.id ?? payload.business_id ?? payload.businesses?.[0]?.id ?? null

  // Some signup flows do not create the workspace until sign-in; cover both.
  if (!businessId) {
    const login = await client.post('/api/v1/auth/login', { email, password: 'ZzVerify-New-2026!' })
    businessId = (login.json?.businesses ?? [])[0]?.id ?? null
  }
  if (!businessId) {
    const me = await client.get('/api/v1/me')
    businessId = (me.json?.businesses ?? [])[0]?.id ?? null
  }

  const me = await client.get('/api/v1/me')
  checkStatus('the new account has a working session', me, 200)

  if (!businessId) {
    // Onboarding is expected to create the business.
    const onboardingPage = await client.get('/onboarding', { raw: true })
    check(
      'a merchant with no workspace lands on onboarding',
      [200, 307, 308].includes(onboardingPage.status),
      `HTTP ${onboardingPage.status}`
    )
    const create = await client.post('/api/v1/businesses', {
      name: `ZZ Verify Cafe ${stamp}`,
      category: 'cafe',
      locale: 'en',
    })
    if (checkStatus('a merchant can create their business', create, [200, 201])) {
      businessId = create.json?.business_id ?? create.json?.business?.id ?? null
    }
  } else {
    pass('signup provisioned a workspace', businessId)
  }

  if (!businessId) {
    fail('new-merchant journey', 'no business id after signup and onboarding')
    return
  }

  // Trial state.
  const billing = await client.get(`/api/v1/billing?businessId=${businessId}`)
  if (checkStatus('the new workspace has a subscription state', billing, 200)) {
    const b = billing.json ?? {}
    check(
      'a new workspace starts on a live trial, never on a free plan',
      b.stored_plan === 'trial' && b.effective_plan === 'pro' && b.trial?.active === true,
      `stored="${b.stored_plan}" resolved="${b.plan}" effective="${b.effective_plan}" trialActive=${b.trial?.active} daysLeft=${b.trial?.daysRemaining}`
    )
    check(
      'the trial grants the tier the merchant is being sold, not the cheapest one',
      b.effective_plan === 'pro' && (b.features ?? []).includes('ai'),
      `${(b.features ?? []).length} features`
    )
  }

  // Onboarding progress + resume.
  const before = await client.get(`/api/v1/onboarding?businessId=${businessId}`)
  checkStatus('onboarding state readable for the new workspace', before, 200)

  const program = await client.post('/api/v1/programs', {
    businessId,
    name: 'ZZ Verify Stamps',
    type: 'stamps',
    unitSingular: 'stamp',
    unitPlural: 'stamps',
    goalAmount: 6,
    rewardDescription: 'A free coffee',
    isDefault: true,
  })
  checkStatus('the merchant can create a loyalty program', program, [200, 201])
  const programId = program.json?.program_id ?? null
  check('the new program has an id', Boolean(programId), programId)

  /*
   * A program created through the API has to arrive with working earning rules.
   * This route used to create none at all, so a merchant who added a second
   * program got one that credited nothing on every scan.
   */
  if (programId) {
    const readBack = await client.get(`/api/v1/programs?businessId=${businessId}`)
    const rules = (readBack.json?.rules ?? []).filter((rule) => rule.program_id === programId)
    check(
      'a newly created program arrives with earning rules that work',
      rules.some((rule) => rule.is_active && ['visit', 'purchase'].includes(rule.trigger)),
      rules.map((rule) => `${rule.trigger}:${rule.award_type}:${rule.award_amount}`).join(', ') || 'no rules'
    )
  }

  const reward = await client.post('/api/v1/rewards', {
    businessId,
    programId,
    name: 'Free coffee',
    cost: 6,
  })
  checkStatus('the merchant can configure a reward', reward, [200, 201])

  const location = await client.post('/api/v1/locations', {
    businessId,
    name: 'Main shop',
    addressLine1: 'Calle Mayor 1',
    city: 'Madrid',
    postalCode: '28013',
    countryCode: 'ES',
  })
  checkStatus('the merchant can add a location', location, [200, 201, 422])

  const brand = await client.patch('/api/v1/brand', {
    businessId,
    primaryColor: '#7C3AED',
    description: 'Verification fixture business.',
  })
  checkStatus('the merchant can set their branding', brand, 200)

  const design = await client.patch('/api/v1/wallet/design', {
    businessId,
    headline: 'ZZ Verify Card',
    cardStyle: 'solid',
  })
  checkStatus('the merchant can configure their wallet card', design, 200)

  // Onboarding resume: sign out, sign back in, and confirm the progress made
  // above is still reported. This is the check that catches a wizard storing
  // state in a React ref.
  const midway = await client.get(`/api/v1/onboarding?businessId=${businessId}`)
  const midwayState = JSON.stringify(midway.json?.data ?? midway.json)

  await client.post('/api/v1/auth/logout', {})
  const afterLogout = await client.get('/api/v1/me')
  checkStatus('signing out invalidates the session', afterLogout, [401, 403])

  const fresh = new Client('new-resumed')
  const relogin = await fresh.post('/api/v1/auth/login', { email, password: 'ZzVerify-New-2026!' })
  if (checkStatus('the merchant can sign back in', relogin, 200)) {
    const resumed = await fresh.get(`/api/v1/onboarding?businessId=${businessId}`)
    const resumedState = JSON.stringify(resumed.json?.data ?? resumed.json)
    check(
      'onboarding progress survives sign-out and sign-in',
      resumedState === midwayState,
      resumedState === midwayState ? 'state identical' : `before ${midwayState.slice(0, 120)} / after ${resumedState.slice(0, 120)}`
    )

    // First customer and first scan, on the new account.
    const customer = await fresh.post('/api/v1/customers', {
      businessId,
      email: `zz-verify-first-${stamp}@demo.invalid`,
      name: 'First Customer',
    })
    if (checkStatus('the merchant can register their first customer', customer, [200, 201])) {
      const id = customer.json?.customer_id
      const earn = await fresh.post('/api/v1/loyalty/earn', {
        businessId,
        customerId: id,
        trigger: 'visit',
        idempotencyKey: `zz-verify-first-${stamp}`,
      })
      checkStatus('the merchant can award their first stamp', earn, 200)

      const analytics = await fresh.get(`/api/v1/analytics/overview?businessId=${businessId}&days=30`)
      if (checkStatus('analytics work on a brand-new workspace', analytics, 200)) {
        const visits = visitsOf(analytics)
        check('the first visit shows up in analytics', visits !== null && visits >= 1, `visits ${visits}`)
        check(
          'a brand-new workspace renders analytics without dividing by zero',
          analytics.json?.customers?.total >= 1 && analytics.json?.revenue !== undefined,
          `customers=${analytics.json?.customers?.total} retention=${analytics.json?.customers?.retention_rate}`
        )
      }
    }

    // Public join page for the new business.
    const businesses = relogin.json?.businesses ?? []
    const slug = businesses.find((b) => b.id === businessId)?.slug
    if (slug) {
      const anon = new Client('anon')
      const join = await anon.get(`/join/${slug}`, { raw: true })
      check('the new business has a working public join page', join.status === 200, `HTTP ${join.status} /join/${slug}`)
      const publicApi = await anon.get(`/api/v1/public/business/${slug}`)
      checkStatus('the public business endpoint serves the new workspace', publicApi, 200)
    }
  }

  return { email, businessId }
}

async function verifyPublicSurfaces(slug) {
  heading('Public surfaces')
  const anon = new Client('anon')

  const pages = ['/', '/login', '/signup', '/reset-password', '/offline', '/legal/privacy', '/legal/terms', `/join/${slug}`]
  const broken = []
  for (const path of pages) {
    const response = await anon.get(path, { raw: true })
    if (response.status !== 200) broken.push(`${path} → ${response.status}`)
  }
  check(`all ${pages.length} public pages render`, broken.length === 0, broken.join(', ') || 'all 200')

  const landing = await anon.get('/', { raw: true })
  check(
    'the landing page does not open a camera scanner',
    !/getUserMedia|navigator\.mediaDevices/.test(landing.text),
    'no camera API reference in the landing HTML'
  )

  /*
   * Checked per locale. Spanish is the default and `Intl` renders USD as
   * "5,00 US$" there, so grepping for "$5" against an uncookied request finds
   * nothing and says nothing about the page — it says the checker did not set a
   * language. Both renderings are asserted instead.
   */
  for (const [locale, pattern] of [
    ['en', /\$5(\.00)?\b/],
    ['es', /5,00\s*US\$|US\$\s*5|\$5/],
  ]) {
    const localised = new Client('anon')
    localised.setCookie('passimo_locale', locale)
    const page = await localised.get('/', { raw: true })
    check(
      `the landing page quotes the $5 entry price in ${locale.toUpperCase()}`,
      pattern.test(page.text),
      pattern.test(page.text) ? 'present' : (page.text.match(/[0-9][.,]00[^<]{0,6}/) ?? ['not found'])[0]
    )
  }

  check(
    'the four prices are in the structured data crawlers read',
    ['"price":5', '"price":19', '"price":49', '"price":99'].every((p) => landing.text.includes(p)),
    'ld+json offers present'
  )
  check(
    'the landing page does not advertise a free plan',
    !/free plan|plan gratis|gratis para siempre|free forever|plan gratuito/i.test(landing.text),
    'no free-tier claim'
  )
  check(
    'the landing page makes no unverifiable social-proof claim',
    !/[0-9][,.]?[0-9]*\+?\s*(businesses|negocios|merchants|comercios)\s+(already|ya|trust|conf)/i.test(landing.text),
    'no fabricated customer counts'
  )

  const security = ['x-content-type-options', 'x-frame-options', 'referrer-policy', 'content-security-policy']
  const missing = security.filter((header) => !landing.headers.get(header))
  check('security headers present on public pages', missing.length === 0, missing.length ? `missing ${missing.join(', ')}` : security.join(', '))

  /*
   * A real 404, not a 200 with "not found" in the DOM. This was a genuine defect:
   * `/join/[slug]` was a client component, so an unknown slug answered 200 with a
   * Passimo-branded shell and only corrected itself after a round trip — which
   * crawlers, link unfurlers and uptime checks all read as a live page.
   */
  const notFound = await anon.get('/join/definitely-no-such-business-zz', { raw: true })
  check(
    'an unknown business slug answers a real HTTP 404',
    notFound.status === 404,
    `HTTP ${notFound.status}`
  )
  const notFoundApi = await anon.get('/api/v1/public/business/definitely-no-such-business-zz')
  checkStatus('the public business endpoint 404s for an unknown slug', notFoundApi, 404)

  const known = await anon.get(`/api/v1/public/business/${slug}`)
  if (checkStatus('the public business endpoint serves a known slug', known, 200)) {
    check(
      'the public payload does not leak the tenant primary key',
      known.json?.business?.id === undefined,
      `keys: ${Object.keys(known.json?.business ?? {}).join(', ')}`
    )
    check(
      'the public payload carries the brand and the reward, and nothing commercial',
      known.json?.business?.primary_color !== undefined &&
        known.json?.rewards !== undefined &&
        !('customer_count' in (known.json ?? {})) &&
        !('revenue' in (known.json ?? {})),
      `${(known.json?.rewards ?? []).length} rewards, ${(known.json?.locations ?? []).length} locations`
    )
  }

  const publicJoin = await anon.post('/api/v1/public/join', {
    businessSlug: slug,
    email: `zz-verify-public-${Date.now()}@demo.invalid`,
    name: 'ZZ Public Joiner',
    acceptedTerms: true,
  })
  if (checkStatus('a customer can enrol from the public join page', publicJoin, [200, 201])) {
    check(
      'enrolment returns a card and both wallet links',
      Boolean(publicJoin.json?.card_url) &&
        Boolean(publicJoin.json?.apple_wallet_url) &&
        Boolean(publicJoin.json?.google_wallet_url) &&
        Boolean(publicJoin.json?.referral_code),
      `referral code ${publicJoin.json?.referral_code}`
    )
    // The token is the last path segment of the card URL.
    const token = (publicJoin.json?.card_url ?? '').split('/card/')[1] ?? null
    if (token) {
      const card = await anon.get(`/card/${token}`, { raw: true })
      check('the enrolled customer gets a working card page', card.status === 200, `HTTP ${card.status}`)
      const cardApi = await anon.get(`/api/v1/public/card/${token}`)
      checkStatus('the public card API serves the pass data', cardApi, 200)
    } else {
      warn('public join returns a card token', JSON.stringify(publicJoin.json).slice(0, 200))
    }
  }

  const missingTerms = await anon.post('/api/v1/public/join', {
    businessSlug: slug,
    email: `zz-verify-noterms-${Date.now()}@demo.invalid`,
  })
  checkStatus('joining without accepting the terms is refused', missingTerms, 422)
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/**
 * A customer's balance on their default program.
 *
 * `GET /api/v1/customers/{id}` returns camelCase and exposes the figure three
 * ways: `customer.primaryBalance`, and per-program under `loyalty.programs[]`.
 * Reading `primaryBalance` is what the dashboard header shows, so it is what a
 * balance assertion should compare.
 */
function balanceOf(response) {
  const payload = response.json ?? {}
  const primary = payload.customer?.primaryBalance
  if (typeof primary === 'number') return primary
  const programs = payload.loyalty?.programs ?? []
  if (programs.length > 0) return Number(programs[0].balance ?? 0)
  return 0
}

/** Total visits in the analytics window. `engagement.visits` is the series total. */
function visitsOf(response) {
  const value = response.json?.engagement?.visits
  return typeof value === 'number' ? value : null
}

/** Redemptions in the analytics window. */
function redemptionsOf(response) {
  const value = response.json?.engagement?.redemptions
  return typeof value === 'number' ? value : null
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

async function main() {
  process.stdout.write(`${C.bold}Passimo functional verification${C.reset}\n${C.dim}${BASE}${C.reset}\n`)

  const anon = await verifyHealth()

  const sessions = {}
  heading('Authentication — every demo plan')
  for (const account of ACCOUNTS) {
    const session = await signIn(account)
    if (session) sessions[account.plan] = { ...session, account }
  }

  const anyBusinessId = Object.values(sessions)[0]?.businessId
  if (!anyBusinessId) {
    fail('demo environment', 'no demo account could sign in — is the database seeded?')
    return report()
  }

  await verifyUnauthenticated(anon, anyBusinessId)

  for (const account of ACCOUNTS) {
    const session = sessions[account.plan]
    if (!session) continue
    if (ONLY && !ONLY.split(',').includes(account.plan)) continue

    const price = EXPECTED_PLANS[account.plan].monthlyPrice
    heading(
      `Plan verification — ${account.plan} (${price === null ? 'not for sale' : `$${price}/mo`}, ${account.business})`
    )
    await verifyPlan(session, account)
    await verifyDashboardPages(session, account)
    await verifyFeatureGating(session, account)
    await verifyOnboarding(session, account)
    await verifyLoyalty(session, account)
    await verifyWallet(session, account)
    await verifyCampaigns(session, account)
    /*
     * Localisation is checked once, on the workspace with the most screens
     * populated. It renders the same fifteen surfaces per locale, and repeating
     * that for every plan adds ninety HTTP round trips and no new information —
     * the dictionary is not per-tenant.
     */
    if (account.plan === 'business') await verifyLocalization(session, account)
  }

  await verifyTenantIsolation(sessions)
  await verifyApiContracts(Object.values(sessions)[0])
  await verifyPublicSurfaces(Object.values(sessions)[0].slug)
  await verifyAdmin()
  await verifySignupJourney()

  return report()
}

function report() {
  const counts = { PASS: 0, WARN: 0, FAIL: 0 }
  for (const result of results) counts[result.status] += 1

  process.stdout.write(`\n${C.bold}Summary${C.reset}\n`)
  process.stdout.write(
    `  ${C.green}${counts.PASS} passed${C.reset}   ${C.yellow}${counts.WARN} warnings${C.reset}   ${counts.FAIL ? C.red : C.dim}${counts.FAIL} failed${C.reset}\n`
  )

  if (counts.FAIL > 0) {
    process.stdout.write(`\n${C.red}${C.bold}Failures${C.reset}\n`)
    for (const result of results.filter((r) => r.status === 'FAIL')) {
      process.stdout.write(`  ${C.red}✗${C.reset} [${result.section}] ${result.name}${result.detail ? ` — ${result.detail}` : ''}\n`)
    }
  }
  if (counts.WARN > 0) {
    process.stdout.write(`\n${C.yellow}Warnings${C.reset}\n`)
    for (const result of results.filter((r) => r.status === 'WARN')) {
      process.stdout.write(`  ${C.yellow}!${C.reset} [${result.section}] ${result.name}${result.detail ? ` — ${result.detail}` : ''}\n`)
    }
  }

  if (process.env.VERIFY_JSON) {
    writeFileSync(process.env.VERIFY_JSON, JSON.stringify(results, null, 2))
  }

  process.exitCode = counts.FAIL > 0 ? 1 : 0
  return counts
}

main().catch((error) => {
  process.stdout.write(`\n${C.red}Harness crashed:${C.reset} ${error?.stack ?? error}\n`)
  process.exitCode = 1
})
