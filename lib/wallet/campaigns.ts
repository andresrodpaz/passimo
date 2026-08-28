import 'server-only'
import { getDb } from '@/lib/db'
import { notFound, unprocessable } from '@/lib/errors'
import { num } from '@/lib/domain/types'
import type { ProximityCampaignRule } from '@/lib/wallet/eligibility'
import { findTemplate, resolveTemplateCampaign } from '@/lib/wallet/templates'
import { translatorForBusiness } from '@/lib/i18n/business'
import type { GeofenceTrigger } from '@/lib/wallet/types'

/**
 * Proximity campaign store.
 *
 * Reads and writes `proximity_campaigns` and maps rows to the pure
 * `ProximityCampaignRule` the evaluator consumes. The evaluator stays free of
 * database concerns and this file stays free of eligibility logic, which is what
 * makes the interesting half — "would this send?" — testable without a database.
 */

export type ProximityCampaign = ProximityCampaignRule & {
  businessId: string
  kind: string
  description: string | null
  dwellMinutes: number | null
  radiusMeters: number | null

  title: string
  message: string
  emoji: string | null
  ctaLabel: string | null
  ctaUrl: string | null
  rewardDescription: string | null
  imageUrl: string | null
  backgroundColor: string | null
  textColor: string | null
  logoUrl: string | null
  expiresAt: string | null
  channels: string[]

  stats: {
    sent: number
    impressions: number
    clicks: number
    visits: number
    redemptions: number
    revenueCents: number
  }

  createdAt: string
  updatedAt: string
}

const SELECT = '*, proximity_campaign_locations (location_id)'

type CampaignRow = Record<string, unknown> & {
  proximity_campaign_locations?: Array<{ location_id: string }> | null
}

export function mapCampaign(row: CampaignRow): ProximityCampaign {
  const weekdays = Array.isArray(row.weekdays)
    ? (row.weekdays as number[]).map((day) => num(day))
    : [0, 1, 2, 3, 4, 5, 6]

  return {
    id: row.id as string,
    businessId: row.business_id as string,
    name: (row.name as string) ?? 'Campaign',
    kind: (row.kind as string) ?? 'custom',
    description: (row.description as string) ?? null,
    status: (row.status as ProximityCampaign['status']) ?? 'draft',
    trigger: ((row.trigger as GeofenceTrigger) ?? 'entry') as GeofenceTrigger,
    priority: num(row.priority),

    radiusMeters: row.radius_m === null || row.radius_m === undefined ? null : num(row.radius_m),
    dwellMinutes:
      row.dwell_minutes === null || row.dwell_minutes === undefined
        ? null
        : num(row.dwell_minutes),

    startsOn: (row.starts_on as string) ?? null,
    endsOn: (row.ends_on as string) ?? null,
    weekdays,
    startTime: (row.start_time as string) ?? null,
    endTime: (row.end_time as string) ?? null,

    allLocations: row.all_locations === undefined ? true : Boolean(row.all_locations),
    locationIds: (row.proximity_campaign_locations ?? []).map((link) => link.location_id),
    segmentId: (row.segment_id as string) ?? null,
    minTierLevel:
      row.min_tier_level === null || row.min_tier_level === undefined
        ? null
        : num(row.min_tier_level),
    minPoints:
      row.min_points === null || row.min_points === undefined ? null : num(row.min_points),
    minVisits:
      row.min_visits === null || row.min_visits === undefined ? null : num(row.min_visits),
    maxDaysSinceVisit:
      row.max_days_since_visit === null || row.max_days_since_visit === undefined
        ? null
        : num(row.max_days_since_visit),
    minDaysSinceVisit:
      row.min_days_since_visit === null || row.min_days_since_visit === undefined
        ? null
        : num(row.min_days_since_visit),
    vipOnly: Boolean(row.vip_only),
    eligibility: (row.eligibility as Record<string, unknown>) ?? {},

    cooldownHours: num(row.cooldown_hours, 24),
    maxSendsPerCustomer:
      row.max_sends_per_customer === null || row.max_sends_per_customer === undefined
        ? null
        : num(row.max_sends_per_customer),

    title: (row.title as string) ?? '',
    message: (row.message as string) ?? '',
    emoji: (row.emoji as string) ?? null,
    ctaLabel: (row.cta_label as string) ?? null,
    ctaUrl: (row.cta_url as string) ?? null,
    rewardDescription: (row.reward_description as string) ?? null,
    imageUrl: (row.image_url as string) ?? null,
    backgroundColor: (row.background_color as string) ?? null,
    textColor: (row.text_color as string) ?? null,
    logoUrl: (row.logo_url as string) ?? null,
    expiresAt: (row.expires_at as string) ?? null,
    channels: Array.isArray(row.channels) ? (row.channels as string[]) : ['wallet'],

    stats: {
      sent: num(row.sent_count),
      impressions: num(row.impression_count),
      clicks: num(row.click_count),
      visits: num(row.visit_count),
      redemptions: num(row.redemption_count),
      revenueCents: num(row.revenue_cents),
    },

    createdAt: (row.created_at as string) ?? new Date().toISOString(),
    updatedAt: (row.updated_at as string) ?? new Date().toISOString(),
  }
}

