import 'server-only'
import { getDb } from '@/lib/db'
import { conflict, notFound, unprocessable } from '@/lib/errors'
import { logger } from '@/lib/logger'
import { num } from '@/lib/domain/types'
import { enqueue } from '@/lib/jobs/queue'
import { notify } from '@/lib/notifications'

/**
 * Paid memberships — the merchant's own recurring revenue.
 *
 * A stamp card rewards someone for coming back. A membership makes them decide
 * to come back once, in advance, and then keeps charging: "€19 a month, a
 * coffee a day". For the merchant it converts unpredictable footfall into a
 * subscriber count they can forecast against. For us it is the single
 * stickiest thing on the platform — a merchant with 300 paying members is not
 * migrating to a competitor over a €20 price difference, because the migration
 * means asking 300 people to re-enter a card.
 *
 * Period rollover, balance grants and the multiplier lookup live in SQL
 * (`passimo_enroll_membership`, `passimo_renew_memberships`,
 * `passimo_membership_multiplier`) so a lapsed period can never be double-
 * granted by two concurrent workers.
 */

export type MembershipInterval = 'month' | 'year'
export type MembershipStatus = 'active' | 'past_due' | 'cancelled' | 'expired'

export type MembershipPlan = {
  id: string
  businessId: string
  programId: string | null
  name: string
  description: string | null
  price: number
  currency: string
  interval: MembershipInterval
  includedBalance: number
  earnMultiplier: number
  perks: string[]
  trialDays: number
  maxMembers: number | null
  memberCount: number
  isActive: boolean
  isPublic: boolean
  sortOrder: number
  stripePriceId: string | null
}

export type MembershipStats = {
  active_members: number
  cancelled_members: number
  /** Monthly recurring revenue in the business's currency, annual plans amortised. */
  mrr: number
  lifetime_revenue: number
  churn_rate: number
  renewing_30d: number
}

const PLAN_SELECT =
  'id, business_id, program_id, name, description, price, currency, interval, included_balance, ' +
  'earn_multiplier, perks, trial_days, max_members, member_count, is_active, is_public, sort_order, stripe_price_id'

function mapPlan(row: Record<string, unknown>): MembershipPlan {
  return {
    id: row.id as string,
    businessId: row.business_id as string,
    programId: (row.program_id as string) ?? null,
    name: row.name as string,
    description: (row.description as string) ?? null,
    price: num(row.price),
    currency: (row.currency as string) ?? 'EUR',
    interval: (row.interval as MembershipInterval) ?? 'month',
    includedBalance: num(row.included_balance),
    earnMultiplier: num(row.earn_multiplier, 1),
    perks: Array.isArray(row.perks) ? (row.perks as string[]) : [],
    trialDays: num(row.trial_days),
    maxMembers: row.max_members === null ? null : num(row.max_members),
    memberCount: num(row.member_count),
    isActive: Boolean(row.is_active),
    isPublic: Boolean(row.is_public),
    sortOrder: num(row.sort_order),
    stripePriceId: (row.stripe_price_id as string) ?? null,
  }
}

// -----------------------------------------------------------------------------
// Plans
// -----------------------------------------------------------------------------

export async function listMembershipPlans(
  businessId: string,
  options: { includeInactive?: boolean; publicOnly?: boolean } = {}
): Promise<MembershipPlan[]> {
  const admin = getDb()
  let request = admin
    .from('membership_plans')
    .select(PLAN_SELECT)
    .eq('business_id', businessId)
    .order('sort_order')
    .order('price')

  if (!options.includeInactive) request = request.eq('is_active', true)
  if (options.publicOnly) request = request.eq('is_public', true)

  const { data, error } = await request
  if (error) throw unprocessable(error.message)
  return (data ?? []).map((row) => mapPlan(row as unknown as Record<string, unknown>))
}

export type UpsertPlanInput = {
  businessId: string
  id?: string | null
  programId?: string | null
  name: string
  description?: string | null
  price: number
  interval: MembershipInterval
  includedBalance?: number
  earnMultiplier?: number
  perks?: string[]
  trialDays?: number
  maxMembers?: number | null
  isActive?: boolean
  isPublic?: boolean
  sortOrder?: number
  stripePriceId?: string | null
}

