import 'server-only'
import { getDb } from '@/lib/db'
import { AppError, badRequest, notFound, unprocessable } from '@/lib/errors'
import { logger } from '@/lib/logger'
import { enqueue } from '@/lib/jobs/queue'
import {
  applyDailyCap,
  cashbackAward,
  evaluateProgram,
  localTimeParts,
  type ComputedAward,
  type EarnContext,
  type RuleSkip,
} from '@/lib/loyalty/rules'
import {
  num,
  numOrNull,
  type EarnTrigger,
  type EarningRule,
  type LoyaltyProgram,
  type ProgramTier,
} from '@/lib/domain/types'
import { scheduleWalletSync } from '@/lib/wallet/sync'

/**
 * The loyalty engine: the one place that turns "something happened" into
 * balance. Everything else — POS, public API, integrations, automations —
 * calls `recordEarn` rather than touching balances directly.
 */

// -----------------------------------------------------------------------------
// Configuration loading (short-lived cache: rules change rarely, are read hot)
// -----------------------------------------------------------------------------

export type ProgramConfig = {
  businessId: string
  timezone: string
  currency: string
  programs: LoyaltyProgram[]
  rules: EarningRule[]
  tiers: ProgramTier[]
}

const configCache = new Map<string, { value: ProgramConfig; expiresAt: number }>()
const CONFIG_TTL_MS = 30_000

export function invalidateProgramConfig(businessId: string): void {
  configCache.delete(businessId)
}

function mapProgram(row: Record<string, unknown>): LoyaltyProgram {
  return {
    id: row.id as string,
    businessId: row.business_id as string,
    name: row.name as string,
    type: row.type as LoyaltyProgram['type'],
    isActive: Boolean(row.is_active),
    isDefault: Boolean(row.is_default),
    unitSingular: (row.unit_singular as string) ?? 'point',
    unitPlural: (row.unit_plural as string) ?? 'points',
    description: (row.description as string) ?? null,
    goalAmount: numOrNull(row.goal_amount),
    rewardDescription: (row.reward_description as string) ?? null,
    resetOnReward: Boolean(row.reset_on_reward),
    cashbackPercent: numOrNull(row.cashback_percent),
    pointValue: numOrNull(row.point_value),
    expiryMonths: numOrNull(row.expiry_months),
    expiryWarningDays: num(row.expiry_warning_days, 14),
    earnCooldownMinutes: num(row.earn_cooldown_minutes),
    maxEarnPerDay: numOrNull(row.max_earn_per_day),
    tierEnabled: Boolean(row.tier_enabled),
    tierMetric: (row.tier_metric as LoyaltyProgram['tierMetric']) ?? 'lifetime_earned',
    tierWindowDays: numOrNull(row.tier_window_days),
  }
}

function mapRule(row: Record<string, unknown>): EarningRule {
  return {
    id: row.id as string,
    businessId: row.business_id as string,
    programId: row.program_id as string,
    name: row.name as string,
    isActive: Boolean(row.is_active),
    priority: num(row.priority, 100),
    stackable: Boolean(row.stackable),
    trigger: row.trigger as EarnTrigger,
    awardType: row.award_type as EarningRule['awardType'],
    awardAmount: num(row.award_amount),
    perAmount: num(row.per_amount, 1),
    maxAward: numOrNull(row.max_award),
    minPurchase: numOrNull(row.min_purchase),
    milestoneThreshold: numOrNull(row.milestone_threshold),
    daysOfWeek: (row.days_of_week as number[] | null) ?? null,
    timeFrom: (row.time_from as string) ?? null,
    timeTo: (row.time_to as string) ?? null,
    startsAt: (row.starts_at as string) ?? null,
    endsAt: (row.ends_at as string) ?? null,
    locationIds: (row.location_ids as string[] | null) ?? null,
    tierIds: (row.tier_ids as string[] | null) ?? null,
    segmentId: (row.segment_id as string) ?? null,
    cooldownMinutes: num(row.cooldown_minutes),
    usageLimitPerCustomer: numOrNull(row.usage_limit_per_customer),
    totalUsageLimit: numOrNull(row.total_usage_limit),
    usageCount: num(row.usage_count),
  }
}

