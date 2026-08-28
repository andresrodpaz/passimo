import 'server-only'
import { getDb } from '@/lib/db'
import { logger } from '@/lib/logger'
import { num } from '@/lib/domain/types'

/**
 * Proximity analytics.
 *
 * Answers the only question a merchant actually asks about this feature: *"is it
 * bringing people in, and is it worth what I pay for it?"*
 *
 * Two decisions about honesty, because analytics is where a product is most
 * tempted to flatter itself:
 *
 *   * **Conversion is attributed, not assumed.** A visit only counts as a
 *     conversion when the event carries a `source_event_id` pointing back to a
 *     notification within the attribution window. A regular's daily coffee is not
 *     a conversion, and counting it would let us report a rate we have not earned.
 *
 *   * **ROI is reported as null, not zero, when unknown.** A merchant who has not
 *     configured transaction amounts should see "—", not "$0 return", which reads
 *     as a failure rather than as missing data.
 */

export type ProximityFunnel = {
  suggestions: number
  notificationsSent: number
  impressions: number
  clicks: number
  walletOpens: number
  storeVisits: number
  redemptions: number
  passesInstalled: number
  passesRemoved: number
  geofenceEntries: number
  revenueCents: number
  /** Minutes between a notification and the visit it produced. */
  averageVisitDelayMinutes: number | null
  uniqueCustomers: number
}

export type ProximityRates = {
  /** Clicks ÷ notifications sent. */
  clickThrough: number | null
  /** Attributed visits ÷ notifications sent — the number that matters. */
  conversion: number | null
  /** Redemptions ÷ attributed visits. */
  redemption: number | null
  /** Revenue per notification sent, in minor units. */
  revenuePerNotificationCents: number | null
}

export type CampaignPerformance = {
  campaignId: string
  name: string
  kind: string
  status: string
  sent: number
  impressions: number
  clicks: number
  visits: number
  redemptions: number
  revenueCents: number
  conversion: number | null
  /**
   * Revenue per notification. The ranking metric, deliberately: a campaign with a
   * 40% click rate and no visits annoyed people, and sorting by clicks would hide
   * that from the person paying for it.
   */
  revenuePerSendCents: number | null
}

export type LocationPerformance = {
  locationId: string
  name: string
  entries: number
  notifications: number
  visits: number
  revenueCents: number
}

export type ProximityAnalytics = {
  range: { from: string; to: string }
  funnel: ProximityFunnel
  rates: ProximityRates
  campaigns: CampaignPerformance[]
  locations: LocationPerformance[]
  /** Daily notification and visit counts, for the trend chart. */
  timeline: Array<{ date: string; notifications: number; visits: number; revenueCents: number }>
}

const EMPTY_FUNNEL: ProximityFunnel = {
  suggestions: 0,
  notificationsSent: 0,
  impressions: 0,
  clicks: 0,
  walletOpens: 0,
  storeVisits: 0,
  redemptions: 0,
  passesInstalled: 0,
  passesRemoved: 0,
  geofenceEntries: 0,
  revenueCents: 0,
  averageVisitDelayMinutes: null,
  uniqueCustomers: 0,
}

function ratio(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null
  return Number((numerator / denominator).toFixed(4))
}

export function deriveRates(funnel: ProximityFunnel): ProximityRates {
  return {
    clickThrough: ratio(funnel.clicks + funnel.walletOpens, funnel.notificationsSent),
    conversion: ratio(funnel.storeVisits, funnel.notificationsSent),
    redemption: ratio(funnel.redemptions, funnel.storeVisits),
    revenuePerNotificationCents:
      funnel.notificationsSent > 0
        ? Math.round(funnel.revenueCents / funnel.notificationsSent)
        : null,
  }
}

export async function getProximityAnalytics(
  businessId: string,
  options: { from?: Date; to?: Date } = {}
): Promise<ProximityAnalytics> {
  const to = options.to ?? new Date()
  const from = options.from ?? new Date(to.getTime() - 30 * 86_400_000)
  const range = { from: from.toISOString(), to: to.toISOString() }

  const admin = getDb()

  const [funnelResult, campaignResult, timelineResult, locationResult] = await Promise.allSettled([
    admin.rpc('passimo_proximity_analytics', {
      p_business_id: businessId,
      p_from: range.from,
      p_to: range.to,
    }),
    admin.rpc('passimo_proximity_campaign_performance', {
      p_business_id: businessId,
      p_from: range.from,
      p_to: range.to,
    }),
    admin
      .from('wallet_events')
      .select('type, occurred_at, revenue_cents')
      .eq('business_id', businessId)
      .in('type', ['notification_sent', 'store_visit'])
      .gte('occurred_at', range.from)
      .lt('occurred_at', range.to)
      .order('occurred_at')
      .limit(10_000),
    admin
      .from('wallet_events')
      .select('location_id, type, revenue_cents, locations:location_id (name)')
      .eq('business_id', businessId)
      .not('location_id', 'is', null)
      .gte('occurred_at', range.from)
      .lt('occurred_at', range.to)
      .limit(10_000),
  ])

  const funnel = readFunnel(funnelResult)
  const campaigns = readCampaigns(campaignResult)
  const timeline = readTimeline(timelineResult, from, to)
  const locations = readLocations(locationResult)

  return { range, funnel, rates: deriveRates(funnel), campaigns, locations, timeline }
}