export async function upsertMembershipPlan(input: UpsertPlanInput): Promise<MembershipPlan> {
  const admin = getDb()

  if (input.earnMultiplier !== undefined && (input.earnMultiplier < 1 || input.earnMultiplier > 10)) {
    throw unprocessable('The earn multiplier must be between 1× and 10×')
  }

  // Default the program to the business's main one so a merchant creating their
  // first membership does not have to understand the program model first.
  let programId = input.programId ?? null
  if (programId === null && !input.id) {
    const { data: program } = await admin
      .from('loyalty_programs')
      .select('id')
      .eq('business_id', input.businessId)
      .eq('is_default', true)
      .maybeSingle()
    programId = (program?.id as string) ?? null
  }

  const row = {
    business_id: input.businessId,
    program_id: programId,
    name: input.name,
    description: input.description ?? null,
    price: input.price,
    interval: input.interval,
    included_balance: input.includedBalance ?? 0,
    earn_multiplier: input.earnMultiplier ?? 1,
    perks: input.perks ?? [],
    trial_days: input.trialDays ?? 0,
    max_members: input.maxMembers ?? null,
    is_active: input.isActive ?? true,
    is_public: input.isPublic ?? true,
    sort_order: input.sortOrder ?? 0,
    stripe_price_id: input.stripePriceId ?? null,
  }

  const query = input.id
    ? admin.from('membership_plans').update(row).eq('id', input.id).eq('business_id', input.businessId)
    : admin.from('membership_plans').insert(row)

  const { data, error } = await query.select(PLAN_SELECT).maybeSingle()

  if (error) throw unprocessable(error.message)
  if (!data) throw notFound('Membership plan')
  return mapPlan(data as unknown as Record<string, unknown>)
}

/**
 * Retires a plan without touching anyone already on it.
 *
 * Deleting would cascade away live memberships and the revenue history behind
 * them. Existing members keep their benefits until they cancel; the plan simply
 * stops accepting new ones.
 */
export async function archiveMembershipPlan(
  businessId: string,
  planId: string
): Promise<{ archived: boolean; activeMembers: number }> {
  const admin = getDb()

  const { count } = await admin
    .from('customer_memberships')
    .select('id', { count: 'exact', head: true })
    .eq('plan_id', planId)
    .eq('business_id', businessId)
    .eq('status', 'active')

  const { error } = await admin
    .from('membership_plans')
    .update({ is_active: false, is_public: false })
    .eq('id', planId)
    .eq('business_id', businessId)

  if (error) throw unprocessable(error.message)
  return { archived: true, activeMembers: count ?? 0 }
}

// -----------------------------------------------------------------------------
// Memberships
// -----------------------------------------------------------------------------

export type EnrolResult = {
  alreadyMember: boolean
  reactivated: boolean
  membershipId: string
  planName: string
  currentPeriodEnd: string | null
  grantedBalance: number
}

export async function enrolMember(input: {
  businessId: string
  customerId: string
  planId: string
  source?: string
  stripeSubscriptionId?: string | null
}): Promise<EnrolResult> {
  const admin = getDb()
  const { data, error } = await admin.rpc('passimo_enroll_membership', {
    p_business_id: input.businessId,
    p_customer_id: input.customerId,
    p_plan_id: input.planId,
    p_source: input.source ?? 'manual',
    p_stripe_subscription_id: input.stripeSubscriptionId ?? null,
  })

  if (error) {
    if (error.hint === 'membership_full') {
      throw conflict('This membership is full. Raise the member cap to add more.')
    }
    if (error.code === 'P0002') throw notFound('Membership plan')
    throw unprocessable(error.message)
  }

  const payload = data as {
    already_member: boolean
    reactivated?: boolean
    membership_id: string
    plan_name?: string
    current_period_end: string | null
    granted_balance?: number | string
  }

  const result: EnrolResult = {
    alreadyMember: payload.already_member,
    reactivated: Boolean(payload.reactivated),
    membershipId: payload.membership_id,
    planName: payload.plan_name ?? '',
    currentPeriodEnd: payload.current_period_end,
    grantedBalance: num(payload.granted_balance),
  }

  if (!result.alreadyMember) {
    await Promise.allSettled([
      notify(input.businessId, {
        type: 'membership',
        severity: 'success',
        title: result.reactivated ? 'A member came back' : 'New member',
        body: `${result.planName} — recurring revenue you can count on.`,
        url: `/dashboard/customers/${input.customerId}`,
      }),
      enqueue(
        'webhook.deliver',
        {
          businessId: input.businessId,
          event: 'membership.started',
          data: {
            membership_id: result.membershipId,
            customer_id: input.customerId,
            plan_id: input.planId,
          },
        },
        { businessId: input.businessId }
      ),
    ])
  }

  return result
}

