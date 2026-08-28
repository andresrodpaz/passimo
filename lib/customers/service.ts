import 'server-only'
import { getDb } from '@/lib/db'
import { notFound } from '@/lib/errors'
import { num, numOrNull, type Customer, type RfmSegment } from '@/lib/domain/types'
import { compileSegment } from '@/lib/segments/compile'
import { resolveSegmentDefinition } from '@/lib/segments/resolve'

/**
 * Customer reads.
 *
 * One place that knows how a customer row becomes the `Customer` domain object,
 * so list, detail, export and the POS lookup can never drift apart in what they
 * consider "the balance" or "the name".
 */

const LIST_COLUMNS = `
  id, business_id, email, name, first_name, last_name, phone, birthday, anniversary,
  locale, avatar_url, is_vip, status, source, referral_code, referred_by, notes_count,
  consent_email, consent_sms, consent_whatsapp, consent_push, consent_marketing,
  consent_updated_at, consent_source,
  first_visit_at, last_visit, visit_count, lifetime_spend, average_ticket,
  days_between_visits, rfm_segment, churn_risk, predicted_clv, created_at
`

export type CustomerListItem = Customer & {
  primaryBalance: number
  primaryGoal: number | null
  rewardAvailable: boolean
  tierName: string | null
}

export type ListCustomersOptions = {
  businessId: string
  q?: string
  segmentId?: string
  tag?: string
  vip?: boolean
  rfm?: string
  sort?: 'recent' | 'name' | 'spend' | 'visits' | 'balance' | 'churn'
  limit: number
  offset: number
}

export async function listCustomers(options: ListCustomersOptions): Promise<{
  customers: CustomerListItem[]
  total: number
}> {
  const admin = getDb()

  // A saved segment narrows the id set first; everything else is expressed as
  // a normal filtered query so Postgres can use the indexes.
  let segmentIds: string[] | null = null
  if (options.segmentId) {
    const definition = await resolveSegmentDefinition(options.businessId, options.segmentId)
    const { sql, params } = compileSegment(definition)
    const { data } = await admin.rpc('passimo_segment_customer_ids', {
      p_business_id: options.businessId,
      p_predicate: sql,
      p_params: params,
      p_limit: 20000,
      p_offset: 0,
    })
    const ids = (data ?? []).map((row: { id: string }) => row.id)
    if (ids.length === 0) return { customers: [], total: 0 }
    segmentIds = ids
  }

  let query = admin
    .from('customers')
    .select(LIST_COLUMNS, { count: 'exact' })
    .eq('business_id', options.businessId)
    .neq('status', 'anonymized')
    .is('merged_into_customer_id', null)

  if (segmentIds) query = query.in('id', segmentIds)
  if (options.vip !== undefined) query = query.eq('is_vip', options.vip)
  if (options.rfm) query = query.eq('rfm_segment', options.rfm)

  if (options.q) {
    const term = options.q.replace(/[%,()]/g, '').trim()
    if (term) {
      query = query.or(
        `name.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%,first_name.ilike.%${term}%,last_name.ilike.%${term}%`
      )
    }
  }

  if (options.tag) {
    const { data: tagged } = await admin
      .from('customer_tags')
      .select('customer_id, tags!inner(name)')
      .eq('business_id', options.businessId)
      .eq('tags.name', options.tag)
      .limit(20000)
    const ids = (tagged ?? []).map((row) => row.customer_id as string)
    if (ids.length === 0) return { customers: [], total: 0 }
    query = query.in('id', ids)
  }

  switch (options.sort) {
    case 'name':
      query = query.order('name', { ascending: true, nullsFirst: false })
      break
    case 'spend':
      query = query.order('lifetime_spend', { ascending: false })
      break
    case 'visits':
      query = query.order('visit_count', { ascending: false })
      break
    case 'churn':
      query = query.order('churn_risk', { ascending: false, nullsFirst: false })
      break
    default:
      query = query.order('created_at', { ascending: false })
  }

  const { data, count, error } = await query.range(
    options.offset,
    options.offset + options.limit - 1
  )
  if (error) throw error

  const rows = data ?? []
  const ids = rows.map((row) => row.id as string)
  const [balances, tags] = await Promise.all([loadBalances(ids), loadTags(options.businessId, ids)])

  let customers = rows.map((row) =>
    mapCustomer(row as Record<string, unknown>, balances, tags)
  )

  // Balance is not a customers column, so it is sorted after enrichment.
  if (options.sort === 'balance') {
    customers = [...customers].sort((a, b) => b.primaryBalance - a.primaryBalance)
  }

  return { customers, total: count ?? customers.length }
}

export async function getCustomer(
  businessId: string,
  customerId: string
): Promise<CustomerListItem> {
  const admin = getDb()
  const { data } = await admin
    .from('customers')
    .select(LIST_COLUMNS)
    .eq('id', customerId)
    .eq('business_id', businessId)
    .maybeSingle()

  if (!data) throw notFound('Customer')

  const [balances, tags] = await Promise.all([
    loadBalances([customerId]),
    loadTags(businessId, [customerId]),
  ])
  return mapCustomer(data as Record<string, unknown>, balances, tags)
}

