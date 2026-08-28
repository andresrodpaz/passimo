import {
  num,
  type EarnTrigger,
  type EarningRule,
  type LoyaltyProgram,
  type ProgramTier,
} from '@/lib/domain/types'

/**
 * Rule matching and award computation.
 *
 * Deliberately pure: no database, no clock of its own, no I/O. That makes the
 * money-affecting logic exhaustively unit-testable, and lets the caller apply
 * all resulting awards inside a single database transaction.
 */

export type EarnContext = {
  trigger: EarnTrigger
  /** Ticket total for purchase-driven earning. */
  amount?: number | null
  /** Item count for per-item earning. */
  quantity?: number | null
  locationId?: string | null
  /** Evaluated in the business timezone by the caller. */
  now: Date
  /** Local weekday 0-6 (Sunday = 0) in the business timezone. */
  localWeekday: number
  /** Local `HH:MM:SS` in the business timezone. */
  localTime: string
  customer: {
    id: string
    tierIdByProgram: Record<string, string | null>
    lifetimeEarnedByProgram: Record<string, number>
    segmentIds: string[]
    /** Rule id → number of times this customer has already used it. */
    ruleUsage: Record<string, number>
    /** Rule id → last used timestamp, for cooldowns. */
    ruleLastUsedAt: Record<string, string | undefined>
  }
  /** Multiplier from the customer's tier, resolved by the caller. */
  tierMultiplier: number
  /**
   * Multiplier from any active paid membership, resolved by the caller.
   *
   * Multiplied with the tier multiplier rather than replacing it: a Gold
   * customer who also pays for the coffee club earns both benefits, which is
   * what "2× points for members" is understood to mean by everyone who has
   * ever read it on a poster.
   */
  membershipMultiplier: number
}

export type ComputedAward = {
  programId: string
  ruleId: string
  ruleName: string
  amount: number
  reason: string
}

export type RuleSkip = {
  ruleId: string
  ruleName: string
  reason: string
}

export type EvaluationResult = {
  awards: ComputedAward[]
  skipped: RuleSkip[]
}

/** Rounds to 2dp; loyalty balances are money-like and must not drift. */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function withinDateWindow(rule: EarningRule, now: Date): boolean {
  if (rule.startsAt && new Date(rule.startsAt) > now) return false
  if (rule.endsAt && new Date(rule.endsAt) < now) return false
  return true
}

function withinTimeWindow(rule: EarningRule, localTime: string): boolean {
  if (!rule.timeFrom && !rule.timeTo) return true
  const from = rule.timeFrom ?? '00:00:00'
  const to = rule.timeTo ?? '23:59:59'
  // An inverted window (22:00 → 02:00) means "overnight".
  if (from <= to) return localTime >= from && localTime <= to
  return localTime >= from || localTime <= to
}

function cooldownElapsed(rule: EarningRule, context: EarnContext): boolean {
  if (rule.cooldownMinutes <= 0) return true
  const last = context.customer.ruleLastUsedAt[rule.id]
  if (!last) return true
  const elapsedMs = context.now.getTime() - new Date(last).getTime()
  return elapsedMs >= rule.cooldownMinutes * 60_000
}

/**
 * Does this rule's trigger cover this event?
 *
 * Exact match, with one deliberate widening: **a `visit` rule also fires on a
 * `purchase`.** A purchase is a visit with a receipt attached, and the counter
 * decides between the two triggers purely on whether the cashier typed an
 * amount (`lib/client/use-counter-scan.ts`).
 *
 * Without the widening, a merchant on the default stamp card — whose only rule is
 * "Stamp per visit", the one `passimo_provision_business` creates — awarded
 * nothing the moment a cashier started entering ticket amounts. Points worked
 * when the amount box was empty and silently stopped when it was filled, which
 * is the worst possible shape: the merchant is doing *more* work and getting less,
 * with no error anywhere to explain it.
 *
 * The reverse is not true. A `purchase` rule means "only when they buy
 * something" — that is what a merchant is expressing by choosing it — so it must
 * not fire on a bare visit.
 *
 * Stacking is unaffected: `evaluateProgram` already applies the highest-priority
 * non-stackable match and skips the rest, so a merchant who has both "1 point
 * per euro" (purchase) and "1 stamp per visit" gets one of them on a purchase,
 * not both.
 */