export async function listCampaigns(
  businessId: string,
  options: { status?: string; includeArchived?: boolean } = {}
): Promise<ProximityCampaign[]> {
  const admin = getDb()
  let query = admin
    .from('proximity_campaigns')
    .select(SELECT)
    .eq('business_id', businessId)
    .order('priority', { ascending: false })
    .order('created_at', { ascending: false })

  if (!options.includeArchived) query = query.is('archived_at', null)
  if (options.status) query = query.eq('status', options.status)

  const { data, error } = await query
  if (error) throw error
  return (data ?? []).map((row) => mapCampaign(row as CampaignRow))
}

/**
 * The campaigns a geofence evaluation must consider.
 *
 * Only active ones, and only for the right trigger — including `nearby`, which is
 * satisfied by an entry event (a customer who walked in was, moments earlier,
 * nearby). Filtering that in SQL rather than in the evaluator keeps the hot path
 * to a single indexed read.
 */
export async function activeCampaignsFor(
  businessId: string,
  trigger: GeofenceTrigger
): Promise<ProximityCampaign[]> {
  const triggers = trigger === 'entry' ? ['entry', 'nearby'] : [trigger]
  const admin = getDb()
  const { data, error } = await admin
    .from('proximity_campaigns')
    .select(SELECT)
    .eq('business_id', businessId)
    .eq('status', 'active')
    .is('archived_at', null)
    .in('trigger', triggers)
    .order('priority', { ascending: false })
    .limit(100)

  if (error) throw error
  return (data ?? []).map((row) => mapCampaign(row as CampaignRow))
}

export async function getCampaign(businessId: string, id: string): Promise<ProximityCampaign> {
  const admin = getDb()
  const { data } = await admin
    .from('proximity_campaigns')
    .select(SELECT)
    .eq('business_id', businessId)
    .eq('id', id)
    .maybeSingle()
  if (!data) throw notFound('Campaign')
  return mapCampaign(data as CampaignRow)
}

export type CampaignInput = {
  name: string
  kind?: string
  status?: 'draft' | 'scheduled' | 'active' | 'paused' | 'ended'
  description?: string | null
  trigger?: GeofenceTrigger
  radiusMeters?: number | null
  dwellMinutes?: number | null
  startsOn?: string | null
  endsOn?: string | null
  weekdays?: number[]
  startTime?: string | null
  endTime?: string | null
  allLocations?: boolean
  locationIds?: string[]
  segmentId?: string | null
  minTierLevel?: number | null
  minPoints?: number | null
  minVisits?: number | null
  maxDaysSinceVisit?: number | null
  minDaysSinceVisit?: number | null
  vipOnly?: boolean
  eligibility?: Record<string, unknown>
  title?: string
  message?: string
  emoji?: string | null
  ctaLabel?: string | null
  ctaUrl?: string | null
  rewardDescription?: string | null
  imageUrl?: string | null
  backgroundColor?: string | null
  textColor?: string | null
  logoUrl?: string | null
  expiresAt?: string | null
  priority?: number
  cooldownHours?: number
  maxSendsPerCustomer?: number | null
  channels?: string[]
}

function toRow(input: Partial<CampaignInput>): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  const set = (column: string, value: unknown) => {
    if (value !== undefined) row[column] = value
  }

  set('name', input.name)
  set('kind', input.kind)
  set('status', input.status)
  set('description', input.description)
  set('trigger', input.trigger)
  set('radius_m', input.radiusMeters)
  set('dwell_minutes', input.dwellMinutes)
  set('starts_on', input.startsOn)
  set('ends_on', input.endsOn)
  set('weekdays', input.weekdays)
  set('start_time', input.startTime)
  set('end_time', input.endTime)
  set('all_locations', input.allLocations)
  set('segment_id', input.segmentId)
  set('min_tier_level', input.minTierLevel)
  set('min_points', input.minPoints)
  set('min_visits', input.minVisits)
  set('max_days_since_visit', input.maxDaysSinceVisit)
  set('min_days_since_visit', input.minDaysSinceVisit)
  set('vip_only', input.vipOnly)
  set('eligibility', input.eligibility)
  set('title', input.title)
  set('message', input.message)
  set('emoji', input.emoji)
  set('cta_label', input.ctaLabel)
  set('cta_url', input.ctaUrl)
  set('reward_description', input.rewardDescription)
  set('image_url', input.imageUrl)
  set('background_color', input.backgroundColor)
  set('text_color', input.textColor)
  set('logo_url', input.logoUrl)
  set('expires_at', input.expiresAt)
  set('priority', input.priority)
  set('cooldown_hours', input.cooldownHours)
  set('max_sends_per_customer', input.maxSendsPerCustomer)
  set('channels', input.channels)
  return row
}

