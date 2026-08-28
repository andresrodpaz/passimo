import { describe, expect, it } from 'vitest'
import { isReferralConverted } from '@/lib/growth/referrals'
import { PLAN_IDS, TRIAL_EXPIRED_PLAN, TRIAL_PLAN, PLANS } from '@/lib/billing/plans'

/**
 * A referral "converts" when the referred merchant actually starts paying, and
 * that moment is worth real credit to the referrer. The rule therefore has to be
 * wrong in neither direction: paying out for a signup that never paid is a hole
 * anyone can farm, and withholding from a merchant who did pay is a support
 * ticket and a broken promise.
 *
 * The original implementation asked the plan (`plan !== 'trial' && plan !==
 * 'free'`) rather than the billing status. Neither of those ids exists in the
 * catalogue, so every referred business — including lapsed ones that had never
 * paid a cent — counted as converted. These cases pin the rule to the billing
 * status instead.
 */

describe('referral conversion', () => {
  it('counts a merchant paying for a purchasable tier', () => {
    expect(isReferralConverted('starter', 'active')).toBe(true)
    expect(isReferralConverted('growth', 'active')).toBe(true)
    expect(isReferralConverted('business', 'active')).toBe(true)
  })

  it('does not count a lapsed merchant, who by definition never paid', () => {
    // The regression: `lapsed` is not `trial` or `free`, so the old check passed
    // it and credited the referrer for a signup that produced no revenue.
    expect(isReferralConverted(TRIAL_EXPIRED_PLAN, 'active')).toBe(false)
    expect(isReferralConverted(TRIAL_EXPIRED_PLAN, null)).toBe(false)
    expect(isReferralConverted(TRIAL_EXPIRED_PLAN, 'canceled')).toBe(false)
  })

  it('does not count a merchant who is still trialling', () => {
    // A trial sits on a real paid tier, so the plan looks like revenue while the
    // card has never been charged. Only the status can tell these apart.
    expect(isReferralConverted(TRIAL_PLAN, 'trialing')).toBe(false)
    expect(PLANS[TRIAL_PLAN].purchasable).toBe(true)
  })

  it('does not count a merchant whose payment is failing or gone', () => {
    for (const status of ['past_due', 'unpaid', 'canceled', 'incomplete', 'paused']) {
      expect(isReferralConverted('pro', status), `status ${status}`).toBe(false)
    }
  })

  it('rejects the legacy and unknown plan values outright', () => {
    // `trial` and `free` are pre-migration-15 stored values, not tiers anyone can
    // buy. They must never convert regardless of what the status column says.
    for (const legacy of ['trial', 'free', 'enterprise', '', null, undefined, 7]) {
      expect(isReferralConverted(legacy, 'active'), `plan ${String(legacy)}`).toBe(false)
    }
  })

  it('requires an active status for every plan in the catalogue', () => {
    // Guards the rule against a future tier being added and silently converting
    // on a non-paying status.
    for (const plan of PLAN_IDS) {
      expect(isReferralConverted(plan, 'trialing'), `${plan} while trialling`).toBe(false)
      expect(isReferralConverted(plan, null), `${plan} with no status`).toBe(false)
    }
  })
})
