import 'server-only'
import { getDb } from '@/lib/db'
import { logger } from '@/lib/logger'
import { num } from '@/lib/domain/types'
import { env } from '@/lib/env'
import { TRIAL_EXPIRED_PLAN, isPurchasablePlan } from '@/lib/billing/plans'

/**
 * Referral reporting and configuration.
 *
 * Attribution itself lives in SQL (`passimo_enroll_customer` records the link,
 * `passimo_qualify_referrals` pays out only once the friend actually
 * transacts). This module answers the questions a merchant asks about it:
 * is it working, who are my advocates, and what is it worth.
 *
 * The reward amounts are ordinary earning rules on the `referral` and
 * `referred_signup` triggers rather than a parallel configuration system —
 * which means referral rewards get day/time windows, caps, cooldowns and tier
 * targeting for free, and there is exactly one place where "how much do we
 * award" is decided.
 */

export type ReferralStats = {
  total: number
  pending: number
  qualified: number
  rejected: number
  conversion_rate: number
  referred_customers: number
  referred_revenue: number
  referred_avg_visits: number
  advocates: number
}

export type Advocate = {
  customerId: string
  name: string | null
  email: string
  referralCode: string | null
  total: number
  qualified: number
  revenueGenerated: number
}

export type ReferralProgram = {
  /** Award to the person who referred, once the friend qualifies. */
  advocateReward: number
  /** Award to the friend, on signup. */
  friendReward: number
  unitPlural: string
  /** Transactions the friend must complete before the advocate is paid. */
  qualifyingEvents: number
  advocateRuleActive: boolean
  friendRuleActive: boolean
}

export async function getReferralStats(
  businessId: string,
  days = 90
): Promise<ReferralStats> {
  const admin = getDb()
  const { data, error } = await admin.rpc('passimo_referral_stats', {
    p_business_id: businessId,
    p_days: days,
  })

  if (error) {
    logger.warn('referrals.stats_failed', { business_id: businessId, error })
    return {
      total: 0,
      pending: 0,
      qualified: 0,
      rejected: 0,
      conversion_rate: 0,
      referred_customers: 0,
      referred_revenue: 0,
      referred_avg_visits: 0,
      advocates: 0,
    }
  }

  const raw = (data ?? {}) as Record<string, unknown>
  return {
    total: num(raw.total),
    pending: num(raw.pending),
    qualified: num(raw.qualified),
    rejected: num(raw.rejected),
    conversion_rate: num(raw.conversion_rate),
    referred_customers: num(raw.referred_customers),
    referred_revenue: num(raw.referred_revenue),
    referred_avg_visits: num(raw.referred_avg_visits),
    advocates: num(raw.advocates),
  }
}

export async function getAdvocates(businessId: string, limit = 10): Promise<Advocate[]> {
  const admin = getDb()
  const { data, error } = await admin.rpc('passimo_referral_leaderboard', {
    p_business_id: businessId,
    p_limit: limit,
  })

  if (error) {
    logger.warn('referrals.leaderboard_failed', { business_id: businessId, error })
    return []
  }

  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    customerId: row.customer_id as string,
    name: (row.name as string) ?? null,
    email: row.email as string,
    referralCode: (row.referral_code as string) ?? null,
    total: num(row.total),
    qualified: num(row.qualified),
    revenueGenerated: num(row.revenue_generated),
  }))
}

/**
 * Reads the referral configuration out of the earning rules that implement it.
 *
 * Presented to the merchant as one coherent "referral program" even though it
 * is two rules underneath — nobody thinks of "who gets what when a friend joins"
 * as two separate settings.
 */
export async function getReferralProgram(businessId: string): Promise<ReferralProgram> {
  const admin = getDb()

  const [rules, program] = await Promise.all([
    admin
      .from('earning_rules')
      .select('trigger, award_amount, is_active')
      .eq('business_id', businessId)
      .in('trigger', ['referral', 'referred_signup']),
    admin
      .from('loyalty_programs')
      .select('unit_plural')
      .eq('business_id', businessId)
      .eq('is_default', true)
      .maybeSingle(),
  ])

  const advocate = (rules.data ?? []).find((rule) => rule.trigger === 'referral')
  const friend = (rules.data ?? []).find((rule) => rule.trigger === 'referred_signup')

  const { data: sample } = await admin
    .from('referrals')
    .select('qualifies_after_events')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return {
    advocateReward: num(advocate?.award_amount, 0),
    friendReward: num(friend?.award_amount, 0),
    unitPlural: (program.data?.unit_plural as string) ?? 'points',
    qualifyingEvents: num(sample?.qualifies_after_events, 1) || 1,
    advocateRuleActive: Boolean(advocate?.is_active),
    friendRuleActive: Boolean(friend?.is_active),
  }
}

export type UpdateReferralProgramInput = {
  businessId: string
  advocateReward: number
  friendReward: number
  isActive: boolean
}

/**
 * Writes the referral configuration back into its two earning rules, creating
 * them if the business predates the rule seeding.
 */