function mapTier(row: Record<string, unknown>): ProgramTier {
  return {
    id: row.id as string,
    programId: row.program_id as string,
    name: row.name as string,
    level: num(row.level),
    threshold: num(row.threshold),
    earnMultiplier: num(row.earn_multiplier, 1),
    color: (row.color as string) ?? '#64748b',
    icon: (row.icon as string) ?? null,
    perks: (row.perks as string[]) ?? [],
    allowDowngrade: Boolean(row.allow_downgrade),
  }
}

export async function loadProgramConfig(businessId: string): Promise<ProgramConfig> {
  const cached = configCache.get(businessId)
  if (cached && cached.expiresAt > Date.now()) return cached.value

  const admin = getDb()
  const [business, programs, rules, tiers] = await Promise.all([
    admin.from('businesses').select('timezone, currency').eq('id', businessId).maybeSingle(),
    admin.from('loyalty_programs').select('*').eq('business_id', businessId).eq('is_active', true),
    admin.from('earning_rules').select('*').eq('business_id', businessId).eq('is_active', true),
    admin.from('program_tiers').select('*').eq('business_id', businessId),
  ])

  const value: ProgramConfig = {
    businessId,
    timezone: (business.data?.timezone as string) ?? 'Europe/Madrid',
    currency: (business.data?.currency as string) ?? 'EUR',
    programs: (programs.data ?? []).map(mapProgram),
    rules: (rules.data ?? []).map(mapRule),
    tiers: (tiers.data ?? []).map(mapTier),
  }

  configCache.set(businessId, { value, expiresAt: Date.now() + CONFIG_TTL_MS })
  return value
}

// -----------------------------------------------------------------------------
// Earning
// -----------------------------------------------------------------------------

export type RecordEarnInput = {
  businessId: string
  customerId: string
  trigger: EarnTrigger
  /** Ticket total, for purchase-driven programs. */
  amount?: number | null
  quantity?: number | null
  currency?: string | null
  locationId?: string | null
  staffUserId?: string | null
  source?: 'app' | 'pos' | 'api' | 'import' | 'automation' | 'integration' | 'wallet' | 'web'
  /** Provider event id; makes integration replays idempotent. */
  externalId?: string | null
  /** Client-supplied retry key; makes POS retries idempotent. */
  idempotencyKey?: string | null
  note?: string | null
  /** Override the computed award (manual staff adjustment). */
  overrideAmount?: number | null
  overrideProgramId?: string | null
  metadata?: Record<string, unknown>
}

export type EarnResult = {
  duplicate: boolean
  eventId: string | null
  awards: Array<{
    programId: string
    programName: string
    unitPlural: string
    amount: number
    balance: number
    goalAmount: number | null
    rewardAvailable: boolean
    tierChanged: boolean
    tierId: string | null
    expiresAt: string | null
  }>
  skipped: RuleSkip[]
  totalAwarded: number
}

/**
 * Records activity and applies every earning rule it triggers, atomically.
 *
 * Concurrency and retries are handled in Postgres (`passimo_record_earn`);
 * this function is responsible for deciding *what* to award.
 */