function triggerMatches(rule: EarningRule, context: EarnContext): boolean {
  if (rule.trigger === context.trigger) return true
  return rule.trigger === 'visit' && context.trigger === 'purchase'
}

/** Why (if at all) this rule does not apply to this event. */
export function ruleSkipReason(rule: EarningRule, context: EarnContext): string | null {
  if (!rule.isActive) return 'inactive'
  if (!triggerMatches(rule, context)) return 'trigger_mismatch'
  if (!withinDateWindow(rule, context.now)) return 'outside_date_window'
  if (rule.daysOfWeek?.length && !rule.daysOfWeek.includes(context.localWeekday)) {
    return 'outside_day_of_week'
  }
  if (!withinTimeWindow(rule, context.localTime)) return 'outside_time_window'
  if (rule.locationIds?.length) {
    if (!context.locationId || !rule.locationIds.includes(context.locationId)) {
      return 'location_not_eligible'
    }
  }
  if (rule.tierIds?.length) {
    const tierId = context.customer.tierIdByProgram[rule.programId] ?? null
    if (!tierId || !rule.tierIds.includes(tierId)) return 'tier_not_eligible'
  }
  if (rule.segmentId && !context.customer.segmentIds.includes(rule.segmentId)) {
    return 'segment_not_eligible'
  }
  if (rule.minPurchase != null && num(context.amount) < rule.minPurchase) {
    return 'below_minimum_purchase'
  }
  if (rule.totalUsageLimit != null && rule.usageCount >= rule.totalUsageLimit) {
    return 'total_usage_limit_reached'
  }
  if (
    rule.usageLimitPerCustomer != null &&
    (context.customer.ruleUsage[rule.id] ?? 0) >= rule.usageLimitPerCustomer
  ) {
    return 'per_customer_limit_reached'
  }
  if (!cooldownElapsed(rule, context)) return 'cooldown_active'

  if (rule.trigger === 'milestone') {
    if (rule.milestoneThreshold == null) return 'milestone_threshold_missing'
    const lifetime = context.customer.lifetimeEarnedByProgram[rule.programId] ?? 0
    if (lifetime < rule.milestoneThreshold) return 'milestone_not_reached'
  }

  return null
}

/** Raw award before tier multiplier and program caps. */
export function baseAward(rule: EarningRule, context: EarnContext): number {
  switch (rule.awardType) {
    case 'fixed':
      return rule.awardAmount
    case 'per_currency': {
      const spend = num(context.amount)
      if (spend <= 0) return 0
      return Math.floor(spend / rule.perAmount) * rule.awardAmount
    }
    case 'per_item': {
      const quantity = num(context.quantity)
      if (quantity <= 0) return 0
      return Math.floor(quantity / rule.perAmount) * rule.awardAmount
    }
    case 'percent': {
      const spend = num(context.amount)
      if (spend <= 0) return 0
      return (spend * rule.awardAmount) / 100
    }
    default:
      return 0
  }
}

/**
 * Evaluates every rule for a program and returns the awards to apply.
 *
 * Precedence: rules are sorted by priority. The first non-stackable match wins
 * and stops further non-stackable rules; stackable rules always add on top.
 * This gives merchants a predictable mental model — "my Tuesday bonus stacks,
 * my base rule does not" — instead of an opaque sum of everything.
 */