export async function updateReferralProgram(
  input: UpdateReferralProgramInput
): Promise<ReferralProgram> {
  const admin = getDb()

  const { data: program } = await admin
    .from('loyalty_programs')
    .select('id')
    .eq('business_id', input.businessId)
    .eq('is_default', true)
    .maybeSingle()

  const programId = program?.id as string | undefined
  if (!programId) return getReferralProgram(input.businessId)

  const definitions = [
    { trigger: 'referral', name: 'Referral bonus', amount: input.advocateReward, priority: 20 },
    {
      trigger: 'referred_signup',
      name: 'Friend welcome bonus',
      amount: input.friendReward,
      priority: 30,
    },
  ] as const

  for (const definition of definitions) {
    const { data: existing } = await admin
      .from('earning_rules')
      .select('id')
      .eq('business_id', input.businessId)
      .eq('program_id', programId)
      .eq('trigger', definition.trigger)
      .maybeSingle()

    const row = {
      business_id: input.businessId,
      program_id: programId,
      name: definition.name,
      trigger: definition.trigger,
      award_type: 'fixed',
      award_amount: definition.amount,
      priority: definition.priority,
      // A zero award is the same as switching that side off; keeping the rule
      // inactive rather than deleting it preserves its usage history.
      is_active: input.isActive && definition.amount > 0,
    }

    if (existing?.id) {
      await admin.from('earning_rules').update(row).eq('id', existing.id)
    } else {
      await admin.from('earning_rules').insert(row)
    }
  }

  return getReferralProgram(input.businessId)
}

/** The link an advocate shares. Also embedded in their wallet pass. */
export function referralUrl(businessSlug: string, code: string): string {
  return `${env.appUrl}/join/${businessSlug}?ref=${code}`
}

// -----------------------------------------------------------------------------
// Merchant-to-merchant referrals
// -----------------------------------------------------------------------------

export type MerchantReferralSummary = {
  code: string
  url: string
  referred: Array<{ id: string; name: string; plan: string; joinedAt: string; converted: boolean }>
  creditEarned: number
  pendingCredit: number
}

/** Credit granted per referred merchant who reaches a paid plan. */
export const MERCHANT_REFERRAL_CREDIT = 50

/**
 * Whether a referred merchant counts as converted — i.e. whether the referrer
 * has earned their credit.
 *
 * Pure and exported so the rule is testable without a database, because getting
 * it wrong costs real money in both directions. Money must actually have changed
 * hands: the billing status is authoritative, and the tier has to be one that
 * can be bought. Plan alone cannot answer this — a trialling business sits on a
 * paid tier and a lapsed one keeps the name of the tier it used to be on, so
 * reading the plan marks both as paying and lets the programme be farmed with
 * throwaway signups.
 */
export function isReferralConverted(
  plan: unknown,
  subscriptionStatus: string | null | undefined
): boolean {
  return subscriptionStatus === 'active' && isPurchasablePlan(plan)
}

/**
 * The merchant's own referral program: one shop owner tells another.
 *
 * Local business owners talk to each other constantly, and a recommendation
 * from the café two doors down converts far better than any ad we could buy.
 * Credit is only granted once the referred business actually pays, so the
 * programme cannot be farmed with throwaway signups.
 */
export async function getMerchantReferralSummary(
  businessId: string
): Promise<MerchantReferralSummary | null> {
  const admin = getDb()

  const { data: business } = await admin
    .from('businesses')
    .select('referral_code, referral_credit')
    .eq('id', businessId)
    .maybeSingle()

  if (!business?.referral_code) return null

  const { data: referred } = await admin
    .from('businesses')
    .select('id, name, plan, subscription_status, created_at')
    .eq('referred_by_business_id', businessId)
    .order('created_at', { ascending: false })
    .limit(50)

  const rows = (referred ?? []).map((row) => {
    const plan = (row.plan as string) ?? TRIAL_EXPIRED_PLAN
    return {
      id: row.id as string,
      name: row.name as string,
      plan,
      joinedAt: row.created_at as string,
      converted: isReferralConverted(plan, row.subscription_status as string | null),
    }
  })

  return {
    code: business.referral_code as string,
    url: `${env.appUrl}/signup?ref=${business.referral_code}`,
    referred: rows,
    creditEarned: num(business.referral_credit),
    pendingCredit: rows.filter((row) => !row.converted).length * MERCHANT_REFERRAL_CREDIT,
  }
}

/**
 * Grants referral credit when a referred business starts paying.
 *
 * Called from the billing webhook. Idempotent through the `referral_credited_at`
 * stamp: a subscription that updates fifty times pays the referrer once.
 */
export async function creditMerchantReferral(businessId: string): Promise<boolean> {
  const admin = getDb()

  const { data: business } = await admin
    .from('businesses')
    .select('id, name, referred_by_business_id, referral_credited_at')
    .eq('id', businessId)
    .maybeSingle()

  if (!business?.referred_by_business_id || business.referral_credited_at) return false

  const { error } = await admin.rpc('passimo_credit_merchant_referral', {
    p_referred_business_id: businessId,
    p_amount: MERCHANT_REFERRAL_CREDIT,
  })

  if (error) {
    logger.warn('referrals.merchant_credit_failed', { business_id: businessId, error })
    return false
  }
  return true
}
