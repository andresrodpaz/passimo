import 'server-only'
import { getDb } from '@/lib/db'
import { recordEarn } from '@/lib/loyalty/engine'
import type { EarnTrigger } from '@/lib/domain/types'
import { fulfillGrantedReward } from '@/lib/loyalty/grants'
import { logger } from '@/lib/logger'
import { resolveScan, type ScanResolution } from '@/lib/scan/resolve'
import type { CounterCustomer } from '@/lib/scan/counter'

/**
 * Scan check-in.
 *
 * The whole counter interaction in one server call: work out who was scanned,
 * credit them, and return the screen to show. Splitting identification from
 * awarding would double the latency of the most frequent action in the product,
 * and at a busy counter that is the difference between a queue moving and not.
 *
 * Awarding is idempotent on the caller's key, which is what makes the offline
 * queue safe: a scan recorded on a phone with no signal can be replayed any
 * number of times and will credit exactly once.
 */

export type CheckinAward = {
  programId: string
  programName: string
  unitSingular: string
  unitPlural: string
  amount: number
  balance: number
  goalAmount: number | null
  progressPercent: number
  rewardAvailable: boolean
  tierChanged: boolean
}

export type CheckinOutcome = {
  /** True when this exact key was already recorded — a replay, not a new visit. */
  duplicate: boolean
  totalAwarded: number
  awards: CheckinAward[]
  /** A card was completed by this scan: the moment worth celebrating. */
  rewardUnlocked: boolean
  /** Rules that declined to fire, so a merchant can answer "why no bonus?". */
  skipped: Array<{ ruleName: string; reason: string }>
}

export type ScanAction =
  /** Look up only. Used by the search fallback and the customer picker. */
  | { type: 'identify' }
  /** Identify and immediately credit — the express counter flow. */
  | {
      type: 'checkin'
      trigger?: EarnTrigger
      amount?: number | null
      quantity?: number | null
      idempotencyKey: string
      locationId?: string | null
    }

export type ScanResult = {
  resolution: ScanResolution
  checkin: CheckinOutcome | null
  /** Set when a scanned claim code was handed over by this call. */
  fulfilled: { code: string; rewardName: string } | null
}

export async function performScan(input: {
  businessId: string
  raw: string
  action: ScanAction
  staffUserId: string | null
  source?: 'pos' | 'api'
}): Promise<ScanResult> {
  const resolution = await resolveScan({ businessId: input.businessId, raw: input.raw })

  // A scanned claim code means "give them the thing" — it is settled here
  // rather than requiring a second confirming tap, because the cashier already
  // confirmed by pointing the camera at it.
  if (resolution.kind === 'reward_claim' && input.action.type === 'checkin') {
    const outcome = await fulfillGrantedReward({
      businessId: input.businessId,
      code: resolution.claim.code,
      staffUserId: input.staffUserId,
      locationId: input.action.locationId ?? null,
    })

    return {
      resolution: outcome.ok
        ? resolution
        : {
            kind: 'unknown',
            raw: input.raw,
            hint: claimFailureHint(outcome.reason),
          },
      checkin: null,
      fulfilled: outcome.ok
        ? { code: resolution.claim.code, rewardName: outcome.rewardName ?? 'Reward' }
        : null,
    }
  }

  if (resolution.kind !== 'customer' || input.action.type !== 'checkin') {
    return { resolution, checkin: null, fulfilled: null }
  }

  const action = input.action
  const result = await recordEarn({
    businessId: input.businessId,
    customerId: resolution.customer.id,
    trigger: action.trigger ?? (action.amount ? 'purchase' : 'visit'),
    amount: action.amount ?? null,
    quantity: action.quantity ?? null,
    locationId: action.locationId ?? null,
    staffUserId: input.staffUserId,
    source: input.source ?? 'pos',
    idempotencyKey: action.idempotencyKey,
    metadata: { scanned: true },
  })

  // Referral payouts are earned by the friend actually turning up, so they are
  // settled on the first real visit rather than at sign-up.
  if (!result.duplicate) {
    const admin = getDb()
    const { error } = await admin.rpc('passimo_qualify_referrals', {
      p_business_id: input.businessId,
      p_customer_id: resolution.customer.id,
    })
    // A referral bonus must never cost the customer their visit.
    if (error) {
      logger.warn('scan.referral_qualify_failed', {
        businessId: input.businessId,
        customerId: resolution.customer.id,
        error,
      })
    }
  }

  const awards: CheckinAward[] = result.awards.map((award) => ({
    programId: award.programId,
    programName: award.programName,
    unitSingular: singularFor(resolution.customer, award.programId, award.unitPlural),
    unitPlural: award.unitPlural,
    amount: award.amount,
    balance: award.balance,
    goalAmount: award.goalAmount,
    progressPercent:
      award.goalAmount && award.goalAmount > 0
        ? Math.min(100, Math.round((award.balance / award.goalAmount) * 100))
        : 0,
    rewardAvailable: award.rewardAvailable,
    tierChanged: award.tierChanged,
  }))

  return {
    // The customer was assembled before the award landed, so the balances it
    // carries are patched from the authoritative earn result rather than
    // re-queried: correct, and one round trip cheaper.
    resolution: { kind: 'customer', customer: applyAwards(resolution.customer, awards) },
    checkin: {
      duplicate: result.duplicate,
      totalAwarded: result.totalAwarded,
      awards,
      rewardUnlocked: awards.some((award) => award.rewardAvailable),
      skipped: result.skipped.map((skip) => ({
        ruleName: skip.ruleName,
        reason: skip.reason,
      })),
    },
    fulfilled: null,
  }
}

/**
 * Folds the awarded amounts into the counter view so the success screen shows
 * post-award numbers without another database read.
 */
function applyAwards(customer: CounterCustomer, awards: CheckinAward[]): CounterCustomer {
  if (awards.length === 0) return customer

  const byProgram = new Map(awards.map((award) => [award.programId, award]))

  const programs = customer.programs.map((program) => {
    const award = byProgram.get(program.programId)
    if (!award) return program
    return {
      ...program,
      balance: award.balance,
      progressPercent: award.progressPercent,
      remainingToGoal:
        award.goalAmount == null ? null : Math.max(0, award.goalAmount - award.balance),
      rewardAvailable: award.rewardAvailable,
    }
  })

  const rewards = customer.rewards.map((reward) => ({
    ...reward,
    affordable:
      reward.affordable ||
      programs.some((program) => program.balance >= reward.cost && program.rewardAvailable),
  }))

  return {
    ...customer,
    programs,
    rewards,
    visitCount: customer.visitCount + 1,
    // The greeting was chosen for a first-time visitor; after the award the
    // reward in front of them is the more useful thing to say.
    flags: { ...customer.flags, firstVisit: false },
    nextBestAction: programs.some((program) => program.rewardAvailable)
      ? 'Reward unlocked — offer it now before they leave'
      : customer.nextBestAction,
  }
}

function singularFor(
  customer: CounterCustomer,
  programId: string,
  fallbackPlural: string
): string {
  return (
    customer.programs.find((program) => program.programId === programId)?.unitSingular ??
    fallbackPlural.replace(/s$/, '')
  )
}

function claimFailureHint(reason: string | undefined): string {
  switch (reason) {
    case 'already_used':
      return 'That reward has already been handed over.'
    case 'expired':
      return 'That reward has expired. Offer them something else.'
    case 'cancelled':
      return 'That reward was cancelled.'
    default:
      return 'That reward code is not valid here.'
  }
}
