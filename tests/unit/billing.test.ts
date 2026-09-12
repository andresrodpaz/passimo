import { describe, expect, it } from 'vitest'
import {
  ENTRY_PLAN,
  FEATURES,
  FEATURE_LABEL_KEYS,
  LIMIT_LABEL_KEYS,
  PLANS,
  PLAN_IDS,
  PLAN_ORDER,
  PUBLIC_PLANS,
  RECOMMENDED_PLAN,
  TRIAL_EXPIRED_PLAN,
  TRIAL_PLAN,
  USAGE_METRICS,
  annualSaving,
  annualSavingPercent,
  isPlanId,
  isPurchasablePlan,
  isUpgrade,
  lowestPlanWith,
  lowestPlanWithLimit,
  nextPlanAfter,
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
    /*
     * The core loyalty product is on the entry tier. These six assertions are the
     * commercial promise of Starter written as a test: a $29 café can brand its
     * card, run campaigns, leave automations on, segment its list and use the AI
     * — and if a future edit moves any of them up a tier, this fails rather than
     * the pricing page quietly starting to lie.
     */
    expect(lowestPlanWith('wallet_proximity')?.id).toBe('starter')
    expect(lowestPlanWith('custom_branding')?.id).toBe('starter')
    expect(lowestPlanWith('campaigns')?.id).toBe('starter')
    expect(lowestPlanWith('automations')?.id).toBe('starter')
    expect(lowestPlanWith('segments')?.id).toBe('starter')
    expect(lowestPlanWith('ai')?.id).toBe('starter')

    // Scale and advanced capability are what the higher tiers sell.
    expect(lowestPlanWith('geofencing')?.id).toBe('growth')
    expect(lowestPlanWith('multi_location')?.id).toBe('growth')
    expect(lowestPlanWith('gift_cards')?.id).toBe('growth')
    expect(lowestPlanWith('advanced_analytics')?.id).toBe('growth')
    expect(lowestPlanWith('memberships')?.id).toBe('pro')
    expect(lowestPlanWith('coalition')?.id).toBe('pro')
    expect(lowestPlanWith('priority_support')?.id).toBe('pro')
  })

  it('resolves the cheapest plan that clears a required limit', () => {
    expect(lowestPlanWithLimit('customers', 100)?.id).toBe('starter')
    expect(lowestPlanWithLimit('customers', 900)?.id).toBe('growth')
    expect(lowestPlanWithLimit('customers', 10_000)?.id).toBe('pro')
    expect(lowestPlanWithLimit('locations', 1)?.id).toBe('starter')
    expect(lowestPlanWithLimit('locations', 2)?.id).toBe('growth')
    expect(lowestPlanWithLimit('locations', 4)?.id).toBe('pro')
  })

  it('returns null rather than a plan when nothing can clear the amount', () => {
    /*
     * No tier is unlimited on customers any more, so a request beyond Pro's cap
     * has no remedy to offer. Null is the honest answer, and the one the paywall
     * renders as "get in touch" instead of pointing at a plan that would refuse
     * the same call.
     */
    expect(lowestPlanWithLimit('customers', 10_000_000)).toBeNull()
    expect(lowestPlanWithLimit('locations', 500)).toBeNull()
  })

  it('walks up the ladder and stops at the top', () => {
    expect(nextPlanAfter('lapsed')?.id).toBe('starter')
    expect(nextPlanAfter('starter')?.id).toBe('growth')
    expect(nextPlanAfter('growth')?.id).toBe('pro')
    expect(nextPlanAfter('pro')).toBeNull()
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
    /*
     * Three generations of catalogue. `free` predates the paid-only ladder;
     * `enterprise` was renamed to `business`; `business` was the fourth tier at
     * $99 before the three-plan catalogue put Pro at that price. Migration
     * 000024 rewrites the rows, but the resolver has to read every old value
     * correctly during the window before it runs.
     */
    expect(normalizePlanId('free')).toBe('lapsed')
    expect(normalizePlanId('enterprise')).toBe('pro')
    expect(normalizePlanId('business')).toBe('pro')
    expect(normalizePlanId('pro')).toBe('pro')
    expect(normalizePlanId('platinum')).toBeNull()
  })

  it('never remaps a legacy tier onto a cheaper price than it was paying', () => {
    // `business` was $99. Landing it anywhere below $99 would silently hand a
    // paying merchant a discount, or worse, take features away at the same price.
    expect(PLANS[normalizePlanId('business')!].monthlyPrice).toBe(99)
    expect(PLANS[normalizePlanId('enterprise')!].monthlyPrice).toBe(99)
  })

  it('reads the price for an interval', () => {
    expect(priceFor(PLANS.growth, 'month')).toBe(59)
    expect(priceFor(PLANS.growth, 'year')).toBe(590)
    expect(priceFor(PLANS.lapsed, 'month')).toBeNull()
  })

  it('sells exactly three tiers at $29, $59 and $99', () => {
    // The published prices, asserted rather than assumed. Every user-facing
    // surface — pricing page, billing screen, onboarding, structured data,
    // paywalls — renders these numbers from this catalogue, so this one test is
    // what stops any of them drifting.
    expect(PUBLIC_PLANS.map((plan) => plan.id)).toEqual(['starter', 'growth', 'pro'])
    expect(PUBLIC_PLANS.map((plan) => plan.monthlyPrice)).toEqual([29, 59, 99])
  })

  it('sells no free tier and no permanent zero-price plan', () => {
    // A loyalty program that costs nothing never gets set up. Every purchasable
    // tier must cost real money, and the entry point is the price quoted on the
    // marketing page.
    for (const plan of PUBLIC_PLANS) {
      expect(plan.monthlyPrice, `${plan.name} must have a price`).not.toBeNull()
      expect(plan.monthlyPrice!, `${plan.name} must not be free`).toBeGreaterThan(0)
      expect(plan.annualPrice!, `${plan.name} must not be free yearly`).toBeGreaterThan(0)
    }
    // `free` is not a plan id, and nothing in the catalogue is named for one.
    expect(isPlanId('free')).toBe(false)
    expect(PLAN_IDS).not.toContain('free')
    expect(ENTRY_PLAN.id).toBe('starter')
    expect(ENTRY_PLAN.monthlyPrice).toBe(29)
  })

  it('discounts the year by two months on every tier', () => {
    for (const plan of PUBLIC_PLANS) {
      expect(plan.annualPrice, `${plan.name} annual is not ten months`).toBe(
        plan.monthlyPrice! * 10
      )
      // The badge on the pricing page renders this number, so it has to be the
      // same on every card or the copy reads as a per-plan promotion.
      expect(annualSavingPercent(plan)).toBe(17)
    }
  })

  it('recommends Growth, and recommends a plan somebody can buy', () => {
    expect(RECOMMENDED_PLAN.id).toBe('growth')
    expect(RECOMMENDED_PLAN.purchasable).toBe(true)
    // Exactly one "most popular" badge, or the pricing page grows two.
    expect(PUBLIC_PLANS.filter((plan) => plan.popular)).toHaveLength(1)
  })

  it('trials a real paid tier rather than an imaginary free one', () => {
    // A trial is temporary access to a plan we sell, not a fourth product.
    expect(isPurchasablePlan(TRIAL_PLAN)).toBe(true)
    expect(PLANS[TRIAL_PLAN].monthlyPrice).toBeGreaterThan(0)
    // And it lands somewhere with nothing switched on, never on a working tier.
    expect(PLANS[TRIAL_EXPIRED_PLAN].purchasable).toBe(false)
    expect(PLANS[TRIAL_EXPIRED_PLAN].features).toHaveLength(0)
  })

  it('caps every resource that costs us money to serve', () => {
    /*
     * Unit economics as an invariant. `null` on a metered resource is a promise
     * of unlimited inference or unlimited SMS against a $99 subscription, which
     * is how a SaaS acquires a customer it loses money on every month. Countable
     * resources (customers, locations, seats) are nearly free to serve and are
     * deliberately not in this list.
     */
    const METERED: LimitKey[] = [
      'messages_per_month',
      'ai_actions_per_month',
      'proximity_campaigns',
    ]
    for (const plan of PUBLIC_PLANS) {
      for (const key of METERED) {
        expect(plan.limits[key], `${plan.name}.${key} must be capped`).not.toBeNull()
      }
    }
  })

  it('never sets a cap a feature gate makes unreachable, or vice versa', () => {
    /*
     * The subtle failure this exists to prevent, in both directions.
     *
     * A plan that grants a feature but caps it at zero shows the merchant a
     * working screen and then refuses the click with a quota error. A plan that
     * caps a feature it does not grant is the mirror image, and it actually
     * shipped: Starter once had `proximity_campaigns: 2` without the feature, so
     * the billing meter read "Proximity campaigns 0 / 2" beside a screen
     * answering "available from Growth" — two surfaces, two answers, and the
     * encouraging one was the wrong one.
     *
     * It also fixes what `lowestPlanWithLimit` reports. Asked for a plan allowing
     * one proximity campaign it must return the cheapest plan that can actually
     * run one, and a phantom cap of 2 on Starter made it answer Starter.
     */
    const GATED: Array<{ limit: LimitKey; feature: Feature }> = [
      { limit: 'campaigns_per_month', feature: 'campaigns' },
      { limit: 'ai_actions_per_month', feature: 'ai' },
      { limit: 'proximity_campaigns', feature: 'proximity_campaigns' },
      { limit: 'automation_rules', feature: 'automation_rules' },
    ]

    for (const plan of PUBLIC_PLANS) {
      for (const { limit, feature } of GATED) {
        const allowance = plan.limits[limit]
        const granted = plan.features.includes(feature)
        if (granted) {
          expect(
            allowance === null || allowance > 0,
            `${plan.name} grants "${feature}" but caps ${limit} at ${allowance}`
          ).toBe(true)
        } else {
          expect(
            allowance,
            `${plan.name} caps ${limit} at ${allowance} without granting "${feature}"`
          ).toBe(0)
        }
      }
    }
  })

  it('gives the entry tier a usable allowance of everything it includes', () => {
    /*
     * Starter's commercial promise, as numbers rather than as copy. A café must be
     * able to brand a card, campaign to its list, keep automations running,
     * segment, and use the AI — with an allowance large enough that none of it is
     * a teaser.
     */
    const starter = PLANS.starter
    expect(starter.features).toContain('campaigns')
    expect(starter.limits.campaigns_per_month).toBeGreaterThanOrEqual(10)
    expect(starter.features).toContain('ai')
    expect(starter.limits.ai_actions_per_month).toBeGreaterThanOrEqual(25)
    expect(starter.features).toContain('automations')
    expect(starter.features).toContain('segments')
    // Enough to email a full 500-customer list several times a month.
    expect(starter.limits.messages_per_month).toBeGreaterThanOrEqual(
      starter.limits.customers! * 2
    )
    // One location and more than one person behind the counter.
    expect(starter.limits.locations).toBe(1)
    expect(starter.limits.team_members).toBeGreaterThan(1)
  })

  it('keeps the whole wallet experience on the entry tier', () => {
    /*
     * The wallet card *is* the product, so gating it would make Starter a demo
     * rather than a plan. `custom_branding` covers the brand kit and the card
     * designer — logo, colours, templates, what the card shows — and
     * `wallet_proximity` is the pass surfacing on the lock screen near the shop.
     *
     * What Growth adds is control rather than access: geofences the merchant
     * defines and pushes they schedule.
     */
    expect(PLANS.starter.features).toContain('custom_branding')
    expect(PLANS.starter.features).toContain('wallet_proximity')
    expect(PLANS.starter.features).not.toContain('geofencing')
    expect(PLANS.growth.features).toContain('geofencing')
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
    // The trial runs on Growth, so a trialling merchant has geofencing but not
    // memberships. Asserted because the copy on three screens says exactly this.
    expect(result.features.has('geofencing')).toBe(true)
    expect(result.features.has('memberships')).toBe(false)
    expect(result.lapsed).toBe(false)
    expect(result.trial.daysRemaining).toBe(10)
  })

  it('leaves an expired trial holding a paid tier alone', () => {
    /*
     * `trial_ends_at` in the past on a `growth` row is the normal state of every
     * merchant who converted: Stripe clears the trial date on activation, but a
     * webhook can arrive out of order. The stored tier has to win, or a paying
     * customer is lapsed by a stale timestamp.
     */
    const result = resolveEntitlements(
      'biz-1',
      row({ plan: 'growth', subscription_status: 'active', trial_ends_at: past }),
      now
    )
    expect(result.effectivePlan).toBe('growth')
    expect(result.lapsed).toBe(false)
    expect(result.trial.active).toBe(false)
  })

  it('drops an expired trial to the inactive state without deleting anything', () => {
    const result = resolveEntitlements('biz-1', row({ trial_ends_at: past }), now)
    expect(result.trial.active).toBe(false)
    expect(result.effectivePlan).toBe(TRIAL_EXPIRED_PLAN)
    expect(result.lapsed).toBe(true)
    expect(result.features.has('ai')).toBe(false)
    // An expired trial is not a free plan. Nothing is granted, and every
    // countable allowance is zero, so every write is refused with one remedy.
    expect(result.features.size).toBe(0)
    expect(result.limits.customers).toBe(0)
    expect(result.limits.campaigns_per_month).toBe(0)
  })

  it('reads a legacy `free` row as inactive rather than as an unknown plan', () => {
    const result = resolveEntitlements('biz-1', row({ plan: 'free', trial_ends_at: past }), now)
    expect(result.effectivePlan).toBe('lapsed')
    expect(result.lapsed).toBe(true)
  })

  it('reads legacy `enterprise` and `business` rows as the top paid tier', () => {
    for (const stored of ['enterprise', 'business']) {
      const result = resolveEntitlements(
        'biz-1',
        row({ plan: stored, subscription_status: 'active', trial_ends_at: past }),
        now
      )
      expect(result.effectivePlan, `${stored} should resolve to pro`).toBe('pro')
      expect(result.lapsed).toBe(false)
      // Still paying $99, still has everything the old top tier could do.
      expect(result.features.has('coalition')).toBe(true)
      expect(result.features.has('memberships')).toBe(true)
    }
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

  it('gives Pro every feature, so the top tier is never a downgrade', () => {
    for (const feature of FEATURES as readonly Feature[]) {
      expect(PLANS.pro.features.includes(feature), `Pro is missing "${feature}"`).toBe(true)
    }
  })

  it('sells nothing it has not built', () => {
    /*
     * The catalogue used to advertise `sso`, `api_access`, `webhooks` and
     * `team_management` on the top tier. None of the four existed anywhere in the
     * codebase — no route checked them, no screen unlocked behind them — so a
     * merchant could pay $99 for four things that were never going to arrive.
     *
     * This guards the general case rather than those four names: a feature that
     * no purchasable plan sells is dead config, and a feature nobody enforces is
     * worse, so the audit in PRICING_AUDIT.md records the call site for each.
     */
    for (const feature of FEATURES as readonly Feature[]) {
      expect(lowestPlanWith(feature), `"${feature}" is sold by no plan`).not.toBeNull()
    }
    for (const removed of ['sso', 'api_access', 'webhooks', 'team_management']) {
      expect(FEATURES as readonly string[]).not.toContain(removed)
    }
  })

  it('maps every metered usage metric to a real limit', () => {
    for (const limitKey of Object.values(USAGE_METRICS)) {
      expect(LIMIT_KEYS.includes(limitKey)).toBe(true)
    }
  })
})