type Settled<T> = PromiseSettledResult<T>

function readFunnel(result: Settled<{ data: unknown }>): ProximityFunnel {
  if (result.status !== 'fulfilled') {
    logger.warn('wallet.analytics_funnel_failed', { reason: result.reason })
    return EMPTY_FUNNEL
  }
  const rows = result.value.data as Array<Record<string, unknown>> | null
  const row = Array.isArray(rows) ? rows[0] : (rows as Record<string, unknown> | null)
  if (!row) return EMPTY_FUNNEL

  return {
    suggestions: num(row.suggestions),
    notificationsSent: num(row.notifications_sent),
    impressions: num(row.impressions),
    clicks: num(row.clicks),
    walletOpens: num(row.wallet_opens),
    storeVisits: num(row.store_visits),
    redemptions: num(row.redemptions),
    passesInstalled: num(row.passes_installed),
    passesRemoved: num(row.passes_removed),
    geofenceEntries: num(row.geofence_entries),
    revenueCents: num(row.revenue_cents),
    averageVisitDelayMinutes:
      row.avg_visit_delay_minutes === null || row.avg_visit_delay_minutes === undefined
        ? null
        : num(row.avg_visit_delay_minutes),
    uniqueCustomers: num(row.unique_customers),
  }
}

function readCampaigns(result: Settled<{ data: unknown }>): CampaignPerformance[] {
  if (result.status !== 'fulfilled') return []
  const rows = (result.value.data as Array<Record<string, unknown>> | null) ?? []

  return rows.map((row) => {
    const sent = num(row.sent)
    const visits = num(row.visits)
    const revenueCents = num(row.revenue_cents)
    return {
      campaignId: row.campaign_id as string,
      name: (row.name as string) ?? 'Campaign',
      kind: (row.kind as string) ?? 'custom',
      status: (row.status as string) ?? 'draft',
      sent,
      impressions: num(row.impressions),
      clicks: num(row.clicks),
      visits,
      redemptions: num(row.redemptions),
      revenueCents,
      conversion: ratio(visits, sent),
      revenuePerSendCents: sent > 0 ? Math.round(revenueCents / sent) : null,
    }
  })
}

function readTimeline(
  result: Settled<{ data: unknown }>,
  from: Date,
  to: Date
): ProximityAnalytics['timeline'] {
  const buckets = new Map<string, { notifications: number; visits: number; revenueCents: number }>()

  // Pre-seed every day in range so a chart shows a flat line rather than
  // collapsing two weeks of silence into a single point.
  for (let day = new Date(from); day < to; day = new Date(day.getTime() + 86_400_000)) {
    buckets.set(day.toISOString().slice(0, 10), { notifications: 0, visits: 0, revenueCents: 0 })
  }

  if (result.status === 'fulfilled') {
    for (const row of (result.value.data as Array<Record<string, unknown>> | null) ?? []) {
      const date = String(row.occurred_at).slice(0, 10)
      const bucket = buckets.get(date) ?? { notifications: 0, visits: 0, revenueCents: 0 }
      if (row.type === 'notification_sent') bucket.notifications += 1
      if (row.type === 'store_visit') {
        bucket.visits += 1
        bucket.revenueCents += num(row.revenue_cents)
      }
      buckets.set(date, bucket)
    }
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, values]) => ({ date, ...values }))
}

function readLocations(result: Settled<{ data: unknown }>): LocationPerformance[] {
  if (result.status !== 'fulfilled') return []
  const rows = (result.value.data as Array<Record<string, unknown>> | null) ?? []

  const byLocation = new Map<string, LocationPerformance>()
  for (const row of rows) {
    const id = row.location_id as string
    const name = (row.locations as { name?: string } | null)?.name ?? 'Location'
    const entry =
      byLocation.get(id) ??
      { locationId: id, name, entries: 0, notifications: 0, visits: 0, revenueCents: 0 }

    if (row.type === 'geofence_enter') entry.entries += 1
    if (row.type === 'notification_sent') entry.notifications += 1
    if (row.type === 'store_visit') {
      entry.visits += 1
      entry.revenueCents += num(row.revenue_cents)
    }
    byLocation.set(id, entry)
  }

  return [...byLocation.values()].sort((a, b) => b.visits - a.visits || b.entries - a.entries)
}

/**
 * A compact summary for the dashboard's overview card.
 *
 * Cheaper than the full analytics call because the overview screen loads six of
 * these and cannot afford four queries each.
 */
export async function getProximitySummary(
  businessId: string,
  days = 30
): Promise<{ funnel: ProximityFunnel; rates: ProximityRates }> {
  const to = new Date()
  const from = new Date(to.getTime() - days * 86_400_000)
  const admin = getDb()

  const [result] = await Promise.allSettled([
    admin.rpc('passimo_proximity_analytics', {
      p_business_id: businessId,
      p_from: from.toISOString(),
      p_to: to.toISOString(),
    }),
  ])

  const funnel = readFunnel(result)
  return { funnel, rates: deriveRates(funnel) }
}
