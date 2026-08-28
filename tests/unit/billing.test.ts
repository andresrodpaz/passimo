import { describe, expect, it } from 'vitest'
import {
  ENTRY_PLAN,
  FEATURES,
  FEATURE_LABEL_KEYS,
  LIMIT_LABEL_KEYS,
  PLANS,
  PLAN_ORDER,
  PUBLIC_PLANS,
  TRIAL_EXPIRED_PLAN,
  TRIAL_PLAN,
  USAGE_METRICS,
  annualSaving,
  isPlanId,
  isPurchasablePlan,
  isUpgrade,
  lowestPlanWith,
  lowestPlanWithLimit,
  normalizePlanId,
  planRank,
  priceFor,
  type Feature,
  type LimitKey,
} from '@/lib/billing/plans'
import { resolveEntitlements } from '@/lib/billing/entitlements'

/**
 * The plan catalogue decides what a merchant is allowed to do and what we are
 * paid for it. A mistake here either gives away a paid feature or blocks
 * someone who paid, so the invariants are asserted rather than assumed.
 */

const LIMIT_KEYS: LimitKey[] = [
  'customers',
  'locations',
  'team_members',
  'messages_per_month',
  'ai_actions_per_month',
  'campaigns_per_month',
  'proximity_campaigns',
  'automation_rules',
]

describe('plan catalogue', () => {
  it('never removes a feature as the plan gets more expensive', () => {
    // A merchant who upgrades must never lose something they had. This is the
    // single easiest mistake to make when editing the catalogue by hand.
    for (let index = 1; index < PLAN_ORDER.length; index += 1) {
      const lower = PLANS[PLAN_ORDER[index - 1]!]
      const higher = PLANS[PLAN_ORDER[index]!]
      for (const feature of lower.features) {
        expect(
          higher.features.includes(feature),
          `${higher.name} is missing "${feature}", which ${lower.name} includes`
        ).toBe(true)
      }
    }
  })

  it('never lowers a limit as the plan gets more expensive', () => {
    for (let index = 1; index < PLAN_ORDER.length; index += 1) {
      const lower = PLANS[PLAN_ORDER[index - 1]!]
      const higher = PLANS[PLAN_ORDER[index]!]
      for (const key of LIMIT_KEYS) {
        const lowerLimit = lower.limits[key]
        const higherLimit = higher.limits[key]
        if (higherLimit === null) continue // unlimited beats everything
        expect(
          lowerLimit !== null && higherLimit >= lowerLimit,
          `${higher.name}.${key} (${higherLimit}) is below ${lower.name} (${lowerLimit})`
        ).toBe(true)
      }
    }
  })

  it('prices rise monotonically and annual is never worse than monthly', () => {
    let previous = -1
    for (const id of PLAN_ORDER) {
      const plan = PLANS[id]
      if (plan.monthlyPrice === null) continue
      expect(plan.monthlyPrice).toBeGreaterThanOrEqual(previous)
      previous = plan.monthlyPrice
      expect(annualSaving(plan)).toBeGreaterThanOrEqual(0)
    }
  })

  it('offers every feature on at least one purchasable plan', () => {
    // A feature no plan sells is a feature nobody can ever switch on.
    for (const feature of FEATURES) {
      expect(lowestPlanWith(feature), `no plan includes "${feature}"`).not.toBeNull()
    }
  })

  it('resolves the cheapest plan that unlocks a feature', () => {
    expect(lowestPlanWith('wallet_proximity')?.id).toBe('starter')
    expect(lowestPlanWith('geofencing')?.id).toBe('growth')
    expect(lowestPlanWith('gift_cards')?.id).toBe('growth')
    expect(lowestPlanWith('ai')?.id).toBe('pro')
    expect(lowestPlanWith('coalition')?.id).toBe('business')
    expect(lowestPlanWith('sso')?.id).toBe('business')
  })

  it('resolves the cheapest plan that clears a required limit', () => {
    expect(lowestPlanWithLimit('customers', 100)?.id).toBe('starter')
    expect(lowestPlanWithLimit('customers', 900)?.id).toBe('growth')
    expect(lowestPlanWithLimit('customers', 10_000)?.id).toBe('pro')
    // Beyond every numeric cap, only the unlimited tier qualifies.
    expect(lowestPlanWithLimit('customers', 10_000_000)?.id).toBe('business')
  })

  it('never suggests the inactive tier as a remedy', () => {
    // `lapsed` is a state, not a product. Offering it as the upgrade path would
    // send a blocked merchant to a plan that unblocks nothing.
    for (const feature of FEATURES) {
      expect(lowestPlanWith(feature)?.id).not.toBe('lapsed')
    }
    expect(lowestPlanWithLimit('customers', 1)?.id).not.toBe('lapsed')
  })

  it('ranks and compares plans', () => {
    expect(planRank('lapsed')).toBeLessThan(planRank('pro'))
    expect(isUpgrade('lapsed', 'growth')).toBe(true)
    expect(isUpgrade('pro', 'starter')).toBe(false)
    expect(isUpgrade('growth', 'growth')).toBe(false)
  })

  it('validates plan identifiers', () => {
    expect(isPlanId('growth')).toBe(true)
    expect(isPlanId('platinum')).toBe(false)
    expect(isPlanId(null)).toBe(false)
  })

  it('refuses to let the inactive tier be checked out', () => {
    expect(isPurchasablePlan('starter')).toBe(true)
    expect(isPurchasablePlan('lapsed')).toBe(false)
    expect(isPurchasablePlan('free')).toBe(false)
  })

  it('maps legacy plan identifiers so a deploy cannot gate a paying customer', () => {
    // Rows written before the paid-only catalogue still say `free`/`enterprise`.
    // Migration 15 rewrites them, but the resolver has to read the old values
    // correctly during the deploy window.
    expect(normalizePlanId('free')).toBe('lapsed')
    expect(normalizePlanId('enterprise')).toBe('business')
    expect(normalizePlanId('pro')).toBe('pro')
    expect(normalizePlanId('platinum')).toBeNull()
  })

  it('reads the price for an interval', () => {
    expect(priceFor(PLANS.growth, 'month')).toBe(19)
    expect(priceFor(PLANS.growth, 'year')).toBe(190)
    expect(priceFor(PLANS.lapsed, 'month')).toBeNull()
  })

  it('sells no free tier, and starts at $5', () => {
    // A loyalty program that costs nothing never gets set up. Every purchasable
    // tier must cost real money, and the entry point is the price quoted on the
    // marketing page.
    for (const plan of PUBLIC_PLANS) {
      expect(plan.monthlyPrice, `${plan.name} must have a price`).not.toBeNull()
      expect(plan.monthlyPrice!, `${plan.name} must not be free`).toBeGreaterThan(0)
    }
    expect(ENTRY_PLAN.id).toBe('starter')
    expect(ENTRY_PLAN.monthlyPrice).toBe(5)
  })

  it('hides the inactive tier from the pricing page', () => {
    expect(PUBLIC_PLANS.some((plan) => plan.id === 'lapsed')).toBe(false)
    expect(PLANS.lapsed.purchasable).toBe(false)
  })

  it('gives the inactive tier no features, so every write is refused', () => {
    // Reads are never gated, so a lapsed merchant keeps their data; writes all
    // route through a feature or limit check, and both must fail.
    expect(PLANS.lapsed.features).toHaveLength(0)
    expect(PLANS.lapsed.limits.customers).toBe(0)
  })
})

