import 'server-only'
import { getDb } from '@/lib/db'
import { env } from '@/lib/env'
import { logger } from '@/lib/logger'
import { num } from '@/lib/domain/types'
import { classifyTransition, coarsen, distanceMeters, isValidLatLng, type LatLng } from '@/lib/wallet/geo'
import { getWalletSettings } from '@/lib/wallet/settings'
import { isOpenAt, locationsNear } from '@/lib/wallet/locations'
import { activeCampaignsFor, type ProximityCampaign } from '@/lib/wallet/campaigns'
import { listRules } from '@/lib/wallet/rule-store'
import {
  evaluateCampaign,
  passesFrequencyGuard,
  selectCampaign,
  type CustomerFacts,
  type EvaluationContext,
} from '@/lib/wallet/eligibility'
import { runRules, type RuleAction } from '@/lib/wallet/rules'
import { notificationPressure, recordWalletEvent } from '@/lib/wallet/events'
import { renderNotificationCopy, sendWalletNotification } from '@/lib/wallet/notifications'
import { createAdminGrantReward } from '@/lib/loyalty/grants'
import { notify } from '@/lib/notifications'
import { translatorForBusiness } from '@/lib/i18n/business'
import type { GeofenceTrigger, StoreLocation, WalletPlatform } from '@/lib/wallet/types'

/**
 * The proximity engine.
 *
 * One entry point — `reportPosition` — takes a customer, a coordinate and a
 * platform, and does everything that follows: decide which store they crossed,
 * what kind of crossing it was, which of the merchant's campaigns and rules apply,
 * and what the customer should receive. Everything it depends on is either pure
 * (geo, eligibility, rules) or a narrow store, so the sequencing here is the only
 * thing that is hard to test — and the sequencing is short.
 *
 * Constraints that shaped it:
 *
 *   * **Phones are noisy.** A device at a geofence boundary reports crossings
 *     continuously. Transition classification is stateful (`customer_device_positions`)
 *     with a hysteresis band, and notifications are deduplicated on a key derived
 *     from the crossing — not from the timestamp.
 *   * **A deleted pass is unrecoverable.** There is no re-permission flow for a
 *     wallet card, so every guard fails *closed*. Quiet hours, daily caps and
 *     cooldowns are checked before anything is sent, and an error reading the
 *     guard's own inputs counts as "do not send".
 *   * **No position history.** Coordinates are coarsened to ~100 m and the row is
 *     replaced rather than appended. We need "are they near a store now", never
 *     "where have they been".
 */

export type PositionReport = {
  businessId: string
  customerId: string
  position: LatLng
  accuracyMeters?: number | null
  platform?: WalletPlatform
  /** Overrides the clock, for tests and for replaying a queued report. */
  now?: Date
}

export type ProximityOutcome = {
  /** What the engine decided happened. */
  transition: 'enter' | 'exit' | 'dwell' | 'inside' | 'outside'
  location: { id: string; name: string; distanceMeters: number } | null
  /** Nearby stores, nearest first — what a "find us" UI renders. */
  nearby: Array<{ id: string; name: string; distanceMeters: number; isOpen: boolean }>
  campaign: { id: string; name: string } | null
  notification: { sent: boolean; reason?: string } | null
  rulesMatched: string[]
  suppressed: 'disabled' | 'quiet_hours' | 'daily_cap' | 'too_soon' | 'closed' | null
}

const NO_MATCH: ProximityOutcome = {
  transition: 'outside',
  location: null,
  nearby: [],
  campaign: null,
  notification: null,
  rulesMatched: [],
  suppressed: null,
}

