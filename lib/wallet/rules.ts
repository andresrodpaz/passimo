/**
 * The no-code proximity rule engine.
 *
 * A merchant writes *"IF the customer is within 100 metres AND has enough points
 * THEN notify them their reward is ready"* in a visual builder. That produces a
 * condition tree and an action list, stored as JSON, evaluated here.
 *
 * Three properties this design buys, all of them load-bearing:
 *
 *   1. **One definition, three consumers.** The same tree drives the builder UI,
 *      the plain-language sentence the merchant reads back (`describeRule`), and
 *      the evaluator. A rule can therefore never *look* different from what it
 *      does — the failure that makes no-code tools untrustworthy.
 *   2. **Pure and total.** No I/O, no throwing. An unknown fact or operator
 *      evaluates to `false` rather than crashing a geofence report, because a
 *      rule saved by a future version of the UI must not break a running store.
 *   3. **Explainable.** Evaluation returns which leaves matched, so the merchant
 *      screen can show *why* a rule fired at a customer.
 *
 * Isomorphic: the builder validates and previews with the same code that runs it.
 */

import type { CustomerFacts, EvaluationContext } from '@/lib/wallet/eligibility'

// -----------------------------------------------------------------------------
// Vocabulary
// -----------------------------------------------------------------------------

/**
 * The facts a rule can test.
 *
 * Deliberately a closed list rather than arbitrary field paths: a merchant can
 * only build a rule out of concepts we can explain in one line, and we can only
 * guarantee behaviour for facts we compute ourselves.
 */
export const RULE_FACTS = [
  'distance_meters',
  'points',
  'visits',
  'tier_level',
  'days_since_visit',
  'is_vip',
  'is_birthday',
  'is_anniversary',
  'has_claimable_reward',
  'has_pass_installed',
  'trigger',
  'weekday',
  'hour',
  'location_id',
  'segment_id',
  'notifications_today',
] as const
export type RuleFact = (typeof RULE_FACTS)[number]

export const RULE_OPERATORS = [
  'eq',
  'neq',
  'lt',
  'lte',
  'gt',
  'gte',
  'between',
  'in',
  'not_in',
  'is_true',
  'is_false',
] as const
export type RuleOperator = (typeof RULE_OPERATORS)[number]

export type RuleCondition = {
  fact: RuleFact
  op: RuleOperator
  value?: unknown
}

export type RuleConditionGroup =
  | { all: RuleNode[] }
  | { any: RuleNode[] }
  | { none: RuleNode[] }

export type RuleNode = RuleCondition | RuleConditionGroup

export const RULE_ACTION_TYPES = [
  'suggest_wallet_card',
  'send_wallet_notification',
  'notify_reward_available',
  'activate_campaign',
  'grant_points',
  'grant_reward',
  'add_tag',
  'set_vip',
  'notify_staff',
] as const
export type RuleActionType = (typeof RULE_ACTION_TYPES)[number]

export type RuleAction =
  | { type: 'suggest_wallet_card'; message?: string }
  | {
      type: 'send_wallet_notification'
      title?: string
      message?: string
      emoji?: string
      cta_label?: string
      cta_url?: string
    }
  | { type: 'notify_reward_available'; reward_id?: string }
  | { type: 'activate_campaign'; campaign_id: string }
  | { type: 'grant_points'; amount: number; reason?: string }
  | { type: 'grant_reward'; reward_id?: string; trigger?: string }
  | { type: 'add_tag'; tag: string }
  | { type: 'set_vip'; value?: boolean }
  | { type: 'notify_staff'; title: string; body?: string }

export type ProximityRule = {
  id: string
  name: string
  description: string | null
  isActive: boolean
  priority: number
  stopOnMatch: boolean
  conditions: RuleNode
  actions: RuleAction[]
  cooldownHours: number
  templateKey: string | null
  matchCount: number
  lastMatchedAt: string | null
}

// -----------------------------------------------------------------------------
// Evaluation
// -----------------------------------------------------------------------------

export type FactValue = number | string | boolean | null | readonly string[]

/**
 * Flattens the customer and the moment into the fact table a rule reads.
 *
 * Built once per position report: with twenty rules and eight facts, computing
 * lazily per leaf would mean 160 lookups where one object suffices.
 */
