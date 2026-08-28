import { describe, expect, it } from 'vitest'
import {
  applyDailyCap,
  baseAward,
  cashbackAward,
  evaluateProgram,
  localTimeParts,
  ruleSkipReason,
  type EarnContext,
} from '@/lib/loyalty/rules'
import type { EarningRule, LoyaltyProgram, ProgramTier } from '@/lib/domain/types'

/**
 * The loyalty rules engine decides how much value a customer receives. A bug
 * here either gives away margin or silently under-rewards a regular, so these
 * cases cover every branch that changes the number.
 */

const program: LoyaltyProgram = {
  id: 'prog-1',
  businessId: 'biz-1',
  name: 'Stamp card',
  type: 'stamps',
  isActive: true,
  isDefault: true,
  unitSingular: 'stamp',
  unitPlural: 'stamps',
  description: null,
  goalAmount: 10,
  rewardDescription: 'Free coffee',
  resetOnReward: true,
  cashbackPercent: null,
  pointValue: null,
  expiryMonths: null,
  expiryWarningDays: 14,
  earnCooldownMinutes: 0,
  maxEarnPerDay: null,
  tierEnabled: false,
  tierMetric: 'lifetime_earned',
  tierWindowDays: null,
}

function makeRule(overrides: Partial<EarningRule> = {}): EarningRule {
  return {
    id: 'rule-1',
    businessId: 'biz-1',
    programId: 'prog-1',
    name: 'Stamp per visit',
    isActive: true,
    priority: 100,
    stackable: false,
    trigger: 'visit',
    awardType: 'fixed',
    awardAmount: 1,
    perAmount: 1,
    maxAward: null,
    minPurchase: null,
    milestoneThreshold: null,
    daysOfWeek: null,
    timeFrom: null,
    timeTo: null,
    startsAt: null,
    endsAt: null,
    locationIds: null,
    tierIds: null,
    segmentId: null,
    cooldownMinutes: 0,
    usageLimitPerCustomer: null,
    totalUsageLimit: null,
    usageCount: 0,
    ...overrides,
  }
}

function makeContext(overrides: Partial<EarnContext> = {}): EarnContext {
  return {
    trigger: 'visit',
    amount: null,
    quantity: null,
    locationId: null,
    now: new Date('2026-03-10T12:00:00Z'), // a Tuesday
    localWeekday: 2,
    localTime: '12:00:00',
    tierMultiplier: 1,
    membershipMultiplier: 1,
    customer: {
      id: 'cust-1',
      tierIdByProgram: {},
      lifetimeEarnedByProgram: {},
      segmentIds: [],
      ruleUsage: {},
      ruleLastUsedAt: {},
    },
    ...overrides,
  }
}

describe('baseAward', () => {
  it('awards a flat amount for fixed rules', () => {
    expect(baseAward(makeRule({ awardAmount: 3 }), makeContext())).toBe(3)
  })

  it('awards per unit of currency, rounding down partial units', () => {
    const rule = makeRule({ awardType: 'per_currency', awardAmount: 1, perAmount: 5 })
    // €12 at 1 point per €5 is 2 points, not 2.4 — merchants must never owe
    // fractional stamps.
    expect(baseAward(rule, makeContext({ amount: 12 }))).toBe(2)
  })

  it('awards per item', () => {
    const rule = makeRule({ awardType: 'per_item', awardAmount: 2, perAmount: 1 })
    expect(baseAward(rule, makeContext({ quantity: 3 }))).toBe(6)
  })

  it('awards a percentage of the ticket', () => {
    const rule = makeRule({ awardType: 'percent', awardAmount: 10 })
    expect(baseAward(rule, makeContext({ amount: 25 }))).toBe(2.5)
  })

  it('awards nothing when there is no spend to base it on', () => {
    const rule = makeRule({ awardType: 'per_currency', awardAmount: 1, perAmount: 5 })
    expect(baseAward(rule, makeContext({ amount: 0 }))).toBe(0)
    expect(baseAward(rule, makeContext({ amount: null }))).toBe(0)
  })
})