export async function reportPosition(report: PositionReport): Promise<ProximityOutcome> {
  const now = report.now ?? new Date()

  if (!isValidLatLng(report.position)) return NO_MATCH
  // Operator-level kill switch. Merchant-level switches are in wallet_settings;
  // this one exists so an incident can be stopped platform-wide without touching
  // tenant data.
  if (!env.maps.geofencingEnabled) return { ...NO_MATCH, suppressed: 'disabled' }

  const settings = await getWalletSettings(report.businessId)
  if (!settings.proximityEnabled || !settings.geofencingEnabled) {
    return { ...NO_MATCH, suppressed: 'disabled' }
  }

  const searchRadius = Math.max(settings.defaultRadiusMeters, 1_000)
  const candidates = await locationsNear(report.businessId, report.position, searchRadius)
  if (candidates.length === 0) return NO_MATCH

  const ranked = candidates
    .map((location) => ({
      location,
      metres: Math.round(distanceMeters(report.position, location.coordinates!)),
    }))
    .sort((a, b) => a.metres - b.metres)

  const nearby = ranked.slice(0, 5).map((entry) => ({
    id: entry.location.id,
    name: entry.location.name,
    distanceMeters: entry.metres,
    isOpen: isOpenAt(entry.location.openingHours, now),
  }))

  const closest = ranked[0]
  const previous = await loadPreviousPosition(report.customerId)

  const transition = classifyTransition({
    distanceMeters: closest.metres,
    radiusMeters: closest.location.geofence.notificationRadiusMeters,
    wasInside: previous?.insideLocationId === closest.location.id,
    enteredAt: previous?.enteredAt ?? null,
    dwellMinutes: closest.location.geofence.triggerOnDwell
      ? closest.location.geofence.dwellMinutes
      : 0,
    now,
  })

  await persistPosition({
    businessId: report.businessId,
    customerId: report.customerId,
    position: report.position,
    accuracyMeters: report.accuracyMeters ?? null,
    platform: report.platform ?? 'web',
    insideLocationId: transition === 'outside' || transition === 'exit' ? null : closest.location.id,
    // The dwell clock starts on entry and must survive subsequent "still inside"
    // reports, or a customer sitting in a café would never reach the threshold.
    enteredAt:
      transition === 'enter'
        ? now
        : transition === 'outside' || transition === 'exit'
          ? null
          : (previous?.enteredAt ?? now),
  })

  const trigger = triggerFor(transition)
  if (!trigger) {
    return { ...NO_MATCH, transition, nearby, location: locationSummary(closest) }
  }
  if (!triggerAllowed(closest.location, trigger)) {
    return { ...NO_MATCH, transition, nearby, location: locationSummary(closest) }
  }

  await recordWalletEvent({
    businessId: report.businessId,
    customerId: report.customerId,
    locationId: closest.location.id,
    type:
      trigger === 'exit'
        ? 'geofence_exit'
        : trigger === 'dwell'
          ? 'geofence_dwell'
          : 'geofence_enter',
    platform: report.platform ?? 'web',
    distanceMeters: closest.metres,
  })

  const facts = await loadCustomerFacts(report.businessId, report.customerId, now)
  const context: EvaluationContext = {
    now,
    locationId: closest.location.id,
    trigger,
    distanceMeters: closest.metres,
  }

  const guard = passesFrequencyGuard(facts, settings, now)
  const outcome: ProximityOutcome = {
    transition,
    location: locationSummary(closest),
    nearby,
    campaign: null,
    notification: null,
    rulesMatched: [],
    suppressed: guard.allowed ? null : (guard.reason ?? null),
  }

  // Rules run even when a notification is suppressed: tagging a customer or
  // alerting staff that a VIP walked in is not a notification and must not be
  // silenced by a quiet-hours setting meant for pushes.
  const ruleOutcome = await applyRules(report, facts, context, {
    canNotify: guard.allowed,
    locationName: closest.location.name,
    distanceMeters: closest.metres,
  })
  outcome.rulesMatched = ruleOutcome.matched

  if (ruleOutcome.notified) {
    outcome.notification = { sent: true }
    return outcome
  }
  if (!guard.allowed) return outcome

  const chosen = await chooseCampaign(report.businessId, facts, context)
  if (!chosen) return outcome

  // Inviting someone into a closed shop is the fastest way to look careless, so a
  // campaign is held back when the store is shut — unless the merchant has not
  // told us their hours, in which case we defer to them.
  if (!isOpenAt(closest.location.openingHours, now) && chosen.trigger !== 'exit') {
    return { ...outcome, campaign: { id: chosen.id, name: chosen.name }, suppressed: 'closed' }
  }

  outcome.campaign = { id: chosen.id, name: chosen.name }

  const copy = renderNotificationCopy(
    {
      title: chosen.title,
      message: chosen.message,
      emoji: chosen.emoji,
      ctaLabel: chosen.ctaLabel,
      ctaUrl: chosen.ctaUrl,
      expiresAt: chosen.expiresAt,
    },
    {
      first_name: facts.firstName ?? '',
      points: facts.points,
      store: closest.location.name,
      reward: chosen.rewardDescription ?? '',
      distance: `${closest.metres} m`,
    }
  )

  const result = await sendWalletNotification({
    businessId: report.businessId,
    customerId: report.customerId,
    content: copy,
    campaignId: chosen.id,
    locationId: closest.location.id,
    platform: report.platform ?? 'unknown',
    distanceMeters: closest.metres,
    dedupeKey: dedupeKey({
      campaignId: chosen.id,
      customerId: report.customerId,
      locationId: closest.location.id,
      trigger,
      cooldownHours: chosen.cooldownHours,
      now,
    }),
  })

  outcome.notification = result.sent ? { sent: true } : { sent: false, reason: result.reason }
  return outcome
}

