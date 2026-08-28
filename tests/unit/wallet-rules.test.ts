import { describe, expect, it } from 'vitest'
import {
  ACTION_LABELS,
  FACT_LABELS,
  OPERATOR_LABELS,
  RULE_ACTION_TYPES,
  RULE_FACTS,
  RULE_OPERATORS,
  buildFactTable,
  describeRule,
  evaluateCondition,
  evaluateConditions,
  runRules,
  validateActions,
  validateConditions,
  type ProximityRule,
  type RuleFact,
  type RuleNode,
} from '@/lib/wallet/rules'
import type { CustomerFacts, EvaluationContext } from '@/lib/wallet/eligibility'

/**
 * The no-code rule engine.
 *
 * A merchant builds these from dropdowns and reads back a generated sentence, then
 * trusts them to run unattended for months. The engine therefore has to be *total*
 * (no throw can be allowed to break a geofence report) and *honest* (the sentence has
 * to describe what will actually happen). Both properties are asserted here.
 */

function facts(overrides: Partial<CustomerFacts> = {}): CustomerFacts {
  return {
    customerId: 'customer-1',
    points: 120,
    visits: 9,
    tierLevel: 2,
    isVip: false,
    daysSinceLastVisit: 12,
    isBirthdayToday: false,
    isAnniversaryToday: false,
    hasClaimableReward: true,
    segmentIds: ['segment-a', 'segment-b'],
    hasApplePass: true,
    hasGooglePass: false,
    notificationsToday: 1,
    hoursSinceLastNotification: 30,
    sendsForCampaign: {},
    hoursSinceCampaign: {},
    ...overrides,
  }
}

function context(overrides: Partial<EvaluationContext> = {}): EvaluationContext {
  return {
    // A Wednesday at 09:00 local.
    now: new Date('2026-07-29T09:00:00'),
    locationId: 'location-1',
    trigger: 'entry',
    distanceMeters: 80,
    ...overrides,
  }
}

const table = (
  factsInput = facts(),
  contextInput = context()
): Record<RuleFact, ReturnType<typeof buildFactTable>[RuleFact]> =>
  buildFactTable(factsInput, contextInput)

function rule(overrides: Partial<ProximityRule> = {}): ProximityRule {
  return {
    id: 'rule-1',
    name: 'Reward waiting nearby',
    description: null,
    isActive: true,
    priority: 10,
    stopOnMatch: false,
    conditions: { all: [{ fact: 'has_claimable_reward', op: 'is_true' }] },
    actions: [{ type: 'notify_reward_available' }],
    cooldownHours: 24,
    templateKey: null,
    matchCount: 0,
    lastMatchedAt: null,
    ...overrides,
  }
}

describe('buildFactTable', () => {
  it('exposes every declared fact, so no condition can reference a missing one', () => {
    const built = table()
    for (const fact of RULE_FACTS) {
      expect(fact in built, `${fact} is missing from the fact table`).toBe(true)
    }
  })

  it('derives the moment from the evaluation context, not the wall clock', () => {
    const built = table(facts(), context({ now: new Date('2026-07-29T21:00:00') }))
    expect(built.weekday).toBe(3)
    expect(built.hour).toBe(21)
  })

  it('treats either wallet as a pass being installed', () => {
    expect(table(facts({ hasApplePass: false, hasGooglePass: false })).has_pass_installed).toBe(
      false
    )
    expect(table(facts({ hasApplePass: false, hasGooglePass: true })).has_pass_installed).toBe(true)
  })
})