export function buildFactTable(
  facts: CustomerFacts,
  context: EvaluationContext
): Record<RuleFact, FactValue> {
  return {
    distance_meters: context.distanceMeters,
    points: facts.points,
    visits: facts.visits,
    tier_level: facts.tierLevel,
    days_since_visit: facts.daysSinceLastVisit,
    is_vip: facts.isVip,
    is_birthday: facts.isBirthdayToday,
    is_anniversary: facts.isAnniversaryToday,
    has_claimable_reward: facts.hasClaimableReward,
    has_pass_installed: facts.hasApplePass || facts.hasGooglePass,
    trigger: context.trigger,
    weekday: context.now.getDay(),
    hour: context.now.getHours(),
    location_id: context.locationId,
    segment_id: facts.segmentIds,
    notifications_today: facts.notificationsToday,
  }
}

export type RuleEvaluation = {
  matched: boolean
  /** Which leaves were true, for the "why did this fire?" explanation. */
  matchedConditions: RuleCondition[]
  /** Which leaves were false — what a merchant needs to debug a silent rule. */
  failedConditions: RuleCondition[]
}

export function evaluateConditions(
  node: RuleNode,
  table: Record<RuleFact, FactValue>
): RuleEvaluation {
  const matchedConditions: RuleCondition[] = []
  const failedConditions: RuleCondition[] = []

  const walk = (current: RuleNode): boolean => {
    if ('all' in current) {
      // An empty `all` is true: a rule with no conditions is "always", which is
      // what a merchant who has only picked an action means. An empty `any`
      // would be vacuously false, which would silently disable their rule.
      const children = current.all ?? []
      let result = true
      for (const child of children) if (!walk(child)) result = false
      return result
    }
    if ('any' in current) {
      const children = current.any ?? []
      if (children.length === 0) return true
      let result = false
      for (const child of children) if (walk(child)) result = true
      return result
    }
    if ('none' in current) {
      const children = current.none ?? []
      let result = true
      for (const child of children) if (walk(child)) result = false
      return result
    }

    const condition = current as RuleCondition
    const outcome = evaluateCondition(condition, table)
    ;(outcome ? matchedConditions : failedConditions).push(condition)
    return outcome
  }

  const matched = walk(node)
  return { matched, matchedConditions, failedConditions }
}

export function evaluateCondition(
  condition: RuleCondition,
  table: Record<RuleFact, FactValue>
): boolean {
  if (!RULE_FACTS.includes(condition.fact)) return false
  const actual = table[condition.fact]

  switch (condition.op) {
    case 'is_true':
      return actual === true
    case 'is_false':
      return actual === false
    case 'eq':
      return looseEquals(actual, condition.value)
    case 'neq':
      return !looseEquals(actual, condition.value)
    case 'lt':
    case 'lte':
    case 'gt':
    case 'gte': {
      const left = toNumber(actual)
      const right = toNumber(condition.value)
      // A null fact is "unknown", not zero. `days_since_visit < 30` must not be
      // true for a customer who has never visited, or every win-back rule fires
      // at people who enrolled this morning.
      if (left === null || right === null) return false
      if (condition.op === 'lt') return left < right
      if (condition.op === 'lte') return left <= right
      if (condition.op === 'gt') return left > right
      return left >= right
    }
    case 'between': {
      const bounds = Array.isArray(condition.value) ? condition.value : []
      const left = toNumber(actual)
      const low = toNumber(bounds[0])
      const high = toNumber(bounds[1])
      if (left === null || low === null || high === null) return false
      return left >= Math.min(low, high) && left <= Math.max(low, high)
    }
    case 'in':
    case 'not_in': {
      const expected = (Array.isArray(condition.value) ? condition.value : [condition.value]).map(
        String
      )
      // A list-valued fact (the customer's segments) matches when the sets
      // intersect; a scalar matches by membership.
      const hit = Array.isArray(actual)
        ? actual.some((item) => expected.includes(String(item)))
        : actual !== null && expected.includes(String(actual))
      return condition.op === 'in' ? hit : !hit
    }
    default:
      return false
  }
}