describe('resolveEntitlements', () => {
  const now = new Date('2026-06-15T12:00:00Z')
  const future = new Date('2026-06-25T12:00:00Z').toISOString()
  const past = new Date('2026-06-01T12:00:00Z').toISOString()

  function row(overrides: Record<string, unknown> = {}) {
    return {
      id: 'biz-1',
      plan: 'trial',
      plan_interval: 'month',
      trial_ends_at: future,
      subscription_status: null,
      subscription_current_period_end: null,
      cancel_at_period_end: false,
      stripe_subscription_id: null,
      referral_credit: 0,
      ...overrides,
    } as never
  }

  it('gives a live trial the full trial plan', () => {
    const result = resolveEntitlements('biz-1', row(), now)
    expect(result.trial.active).toBe(true)
    expect(result.effectivePlan).toBe(TRIAL_PLAN)
    expect(result.features.has('ai')).toBe(true)
    expect(result.lapsed).toBe(false)
    expect(result.trial.daysRemaining).toBe(10)
  })

  it('drops an expired trial to the inactive state without deleting anything', () => {
    const result = resolveEntitlements('biz-1', row({ trial_ends_at: past }), now)
    expect(result.trial.active).toBe(false)
    expect(result.effectivePlan).toBe(TRIAL_EXPIRED_PLAN)
    expect(result.lapsed).toBe(true)
    expect(result.features.has('ai')).toBe(false)
  })

  it('reads a legacy `free` row as inactive rather than as an unknown plan', () => {
    const result = resolveEntitlements('biz-1', row({ plan: 'free', trial_ends_at: past }), now)
    expect(result.effectivePlan).toBe('lapsed')
    expect(result.lapsed).toBe(true)
  })

  it('reads a legacy `enterprise` row as the top paid tier', () => {
    const result = resolveEntitlements(
      'biz-1',
      row({ plan: 'enterprise', subscription_status: 'active', trial_ends_at: past }),
      now
    )
    expect(result.effectivePlan).toBe('business')
    expect(result.lapsed).toBe(false)
    expect(result.features.has('sso')).toBe(true)
  })

  it('honours a paid plan and ignores any leftover trial date', () => {
    const result = resolveEntitlements(
      'biz-1',
      row({ plan: 'pro', subscription_status: 'active', trial_ends_at: future }),
      now
    )
    // A trial date in the future must not downgrade someone who is paying more.
    expect(result.effectivePlan).toBe('pro')
    expect(result.features.has('ai')).toBe(true)
    expect(result.lapsed).toBe(false)
  })

  it('keeps a delinquent subscriber on their plan during the grace period', () => {
    // Losing access the hour a bank declines a card is how a customer is lost
    // over a fraud check. Stripe manages dunning; we keep the lights on.
    const result = resolveEntitlements(
      'biz-1',
      row({ plan: 'growth', subscription_status: 'past_due', trial_ends_at: past }),
      now
    )
    expect(result.subscription.delinquent).toBe(true)
    expect(result.effectivePlan).toBe('growth')
    expect(result.features.has('geofencing')).toBe(true)
  })

  it('treats an unknown or missing plan as inactive rather than throwing', () => {
    expect(resolveEntitlements('biz-1', null, now).effectivePlan).toBe(TRIAL_EXPIRED_PLAN)
    expect(
      resolveEntitlements('biz-1', row({ plan: 'platinum', trial_ends_at: past }), now)
        .effectivePlan
    ).toBe(TRIAL_EXPIRED_PLAN)
  })

  it('reports cancellation and interval state for the banner', () => {
    const result = resolveEntitlements(
      'biz-1',
      row({
        plan: 'starter',
        plan_interval: 'year',
        subscription_status: 'active',
        cancel_at_period_end: true,
        subscription_current_period_end: future,
        trial_ends_at: past,
      }),
      now
    )
    expect(result.subscription.cancelAtPeriodEnd).toBe(true)
    expect(result.subscription.interval).toBe('year')
    expect(result.subscription.currentPeriodEnd).toBe(future)
  })

  it('parses referral credit arriving as a numeric string from PostgREST', () => {
    const result = resolveEntitlements('biz-1', row({ referral_credit: '150.00' }), now)
    expect(result.referralCredit).toBe(150)
  })

  it('never reports negative days remaining', () => {
    const result = resolveEntitlements('biz-1', row({ trial_ends_at: past }), now)
    expect(result.trial.daysRemaining).toBe(0)
  })
})