describe('evaluateCondition', () => {
  it('compares numbers in both directions', () => {
    expect(evaluateCondition({ fact: 'points', op: 'gte', value: 120 }, table())).toBe(true)
    expect(evaluateCondition({ fact: 'points', op: 'gt', value: 120 }, table())).toBe(false)
    expect(evaluateCondition({ fact: 'points', op: 'lte', value: 120 }, table())).toBe(true)
    expect(evaluateCondition({ fact: 'points', op: 'lt', value: 120 }, table())).toBe(false)
  })

  it('coerces a numeric string, because a form field is always a string', () => {
    expect(
      evaluateCondition({ fact: 'points', op: 'gte', value: '100' as unknown }, table())
    ).toBe(true)
  })

  it('treats a null fact as unknown, never as zero', () => {
    // `days_since_visit < 30` must not be true for a customer who has never visited,
    // or every win-back rule fires at people who enrolled this morning.
    const never = table(facts({ daysSinceLastVisit: null }))
    expect(evaluateCondition({ fact: 'days_since_visit', op: 'lt', value: 30 }, never)).toBe(false)
    expect(evaluateCondition({ fact: 'days_since_visit', op: 'gte', value: 30 }, never)).toBe(false)
  })

  it('evaluates booleans only against the matching operator', () => {
    expect(evaluateCondition({ fact: 'has_claimable_reward', op: 'is_true' }, table())).toBe(true)
    expect(evaluateCondition({ fact: 'has_claimable_reward', op: 'is_false' }, table())).toBe(false)
    expect(evaluateCondition({ fact: 'is_vip', op: 'is_false' }, table())).toBe(true)
  })

  it('handles between inclusively and tolerates reversed bounds', () => {
    expect(evaluateCondition({ fact: 'points', op: 'between', value: [100, 200] }, table())).toBe(
      true
    )
    expect(evaluateCondition({ fact: 'points', op: 'between', value: [120, 120] }, table())).toBe(
      true
    )
    // A merchant who types the larger number first still gets the range they meant.
    expect(evaluateCondition({ fact: 'points', op: 'between', value: [200, 100] }, table())).toBe(
      true
    )
    expect(evaluateCondition({ fact: 'points', op: 'between', value: [10, 20] }, table())).toBe(
      false
    )
  })

  it('refuses a malformed between rather than guessing', () => {
    expect(evaluateCondition({ fact: 'points', op: 'between', value: [100] }, table())).toBe(false)
    expect(evaluateCondition({ fact: 'points', op: 'between', value: 100 }, table())).toBe(false)
  })

  it('intersects list-valued facts for in / not_in', () => {
    expect(
      evaluateCondition({ fact: 'segment_id', op: 'in', value: ['segment-b', 'segment-c'] }, table())
    ).toBe(true)
    expect(
      evaluateCondition({ fact: 'segment_id', op: 'not_in', value: ['segment-b'] }, table())
    ).toBe(false)
    expect(
      evaluateCondition({ fact: 'segment_id', op: 'in', value: ['segment-z'] }, table())
    ).toBe(false)
  })

  it('matches scalars by membership for in', () => {
    expect(
      evaluateCondition({ fact: 'trigger', op: 'in', value: ['entry', 'dwell'] }, table())
    ).toBe(true)
    expect(evaluateCondition({ fact: 'trigger', op: 'in', value: ['exit'] }, table())).toBe(false)
  })

  it('is total: an unknown fact or operator is false, never a throw', () => {
    // A rule saved by a future version of the UI must not break a running store.
    expect(
      evaluateCondition({ fact: 'nonsense' as RuleFact, op: 'eq', value: 1 }, table())
    ).toBe(false)
    expect(
      evaluateCondition(
        { fact: 'points', op: 'approximately' as (typeof RULE_OPERATORS)[number], value: 1 },
        table()
      )
    ).toBe(false)
  })
})

describe('evaluateConditions', () => {
  it('requires every child of all', () => {
    const node: RuleNode = {
      all: [
        { fact: 'has_claimable_reward', op: 'is_true' },
        { fact: 'distance_meters', op: 'lte', value: 100 },
      ],
    }
    expect(evaluateConditions(node, table()).matched).toBe(true)
    expect(evaluateConditions(node, table(facts(), context({ distanceMeters: 900 }))).matched).toBe(
      false
    )
  })

  it('requires one child of any', () => {
    const node: RuleNode = {
      any: [
        { fact: 'is_vip', op: 'is_true' },
        { fact: 'has_claimable_reward', op: 'is_true' },
      ],
    }
    expect(evaluateConditions(node, table()).matched).toBe(true)
  })

  it('inverts none', () => {
    // The customer is not a VIP, so "none of these" holds.
    expect(evaluateConditions({ none: [{ fact: 'is_vip', op: 'is_true' }] }, table()).matched).toBe(
      true
    )
    // They *do* have a claimable reward, so "none of these" does not.
    expect(
      evaluateConditions({ none: [{ fact: 'has_claimable_reward', op: 'is_true' }] }, table())
        .matched
    ).toBe(false)
  })

  it('requires every child of none to be false', () => {
    expect(
      evaluateConditions(
        {
          none: [
            { fact: 'is_vip', op: 'is_true' },
            { fact: 'has_claimable_reward', op: 'is_true' },
          ],
        },
        table()
      ).matched
    ).toBe(false)
  })

  it('treats an empty all as always, and an empty any as always too', () => {
    // A rule with no conditions means "always", which is what a merchant who only
    // picked an action intends. A vacuously-false `any` would silently disable it.
    expect(evaluateConditions({ all: [] }, table()).matched).toBe(true)
    expect(evaluateConditions({ any: [] }, table()).matched).toBe(true)
  })

  it('nests groups', () => {
    const node: RuleNode = {
      all: [
        { fact: 'distance_meters', op: 'lte', value: 200 },
        {
          any: [
            { fact: 'is_vip', op: 'is_true' },
            { fact: 'points', op: 'gte', value: 100 },
          ],
        },
      ],
    }
    expect(evaluateConditions(node, table()).matched).toBe(true)
  })

  it('reports which leaves passed and which failed, for the explanation', () => {
    const result = evaluateConditions(
      {
        all: [
          { fact: 'has_claimable_reward', op: 'is_true' },
          { fact: 'is_vip', op: 'is_true' },
        ],
      },
      table()
    )
    expect(result.matched).toBe(false)
    expect(result.matchedConditions).toHaveLength(1)
    expect(result.failedConditions).toHaveLength(1)
    expect(result.failedConditions[0].fact).toBe('is_vip')
  })
})