export async function recordEarn(input: RecordEarnInput): Promise<EarnResult> {
  const admin = getDb()
  const config = await loadProgramConfig(input.businessId)

  if (config.programs.length === 0) {
    throw unprocessable('This business has no active loyalty program')
  }

  const now = new Date()
  const { weekday, time } = localTimeParts(now, config.timezone)

  const [customerState, membershipMultiplier] = await Promise.all([
    loadCustomerRuleState(input.businessId, input.customerId),
    loadMembershipMultiplier(input.customerId),
  ])

  const context: EarnContext = {
    trigger: input.trigger,
    amount: input.amount ?? null,
    quantity: input.quantity ?? null,
    locationId: input.locationId ?? null,
    now,
    localWeekday: weekday,
    localTime: time,
    customer: customerState,
    tierMultiplier: 1,
    membershipMultiplier,
  }

  let awards: ComputedAward[] = []
  const skipped: RuleSkip[] = []

  if (input.overrideAmount != null) {
    // Manual staff adjustment: bypass rules but still go through the ledger.
    const programId =
      input.overrideProgramId ??
      config.programs.find((program) => program.isDefault)?.id ??
      config.programs[0]!.id
    if (!config.programs.some((program) => program.id === programId)) {
      throw badRequest('Unknown program for this business')
    }
    awards = [
      {
        programId,
        ruleId: '',
        ruleName: 'Manual adjustment',
        amount: input.overrideAmount,
        reason: input.note ?? 'Manual adjustment',
      },
    ]
  } else {
    for (const program of config.programs) {
      if (program.type === 'membership') continue

      const evaluation = evaluateProgram(program, config.rules, context, config.tiers)
      let programAwards = evaluation.awards
      skipped.push(...evaluation.skipped)

      // Cashback is a program-level percentage, not a rule.
      const cashback = cashbackAward(program, input.amount)
      if (cashback > 0) {
        programAwards = [
          ...programAwards,
          {
            programId: program.id,
            ruleId: '',
            ruleName: `${program.cashbackPercent}% cashback`,
            amount: cashback,
            reason: `${program.cashbackPercent}% cashback`,
          },
        ]
      }

      if (programAwards.length > 0 && program.maxEarnPerDay != null) {
        const earnedToday = await earnedTodayForProgram(program.id, input.customerId)
        const capped = applyDailyCap(programAwards, program, earnedToday)
        if (capped.capped) {
          skipped.push({
            ruleId: program.id,
            ruleName: program.name,
            reason: 'daily_cap_reached',
          })
        }
        programAwards = capped.awards
      }

      awards.push(...programAwards)
    }
  }

  const { data, error } = await admin.rpc('passimo_record_earn', {
    p_business_id: input.businessId,
    p_customer_id: input.customerId,
    p_event: {
      type: input.trigger === 'purchase' ? 'purchase' : input.trigger === 'signup' ? 'signup' : 'visit',
      amount: input.amount ?? null,
      currency: input.currency ?? config.currency,
      quantity: input.quantity ?? null,
      source: input.source ?? 'app',
      external_id: input.externalId ?? null,
      location_id: input.locationId ?? null,
      staff_user_id: input.staffUserId ?? null,
      metadata: { ...(input.metadata ?? {}), note: input.note ?? null },
      occurred_at: now.toISOString(),
    },
    p_awards: awards.map((award) => ({
      program_id: award.programId,
      amount: award.amount,
      rule_id: award.ruleId || null,
      reason: award.reason,
    })),
    p_idempotency_key: input.idempotencyKey ?? null,
  })

  if (error) throw translatePostgresError(error)

  const payload = data as {
    duplicate: boolean
    event_id: string | null
    awards: Array<Record<string, unknown>>
  }

  const mapped = (payload.awards ?? []).map((entry) => {
    const programId = entry.program_id as string
    const program = config.programs.find((candidate) => candidate.id === programId)
    return {
      programId,
      programName: program?.name ?? 'Program',
      unitPlural: program?.unitPlural ?? 'points',
      amount: num(entry.amount),
      balance: num(entry.balance),
      goalAmount: numOrNull(entry.goal_amount),
      rewardAvailable: Boolean(entry.reward_available),
      tierChanged: Boolean(entry.tier_changed),
      tierId: (entry.tier_id as string) ?? null,
      expiresAt: (entry.expires_at as string) ?? null,
    }
  })

  const result: EarnResult = {
    duplicate: Boolean(payload.duplicate),
    eventId: payload.event_id ?? null,
    awards: mapped,
    skipped,
    totalAwarded: mapped.reduce((sum, award) => sum + award.amount, 0),
  }

  if (!result.duplicate) {
    await incrementRuleUsage(awards)
    await scheduleAfterEarnEffects(input, result)
  }

  return result
}

async function scheduleAfterEarnEffects(input: RecordEarnInput, result: EarnResult) {
  const jobs: Promise<unknown>[] = [
    scheduleWalletSync(input.customerId, 'balance_change', { businessId: input.businessId }),
    enqueue(
      'automation.enroll',
      {
        businessId: input.businessId,
        customerId: input.customerId,
        trigger: input.trigger === 'purchase' ? 'purchase_recorded' : 'visit_recorded',
        eventId: result.eventId,
      },
      { businessId: input.businessId, priority: 80 }
    ),
    enqueue(
      'webhook.deliver',
      {
        businessId: input.businessId,
        event: 'loyalty.earned',
        data: {
          customer_id: input.customerId,
          total_awarded: result.totalAwarded,
          awards: result.awards,
        },
      },
      { businessId: input.businessId, priority: 90 }
    ),
  ]

  // Reaching the goal is the single highest-intent moment in the whole product.
  if (result.awards.some((award) => award.rewardAvailable)) {
    jobs.push(
      enqueue(
        'automation.enroll',
        {
          businessId: input.businessId,
          customerId: input.customerId,
          trigger: 'reward_unlocked',
          eventId: result.eventId,
        },
        { businessId: input.businessId, priority: 20 }
      )
    )
  }

  if (result.awards.some((award) => award.tierChanged)) {
    jobs.push(
      enqueue(
        'automation.enroll',
        {
          businessId: input.businessId,
          customerId: input.customerId,
          trigger: 'tier_upgraded',
          eventId: result.eventId,
        },
        { businessId: input.businessId, priority: 30 }
      )
    )
  }

  await Promise.allSettled(jobs)
}