function looseEquals(actual: FactValue, expected: unknown): boolean {
  if (Array.isArray(actual)) return actual.some((item) => String(item) === String(expected))
  if (actual === null || expected === null || expected === undefined) {
    return actual === (expected ?? null)
  }
  if (typeof actual === 'boolean') return actual === toBoolean(expected)
  if (typeof actual === 'number') {
    const numeric = toNumber(expected)
    return numeric !== null && actual === numeric
  }
  return String(actual) === String(expected)
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function toBoolean(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1'
}

/**
 * Runs a merchant's rules in order and returns the actions to perform.
 *
 * Priority ascending, and the first matching rule with `stopOnMatch` ends the
 * pass. Without that, a merchant whose rules overlap gets several notifications
 * for one door crossing, which reads as a bug no matter how correct each rule is.
 */
export function runRules(
  rules: readonly ProximityRule[],
  facts: CustomerFacts,
  context: EvaluationContext,
  options: { cooldownHoursElapsed?: Record<string, number | null> } = {}
): {
  actions: Array<{ rule: ProximityRule; action: RuleAction }>
  matched: ProximityRule[]
  evaluations: Array<{ rule: ProximityRule; evaluation: RuleEvaluation; skipped?: 'cooldown' }>
} {
  const table = buildFactTable(facts, context)
  const ordered = [...rules]
    .filter((rule) => rule.isActive)
    .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name))

  const actions: Array<{ rule: ProximityRule; action: RuleAction }> = []
  const matched: ProximityRule[] = []
  const evaluations: Array<{
    rule: ProximityRule
    evaluation: RuleEvaluation
    skipped?: 'cooldown'
  }> = []

  for (const rule of ordered) {
    const evaluation = evaluateConditions(rule.conditions, table)
    const elapsed = options.cooldownHoursElapsed?.[rule.id] ?? null

    if (!evaluation.matched) {
      evaluations.push({ rule, evaluation })
      continue
    }

    if (rule.cooldownHours > 0 && elapsed !== null && elapsed < rule.cooldownHours) {
      evaluations.push({ rule, evaluation, skipped: 'cooldown' })
      continue
    }

    evaluations.push({ rule, evaluation })
    matched.push(rule)
    for (const action of rule.actions ?? []) actions.push({ rule, action })
    if (rule.stopOnMatch) break
  }

  return { actions, matched, evaluations }
}

// -----------------------------------------------------------------------------
// Human-readable rendering
// -----------------------------------------------------------------------------

export const FACT_LABELS: Record<RuleFact, string> = {
  distance_meters: 'distance from the store',
  points: 'points balance',
  visits: 'total visits',
  tier_level: 'loyalty tier',
  days_since_visit: 'days since last visit',
  is_vip: 'is a VIP',
  is_birthday: 'birthday is today',
  is_anniversary: 'joined on this day',
  has_claimable_reward: 'has a reward ready',
  has_pass_installed: 'has the card in their wallet',
  trigger: 'what happened',
  weekday: 'day of the week',
  hour: 'hour of the day',
  location_id: 'location',
  segment_id: 'segment',
  notifications_today: 'notifications received today',
}

export const OPERATOR_LABELS: Record<RuleOperator, string> = {
  eq: 'is',
  neq: 'is not',
  lt: 'is under',
  lte: 'is at most',
  gt: 'is over',
  gte: 'is at least',
  between: 'is between',
  in: 'is one of',
  not_in: 'is none of',
  is_true: 'is true',
  is_false: 'is false',
}

export const ACTION_LABELS: Record<RuleActionType, string> = {
  suggest_wallet_card: 'suggest their wallet card',
  send_wallet_notification: 'send a wallet notification',
  notify_reward_available: 'tell them a reward is available',
  activate_campaign: 'run a campaign',
  grant_points: 'give points',
  grant_reward: 'give a reward',
  add_tag: 'tag the customer',
  set_vip: 'mark as VIP',
  notify_staff: 'alert the team',
}

/**
 * Renders a rule as the sentence the merchant thought they were writing.
 *
 * Shown under every rule in the builder. If this reads wrong, the rule *is*
 * wrong — which is the point of generating it from the stored tree rather than
 * letting the merchant type a description that drifts from the logic.
 */
export function describeRule(rule: Pick<ProximityRule, 'conditions' | 'actions'>): string {
  const when = describeNode(rule.conditions)
  const then = (rule.actions ?? [])
    .map((action) => describeAction(action))
    .filter(Boolean)
    .join(', and ')
  return `If ${when || 'anything happens'}, then ${then || 'do nothing'}.`
}

function describeNode(node: RuleNode, depth = 0): string {
  if ('all' in node) return joinChildren(node.all, ' and ', depth)
  if ('any' in node) return joinChildren(node.any, ' or ', depth)
  if ('none' in node) {
    const inner = joinChildren(node.none, ' or ', depth)
    return inner ? `not (${inner})` : ''
  }
  return describeCondition(node as RuleCondition)
}