// -----------------------------------------------------------------------------
// Pieces
// -----------------------------------------------------------------------------

function locationSummary(entry: { location: StoreLocation; metres: number }) {
  return { id: entry.location.id, name: entry.location.name, distanceMeters: entry.metres }
}

function triggerFor(transition: ProximityOutcome['transition']): GeofenceTrigger | null {
  if (transition === 'enter') return 'entry'
  if (transition === 'exit') return 'exit'
  if (transition === 'dwell') return 'dwell'
  // 'inside' and 'outside' are steady states, not events. Firing on them would
  // send a notification on every position report a phone volunteers.
  return null
}

function triggerAllowed(location: StoreLocation, trigger: GeofenceTrigger): boolean {
  if (trigger === 'entry') return location.geofence.triggerOnEntry
  if (trigger === 'exit') return location.geofence.triggerOnExit
  if (trigger === 'dwell') return location.geofence.triggerOnDwell
  return true
}

/**
 * The identity of one notification occurrence.
 *
 * Bucketing by the campaign's own cooldown is what makes the unique index do the
 * cooldown enforcement: two crossings inside the same cooldown window produce the
 * same key, so the second insert conflicts and is dropped. No lock, no scheduled
 * cleanup, and correct across concurrent requests from several devices.
 */
function dedupeKey(input: {
  campaignId: string
  customerId: string
  locationId: string
  trigger: string
  cooldownHours: number
  now: Date
}): string {
  const windowHours = Math.max(1, input.cooldownHours)
  const bucket = Math.floor(input.now.getTime() / (windowHours * 3_600_000))
  return [input.campaignId, input.customerId, input.locationId, input.trigger, bucket].join(':')
}

async function chooseCampaign(
  businessId: string,
  facts: ProximityFacts,
  context: EvaluationContext
): Promise<ProximityCampaign | null> {
  const campaigns = await activeCampaignsFor(businessId, context.trigger)
  if (campaigns.length === 0) return null

  /*
   * Segment membership is resolved here rather than in `loadCustomerFacts`
   * because a merchant may have fifty saved segments and at most a couple are
   * referenced by proximity campaigns. Evaluating all of them on every position
   * report would be the single most expensive thing the engine does, for an
   * answer nobody asked for.
   */
  const segmentIds = [
    ...new Set(campaigns.map((campaign) => campaign.segmentId).filter((id): id is string => !!id)),
  ]
  const resolved =
    segmentIds.length > 0
      ? await matchingSegments(businessId, facts.customerId, segmentIds)
      : []

  const withSegments: ProximityFacts = { ...facts, segmentIds: resolved }

  const eligible = campaigns.filter(
    (campaign) => evaluateCampaign(campaign, withSegments, context).eligible
  )
  return selectCampaign(eligible)
}