describe('runRules', () => {
  it('skips inactive rules', () => {
    const outcome = runRules([rule({ isActive: false })], facts(), context())
    expect(outcome.matched).toEqual([])
    expect(outcome.actions).toEqual([])
  })

  it('collects the actions of every matching rule', () => {
    const outcome = runRules(
      [rule({ id: 'a' }), rule({ id: 'b', name: 'Second', actions: [{ type: 'add_tag', tag: 'x' }] })],
      facts(),
      context()
    )
    expect(outcome.matched).toHaveLength(2)
    expect(outcome.actions).toHaveLength(2)
  })

  it('runs in priority order, lowest first', () => {
    const outcome = runRules(
      [rule({ id: 'late', name: 'Late', priority: 90 }), rule({ id: 'early', name: 'Early', priority: 1 })],
      facts(),
      context()
    )
    expect(outcome.matched.map((entry) => entry.id)).toEqual(['early', 'late'])
  })

  it('stops after a rule that says so', () => {
    // Without this, a merchant whose rules overlap gets several notifications for one
    // door crossing, which reads as a bug however correct each rule is.
    const outcome = runRules(
      [
        rule({ id: 'first', priority: 1, stopOnMatch: true }),
        rule({ id: 'second', name: 'Second', priority: 2 }),
      ],
      facts(),
      context()
    )
    expect(outcome.matched.map((entry) => entry.id)).toEqual(['first'])
  })

  it('respects a per-rule cooldown', () => {
    const outcome = runRules([rule({ cooldownHours: 24 })], facts(), context(), {
      cooldownHoursElapsed: { 'rule-1': 3 },
    })
    expect(outcome.matched).toEqual([])
    expect(outcome.evaluations[0]?.skipped).toBe('cooldown')
    // The rule *did* match; it was the cooldown that held it back, and the merchant
    // screen needs to be able to say so.
    expect(outcome.evaluations[0]?.evaluation.matched).toBe(true)
  })

  it('lets a rule through once its cooldown has elapsed', () => {
    const outcome = runRules([rule({ cooldownHours: 24 })], facts(), context(), {
      cooldownHoursElapsed: { 'rule-1': 25 },
    })
    expect(outcome.matched).toHaveLength(1)
  })

  it('records an evaluation for every rule, matched or not', () => {
    const outcome = runRules(
      [rule({ id: 'yes' }), rule({ id: 'no', name: 'No', conditions: { all: [{ fact: 'is_vip', op: 'is_true' }] } })],
      facts(),
      context()
    )
    expect(outcome.evaluations).toHaveLength(2)
  })

  it('breaks a priority tie by name, so the order is stable across reads', () => {
    const outcome = runRules(
      [rule({ id: 'b', name: 'Beta', priority: 5 }), rule({ id: 'a', name: 'Alpha', priority: 5 })],
      facts(),
      context()
    )
    expect(outcome.matched.map((entry) => entry.name)).toEqual(['Alpha', 'Beta'])
  })
})

describe('describeRule', () => {
  it('renders a rule as the sentence the merchant thought they were writing', () => {
    const summary = describeRule({
      conditions: {
        all: [
          { fact: 'distance_meters', op: 'lte', value: 100 },
          { fact: 'points', op: 'gte', value: 50 },
        ],
      },
      actions: [{ type: 'notify_reward_available' }],
    })
    expect(summary).toBe(
      'If distance from the store is at most 100 m and points balance is at least 50, then tell them a reward is available.'
    )
  })

  it('renders a boolean condition as prose rather than as "is true"', () => {
    const summary = describeRule({
      conditions: { all: [{ fact: 'is_vip', op: 'is_true' }] },
      actions: [{ type: 'notify_staff', title: 'VIP here' }],
    })
    expect(summary).toContain('the customer is a VIP')
  })

  it('joins several actions', () => {
    const summary = describeRule({
      conditions: { all: [] },
      actions: [
        { type: 'grant_points', amount: 25 },
        { type: 'add_tag', tag: 'regular' },
      ],
    })
    expect(summary).toContain('give points (25)')
    expect(summary).toContain('tag the customer')
  })

  it('describes an empty rule without producing a broken sentence', () => {
    expect(describeRule({ conditions: { all: [] }, actions: [] })).toBe(
      'If anything happens, then do nothing.'
    )
  })

  it('parenthesises a nested group so the logic is not misread', () => {
    const summary = describeRule({
      conditions: {
        all: [
          { fact: 'distance_meters', op: 'lte', value: 100 },
          {
            any: [
              { fact: 'is_vip', op: 'is_true' },
              { fact: 'is_birthday', op: 'is_true' },
            ],
          },
        ],
      },
      actions: [{ type: 'suggest_wallet_card' }],
    })
    expect(summary).toContain('(')
    expect(summary).toContain(' or ')
  })
})