async function incrementRuleUsage(awards: ComputedAward[]) {
  const ruleIds = awards.map((award) => award.ruleId).filter(Boolean)
  if (ruleIds.length === 0) return
  const admin = getDb()
  await Promise.allSettled(
    ruleIds.map((ruleId) =>
      admin.rpc('passimo_increment_rule_usage', { p_rule_id: ruleId }).then(
        () => undefined,
        (error: unknown) => logger.warn('loyalty.rule_usage_failed', { ruleId, error })
      )
    )
  )
}

async function earnedTodayForProgram(programId: string, customerId: string): Promise<number> {
  const admin = getDb()
  const startOfDay = new Date()
  startOfDay.setUTCHours(0, 0, 0, 0)
  const { data } = await admin
    .from('loyalty_ledger')
    .select('amount')
    .eq('program_id', programId)
    .eq('customer_id', customerId)
    .eq('entry_type', 'earn')
    .gte('created_at', startOfDay.toISOString())
  return (data ?? []).reduce((sum, row) => sum + num(row.amount), 0)
}

/**
 * The best multiplier from any active paid membership, or 1.
 *
 * Resolved in SQL against an indexed lookup rather than joining every plan, and
 * never allowed to fail an award: a customer standing at the counter gets their
 * stamp even if the membership table is briefly unreachable. Under-awarding a
 * member is recoverable with an adjustment; refusing the scan is not.
 */
async function loadMembershipMultiplier(customerId: string): Promise<number> {
  try {
    const admin = getDb()
    const { data, error } = await admin.rpc('passimo_membership_multiplier', {
      p_customer_id: customerId,
    })
    if (error) throw error
    return num(data, 1) || 1
  } catch (cause) {
    logger.warn('loyalty.membership_multiplier_failed', { customer_id: customerId, cause })
    return 1
  }
}

async function loadCustomerRuleState(
  businessId: string,
  customerId: string
): Promise<EarnContext['customer']> {
  const admin = getDb()
  const [accounts, recentEarns] = await Promise.all([
    admin
      .from('loyalty_accounts')
      .select('program_id, tier_id, lifetime_earned')
      .eq('customer_id', customerId),
    // Only rules used recently can be blocked by a cooldown or per-customer cap
    // that we could not otherwise see; 90 days bounds the scan.
    admin
      .from('loyalty_ledger')
      .select('rule_id, created_at')
      .eq('customer_id', customerId)
      .eq('business_id', businessId)
      .not('rule_id', 'is', null)
      .gte('created_at', new Date(Date.now() - 90 * 86_400_000).toISOString())
      .order('created_at', { ascending: false })
      .limit(500),
  ])

  const tierIdByProgram: Record<string, string | null> = {}
  const lifetimeEarnedByProgram: Record<string, number> = {}
  for (const account of accounts.data ?? []) {
    tierIdByProgram[account.program_id as string] = (account.tier_id as string) ?? null
    lifetimeEarnedByProgram[account.program_id as string] = num(account.lifetime_earned)
  }

  const ruleUsage: Record<string, number> = {}
  const ruleLastUsedAt: Record<string, string | undefined> = {}
  for (const entry of recentEarns.data ?? []) {
    const ruleId = entry.rule_id as string
    ruleUsage[ruleId] = (ruleUsage[ruleId] ?? 0) + 1
    ruleLastUsedAt[ruleId] ??= entry.created_at as string
  }

  return {
    id: customerId,
    tierIdByProgram,
    lifetimeEarnedByProgram,
    // Segment-gated rules are resolved lazily; an empty list means "no segment
    // rules apply", which is the safe default (never over-award).
    segmentIds: [],
    ruleUsage,
    ruleLastUsedAt,
  }
}