describe('ruleSkipReason', () => {
  it('accepts a matching rule', () => {
    expect(ruleSkipReason(makeRule(), makeContext())).toBeNull()
  })

  it('rejects an inactive rule', () => {
    expect(ruleSkipReason(makeRule({ isActive: false }), makeContext())).toBe('inactive')
  })

  it('rejects a different trigger', () => {
    expect(ruleSkipReason(makeRule({ trigger: 'birthday' }), makeContext())).toBe(
      'trigger_mismatch'
    )
  })

  /*
   * The regression this group exists for: the counter sends `purchase` instead of
   * `visit` the moment a cashier types a ticket amount. With an exact trigger
   * match, the default stamp card — whose only rule is "Stamp per visit" — awarded
   * nothing on those scans. The merchant was doing more work and their customers
   * were earning less, with no error to explain it.
   */
  it('fires a visit rule on a purchase, because a purchase is a visit with a receipt', () => {
    expect(
      ruleSkipReason(makeRule({ trigger: 'visit' }), makeContext({ trigger: 'purchase' }))
    ).toBeNull()
  })

  it('does not fire a purchase rule on a bare visit', () => {
    // Choosing `purchase` is how a merchant says "only when they buy something".
    expect(
      ruleSkipReason(makeRule({ trigger: 'purchase' }), makeContext({ trigger: 'visit' }))
    ).toBe('trigger_mismatch')
  })

  it('does not widen any other trigger', () => {
    for (const trigger of ['signup', 'birthday', 'referral'] as const) {
      expect(ruleSkipReason(makeRule({ trigger }), makeContext({ trigger: 'purchase' }))).toBe(
        'trigger_mismatch'
      )
    }
  })

  it('awards a purchase exactly once when both rule kinds exist', () => {
    // Both match a purchase, both are non-stackable, so precedence decides —
    // the widening must not turn one scan into two awards.
    const result = evaluateProgram(
      program,
      [
        makeRule({ id: 'per-euro', name: 'Point per euro', trigger: 'purchase', priority: 10 }),
        makeRule({ id: 'per-visit', name: 'Stamp per visit', trigger: 'visit', priority: 100 }),
      ],
      makeContext({ trigger: 'purchase', amount: 10 })
    )

    expect(result.awards).toHaveLength(1)
    expect(result.awards[0]!.ruleId).toBe('per-euro')
    expect(result.skipped.map((skip) => skip.reason)).toContain('superseded_by_higher_priority')
  })

  it('honours day-of-week windows', () => {
    const tuesdayOnly = makeRule({ daysOfWeek: [2] })
    expect(ruleSkipReason(tuesdayOnly, makeContext({ localWeekday: 2 }))).toBeNull()
    expect(ruleSkipReason(tuesdayOnly, makeContext({ localWeekday: 3 }))).toBe(
      'outside_day_of_week'
    )
  })

  it('handles a time window that wraps past midnight', () => {
    const lateNight = makeRule({ timeFrom: '22:00:00', timeTo: '02:00:00' })
    expect(ruleSkipReason(lateNight, makeContext({ localTime: '23:30:00' }))).toBeNull()
    expect(ruleSkipReason(lateNight, makeContext({ localTime: '01:00:00' }))).toBeNull()
    expect(ruleSkipReason(lateNight, makeContext({ localTime: '12:00:00' }))).toBe(
      'outside_time_window'
    )
  })

  it('respects the campaign date window', () => {
    const expired = makeRule({ endsAt: '2026-01-01T00:00:00Z' })
    expect(ruleSkipReason(expired, makeContext())).toBe('outside_date_window')

    const future = makeRule({ startsAt: '2027-01-01T00:00:00Z' })
    expect(ruleSkipReason(future, makeContext())).toBe('outside_date_window')
  })

  it('enforces a minimum purchase', () => {
    const rule = makeRule({ minPurchase: 10 })
    expect(ruleSkipReason(rule, makeContext({ amount: 5 }))).toBe('below_minimum_purchase')
    expect(ruleSkipReason(rule, makeContext({ amount: 15 }))).toBeNull()
  })

  it('enforces the per-customer usage limit', () => {
    const rule = makeRule({ usageLimitPerCustomer: 2 })
    const context = makeContext()
    context.customer.ruleUsage = { 'rule-1': 2 }
    expect(ruleSkipReason(rule, context)).toBe('per_customer_limit_reached')
  })

  it('enforces the global usage limit', () => {
    const rule = makeRule({ totalUsageLimit: 100, usageCount: 100 })
    expect(ruleSkipReason(rule, makeContext())).toBe('total_usage_limit_reached')
  })

  it('blocks a repeat earn inside the cooldown and allows it after', () => {
    const rule = makeRule({ cooldownMinutes: 60 })
    const now = new Date('2026-03-10T12:00:00Z')

    const tooSoon = makeContext({ now })
    tooSoon.customer.ruleLastUsedAt = { 'rule-1': '2026-03-10T11:30:00Z' }
    expect(ruleSkipReason(rule, tooSoon)).toBe('cooldown_active')

    const elapsed = makeContext({ now })
    elapsed.customer.ruleLastUsedAt = { 'rule-1': '2026-03-10T10:30:00Z' }
    expect(ruleSkipReason(rule, elapsed)).toBeNull()
  })

  it('requires the milestone threshold to be reached', () => {
    const rule = makeRule({ trigger: 'milestone', milestoneThreshold: 50 })
    const context = makeContext({ trigger: 'milestone' })

    context.customer.lifetimeEarnedByProgram = { 'prog-1': 20 }
    expect(ruleSkipReason(rule, context)).toBe('milestone_not_reached')

    context.customer.lifetimeEarnedByProgram = { 'prog-1': 60 }
    expect(ruleSkipReason(rule, context)).toBeNull()
  })

  it('restricts by location', () => {
    const rule = makeRule({ locationIds: ['loc-1'] })
    expect(ruleSkipReason(rule, makeContext({ locationId: 'loc-2' }))).toBe(
      'location_not_eligible'
    )
    expect(ruleSkipReason(rule, makeContext({ locationId: 'loc-1' }))).toBeNull()
  })
})

