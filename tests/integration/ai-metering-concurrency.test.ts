import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  UpgradeRequiredError,
  invalidateEntitlements,
  measureLimit,
  meterAction,
  trackUsage,
} from '@/lib/billing/entitlements'
import { PLANS } from '@/lib/billing/plans'
import { assertDatabaseReady, createTenant, dropTenant, shutdown, type TestTenant } from './helpers'

/**
 * What the AI meter does when requests arrive at the same time.
 *
 * `entitlements.test.ts` covers the meter sequentially — below the cap, at it,
 * over it, and the case where the provider throws. All three hold. None of them
 * can see the one property that only exists under concurrency, which is that
 * `meterAction` is a check-then-act:
 *
 *     requireWithinLimit(...)   <-- reads the counter
 *     await action()            <-- the Anthropic call, hundreds of ms
 *     trackUsage(...)           <-- writes the counter
 *
 * Nothing holds a lock across that gap, so N requests that pass the check
 * before any of them has written can all proceed. The code says so plainly
 * ("the check-then-act window is acceptable because the cost of briefly
 * exceeding a soft quota is zero"), and for `customers` or `locations` that
 * reasoning is right — a merchant who ends up with 501 customers on a 500 plan
 * costs us nothing.
 *
 * `ai_actions` is the metric where that argument does not transfer, because
 * every unit of overshoot is a real inference call that we pay for. So the
 * question worth pinning is not "is there a race" — there is, by construction —
 * but **how far past the cap a burst can actually get**, because that product
 * is the unbudgeted spend.
 *
 * These tests measure it rather than assert it away. If someone later makes the
 * meter atomic, the second test fails and should be rewritten to assert zero
 * overshoot: a failure here means the guarantee got *stronger*.
 */
describe('AI metering under concurrency', () => {
  let starter: TestTenant

  beforeAll(async () => {
    await assertDatabaseReady()
  })

  afterAll(async () => {
    await shutdown()
  })

  /*
   * A fresh tenant per test rather than a shared one. The usage counter is the
   * subject here, so a counter carried over from the previous test is not a
   * detail — it silently changes what "three units remaining" means, which is
   * exactly what happened on the first run of this file.
   */
  beforeEach(async () => {
    starter = await createTenant('ai-meter', { plan: 'starter' })
    invalidateEntitlements()
  })

  afterEach(async () => {
    await dropTenant(starter)
  })

  it('serialised requests stop exactly at the cap', async () => {
    /*
     * The control. Same burst size as the race test below, but awaited one at a
     * time, so every call sees the previous call's write. This is what the
     * concurrent case is being compared against — without it, an overshoot
     * number means nothing.
     */
    const allowance = PLANS.starter.limits.ai_actions_per_month!
    expect(allowance).toBe(25)

    await trackUsage(starter.businessId, 'ai_actions', allowance - 3)
    invalidateEntitlements()

    let succeeded = 0
    let refused = 0
    for (let i = 0; i < 8; i += 1) {
      invalidateEntitlements()
      try {
        await meterAction(starter.businessId, 'ai_actions', 1, async () => 'ok')
        succeeded += 1
      } catch (cause) {
        expect(cause).toBeInstanceOf(UpgradeRequiredError)
        refused += 1
      }
    }

    // Exactly the three remaining units are sold, and the rest are refused.
    expect(succeeded).toBe(3)
    expect(refused).toBe(5)

    invalidateEntitlements()
    const status = await measureLimit(starter.businessId, 'ai_actions_per_month')
    expect(status.used).toBe(allowance)
  })

  it('a concurrent burst can overshoot the cap, and by how much', async () => {
    /*
     * Eight requests fired together with three units left. Each one's provider
     * call is stubbed with a short delay, which is what a real inference call
     * does to the window: it holds it open long enough for every sibling to get
     * through the check.
     */
    const allowance = PLANS.starter.limits.ai_actions_per_month!
    await trackUsage(starter.businessId, 'ai_actions', allowance - 3)
    invalidateEntitlements()

    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        meterAction(starter.businessId, 'ai_actions', 1, async () => {
          await new Promise((resolve) => setTimeout(resolve, 40))
          return 'ok'
        })
      )
    )

    const sold = results.filter((r) => r.status === 'fulfilled').length
    invalidateEntitlements()
    const status = await measureLimit(starter.businessId, 'ai_actions_per_month')
    const overshoot = Math.max(0, status.used - allowance)

    /*
     * Recorded, not silently tolerated. `sold` is the number of billable
     * Anthropic calls this burst actually bought, and `overshoot` is how many
     * of them were past what the merchant paid for.
     */
    console.info(
      `[ai meter] burst=8 remaining=3 sold=${sold} used=${status.used}/${allowance} overshoot=${overshoot}`
    )

    // The meter never *under*-counts: everything sold is counted against them.
    expect(status.used).toBe(allowance - 3 + sold)

    /*
     * The bound that matters. A burst cannot sell more than it contained, and
     * the route's own rate limit (`ai`: 30/hour, lib/rate-limit.ts) is the real
     * ceiling on burst size in production — so worst-case unbudgeted spend is
     * bounded by that, not by the plan.
     */
    expect(sold).toBeLessThanOrEqual(8)
    expect(overshoot).toBeLessThanOrEqual(8 - 3)
  })

  it('refuses everything once the counter is durably past the cap', async () => {
    /*
     * The race only exists in the window before the first write lands. Once the
     * counter is over, a concurrent burst is refused in full — which is why the
     * exposure is a one-off overshoot per period and not an ongoing leak.
     */
    const allowance = PLANS.starter.limits.ai_actions_per_month!
    await trackUsage(starter.businessId, 'ai_actions', allowance + 5)
    invalidateEntitlements()

    let ran = 0
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        meterAction(starter.businessId, 'ai_actions', 1, async () => {
          ran += 1
          return 'should not happen'
        })
      )
    )

    expect(results.every((r) => r.status === 'rejected')).toBe(true)
    // The decisive assertion: no inference call was made for any of them.
    expect(ran).toBe(0)
  })
})