// -----------------------------------------------------------------------------
// Redemption
// -----------------------------------------------------------------------------

export type RedeemInput = {
  businessId: string
  customerId: string
  rewardId: string
  locationId?: string | null
  staffUserId?: string | null
  idempotencyKey?: string | null
}

export type RedeemResult = {
  duplicate: boolean
  redemptionId: string
  code: string
  rewardName: string
  cost: number
  balance: number
  expiresAt: string | null
}

export async function redeemReward(input: RedeemInput): Promise<RedeemResult> {
  const admin = getDb()
  const { data, error } = await admin.rpc('passimo_redeem_reward', {
    p_business_id: input.businessId,
    p_customer_id: input.customerId,
    p_reward_id: input.rewardId,
    p_location_id: input.locationId ?? null,
    p_staff_user_id: input.staffUserId ?? null,
    p_idempotency_key: input.idempotencyKey ?? null,
  })

  if (error) throw translatePostgresError(error)

  const payload = data as Record<string, unknown>
  const result: RedeemResult = {
    duplicate: Boolean(payload.duplicate),
    redemptionId: payload.redemption_id as string,
    code: payload.code as string,
    rewardName: payload.reward_name as string,
    cost: num(payload.cost),
    balance: num(payload.balance),
    expiresAt: (payload.expires_at as string) ?? null,
  }

  if (!result.duplicate) {
    await Promise.allSettled([
      scheduleWalletSync(input.customerId, 'balance_change', { businessId: input.businessId }),
      enqueue(
        'automation.enroll',
        {
          businessId: input.businessId,
          customerId: input.customerId,
          trigger: 'reward_redeemed',
        },
        { businessId: input.businessId, priority: 80 }
      ),
      enqueue(
        'webhook.deliver',
        {
          businessId: input.businessId,
          event: 'reward.redeemed',
          data: {
            customer_id: input.customerId,
            reward_id: input.rewardId,
            redemption_id: result.redemptionId,
          },
        },
        { businessId: input.businessId, priority: 90 }
      ),
    ])
  }

  return result
}

// -----------------------------------------------------------------------------
// Manual adjustment (staff correction, goodwill gesture)
// -----------------------------------------------------------------------------

export async function adjustBalance(input: {
  businessId: string
  customerId: string
  programId: string
  amount: number
  reason: string
  staffUserId?: string | null
  idempotencyKey?: string | null
}): Promise<{ balance: number; entryId: string }> {
  const admin = getDb()
  const isCredit = input.amount > 0
  const { data, error } = await admin.rpc(
    isCredit ? 'passimo_credit_account' : 'passimo_debit_account',
    isCredit
      ? {
          p_business_id: input.businessId,
          p_program_id: input.programId,
          p_customer_id: input.customerId,
          p_amount: Math.abs(input.amount),
          p_entry_type: 'adjust',
          p_reason: input.reason,
          p_staff_user_id: input.staffUserId ?? null,
          p_idempotency_key: input.idempotencyKey ?? null,
        }
      : {
          p_business_id: input.businessId,
          p_program_id: input.programId,
          p_customer_id: input.customerId,
          p_amount: Math.abs(input.amount),
          p_entry_type: 'adjust',
          p_reason: input.reason,
          p_staff_user_id: input.staffUserId ?? null,
          p_idempotency_key: input.idempotencyKey ?? null,
        }
  )

  if (error) throw translatePostgresError(error)
  const payload = data as Record<string, unknown>

  await scheduleWalletSync(input.customerId, 'balance_change', { businessId: input.businessId })

  return { balance: num(payload.balance), entryId: payload.entry_id as string }
}

// -----------------------------------------------------------------------------
// Reads
// -----------------------------------------------------------------------------

export type CustomerLoyaltySnapshot = {
  programs: Array<{
    programId: string
    programName: string
    type: LoyaltyProgram['type']
    unitSingular: string
    unitPlural: string
    balance: number
    lifetimeEarned: number
    goalAmount: number | null
    progressPercent: number
    rewardAvailable: boolean
    nextExpiryAt: string | null
    tier: { id: string; name: string; level: number; color: string } | null
    nextTier: { name: string; remaining: number } | null
  }>
  availableRewards: Array<{
    id: string
    name: string
    description: string | null
    cost: number
    affordable: boolean
    programId: string | null
  }>
}