describe('evaluateProgram', () => {
  it('applies only the highest-priority non-stackable rule', () => {
    const result = evaluateProgram(
      program,
      [
        makeRule({ id: 'a', name: 'Base', priority: 100, awardAmount: 1 }),
        makeRule({ id: 'b', name: 'Other base', priority: 200, awardAmount: 5 }),
      ],
      makeContext()
    )

    expect(result.awards).toHaveLength(1)
    expect(result.awards[0]!.amount).toBe(1)
    expect(result.skipped.map((skip) => skip.reason)).toContain(
      'superseded_by_higher_priority'
    )
  })

  it('stacks bonus rules on top of the base rule', () => {
    const result = evaluateProgram(
      program,
      [
        makeRule({ id: 'a', name: 'Base', priority: 100, awardAmount: 1 }),
        makeRule({
          id: 'b',
          name: 'Tuesday bonus',
          priority: 50,
          awardAmount: 1,
          stackable: true,
          daysOfWeek: [2],
        }),
      ],
      makeContext({ localWeekday: 2 })
    )

    expect(result.awards).toHaveLength(2)
    expect(result.awards.reduce((sum, award) => sum + award.amount, 0)).toBe(2)
  })

  it('rounds stamp awards down to whole units', () => {
    const pointsProgram = { ...program, type: 'points' as const }
    const stampsResult = evaluateProgram(
      program,
      [makeRule({ awardType: 'percent', awardAmount: 15 })],
      makeContext({ amount: 10 })
    )
    const pointsResult = evaluateProgram(
      pointsProgram,
      [makeRule({ awardType: 'percent', awardAmount: 15 })],
      makeContext({ amount: 10 })
    )

    expect(stampsResult.awards[0]!.amount).toBe(1) // floor(1.5)
    expect(pointsResult.awards[0]!.amount).toBe(1.5)
  })

  it('caps an award at maxAward', () => {
    const result = evaluateProgram(
      { ...program, type: 'points' },
      [makeRule({ awardType: 'per_currency', awardAmount: 1, perAmount: 1, maxAward: 10 })],
      makeContext({ amount: 500 })
    )
    expect(result.awards[0]!.amount).toBe(10)
  })

  it('multiplies by the customer tier', () => {
    const tiered = { ...program, tierEnabled: true, type: 'points' as const }
    const tiers: ProgramTier[] = [
      {
        id: 'tier-gold',
        programId: 'prog-1',
        name: 'Gold',
        level: 2,
        threshold: 100,
        earnMultiplier: 2,
        color: '#000',
        icon: null,
        perks: [],
        allowDowngrade: true,
      },
    ]
    const context = makeContext()
    context.customer.tierIdByProgram = { 'prog-1': 'tier-gold' }

    const result = evaluateProgram(tiered, [makeRule({ awardAmount: 3 })], context, tiers)
    expect(result.awards[0]!.amount).toBe(6)
  })

  it('ignores rules belonging to a different program', () => {
    const result = evaluateProgram(
      program,
      [makeRule({ programId: 'other-program' })],
      makeContext()
    )
    expect(result.awards).toHaveLength(0)
  })
})