/** Which of the given segments this customer currently belongs to. */
async function matchingSegments(
  businessId: string,
  customerId: string,
  segmentIds: string[]
): Promise<string[]> {
  const { customerMatchesSegment, resolveSegmentDefinition } = await import(
    '@/lib/segments/resolve'
  )
  const outcomes = await Promise.all(
    segmentIds.map(async (segmentId) => {
      try {
        const definition = await resolveSegmentDefinition(businessId, segmentId)
        const matches = await customerMatchesSegment(businessId, customerId, definition)
        return matches ? segmentId : null
      } catch (cause) {
        // A broken segment must not hand a campaign to everyone; treat an
        // unresolvable audience as "does not match".
        logger.warn('wallet.segment_resolve_failed', { business_id: businessId, segmentId, cause })
        return null
      }
    })
  )
  return outcomes.filter((id): id is string => id !== null)
}

/**
 * Runs the merchant's no-code rules and performs their actions.
 *
 * Returns whether a notification was delivered, so the campaign pass can be
 * skipped: a rule and a campaign both firing at one door crossing is two buzzes
 * for one event, and the merchant's explicit rule should win.
 */
async function applyRules(
  report: PositionReport,
  facts: ProximityFacts,
  context: EvaluationContext,
  options: { canNotify: boolean; locationName: string; distanceMeters: number }
): Promise<{ matched: string[]; notified: boolean }> {
  let rules
  try {
    rules = await listRules(report.businessId, { activeOnly: true })
  } catch (cause) {
    logger.warn('wallet.rules_read_failed', { business_id: report.businessId, cause })
    return { matched: [], notified: false }
  }
  if (rules.length === 0) return { matched: [], notified: false }

  const cooldowns = await ruleCooldowns(report.businessId, report.customerId, rules.map((r) => r.id))
  const { actions, matched } = runRules(rules, facts, context, { cooldownHoursElapsed: cooldowns })

  let notified = false
  for (const { rule, action } of actions) {
    try {
      const sent = await performRuleAction({
        action,
        ruleId: rule.id,
        ruleName: rule.name,
        cooldownHours: rule.cooldownHours,
        report,
        facts,
        context,
        canNotify: options.canNotify && !notified,
        locationName: options.locationName,
        distanceMeters: options.distanceMeters,
      })
      notified = notified || sent
    } catch (cause) {
      // One failing action must not abandon the rest: a webhook timing out
      // should not stop the customer being tagged.
      logger.warn('wallet.rule_action_failed', {
        business_id: report.businessId,
        rule_id: rule.id,
        action: action.type,
        cause,
      })
    }
  }

  return { matched: matched.map((rule) => rule.name), notified }
}