describe('validateConditions', () => {
  it('accepts a well-formed tree', () => {
    expect(
      validateConditions({ all: [{ fact: 'points', op: 'gte', value: 10 }] })
    ).toEqual([])
  })

  it('rejects an unknown fact or operator', () => {
    expect(validateConditions({ all: [{ fact: 'vibes', op: 'gte', value: 1 }] })).not.toEqual([])
    expect(validateConditions({ all: [{ fact: 'points', op: 'vibes', value: 1 }] })).not.toEqual([])
  })

  it('requires a value for operators that compare', () => {
    expect(validateConditions({ all: [{ fact: 'points', op: 'gte' }] })).not.toEqual([])
    // ...and not for the ones that do not.
    expect(validateConditions({ all: [{ fact: 'is_vip', op: 'is_true' }] })).toEqual([])
  })

  it('requires exactly two bounds for between', () => {
    expect(
      validateConditions({ all: [{ fact: 'points', op: 'between', value: [1] }] })
    ).not.toEqual([])
    expect(
      validateConditions({ all: [{ fact: 'points', op: 'between', value: [1, 2] }] })
    ).toEqual([])
  })

  it('refuses a tree nested past a sane depth', () => {
    let node: unknown = { fact: 'points', op: 'gte', value: 1 }
    for (let depth = 0; depth < 8; depth += 1) node = { all: [node] }
    expect(validateConditions(node)).not.toEqual([])
  })

  it('rejects something that is not an object at all', () => {
    expect(validateConditions(null)).not.toEqual([])
    expect(validateConditions('always')).not.toEqual([])
    expect(validateConditions({ all: 'everything' })).not.toEqual([])
  })
})

describe('validateActions', () => {
  it('requires at least one action', () => {
    // Storing a rule that can never do anything is worse than refusing it: the
    // merchant believes it is live.
    expect(validateActions([])).not.toEqual([])
    expect(validateActions('notify')).not.toEqual([])
  })

  it('accepts the documented actions', () => {
    expect(validateActions([{ type: 'suggest_wallet_card' }])).toEqual([])
    expect(validateActions([{ type: 'grant_points', amount: 10 }])).toEqual([])
  })

  it('rejects an unknown action type', () => {
    expect(validateActions([{ type: 'launch_rocket' }])).not.toEqual([])
  })

  it('bounds a points grant', () => {
    expect(validateActions([{ type: 'grant_points', amount: 0 }])).not.toEqual([])
    expect(validateActions([{ type: 'grant_points', amount: -5 }])).not.toEqual([])
    expect(validateActions([{ type: 'grant_points', amount: 99_999 }])).not.toEqual([])
  })

  it('requires the parameters each action needs', () => {
    expect(validateActions([{ type: 'add_tag', tag: '  ' }])).not.toEqual([])
    expect(validateActions([{ type: 'activate_campaign' }])).not.toEqual([])
    expect(validateActions([{ type: 'notify_staff' }])).not.toEqual([])
  })

  it('caps the number of actions on one rule', () => {
    const many = Array.from({ length: 11 }, () => ({ type: 'suggest_wallet_card' }))
    expect(validateActions(many)).not.toEqual([])
  })
})

describe('vocabulary labels', () => {
  it('labels every fact, operator and action, so the builder never shows a raw enum', () => {
    // The builder renders its dropdowns from these constants, so a missing label is a
    // blank option in a merchant-facing menu.
    for (const fact of RULE_FACTS) expect(FACT_LABELS[fact], fact).toBeTruthy()
    for (const operator of RULE_OPERATORS) expect(OPERATOR_LABELS[operator], operator).toBeTruthy()
    for (const action of RULE_ACTION_TYPES) expect(ACTION_LABELS[action], action).toBeTruthy()
  })
})
