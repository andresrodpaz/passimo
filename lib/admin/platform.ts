import 'server-only'
import { getDb } from '@/lib/db'
import { logger } from '@/lib/logger'
import { num } from '@/lib/domain/types'
import { PLANS, TRIAL_EXPIRED_PLAN, normalizePlanId, type PlanId } from '@/lib/billing/plans'
import { capabilityReport } from '@/lib/env'
import { walletService } from '@/lib/wallet/service'

/**
 * Platform-wide reads for the admin console.
 *
 * Everything here crosses tenant boundaries, which is exactly why it lives in one
 * file rather than being sprinkled across admin routes: there is a single place to
 * audit for "does this query forget to scope by business, and is that deliberate?"
 *
 * Runs through the service role and is only ever reachable behind
 * `requirePlatformAdmin`.
 */

export type PlatformOverview = {
  businesses: {
    total: number
    active: number
    trialing: number
    lapsed: number
  }
  customersTotal: number
  scansLast30d: number
  walletPasses: number
  /** Monthly recurring revenue in minor units, from live subscriptions. */
  mrrCents: number
  planBreakdown: Array<{ plan: PlanId; label: string; count: number; mrrCents: number }>
  /** Which integrations this deployment has credentials for. */
  capabilities: ReturnType<typeof capabilityReport>
  walletProviders: ReturnType<ReturnType<typeof walletService>['status']>
}

const MONTHLY_CENTS: Record<PlanId, number> = {
  lapsed: 0,
  starter: 500,
  growth: 1_900,
  pro: 4_900,
  business: 9_900,
}

export async function getPlatformOverview(): Promise<PlatformOverview> {
  const admin = getDb()

  const [overviewResult, planResult] = await Promise.allSettled([
    admin.rpc('passimo_platform_overview'),
    admin.from('businesses').select('plan, subscription_status, plan_interval').limit(20_000),
  ])

  const overviewRows =
    overviewResult.status === 'fulfilled'
      ? (overviewResult.value.data as Array<Record<string, unknown>> | null)
      : null
  const row = Array.isArray(overviewRows) ? overviewRows[0] : null

  if (overviewResult.status === 'rejected') {
    logger.error('admin.overview_failed', { reason: overviewResult.reason })
  }

  const planBreakdown = new Map<PlanId, { count: number; mrrCents: number }>()
  if (planResult.status === 'fulfilled') {
    for (const business of planResult.value.data ?? []) {
      const plan = normalizePlanId(business.plan) ?? 'lapsed'
      const entry = planBreakdown.get(plan) ?? { count: 0, mrrCents: 0 }
      entry.count += 1
      // Only paying subscriptions contribute. Counting a lapsed or trialling
      // workspace as revenue is the fastest way to build a dashboard nobody
      // trusts.
      if (business.subscription_status === 'active' || business.subscription_status === 'trialing') {
        // A yearly plan is ten months' price, so its monthly contribution is
        // 10/12 of the list rate — reporting the list rate would overstate MRR.
        entry.mrrCents +=
          business.plan_interval === 'year'
            ? Math.round((MONTHLY_CENTS[plan] * 10) / 12)
            : MONTHLY_CENTS[plan]
      }
      planBreakdown.set(plan, entry)
    }
  }

  return {
    businesses: {
      total: num(row?.businesses_total),
      active: num(row?.businesses_active),
      trialing: num(row?.businesses_trialing),
      lapsed: num(row?.businesses_lapsed),
    },
    customersTotal: num(row?.customers_total),
    scansLast30d: num(row?.scans_last_30d),
    walletPasses: num(row?.wallet_passes),
    mrrCents: [...planBreakdown.values()].reduce((total, entry) => total + entry.mrrCents, 0),
    planBreakdown: (Object.keys(PLANS) as PlanId[]).map((plan) => ({
      plan,
      label: PLANS[plan].name,
      count: planBreakdown.get(plan)?.count ?? 0,
      mrrCents: planBreakdown.get(plan)?.mrrCents ?? 0,
    })),
    capabilities: capabilityReport(),
    walletProviders: walletService().status(),
  }
}

export type AdminBusinessRow = {
  id: string
  name: string
  slug: string
  plan: PlanId
  planLabel: string
  subscriptionStatus: string | null
  trialEndsAt: string | null
  createdAt: string
  ownerEmail: string | null
  customerCount: number
  locationCount: number
  lastActivityAt: string | null
}

/**
 * The business list, with the counts an operator needs to triage.
 *
 * Counts come from two grouped reads rather than a per-row subquery, because the
 * console lists 50 businesses at a time and 100 extra round trips to render a table
 * is how an admin screen becomes the slowest page in the product.
 */