async function performRuleAction(input: {
  action: RuleAction
  ruleId: string
  ruleName: string
  cooldownHours: number
  report: PositionReport
  facts: ProximityFacts
  context: EvaluationContext
  canNotify: boolean
  locationName: string
  distanceMeters: number
}): Promise<boolean> {
  const { action, report, facts, context } = input
  const admin = getDb()
  const now = context.now

  /*
   * The business's language. Every string below lands on a customer's lock
   * screen, and only reaches them when the merchant has *not* written their own
   * copy — which is the default state, so these fallbacks were the version most
   * customers actually saw. They were English literals.
   */
  const t = await translatorForBusiness(report.businessId)

  const send = async (content: {
    title: string
    message: string
    emoji?: string | null
    ctaLabel?: string | null
    ctaUrl?: string | null
  }): Promise<boolean> => {
    if (!input.canNotify) return false
    const rendered = renderNotificationCopy(
      {
        title: content.title,
        message: content.message,
        emoji: content.emoji ?? null,
        ctaLabel: content.ctaLabel ?? null,
        ctaUrl: content.ctaUrl ?? null,
        expiresAt: null,
      },
      {
        first_name: facts.firstName ?? '',
        points: facts.points,
        store: input.locationName,
        distance: `${input.distanceMeters} m`,
      }
    )
    const outcome = await sendWalletNotification({
      businessId: report.businessId,
      customerId: report.customerId,
      content: rendered,
      ruleId: input.ruleId,
      locationId: context.locationId,
      platform: report.platform ?? 'unknown',
      distanceMeters: input.distanceMeters,
      dedupeKey: dedupeKey({
        campaignId: `rule-${input.ruleId}`,
        customerId: report.customerId,
        locationId: context.locationId ?? 'none',
        trigger: context.trigger,
        cooldownHours: input.cooldownHours,
        now,
      }),
    })
    return outcome.sent
  }

  switch (action.type) {
    case 'suggest_wallet_card': {
      await recordWalletEvent({
        businessId: report.businessId,
        customerId: report.customerId,
        locationId: context.locationId,
        ruleId: input.ruleId,
        type: 'wallet_suggestion',
        platform: report.platform ?? 'unknown',
        distanceMeters: input.distanceMeters,
      })
      return send({
        title: t('wallet.push.nearbyTitle', { location: input.locationName }),
        // No values passed on purpose: the `{{points}}` token in this string is
        // expanded downstream by `renderNotificationCopy`, not here.
        message: action.message ?? t('wallet.push.nearbyBody'),
        emoji: '👋',
      })
    }

    case 'send_wallet_notification':
      return send({
        title: action.title ?? t('wallet.push.nearbyTitle', { location: input.locationName }),
        message: action.message ?? t('wallet.push.cardReady'),
        emoji: action.emoji ?? null,
        ctaLabel: action.cta_label ?? null,
        ctaUrl: action.cta_url ?? null,
      })

    case 'notify_reward_available':
      return send({
        title: t('wallet.push.rewardTitle'),
        message: t('wallet.push.rewardBody', { location: input.locationName }),
        emoji: '🎁',
      })

    case 'activate_campaign': {
      await admin
        .from('proximity_campaigns')
        .update({ status: 'active' })
        .eq('id', action.campaign_id)
        .eq('business_id', report.businessId)
      return false
    }

    case 'grant_points': {
      const { data: program } = await admin
        .from('loyalty_programs')
        .select('id')
        .eq('business_id', report.businessId)
        .eq('is_default', true)
        .maybeSingle()
      if (!program) return false
      await admin.rpc('passimo_credit_account', {
        p_business_id: report.businessId,
        p_program_id: program.id,
        p_customer_id: report.customerId,
        p_amount: action.amount,
        p_entry_type: 'earn',
        p_reason: action.reason ?? input.ruleName,
        // Idempotent per rule per day: a rule that grants points must not do so
        // once per position report a phone happens to send.
        p_idempotency_key: `proximity-rule:${input.ruleId}:${report.customerId}:${now
          .toISOString()
          .slice(0, 10)}`,
      })
      return false
    }

    case 'grant_reward': {
      await createAdminGrantReward({
        businessId: report.businessId,
        customerId: report.customerId,
        autoGrantTrigger: action.trigger ?? null,
        rewardId: action.reward_id ?? null,
        source: `proximity-rule:${input.ruleName}`,
      })
      return false
    }

    case 'add_tag': {
      const { data: tag } = await admin
        .from('tags')
        .upsert({ business_id: report.businessId, name: action.tag }, { onConflict: 'business_id,name' })
        .select('id')
        .maybeSingle()
      if (!tag) return false
      await admin.from('customer_tags').upsert(
        { customer_id: report.customerId, tag_id: tag.id, business_id: report.businessId },
        { onConflict: 'customer_id,tag_id', ignoreDuplicates: true }
      )
      return false
    }

    case 'set_vip': {
      await admin
        .from('customers')
        .update({ is_vip: action.value ?? true })
        .eq('id', report.customerId)
        .eq('business_id', report.businessId)
      return false
    }

    case 'notify_staff': {
      await notify(report.businessId, {
        type: 'customer',
        title: action.title,
        body: action.body ?? `${facts.firstName ?? 'A customer'} is at ${input.locationName}.`,
        url: `/dashboard/customers/${report.customerId}`,
      })
      return false
    }

    default:
      return false
  }
}

async function ruleCooldowns(
  businessId: string,
  customerId: string,
  ruleIds: string[]
): Promise<Record<string, number | null>> {
  if (ruleIds.length === 0) return {}
  const admin = getDb()
  const { data } = await admin
    .from('wallet_notifications')
    .select('rule_id, sent_at')
    .eq('business_id', businessId)
    .eq('customer_id', customerId)
    .in('rule_id', ruleIds)
    .eq('status', 'sent')
    .order('sent_at', { ascending: false })
    .limit(100)

  const elapsed: Record<string, number | null> = {}
  for (const row of data ?? []) {
    const ruleId = row.rule_id as string
    if (elapsed[ruleId] !== undefined || !row.sent_at) continue
    elapsed[ruleId] = (Date.now() - new Date(row.sent_at as string).getTime()) / 3_600_000
  }
  return elapsed
}