describe('presentation metadata', () => {
  it('points every plan at real dictionary copy rather than at English prose', () => {
    // The catalogue holds the *shape* of a tier; the words live in the
    // dictionary. If a tier ever carried a literal sentence again, the Spanish
    // pricing page would silently render it in English — which is the exact
    // failure the i18n contract exists to make impossible.
    for (const id of PLAN_ORDER) {
      const plan = PLANS[id]
      expect(plan.taglineKey, `${plan.name} has no tagline key`).toMatch(/^plans\./)
      for (const key of plan.highlightKeys) {
        expect(key, `${plan.name} highlight is not a key: ${key}`).toMatch(/^plans\./)
      }
    }
  })

  it('labels every feature and limit, so no paywall renders a raw enum', () => {
    for (const feature of FEATURES as readonly Feature[]) {
      expect(FEATURE_LABEL_KEYS[feature], `"${feature}" has no label key`).toBeTruthy()
    }
    for (const key of LIMIT_KEYS) {
      expect(LIMIT_LABEL_KEYS[key], `"${key}" has no label key`).toBeTruthy()
    }
  })

  it('gives Business every feature, so the top tier is never a downgrade', () => {
    for (const feature of FEATURES as readonly Feature[]) {
      expect(PLANS.business.features.includes(feature)).toBe(true)
    }
  })

  it('maps every metered usage metric to a real limit', () => {
    for (const limitKey of Object.values(USAGE_METRICS)) {
      expect(LIMIT_KEYS.includes(limitKey)).toBe(true)
    }
  })
})