export function evaluateProgram(
  program: LoyaltyProgram,
  rules: EarningRule[],
  context: EarnContext,
  tiers: ProgramTier[] = []
): EvaluationResult {
  const awards: ComputedAward[] = []
  const skipped: RuleSkip[] = []
  let baseRuleApplied = false

  const ordered = [...rules]
    .filter((rule) => rule.programId === program.id)
    .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name))

  for (const rule of ordered) {
    const skip = ruleSkipReason(rule, context)
    if (skip) {
      skipped.push({ ruleId: rule.id, ruleName: rule.name, reason: skip })
      continue
    }
    if (!rule.stackable && baseRuleApplied) {
      skipped.push({ ruleId: rule.id, ruleName: rule.name, reason: 'superseded_by_higher_priority' })
      continue
    }

    let amount = baseAward(rule, context)
    if (amount <= 0) {
      skipped.push({ ruleId: rule.id, ruleName: rule.name, reason: 'zero_award' })
      continue
    }

    amount *= resolveEarnMultiplier(program, tiers, context)
    if (rule.maxAward != null) amount = Math.min(amount, rule.maxAward)
    amount = program.type === 'stamps' ? Math.floor(amount) : round2(amount)

    if (amount <= 0) {
      skipped.push({ ruleId: rule.id, ruleName: rule.name, reason: 'zero_after_caps' })
      continue
    }

    awards.push({
      programId: program.id,
      ruleId: rule.id,
      ruleName: rule.name,
      amount,
      reason: rule.name,
    })
    if (!rule.stackable) baseRuleApplied = true
  }

  return { awards, skipped }
}

/**
 * The combined earn multiplier: status the customer earned, times status they
 * bought. Exported so the UI can show a member exactly why they got 6 points
 * for a €2 coffee.
 */
export function resolveEarnMultiplier(
  program: LoyaltyProgram,
  tiers: ProgramTier[],
  context: EarnContext
): number {
  const membership = context.membershipMultiplier > 0 ? context.membershipMultiplier : 1
  return resolveTierMultiplier(program, tiers, context) * membership
}

function resolveTierMultiplier(
  program: LoyaltyProgram,
  tiers: ProgramTier[],
  context: EarnContext
): number {
  if (!program.tierEnabled) return 1
  const tierId = context.customer.tierIdByProgram[program.id]
  if (!tierId) return context.tierMultiplier || 1
  const tier = tiers.find((candidate) => candidate.id === tierId)
  return tier?.earnMultiplier ?? context.tierMultiplier ?? 1
}

/**
 * Cashback programs are expressed as a percentage on the program rather than a
 * rule, so a merchant can turn on "3% back" without authoring anything.
 */
export function cashbackAward(program: LoyaltyProgram, amount: number | null | undefined): number {
  if (program.type !== 'cashback' || !program.cashbackPercent) return 0
  const spend = num(amount)
  if (spend <= 0) return 0
  return round2((spend * program.cashbackPercent) / 100)
}

/** Total to apply across programs, respecting each program's daily cap. */
export function applyDailyCap(
  awards: ComputedAward[],
  program: LoyaltyProgram,
  alreadyEarnedToday: number
): { awards: ComputedAward[]; capped: boolean } {
  if (program.maxEarnPerDay == null) return { awards, capped: false }
  const headroom = Math.max(0, program.maxEarnPerDay - alreadyEarnedToday)
  if (headroom <= 0) return { awards: [], capped: true }

  let remaining = headroom
  const limited: ComputedAward[] = []
  let capped = false
  for (const award of awards) {
    if (remaining <= 0) {
      capped = true
      break
    }
    const amount = Math.min(award.amount, remaining)
    if (amount < award.amount) capped = true
    limited.push({ ...award, amount })
    remaining -= amount
  }
  return { awards: limited, capped }
}

/** Local weekday/time in an IANA timezone, used to evaluate day/time windows. */
export function localTimeParts(now: Date, timeZone: string): { weekday: number; time: string } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const parts = formatter.formatToParts(now)
  const lookup = (type: string) => parts.find((part) => part.type === type)?.value ?? '00'
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  }
  const hour = lookup('hour') === '24' ? '00' : lookup('hour')
  return {
    weekday: weekdayMap[lookup('weekday')] ?? now.getUTCDay(),
    time: `${hour}:${lookup('minute')}:${lookup('second')}`,
  }
}
