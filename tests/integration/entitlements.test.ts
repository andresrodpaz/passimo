import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '@/lib/db'
import {
  UpgradeRequiredError,
  getBillingSummary,
  hasFeature,
  invalidateEntitlements,
  measureLimit,
  meterAction,
  requireFeature,
  requireWithinLimit,
  trackUsage,
} from '@/lib/billing/entitlements'
import { PLANS } from '@/lib/billing/plans'
import {
  assertDatabaseReady,
  createCustomer,
  createTenant,
  dropTenant,
  shutdown,
  type TestTenant,
} from './helpers'

/**
 * Entitlements against real rows.
 *
 * `tests/unit/billing.test.ts` proves the catalogue is internally consistent and
 * that `resolveEntitlements` reads a row correctly. Neither of those touches the
 * thing that actually protects the business: whether a *count* against live
 * tables refuses the write.
 *
 * That gap is where the interesting failures live, and several of them shipped:
 *
 *   - `campaigns_per_month` was defined on every tier and enforced by nothing.
 *   - `messages_per_month` was incremented after every send and never checked.
 *   - The CSV importer had no cap at all, so a 500-customer plan accepted twenty
 *     thousand rows in one request.
 *
 * Every one of those is invisible to a unit test, because a unit test does not
 * have a `customers` table to count. So these tests use the same functions the
 * routes call, against the same database, on tenants pinned to specific tiers.
 *
 * On the caps that need volume — 500 customers, 5,000 — the assertion is on
 * `measureLimit` and on `requireWithinLimit`'s arithmetic rather than on
 * enrolling five hundred people, which would make the suite slow for no extra
 * confidence: the counting query is the same one either way.
 */