describe('cashbackAward', () => {
  it('returns a percentage of the ticket for cashback programs', () => {
    const cashback = { ...program, type: 'cashback' as const, cashbackPercent: 5 }
    expect(cashbackAward(cashback, 20)).toBe(1)
  })

  it('returns zero for non-cashback programs', () => {
    expect(cashbackAward(program, 20)).toBe(0)
  })

  it('rounds to two decimal places', () => {
    const cashback = { ...program, type: 'cashback' as const, cashbackPercent: 3.33 }
    expect(cashbackAward(cashback, 10)).toBe(0.33)
  })
})

describe('applyDailyCap', () => {
  const awards = [
    { programId: 'prog-1', ruleId: 'a', ruleName: 'Base', amount: 5, reason: 'Base' },
    { programId: 'prog-1', ruleId: 'b', ruleName: 'Bonus', amount: 5, reason: 'Bonus' },
  ]

  it('passes everything through when no cap is set', () => {
    expect(applyDailyCap(awards, program, 0).awards).toHaveLength(2)
  })

  it('trims the last award to fit the remaining headroom', () => {
    const capped = applyDailyCap(awards, { ...program, maxEarnPerDay: 8 }, 0)
    expect(capped.capped).toBe(true)
    expect(capped.awards.reduce((sum, award) => sum + award.amount, 0)).toBe(8)
  })

  it('awards nothing once the cap is already reached', () => {
    const capped = applyDailyCap(awards, { ...program, maxEarnPerDay: 5 }, 5)
    expect(capped.awards).toHaveLength(0)
    expect(capped.capped).toBe(true)
  })
})

describe('localTimeParts', () => {
  it('resolves weekday and time in the business timezone', () => {
    // 23:30 UTC on a Monday is already Tuesday in Madrid (UTC+1/+2).
    const parts = localTimeParts(new Date('2026-03-09T23:30:00Z'), 'Europe/Madrid')
    expect(parts.weekday).toBe(2)
    expect(parts.time).toBe('00:30:00')
  })

  it('normalises midnight to 00 rather than 24', () => {
    const parts = localTimeParts(new Date('2026-03-10T00:00:00Z'), 'UTC')
    expect(parts.time.startsWith('00:')).toBe(true)
  })
})