export async function getCustomerLoyalty(
  businessId: string,
  customerId: string
): Promise<CustomerLoyaltySnapshot> {
  const admin = getDb()
  const config = await loadProgramConfig(businessId)

  const [accountsResult, rewardsResult] = await Promise.all([
    admin.from('loyalty_accounts').select('*').eq('customer_id', customerId),
    admin
      .from('rewards')
      .select('id, name, description, cost, program_id, min_tier_level, stock, is_active')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .is('auto_grant_trigger', null)
      .order('sort_order'),
  ])

  const accounts = accountsResult.data ?? []

  const programs = config.programs.map((program) => {
    const account = accounts.find((row) => row.program_id === program.id)
    const balance = num(account?.balance)
    const goal = program.goalAmount
    const tiers = config.tiers
      .filter((tier) => tier.programId === program.id)
      .sort((a, b) => a.level - b.level)
    const currentTier = tiers.find((tier) => tier.id === account?.tier_id) ?? null
    const nextTier = tiers.find((tier) => tier.level > (currentTier?.level ?? -1)) ?? null

    return {
      programId: program.id,
      programName: program.name,
      type: program.type,
      unitSingular: program.unitSingular,
      unitPlural: program.unitPlural,
      balance,
      lifetimeEarned: num(account?.lifetime_earned),
      goalAmount: goal,
      progressPercent: goal && goal > 0 ? Math.min(100, Math.round((balance / goal) * 100)) : 0,
      rewardAvailable: goal != null && balance >= goal,
      nextExpiryAt: (account?.next_expiry_at as string) ?? null,
      tier: currentTier
        ? {
            id: currentTier.id,
            name: currentTier.name,
            level: currentTier.level,
            color: currentTier.color,
          }
        : null,
      nextTier: nextTier
        ? {
            name: nextTier.name,
            remaining: Math.max(0, nextTier.threshold - num(account?.lifetime_earned)),
          }
        : null,
    }
  })

  const balanceByProgram = new Map(programs.map((program) => [program.programId, program.balance]))

  const availableRewards = (rewardsResult.data ?? []).map((reward) => ({
    id: reward.id as string,
    name: reward.name as string,
    description: (reward.description as string) ?? null,
    cost: num(reward.cost),
    programId: (reward.program_id as string) ?? null,
    affordable:
      num(reward.cost) <= (balanceByProgram.get(reward.program_id as string) ?? 0) &&
      (reward.stock === null || num(reward.stock) > 0),
  }))

  return { programs, availableRewards }
}

// -----------------------------------------------------------------------------
// Error translation
// -----------------------------------------------------------------------------

/**
 * The subset of a database error this translator reads.
 *
 * `hint` is the interesting field: the loyalty functions raise with an explicit
 * hint (`insufficient_balance`, `out_of_stock`) precisely so the API layer can
 * map a constraint into a merchant-readable 422 without string-matching a
 * message that a PostgreSQL upgrade might reword.
 */
type PostgrestLikeError = {
  message?: string
  hint?: string | null
  code?: string | null
}

/** Maps database-level guards onto meaningful HTTP semantics. */
export function translatePostgresError(error: PostgrestLikeError): AppError {
  const hint = error.hint ?? ''
  const message = error.message ?? 'Loyalty operation failed'

  if (hint === 'insufficient_balance' || message.includes('Insufficient balance')) {
    return unprocessable('Not enough balance to redeem this reward')
  }
  if (hint === 'out_of_stock') return unprocessable('This reward is out of stock')
  if (hint === 'tier_too_low') return unprocessable('Customer tier is too low for this reward')
  if (hint === 'per_customer_limit') {
    return unprocessable('This customer has already redeemed this reward the maximum number of times')
  }
  if (hint === 'reward_inactive' || hint === 'reward_ended') {
    return unprocessable('This reward is no longer available')
  }
  if (hint === 'reward_not_started') return unprocessable('This reward is not available yet')
  if (error.code === 'no_data_found' || message.includes('not found')) {
    return notFound('Reward')
  }
  if (message.includes('does not belong to business')) {
    return badRequest('Resource does not belong to this business')
  }

  logger.error('loyalty.unmapped_db_error', { error })
  return new AppError('internal_error', message, { expose: false })
}