describe('entitlement enforcement', () => {
  let starter: TestTenant
  let growth: TestTenant
  let pro: TestTenant
  let lapsed: TestTenant

  beforeAll(async () => {
    await assertDatabaseReady()
    ;[starter, growth, pro, lapsed] = await Promise.all([
      createTenant('ent-starter', { plan: 'starter' }),
      createTenant('ent-growth', { plan: 'growth' }),
      createTenant('ent-pro', { plan: 'pro' }),
      // A cancelled subscription, which is where a trial that never converted and
      // a merchant who left both land.
      createTenant('ent-lapsed', { plan: 'lapsed', subscriptionStatus: 'canceled' }),
    ])
  }, 60_000)

  afterAll(async () => {
    await Promise.all(
      [starter, growth, pro, lapsed].filter(Boolean).map((tenant) => dropTenant(tenant))
    )
    await shutdown()
  }, 60_000)

  beforeEach(() => {
    // The resolver memoises for 15s. Tests that change a plan or burn a quota
    // need the next read to see it.
    invalidateEntitlements()
  })

  // ---------------------------------------------------------------------------
  // Features
  // ---------------------------------------------------------------------------

  describe('feature gates', () => {
    it('gives Starter the whole core loyalty product', async () => {
      /*
       * The commercial claim of the $29 tier, checked against the resolver rather
       * than against the catalogue: a café must be able to brand its card,
       * campaign to its list, keep automations running, segment and use the AI.
       * If any of these ever answers false, Starter has become a teaser and the
       * pricing page is lying.
       */
      for (const feature of [
        'custom_branding',
        'wallet_proximity',
        'campaigns',
        'automations',
        'segments',
        'ai',
      ] as const) {
        expect(
          await hasFeature(starter.businessId, feature),
          `Starter must include "${feature}"`
        ).toBe(true)
        await expect(requireFeature(starter.businessId, feature)).resolves.toBeUndefined()
      }
    })

    it('refuses a Growth feature to Starter, and names Growth', async () => {
      for (const feature of [
        'multi_location',
        'geofencing',
        'proximity_campaigns',
        'automation_rules',
        'gift_cards',
        'advanced_analytics',
      ] as const) {
        expect(await hasFeature(starter.businessId, feature)).toBe(false)

        const error = await requireFeature(starter.businessId, feature).catch(
          (cause: unknown) => cause
        )
        expect(error, `"${feature}" should be refused on Starter`).toBeInstanceOf(
          UpgradeRequiredError
        )
        const upgrade = (error as UpgradeRequiredError).upgrade
        expect(upgrade.reason).toBe('feature')
        expect(upgrade.current_plan).toBe('starter')
        // The remedy has to be a plan that would actually allow it, or the UI
        // renders a button that leads to the same refusal.
        expect(upgrade.suggested_plan).toBe('growth')
      }
    })

    it('refuses a Pro feature to Growth, and names Pro', async () => {
      for (const feature of ['memberships', 'coalition'] as const) {
        expect(await hasFeature(growth.businessId, feature)).toBe(false)
        const error = await requireFeature(growth.businessId, feature).catch(
          (cause: unknown) => cause
        )
        expect(error).toBeInstanceOf(UpgradeRequiredError)
        expect((error as UpgradeRequiredError).upgrade.suggested_plan).toBe('pro')
      }
    })

    it('gives Pro every feature in the catalogue', async () => {
      for (const feature of PLANS.pro.features) {
        expect(await hasFeature(pro.businessId, feature), `Pro must include "${feature}"`).toBe(
          true
        )
      }
    })

    it('refuses every feature to a lapsed workspace, and offers the entry tier', async () => {
      for (const feature of ['campaigns', 'custom_branding', 'ai'] as const) {
        const error = await requireFeature(lapsed.businessId, feature).catch(
          (cause: unknown) => cause
        )
        expect(error).toBeInstanceOf(UpgradeRequiredError)
        const upgrade = (error as UpgradeRequiredError).upgrade
        expect(upgrade.current_plan).toBe('lapsed')
        // Never `lapsed` itself: that is a plan that would unblock nothing.
        expect(upgrade.suggested_plan).toBe('starter')
      }
    })
  })

  // ---------------------------------------------------------------------------
  // Countable limits
  // ---------------------------------------------------------------------------

  describe('location cap', () => {
    it('lets a Starter merchant keep the one location they have, and refuses the second', async () => {
      const db = getDb()

      /*
       * `passimo_provision_business` creates the first location, so a fresh
       * Starter tenant is already at 1 / 1 — which is the interesting state,
       * because it is the one every real single-site café is in.
       */
      const before = await measureLimit(starter.businessId, 'locations')
      expect(before.allowed).toBe(1)
      expect(before.used).toBe(1)
      expect(before.exceeded).toBe(true)

      const error = await requireWithinLimit(starter.businessId, 'locations').catch(
        (cause: unknown) => cause
      )
      expect(error).toBeInstanceOf(UpgradeRequiredError)
      const upgrade = (error as UpgradeRequiredError).upgrade
      expect(upgrade.reason).toBe('limit')
      expect(upgrade.limit).toBe('locations')
      expect(upgrade.used).toBe(1)
      expect(upgrade.allowed).toBe(1)
      expect(upgrade.suggested_plan).toBe('growth')

      // Nothing was created by the refusal.
      const { count } = await db
        .from('locations')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', starter.businessId)
      expect(count).toBe(1)
    })

    it('lets Growth add a second and a third, then refuses the fourth', async () => {
      const db = getDb()

      await expect(
        requireWithinLimit(growth.businessId, 'locations')
      ).resolves.toMatchObject({ allowed: 3 })

      // `is_default`, not `is_primary` — and asserted, because an insert that
      // silently fails makes this test pass for the wrong reason: `used` stays at
      // 1, the cap is never approached, and the refusal below never fires.
      const { error: insertError } = await db.from('locations').insert([
        { business_id: growth.businessId, name: 'Second', is_default: false },
        { business_id: growth.businessId, name: 'Third', is_default: false },
      ])
      expect(insertError).toBeNull()
      invalidateEntitlements()

      const full = await measureLimit(growth.businessId, 'locations')
      expect(full.used).toBe(3)
      expect(full.allowed).toBe(3)

      const error = await requireWithinLimit(growth.businessId, 'locations').catch(
        (cause: unknown) => cause
      )
      expect(error).toBeInstanceOf(UpgradeRequiredError)
      expect((error as UpgradeRequiredError).upgrade.suggested_plan).toBe('pro')
    })

    it('does not count an archived location against the cap', async () => {
      /*
       * The downgrade-safety rule, from the enforcement side. A merchant who moves
       * from Growth to Starter is never made to delete a shop: they archive the
       * ones they are not using, and archiving has to free the slot or the
       * downgrade is a trap.
       */
      const db = getDb()
      await db
        .from('locations')
        .update({ archived_at: new Date().toISOString() })
        .eq('business_id', growth.businessId)
        .eq('name', 'Third')
      invalidateEntitlements()

      const after = await measureLimit(growth.businessId, 'locations')
      expect(after.used).toBe(2)
      await expect(requireWithinLimit(growth.businessId, 'locations')).resolves.toBeTruthy()
    })
  })

  describe('customer cap', () => {
    it('reads the plan cap and lets a small merchant add customers', async () => {
      const status = await measureLimit(starter.businessId, 'customers')
      expect(status.allowed).toBe(500)
      expect(status.exceeded).toBe(false)

      await createCustomer(starter.businessId)
      invalidateEntitlements()

      const after = await measureLimit(starter.businessId, 'customers')
      expect(after.used).toBe(status.used + 1)
      await expect(requireWithinLimit(starter.businessId, 'customers')).resolves.toBeTruthy()
    })

    it('refuses a bulk amount that would cross the cap, without writing anything', async () => {
      /*
       * The CSV importer's case, and the one that had no check at all. The
       * `amount` argument is what makes a 20,000-row file a single refusal rather
       * than 19,500 individual ones after the first 500 succeeded.
       */
      const db = getDb()
      const { count: before } = await db
        .from('customers')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', starter.businessId)

      const error = await requireWithinLimit(starter.businessId, 'customers', 12_000).catch(
        (cause: unknown) => cause
      )
      expect(error).toBeInstanceOf(UpgradeRequiredError)
      const upgrade = (error as UpgradeRequiredError).upgrade
      expect(upgrade.limit).toBe('customers')
      // 12,000 clears neither Starter's 500 nor Growth's 5,000, so the honest
      // remedy is Pro — not simply the next plan up.
      expect(upgrade.suggested_plan).toBe('pro')

      const { count: after } = await db
        .from('customers')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', starter.businessId)
      expect(after).toBe(before)
    })

    it('offers no remedy at all when nothing in the catalogue would fit', async () => {
      // No tier is unlimited on customers. A request beyond Pro's 20,000 has no
      // plan to point at, and `null` is the honest answer — the paywall renders
      // "get in touch" rather than a button that leads to the same 402.
      const error = await requireWithinLimit(starter.businessId, 'customers', 5_000_000).catch(
        (cause: unknown) => cause
      )
      expect(error).toBeInstanceOf(UpgradeRequiredError)
      expect((error as UpgradeRequiredError).upgrade.suggested_plan).toBeNull()
    })

    it('refuses a lapsed workspace its first new customer while leaving the old ones readable', async () => {
      const db = getDb()
      // Enrolled while the workspace was still notionally live. Nothing about
      // lapsing may remove them.
      const existing = await createCustomer(lapsed.businessId)
      invalidateEntitlements()

      const error = await requireWithinLimit(lapsed.businessId, 'customers').catch(
        (cause: unknown) => cause
      )
      expect(error).toBeInstanceOf(UpgradeRequiredError)
      expect((error as UpgradeRequiredError).upgrade.allowed).toBe(0)
      expect((error as UpgradeRequiredError).upgrade.suggested_plan).toBe('starter')

      // The read is untouched, which is the whole promise of `lapsed`.
      const { data } = await db
        .from('customers')
        .select('id')
        .eq('id', existing)
        .maybeSingle()
      expect(data?.id).toBe(existing)
    })
  })

  // ---------------------------------------------------------------------------
  // Metered limits
  // ---------------------------------------------------------------------------

  describe('metered allowances', () => {
    it('counts AI actions against the plan and refuses when the allowance is spent', async () => {
      /*
       * Starter's twenty-five generations, burned in one go. This exercises the
       * whole meter — `passimo_track_usage`, the `usage_counters` row, the period
       * key and the check — rather than any one of them in isolation.
       */
      const allowance = PLANS.starter.limits.ai_actions_per_month!
      expect(allowance).toBe(25)

      await trackUsage(starter.businessId, 'ai_actions', allowance)
      invalidateEntitlements()

      const status = await measureLimit(starter.businessId, 'ai_actions_per_month')
      expect(status.used).toBe(allowance)
      expect(status.exceeded).toBe(true)

      let ran = false
      const error = await meterAction(starter.businessId, 'ai_actions', 1, async () => {
        ran = true
        return 'should not happen'
      }).catch((cause: unknown) => cause)

      expect(error).toBeInstanceOf(UpgradeRequiredError)
      // The check is *before* the work, so an over-quota merchant never costs us
      // an inference call.
      expect(ran).toBe(false)
      expect((error as UpgradeRequiredError).upgrade.suggested_plan).toBe('growth')
    })

    it('does not count work that failed', async () => {
      /*
       * A provider outage must not burn the merchant's allowance. `meterAction`
       * counts after the action resolves, so a throw leaves the counter where it
       * was — which is the difference between an outage costing us a retry and it
       * costing the merchant their month.
       */
      const before = await measureLimit(growth.businessId, 'ai_actions_per_month')

      await expect(
        meterAction(growth.businessId, 'ai_actions', 1, async () => {
          throw new Error('provider down')
        })
      ).rejects.toThrow('provider down')

      invalidateEntitlements()
      const after = await measureLimit(growth.businessId, 'ai_actions_per_month')
      expect(after.used).toBe(before.used)
    })

    it('meters a successful action exactly once', async () => {
      const before = await measureLimit(growth.businessId, 'ai_actions_per_month')

      const result = await meterAction(growth.businessId, 'ai_actions', 1, async () => 'ok')
      expect(result).toBe('ok')

      invalidateEntitlements()
      const after = await measureLimit(growth.businessId, 'ai_actions_per_month')
      expect(after.used).toBe(before.used + 1)
    })

    it('caps campaign sends on Starter and leaves them unlimited on Pro', async () => {
      /*
       * `campaigns_per_month` is the limit that was defined on every tier and
       * enforced by nothing. Starter is ten a month; Pro is `null`, and a null cap
       * has to resolve as unlimited rather than as zero — reading it as zero would
       * refuse every send on the most expensive plan.
       */
      expect(PLANS.starter.limits.campaigns_per_month).toBe(10)
      expect(PLANS.pro.limits.campaigns_per_month).toBeNull()

      await trackUsage(starter.businessId, 'campaigns', 10)
      invalidateEntitlements()

      const error = await requireWithinLimit(starter.businessId, 'campaigns_per_month').catch(
        (cause: unknown) => cause
      )
      expect(error).toBeInstanceOf(UpgradeRequiredError)
      expect((error as UpgradeRequiredError).upgrade.suggested_plan).toBe('growth')

      const unlimited = await measureLimit(pro.businessId, 'campaigns_per_month')
      expect(unlimited.allowed).toBeNull()
      expect(unlimited.exceeded).toBe(false)
      await expect(
        requireWithinLimit(pro.businessId, 'campaigns_per_month', 10_000)
      ).resolves.toBeTruthy()
    })

    it('reserves the whole worst-case message volume before a campaign is queued', async () => {
      /*
       * The send route asks for `reach × channels` up front. Reserving the worst
       * case rather than counting as it goes is what stops a merchant discovering
       * mid-send that half their audience was messaged and half was not — and
       * every one of these channels is billed to us per message.
       */
      const allowance = PLANS.starter.limits.messages_per_month!
      const error = await requireWithinLimit(
        starter.businessId,
        'messages_per_month',
        allowance + 1
      ).catch((cause: unknown) => cause)

      expect(error).toBeInstanceOf(UpgradeRequiredError)
      expect((error as UpgradeRequiredError).upgrade.limit).toBe('messages_per_month')

      // And the same volume is fine one tier up, which is what makes the refusal
      // an upgrade prompt rather than a dead end.
      await expect(
        requireWithinLimit(growth.businessId, 'messages_per_month', allowance + 1)
      ).resolves.toBeTruthy()
    })
  })

  // ---------------------------------------------------------------------------
  // The billing screen's own data
  // ---------------------------------------------------------------------------

  describe('billing summary', () => {
    it('reports every limit in the catalogue, so no meter is missing from the screen', async () => {
      const summary = await getBillingSummary(starter.businessId)
      const reported = summary.usage.map((row) => row.key).sort()
      const expected = Object.keys(PLANS.starter.limits).sort()
      expect(reported).toEqual(expected)
    })

    it('marks a limit as approaching before it is exceeded', async () => {
      /*
       * The 80% threshold is what turns a limit into an upgrade conversation
       * instead of an error. A merchant who first hears about a cap when it
       * refuses them has been ambushed by us.
       */
      const summary = await getBillingSummary(starter.businessId)
      const ai = summary.usage.find((row) => row.key === 'ai_actions_per_month')!
      expect(ai.approaching).toBe(true)
      expect(summary.pressure.map((row) => row.key)).toContain('ai_actions_per_month')
    })

    it('reports a lapsed workspace as lapsed without hiding its usage', async () => {
      const summary = await getBillingSummary(lapsed.businessId)
      expect(summary.lapsed).toBe(true)
      expect(summary.effectivePlan).toBe('lapsed')
      expect(summary.features.size).toBe(0)
      // Its customers are still counted and still shown — "60 / 0" is the state
      // working, not a bug.
      const customers = summary.usage.find((row) => row.key === 'customers')!
      expect(customers.allowed).toBe(0)
      expect(customers.used).toBeGreaterThan(0)
    })
  })

  // ---------------------------------------------------------------------------
  // Trial and downgrade
  // ---------------------------------------------------------------------------

  describe('trial lifecycle', () => {
    it('entitles a live trial to Growth and nothing above it', async () => {
      const tenant = await createTenant('ent-trial', {
        plan: 'trial',
        subscriptionStatus: 'trialing',
        trialEndsAt: new Date(Date.now() + 9 * 86_400_000).toISOString(),
      })

      try {
        invalidateEntitlements()
        const summary = await getBillingSummary(tenant.businessId)

        expect(summary.trial.active).toBe(true)
        expect(summary.effectivePlan).toBe('growth')
        expect(summary.lapsed).toBe(false)
        expect(summary.trial.daysRemaining).toBeGreaterThan(0)

        expect(await hasFeature(tenant.businessId, 'geofencing')).toBe(true)
        // A trial is not a free pass to the top tier.
        expect(await hasFeature(tenant.businessId, 'memberships')).toBe(false)
      } finally {
        await dropTenant(tenant)
      }
    }, 30_000)

    it('lapses an expired trial without deleting anything', async () => {
      const tenant = await createTenant('ent-expired', {
        plan: 'trial',
        subscriptionStatus: null,
        trialEndsAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
      })

      try {
        const customerId = await createCustomer(tenant.businessId)
        invalidateEntitlements()

        const summary = await getBillingSummary(tenant.businessId)
        expect(summary.trial.active).toBe(false)
        expect(summary.lapsed).toBe(true)
        expect(summary.features.size).toBe(0)

        // The customer enrolled during the trial is still there. An expired trial
        // is a locked door, not a bonfire.
        const { data } = await getDb()
          .from('customers')
          .select('id')
          .eq('id', customerId)
          .maybeSingle()
        expect(data?.id).toBe(customerId)
      } finally {
        await dropTenant(tenant)
      }
    }, 30_000)

    it('keeps a delinquent subscriber on their plan through the grace period', async () => {
      const tenant = await createTenant('ent-pastdue', {
        plan: 'growth',
        subscriptionStatus: 'past_due',
      })

      try {
        invalidateEntitlements()
        const summary = await getBillingSummary(tenant.businessId)
        expect(summary.subscription.delinquent).toBe(true)
        // Losing a merchant's geofences the hour their bank declines a card is how
        // a customer is lost over a fraud check. Stripe manages dunning.
        expect(summary.effectivePlan).toBe('growth')
        expect(await hasFeature(tenant.businessId, 'geofencing')).toBe(true)
      } finally {
        await dropTenant(tenant)
      }
    }, 30_000)
  })

  describe('downgrade safety', () => {
    it('turns a downgrade into read-only rather than deletion', async () => {
      /*
       * The scenario a merchant is actually afraid of: three shops on Growth,
       * moving to Starter. Nothing may be deleted, everything must stay readable,
       * and only *adding* is refused.
       */
      const tenant = await createTenant('ent-down', { plan: 'growth' })

      try {
        const db = getDb()
        const { error: insertError } = await db.from('locations').insert([
          { business_id: tenant.businessId, name: 'Second', is_default: false },
          { business_id: tenant.businessId, name: 'Third', is_default: false },
        ])
        expect(insertError).toBeNull()
        const customerId = await createCustomer(tenant.businessId)

        // The downgrade itself: nothing but the plan column changes.
        await db.from('businesses').update({ plan: 'starter' }).eq('id', tenant.businessId)
        invalidateEntitlements()

        const locations = await measureLimit(tenant.businessId, 'locations')
        expect(locations.allowed).toBe(1)
        expect(locations.used).toBe(3)
        expect(locations.exceeded).toBe(true)

        // All three rows survive, which is what the billing screen's conflict list
        // reads to tell the merchant what would become read-only.
        const { count } = await db
          .from('locations')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', tenant.businessId)
          .is('archived_at', null)
        expect(count).toBe(3)

        // The customer is untouched, and core loyalty still works.
        const { data } = await db
          .from('customers')
          .select('id')
          .eq('id', customerId)
          .maybeSingle()
        expect(data?.id).toBe(customerId)
        expect(await hasFeature(tenant.businessId, 'custom_branding')).toBe(true)

        // Adding a fourth is refused, which is the only thing that changed.
        await expect(requireWithinLimit(tenant.businessId, 'locations')).rejects.toThrow(
          UpgradeRequiredError
        )
      } finally {
        await dropTenant(tenant)
      }
    }, 30_000)
  })
})