// -----------------------------------------------------------------------------
// Customer facts
// -----------------------------------------------------------------------------

export type ProximityFacts = CustomerFacts & { firstName: string | null }

/**
 * Assembles everything the evaluators need, in as few reads as possible.
 *
 * One assembly is reused across every campaign and every rule for this report: a
 * merchant with twenty campaigns and ten rules costs the same as one with one of
 * each, which is what makes it safe to let merchants create as many as their plan
 * allows.
 */
export async function loadCustomerFacts(
  businessId: string,
  customerId: string,
  now: Date = new Date()
): Promise<ProximityFacts> {
  const admin = getDb()

  const [
    { data: customer },
    { data: accounts },
    { count: claimable },
    { count: appleRegs },
    { data: googleRow },
    pressure,
  ] = await Promise.all([
    admin
      .from('customers')
      .select(
        'id, first_name, name, birthday, created_at, last_visit, visit_count, is_vip, lifetime_spend'
      )
      .eq('id', customerId)
      .maybeSingle(),
    admin
      .from('loyalty_accounts')
      .select('balance, loyalty_programs:program_id (is_default), program_tiers:tier_id (level)')
      .eq('customer_id', customerId),
    admin
      .from('reward_redemptions')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', businessId)
      .eq('customer_id', customerId)
      .eq('status', 'claimed'),
    admin
      .from('wallet_registrations')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', customerId)
      .eq('platform', 'apple'),
    admin
      .from('customers')
      .select('google_wallet_saved_at')
      .eq('id', customerId)
      .maybeSingle(),
    notificationPressure(businessId, customerId),
  ])

  const primary =
    (accounts ?? []).find(
      (row) => (row.loyalty_programs as unknown as { is_default?: boolean } | null)?.is_default
    ) ?? (accounts ?? [])[0]
  const tier = primary?.program_tiers as unknown as { level?: number } | null

  const lastVisit = customer?.last_visit ? new Date(customer.last_visit as string) : null
  const daysSinceLastVisit = lastVisit
    ? Math.floor((now.getTime() - lastVisit.getTime()) / 86_400_000)
    : null

  const sends = await campaignSendCounts(businessId, customerId)

  return {
    customerId,
    firstName: (customer?.first_name as string) ?? (customer?.name as string) ?? null,
    points: num(primary?.balance),
    visits: num(customer?.visit_count),
    tierLevel: tier?.level === undefined ? null : num(tier.level),
    isVip: Boolean(customer?.is_vip),
    daysSinceLastVisit,
    isBirthdayToday: isSameMonthDay(customer?.birthday as string | null, now),
    isAnniversaryToday: isSameMonthDay(customer?.created_at as string | null, now),
    hasClaimableReward: num(claimable) > 0,
    segmentIds: [],
    hasApplePass: num(appleRegs) > 0,
    hasGooglePass: Boolean(googleRow?.google_wallet_saved_at),
    notificationsToday: pressure.today,
    hoursSinceLastNotification: pressure.hoursSinceLast,
    sendsForCampaign: sends.counts,
    hoursSinceCampaign: sends.hoursSince,
  }
}

async function campaignSendCounts(
  businessId: string,
  customerId: string
): Promise<{ counts: Record<string, number>; hoursSince: Record<string, number | null> }> {
  const admin = getDb()
  const { data } = await admin
    .from('wallet_notifications')
    .select('campaign_id, sent_at')
    .eq('business_id', businessId)
    .eq('customer_id', customerId)
    .eq('status', 'sent')
    .not('campaign_id', 'is', null)
    .order('sent_at', { ascending: false })
    .limit(200)

  const counts: Record<string, number> = {}
  const hoursSince: Record<string, number | null> = {}

  for (const row of data ?? []) {
    const campaignId = row.campaign_id as string
    counts[campaignId] = (counts[campaignId] ?? 0) + 1
    if (hoursSince[campaignId] === undefined && row.sent_at) {
      hoursSince[campaignId] =
        (Date.now() - new Date(row.sent_at as string).getTime()) / 3_600_000
    }
  }

  return { counts, hoursSince }
}