/**
 * Cancels a membership.
 *
 * Defaults to end-of-period, because taking away benefits someone has already
 * paid for is the fastest way to turn a cancellation into a chargeback.
 */
export async function cancelMembership(input: {
  businessId: string
  membershipId: string
  immediately?: boolean
}): Promise<{ status: MembershipStatus; endsAt: string | null }> {
  const admin = getDb()

  const patch = input.immediately
    ? { status: 'cancelled', cancelled_at: new Date().toISOString(), cancel_at_period_end: false }
    : { cancel_at_period_end: true, cancelled_at: new Date().toISOString() }

  const { data, error } = await admin
    .from('customer_memberships')
    .update(patch)
    .eq('id', input.membershipId)
    .eq('business_id', input.businessId)
    .select('status, current_period_end, plan_id')
    .maybeSingle()

  if (error) throw unprocessable(error.message)
  if (!data) throw notFound('Membership')

  await refreshMemberCount(data.plan_id as string)

  return {
    status: data.status as MembershipStatus,
    endsAt: input.immediately ? null : ((data.current_period_end as string) ?? null),
  }
}

export async function listMembers(
  businessId: string,
  options: { planId?: string; status?: MembershipStatus | 'all'; limit?: number; offset?: number } = {}
) {
  const admin = getDb()
  const limit = Math.min(options.limit ?? 50, 200)
  const offset = options.offset ?? 0

  let request = admin
    .from('customer_memberships')
    .select(
      'id, customer_id, plan_id, status, started_at, current_period_end, cancel_at_period_end, ' +
        'periods_billed, lifetime_value, source, ' +
        'customers(id, name, first_name, last_name, email, avatar_url), ' +
        'membership_plans(name, price, currency, interval)',
      { count: 'exact' }
    )
    .eq('business_id', businessId)
    .order('started_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (options.planId) request = request.eq('plan_id', options.planId)
  if (options.status && options.status !== 'all') request = request.eq('status', options.status)

  const { data, count, error } = await request
  if (error) throw unprocessable(error.message)

  return { members: data ?? [], total: count ?? 0 }
}

export async function getMembershipStats(businessId: string): Promise<MembershipStats> {
  const admin = getDb()
  const { data, error } = await admin.rpc('passimo_membership_stats', {
    p_business_id: businessId,
  })

  if (error) {
    logger.warn('memberships.stats_failed', { business_id: businessId, error })
    return {
      active_members: 0,
      cancelled_members: 0,
      mrr: 0,
      lifetime_revenue: 0,
      churn_rate: 0,
      renewing_30d: 0,
    }
  }

  const raw = (data ?? {}) as Record<string, unknown>
  return {
    active_members: num(raw.active_members),
    cancelled_members: num(raw.cancelled_members),
    mrr: num(raw.mrr),
    lifetime_revenue: num(raw.lifetime_revenue),
    churn_rate: num(raw.churn_rate),
    renewing_30d: num(raw.renewing_30d),
  }
}

/** Memberships a single customer holds. Rendered on their CRM profile. */
export async function membershipsForCustomer(businessId: string, customerId: string) {
  const admin = getDb()
  const { data } = await admin
    .from('customer_memberships')
    .select(
      'id, status, started_at, current_period_end, cancel_at_period_end, periods_billed, ' +
        'lifetime_value, membership_plans(id, name, price, currency, interval, perks, earn_multiplier)'
    )
    .eq('business_id', businessId)
    .eq('customer_id', customerId)
    .order('started_at', { ascending: false })

  return data ?? []
}

export async function renewMemberships(
  businessId: string | null
): Promise<{ renewed: number; expired: number }> {
  const admin = getDb()
  const { data, error } = await admin.rpc('passimo_renew_memberships', {
    p_business_id: businessId,
  })

  if (error) {
    logger.error('memberships.renew_failed', { business_id: businessId, error })
    return { renewed: 0, expired: 0 }
  }

  const payload = (data ?? {}) as Record<string, unknown>
  return { renewed: num(payload.renewed), expired: num(payload.expired) }
}

async function refreshMemberCount(planId: string): Promise<void> {
  const admin = getDb()
  const { count } = await admin
    .from('customer_memberships')
    .select('id', { count: 'exact', head: true })
    .eq('plan_id', planId)
    .eq('status', 'active')

  await admin.from('membership_plans').update({ member_count: count ?? 0 }).eq('id', planId)
}