/** Full profile for the customer detail drawer. */
export async function getCustomerProfile(businessId: string, customerId: string) {
  const admin = getDb()
  const customer = await getCustomer(businessId, customerId)

  const [activity, ledger, redemptions, notes, messages, referrals, surveys, memberships] =
    await Promise.all([
    admin
      .from('activity_events')
      .select('id, type, amount, currency, quantity, source, occurred_at, metadata')
      .eq('customer_id', customerId)
      .order('occurred_at', { ascending: false })
      .limit(50),
    admin
      .from('loyalty_ledger')
      .select('id, entry_type, amount, balance_after, reason, expires_at, created_at, program_id')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(50),
    admin
      .from('reward_redemptions')
      .select('id, code, cost, status, created_at, expires_at, rewards:reward_id (name)')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(30),
    admin
      .from('customer_notes')
      .select('id, body, pinned, author_name, created_at')
      .eq('customer_id', customerId)
      .order('pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(30),
    admin
      .from('messages')
      .select('id, channel, subject, status, sent_at, opened_at, clicked_at, skip_reason')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(20),
    admin
      .from('referrals')
      .select('id, status, referred_email, created_at')
      .eq('referrer_customer_id', customerId)
      .limit(20),
    admin
      .from('survey_responses')
      .select('id, score, scale_max, comment, responded_at')
      .eq('customer_id', customerId)
      .order('responded_at', { ascending: false })
      .limit(10),
    // A paying member is the highest-value fact about a customer, so staff see
    // it on the profile rather than having to open a separate screen.
    admin
      .from('customer_memberships')
      .select(
        'id, status, started_at, current_period_end, cancel_at_period_end, periods_billed, ' +
          'lifetime_value, membership_plans(id, name, price, currency, interval, earn_multiplier)'
      )
      .eq('business_id', businessId)
      .eq('customer_id', customerId)
      .order('started_at', { ascending: false })
      .limit(10),
  ])

  return {
    customer,
    activity: activity.data ?? [],
    ledger: (ledger.data ?? []).map((entry) => ({
      ...entry,
      amount: num(entry.amount),
      balance_after: num(entry.balance_after),
    })),
    redemptions: redemptions.data ?? [],
    notes: notes.data ?? [],
    messages: messages.data ?? [],
    referrals: referrals.data ?? [],
    surveys: surveys.data ?? [],
    memberships: memberships.data ?? [],
  }
}

/**
 * Point-of-sale lookup: fast, forgiving, and ranked so the person standing at
 * the counter is the first result. Matches on email, phone, name or card id.
 */
export async function lookupCustomers(
  businessId: string,
  term: string,
  limit = 8
): Promise<CustomerListItem[]> {
  const cleaned = term.trim()
  if (cleaned.length < 2) return []

  const admin = getDb()
  const escaped = cleaned.replace(/[%,()]/g, '')

  // A scanned card gives us the exact id — short-circuit the fuzzy search.
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleaned)) {
    const { data } = await admin
      .from('customers')
      .select(LIST_COLUMNS)
      .eq('business_id', businessId)
      .eq('id', cleaned)
      .maybeSingle()
    if (data) {
      const ids = [data.id as string]
      const [balances, tags] = await Promise.all([loadBalances(ids), loadTags(businessId, ids)])
      return [mapCustomer(data as Record<string, unknown>, balances, tags)]
    }
  }

  const { data } = await admin
    .from('customers')
    .select(LIST_COLUMNS)
    .eq('business_id', businessId)
    .eq('status', 'active')
    .is('merged_into_customer_id', null)
    .or(
      `email.ilike.%${escaped}%,phone.ilike.%${escaped}%,name.ilike.%${escaped}%,first_name.ilike.%${escaped}%,last_name.ilike.%${escaped}%`
    )
    .order('last_visit', { ascending: false, nullsFirst: false })
    .limit(limit)

  const rows = data ?? []
  const ids = rows.map((row) => row.id as string)
  const [balances, tags] = await Promise.all([loadBalances(ids), loadTags(businessId, ids)])
  return rows.map((row) => mapCustomer(row as Record<string, unknown>, balances, tags))
}

/**
 * The counter roster: who to offer when the camera is unavailable.
 *
 * A merchant whose camera is broken, whose customer forgot their phone, or who
 * is simply faster with their thumbs must still be able to serve people. In a
 * real shop the person at the counter is nearly always someone who was here
 * recently or is a regular, so those two lists resolve most check-ins in one tap
 * without typing anything at all.
 */