export async function createCampaign(
  businessId: string,
  input: CampaignInput,
  actorId?: string | null
): Promise<ProximityCampaign> {
  const admin = getDb()
  const { data, error } = await admin
    .from('proximity_campaigns')
    .insert({
      ...toRow(input),
      business_id: businessId,
      created_by: actorId ?? null,
      title: input.title ?? input.name,
      message: input.message ?? '',
    })
    .select('id')
    .single()

  if (error) throw unprocessable(error.message)
  const id = data.id as string

  if (input.locationIds?.length) await setCampaignLocations(businessId, id, input.locationIds)
  return getCampaign(businessId, id)
}

export async function updateCampaign(
  businessId: string,
  id: string,
  input: Partial<CampaignInput>
): Promise<ProximityCampaign> {
  const patch = toRow(input)
  const admin = getDb()

  if (Object.keys(patch).length > 0) {
    const { error, count } = await admin
      .from('proximity_campaigns')
      .update(patch, { count: 'exact' })
      .eq('id', id)
      .eq('business_id', businessId)
    if (error) throw unprocessable(error.message)
    if (!count) throw notFound('Campaign')
  }

  if (input.locationIds) await setCampaignLocations(businessId, id, input.locationIds)
  return getCampaign(businessId, id)
}

/**
 * Replaces a campaign's location scope.
 *
 * Delete-then-insert rather than a diff: the list is at most a few dozen ids, and
 * a diff would be more code for an operation that is not on any hot path.
 */
export async function setCampaignLocations(
  businessId: string,
  campaignId: string,
  locationIds: string[]
): Promise<void> {
  const admin = getDb()
  await admin.from('proximity_campaign_locations').delete().eq('campaign_id', campaignId)
  if (locationIds.length === 0) return

  const { error } = await admin.from('proximity_campaign_locations').insert(
    locationIds.map((locationId) => ({
      campaign_id: campaignId,
      location_id: locationId,
      business_id: businessId,
    }))
  )
  if (error) throw unprocessable(error.message)
}

export async function archiveCampaign(businessId: string, id: string): Promise<void> {
  const admin = getDb()
  const { error, count } = await admin
    .from('proximity_campaigns')
    .update(
      { archived_at: new Date().toISOString(), status: 'ended' },
      { count: 'exact' }
    )
    .eq('id', id)
    .eq('business_id', businessId)
  if (error) throw unprocessable(error.message)
  if (!count) throw notFound('Campaign')
}

/**
 * Creates the campaigns from an industry template.
 *
 * Idempotent by name so a merchant who applies "Coffee shop" twice does not end up
 * with two "Morning coffee" campaigns — the most likely misuse, since the button
 * lives in a gallery.
 *
 * The copy is resolved with the **business's** locale, not the viewer's. Every
 * `title` and `message` written here ends up on a customer's lock screen and
 * outlives the request that created it, so it has to be in the language that
 * business speaks to its customers in — not in whatever the person clicking the
 * button had selected in their own dashboard.
 */
export async function applyTemplateCampaigns(
  businessId: string,
  templateKey: string,
  actorId?: string | null
): Promise<{ created: number; skipped: number }> {
  const template = findTemplate(templateKey)
  if (!template) return { created: 0, skipped: 0 }

  const t = await translatorForBusiness(businessId)
  const campaigns = template.campaigns.map((entry) => resolveTemplateCampaign(entry, t))

  const existing = await listCampaigns(businessId, { includeArchived: true })
  const existingNames = new Set(existing.map((campaign) => campaign.name.toLowerCase()))

  let created = 0
  let skipped = 0

  for (const campaign of campaigns) {
    if (existingNames.has(campaign.name.toLowerCase())) {
      skipped += 1
      continue
    }
    await createCampaign(
      businessId,
      {
        name: campaign.name,
        kind: campaign.kind,
        // Templates are created paused. A merchant must see the copy that will go
        // to their customers before it goes to their customers — a one-click
        // gallery that immediately starts pushing notifications is a support
        // incident, not a feature.
        status: 'paused',
        description: campaign.description,
        trigger: campaign.trigger,
        radiusMeters: campaign.radiusMeters ?? null,
        dwellMinutes: campaign.dwellMinutes ?? null,
        weekdays: campaign.weekdays ?? [0, 1, 2, 3, 4, 5, 6],
        startTime: campaign.startTime ?? null,
        endTime: campaign.endTime ?? null,
        allLocations: true,
        minPoints: campaign.minPoints ?? null,
        minVisits: campaign.minVisits ?? null,
        maxDaysSinceVisit: campaign.maxDaysSinceVisit ?? null,
        minDaysSinceVisit: campaign.minDaysSinceVisit ?? null,
        vipOnly: campaign.vipOnly ?? false,
        eligibility: campaign.eligibility ?? {},
        title: campaign.title,
        message: campaign.message,
        emoji: campaign.emoji,
        ctaLabel: campaign.ctaLabel,
        rewardDescription: campaign.rewardDescription ?? null,
        priority: campaign.priority ?? 0,
        cooldownHours: campaign.cooldownHours ?? 24,
      },
      actorId
    )
    created += 1
  }

  return { created, skipped }
}