function isSameMonthDay(iso: string | null, now: Date): boolean {
  if (!iso) return false
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return false
  return date.getMonth() === now.getMonth() && date.getDate() === now.getDate()
}

// -----------------------------------------------------------------------------
// Device position state
// -----------------------------------------------------------------------------

async function loadPreviousPosition(customerId: string): Promise<{
  insideLocationId: string | null
  enteredAt: Date | null
} | null> {
  const admin = getDb()
  const { data } = await admin
    .from('customer_device_positions')
    .select('inside_location_id, entered_at')
    .eq('customer_id', customerId)
    .maybeSingle()

  if (!data) return null
  return {
    insideLocationId: (data.inside_location_id as string) ?? null,
    enteredAt: data.entered_at ? new Date(data.entered_at as string) : null,
  }
}

async function persistPosition(input: {
  businessId: string
  customerId: string
  position: LatLng
  accuracyMeters: number | null
  platform: WalletPlatform
  insideLocationId: string | null
  enteredAt: Date | null
}): Promise<void> {
  const admin = getDb()
  const coarse = coarsen(input.position)

  const { error } = await admin.from('customer_device_positions').upsert(
    {
      customer_id: input.customerId,
      business_id: input.businessId,
      lat: coarse.lat,
      lng: coarse.lng,
      accuracy_m: input.accuracyMeters,
      platform: input.platform,
      inside_location_id: input.insideLocationId,
      entered_at: input.enteredAt?.toISOString() ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'customer_id' }
  )

  if (error) logger.warn('wallet.position_persist_failed', { customer_id: input.customerId, error })
}

/**
 * Read-only nearby lookup for a customer's card page.
 *
 * No state written, no notification sent, no campaign evaluated — this answers
 * "where can I use this card and what is on offer there", which is a page render,
 * not a geofence crossing. Keeping it separate from `reportPosition` means opening
 * the card page can never accidentally trigger a notification.
 */
export async function nearbyOffers(input: {
  businessId: string
  customerId?: string | null
  position?: LatLng | null
  limit?: number
}): Promise<{
  locations: Array<{
    id: string
    name: string
    address: string | null
    city: string | null
    coordinates: LatLng | null
    distanceMeters: number | null
    isOpen: boolean
    openingHours: StoreLocation['openingHours']
    phone: string | null
  }>
  offers: Array<{ id: string; name: string; title: string; message: string; emoji: string | null }>
}> {
  const now = new Date()
  const settings = await getWalletSettings(input.businessId)

  const { listLocations } = await import('@/lib/wallet/locations')
  const all = await listLocations(input.businessId, { visibleOnly: true })

  const withDistance = all.map((location) => ({
    location,
    metres:
      input.position && location.coordinates && isValidLatLng(input.position)
        ? Math.round(distanceMeters(input.position, location.coordinates))
        : null,
  }))

  withDistance.sort((a, b) => {
    if (a.metres === null) return b.metres === null ? 0 : 1
    if (b.metres === null) return -1
    return a.metres - b.metres
  })

  const locations = withDistance.slice(0, input.limit ?? 10).map((entry) => ({
    id: entry.location.id,
    name: entry.location.name,
    address: entry.location.address,
    city: entry.location.city,
    coordinates: entry.location.coordinates,
    distanceMeters: entry.metres,
    isOpen: isOpenAt(entry.location.openingHours, now),
    openingHours: entry.location.openingHours,
    phone: entry.location.phone,
  }))

  if (!settings.nearbyRecommendations) return { locations, offers: [] }

  const campaigns = await activeCampaignsFor(input.businessId, 'nearby')
  const offers = campaigns.slice(0, 5).map((campaign) => ({
    id: campaign.id,
    name: campaign.name,
    title: campaign.title,
    message: campaign.message,
    emoji: campaign.emoji,
  }))

  return { locations, offers }
}