export async function listBusinesses(options: {
  q?: string
  plan?: PlanId
  status?: 'active' | 'trialing' | 'lapsed'
  limit?: number
  offset?: number
}): Promise<{ businesses: AdminBusinessRow[]; total: number }> {
  const admin = getDb()
  const limit = options.limit ?? 50
  const offset = options.offset ?? 0

  let query = admin
    .from('businesses')
    .select(
      'id, name, slug, plan, subscription_status, trial_ends_at, created_at, support_email, updated_at',
      { count: 'exact' }
    )
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (options.q) {
    query = query.or(`name.ilike.%${options.q}%,slug.ilike.%${options.q}%`)
  }
  if (options.plan) query = query.eq('plan', options.plan)
  if (options.status === 'active') query = query.eq('subscription_status', 'active')

  /*
   * "Trialling" and "lapsed" are the same stored plan seen on either side of a
   * date, so neither can be filtered on `plan` alone — these mirror the rules in
   * `resolveEntitlements`. Filtering trials on `plan = 'trial'` matched only the
   * pre-migration-15 legacy value, so the admin list came back all but empty
   * while every current trial (status `trialing`, plan `lapsed`) was missed.
   */
  const nowIso = new Date().toISOString()
  if (options.status === 'trialing') {
    query = query
      .gt('trial_ends_at', nowIso)
      .or('subscription_status.eq.trialing,plan.eq.trial,plan.eq.lapsed')
  }
  if (options.status === 'lapsed') {
    query = query
      .eq('plan', TRIAL_EXPIRED_PLAN)
      .or(`trial_ends_at.is.null,trial_ends_at.lte.${nowIso}`)
  }

  const { data, count, error } = await query
  if (error) throw error

  const ids = (data ?? []).map((row) => row.id as string)
  const [customerCounts, locationCounts] = await Promise.all([
    countBy('customers', ids),
    countBy('locations', ids),
  ])

  return {
    businesses: (data ?? []).map((row) => {
      const plan = normalizePlanId(row.plan) ?? 'lapsed'
      return {
        id: row.id as string,
        name: row.name as string,
        slug: row.slug as string,
        plan,
        planLabel: PLANS[plan].name,
        subscriptionStatus: (row.subscription_status as string) ?? null,
        trialEndsAt: (row.trial_ends_at as string) ?? null,
        createdAt: row.created_at as string,
        ownerEmail: (row.support_email as string) ?? null,
        customerCount: customerCounts.get(row.id as string) ?? 0,
        locationCount: locationCounts.get(row.id as string) ?? 0,
        lastActivityAt: (row.updated_at as string) ?? null,
      }
    }),
    total: count ?? 0,
  }
}

async function countBy(table: string, businessIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  if (businessIds.length === 0) return counts

  const admin = getDb()
  const { data } = await admin
    .from(table)
    .select('business_id')
    .in('business_id', businessIds)
    .limit(200_000)

  for (const row of data ?? []) {
    const id = row.business_id as string
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return counts
}

/** Everything about one business, for the admin detail drawer. */
export async function getBusinessDetail(businessId: string): Promise<Record<string, unknown> | null> {
  const admin = getDb()

  const [{ data: business }, { data: team }, { data: recentImpersonations }] = await Promise.all([
    admin.from('businesses').select('*').eq('id', businessId).maybeSingle(),
    admin
      .from('team_members')
      .select('id, role, status, display_name, invited_email, last_active_at')
      .eq('business_id', businessId)
      .limit(50),
    admin
      .from('admin_impersonations')
      .select('id, reason, started_at, ended_at, expires_at')
      .eq('business_id', businessId)
      .order('started_at', { ascending: false })
      .limit(10),
  ])

  if (!business) return null

  const plan = normalizePlanId(business.plan) ?? 'lapsed'
  return {
    business: { ...business, plan, plan_label: PLANS[plan].name },
    team: team ?? [],
    impersonations: recentImpersonations ?? [],
  }
}

/** The impersonation audit trail, newest first. Read by the admin console. */
export async function listImpersonations(limit = 50): Promise<
  Array<{
    id: string
    reason: string
    startedAt: string
    endedAt: string | null
    expiresAt: string
    businessId: string
    adminUserId: string
  }>
> {
  const admin = getDb()
  const { data } = await admin
    .from('admin_impersonations')
    .select('id, reason, started_at, ended_at, expires_at, business_id, admin_user_id')
    .order('started_at', { ascending: false })
    .limit(limit)

  return (data ?? []).map((row) => ({
    id: row.id as string,
    reason: row.reason as string,
    startedAt: row.started_at as string,
    endedAt: (row.ended_at as string) ?? null,
    expiresAt: row.expires_at as string,
    businessId: row.business_id as string,
    adminUserId: row.admin_user_id as string,
  }))
}