export async function getCounterRoster(
  businessId: string,
  limit = 12
): Promise<{ recent: CustomerListItem[]; vip: CustomerListItem[] }> {
  const admin = getDb()

  const base = () =>
    admin
      .from('customers')
      .select(LIST_COLUMNS)
      .eq('business_id', businessId)
      .eq('status', 'active')
      .is('merged_into_customer_id', null)

  const [recentResult, vipResult] = await Promise.all([
    base().not('last_visit', 'is', null).order('last_visit', { ascending: false }).limit(limit),
    // Ordered by spend, not by flag alone: "VIP" is a shortcut to the customers
    // worth recognising by name, and spend is the honest ranking of that.
    base().eq('is_vip', true).order('lifetime_spend', { ascending: false }).limit(limit),
  ])

  const rows = [...(recentResult.data ?? []), ...(vipResult.data ?? [])]
  const ids = [...new Set(rows.map((row) => row.id as string))]
  const [balances, tags] = await Promise.all([loadBalances(ids), loadTags(businessId, ids)])

  const map = (list: typeof rows) =>
    list.map((row) => mapCustomer(row as Record<string, unknown>, balances, tags))

  return {
    recent: map(recentResult.data ?? []),
    vip: map(vipResult.data ?? []),
  }
}

// -----------------------------------------------------------------------------
// Enrichment
// -----------------------------------------------------------------------------

type BalanceInfo = {
  balance: number
  goal: number | null
  rewardAvailable: boolean
  tierName: string | null
}

async function loadBalances(customerIds: string[]): Promise<Map<string, BalanceInfo>> {
  const map = new Map<string, BalanceInfo>()
  if (customerIds.length === 0) return map

  const admin = getDb()
  const { data } = await admin
    .from('loyalty_accounts')
    .select(
      'customer_id, balance, loyalty_programs:program_id (goal_amount, is_default), program_tiers:tier_id (name)'
    )
    .in('customer_id', customerIds)

  for (const row of data ?? []) {
    const program = row.loyalty_programs as unknown as {
      goal_amount: number | null
      is_default: boolean
    } | null
    const tier = row.program_tiers as unknown as { name: string } | null
    const customerId = row.customer_id as string
    const balance = num(row.balance)
    const goal = numOrNull(program?.goal_amount)

    const existing = map.get(customerId)
    // Prefer the default program's numbers when a customer has several.
    if (!existing || program?.is_default) {
      map.set(customerId, {
        balance,
        goal,
        rewardAvailable: goal != null && balance >= goal,
        tierName: tier?.name ?? null,
      })
    }
  }
  return map
}

async function loadTags(
  businessId: string,
  customerIds: string[]
): Promise<Map<string, Customer['tags']>> {
  const map = new Map<string, Customer['tags']>()
  if (customerIds.length === 0) return map

  const admin = getDb()
  const { data } = await admin
    .from('customer_tags')
    .select('customer_id, tags:tag_id (id, name, color)')
    .eq('business_id', businessId)
    .in('customer_id', customerIds)

  for (const row of data ?? []) {
    const tag = row.tags as unknown as { id: string; name: string; color: string } | null
    if (!tag) continue
    const customerId = row.customer_id as string
    const list = map.get(customerId) ?? []
    list.push(tag)
    map.set(customerId, list)
  }
  return map
}

function mapCustomer(
  row: Record<string, unknown>,
  balances: Map<string, BalanceInfo>,
  tags: Map<string, Customer['tags']>
): CustomerListItem {
  const id = row.id as string
  const balance = balances.get(id)

  return {
    id,
    businessId: row.business_id as string,
    email: (row.email as string) ?? '',
    name: (row.name as string) ?? null,
    firstName: (row.first_name as string) ?? null,
    lastName: (row.last_name as string) ?? null,
    phone: (row.phone as string) ?? null,
    birthday: (row.birthday as string) ?? null,
    anniversary: (row.anniversary as string) ?? null,
    locale: (row.locale as string) ?? null,
    avatarUrl: (row.avatar_url as string) ?? null,
    isVip: Boolean(row.is_vip),
    status: (row.status as Customer['status']) ?? 'active',
    source: (row.source as string) ?? 'qr',
    referralCode: (row.referral_code as string) ?? null,
    referredBy: (row.referred_by as string) ?? null,
    notesCount: num(row.notes_count),
    tags: tags.get(id) ?? [],
    consents: {
      email: Boolean(row.consent_email),
      sms: Boolean(row.consent_sms),
      whatsapp: Boolean(row.consent_whatsapp),
      push: Boolean(row.consent_push),
      marketing: Boolean(row.consent_marketing),
      updatedAt: (row.consent_updated_at as string) ?? null,
      source: (row.consent_source as string) ?? null,
    },
    firstVisitAt: (row.first_visit_at as string) ?? null,
    lastVisit: (row.last_visit as string) ?? null,
    visitCount: num(row.visit_count),
    lifetimeSpend: num(row.lifetime_spend),
    averageTicket: num(row.average_ticket),
    daysBetweenVisits: numOrNull(row.days_between_visits),
    rfmSegment: (row.rfm_segment as RfmSegment) ?? null,
    churnRisk: numOrNull(row.churn_risk),
    predictedClv: numOrNull(row.predicted_clv),
    createdAt: row.created_at as string,
    accounts: [],
    primaryBalance: balance?.balance ?? 0,
    primaryGoal: balance?.goal ?? null,
    rewardAvailable: balance?.rewardAvailable ?? false,
    tierName: balance?.tierName ?? null,
  }
}