function joinChildren(children: RuleNode[] | undefined, separator: string, depth: number): string {
  const parts = (children ?? []).map((child) => describeNode(child, depth + 1)).filter(Boolean)
  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0]
  const joined = parts.join(separator)
  return depth > 0 ? `(${joined})` : joined
}

function describeCondition(condition: RuleCondition): string {
  const fact = FACT_LABELS[condition.fact] ?? condition.fact
  if (condition.op === 'is_true') return `the customer ${fact}`
  if (condition.op === 'is_false') return `the customer does not — ${fact}`

  const operator = OPERATOR_LABELS[condition.op] ?? condition.op
  const value = Array.isArray(condition.value)
    ? condition.value.join(condition.op === 'between' ? ' and ' : ', ')
    : String(condition.value ?? '')

  const unit = condition.fact === 'distance_meters' ? ' m' : ''
  return `${fact} ${operator} ${value}${unit}`
}

function describeAction(action: RuleAction): string {
  const label = ACTION_LABELS[action.type] ?? action.type
  if (action.type === 'grant_points') return `${label} (${action.amount})`
  if (action.type === 'add_tag') return `${label} “${action.tag}”`
  if (action.type === 'send_wallet_notification' && action.title) {
    return `${label} “${action.title}”`
  }
  return label
}

// -----------------------------------------------------------------------------
// Validation
// -----------------------------------------------------------------------------

/**
 * Structural validation, used by the API before persisting a rule.
 *
 * The evaluator is total and would happily ignore a malformed leaf, but silently
 * storing a rule that can never match is worse than refusing it: the merchant
 * believes the rule is live.
 */
export function validateConditions(node: unknown, depth = 0): string[] {
  const errors: string[] = []
  if (depth > 5) return ['Conditions are nested too deeply']
  if (!node || typeof node !== 'object') return ['Conditions must be an object']

  const group = node as Record<string, unknown>
  for (const key of ['all', 'any', 'none'] as const) {
    if (key in group) {
      if (!Array.isArray(group[key])) return [`"${key}" must be a list of conditions`]
      const children = group[key] as unknown[]
      if (children.length > 25) errors.push('A rule cannot have more than 25 conditions')
      for (const child of children) errors.push(...validateConditions(child, depth + 1))
      return errors
    }
  }

  const condition = group as Partial<RuleCondition>
  if (!condition.fact || !RULE_FACTS.includes(condition.fact)) {
    errors.push(`Unknown condition field: ${String(condition.fact)}`)
  }
  if (!condition.op || !RULE_OPERATORS.includes(condition.op)) {
    errors.push(`Unknown comparison: ${String(condition.op)}`)
  }
  const needsValue = condition.op !== 'is_true' && condition.op !== 'is_false'
  if (needsValue && (condition.value === undefined || condition.value === null)) {
    errors.push(`"${String(condition.fact)}" needs a value to compare against`)
  }
  if (condition.op === 'between') {
    const bounds = condition.value
    if (!Array.isArray(bounds) || bounds.length !== 2) {
      errors.push('"is between" needs exactly two values')
    }
  }
  return errors
}

export function validateActions(actions: unknown): string[] {
  if (!Array.isArray(actions)) return ['Actions must be a list']
  if (actions.length === 0) return ['A rule needs at least one action']
  if (actions.length > 10) return ['A rule cannot have more than 10 actions']

  const errors: string[] = []
  for (const raw of actions) {
    const action = raw as Partial<RuleAction> & Record<string, unknown>
    if (!action?.type || !RULE_ACTION_TYPES.includes(action.type as RuleActionType)) {
      errors.push(`Unknown action: ${String(action?.type)}`)
      continue
    }
    if (action.type === 'grant_points') {
      const amount = Number(action.amount)
      if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000) {
        errors.push('Points must be between 1 and 10,000')
      }
    }
    if (action.type === 'add_tag' && !String(action.tag ?? '').trim()) {
      errors.push('Tagging needs a tag name')
    }
    if (action.type === 'activate_campaign' && !String(action.campaign_id ?? '').trim()) {
      errors.push('Running a campaign needs a campaign')
    }
    if (action.type === 'notify_staff' && !String(action.title ?? '').trim()) {
      errors.push('A team alert needs a title')
    }
  }
  return errors
}
