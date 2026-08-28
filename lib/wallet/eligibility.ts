/**
 * Proximity campaign eligibility.
 *
 * Pure, synchronous and fully unit-tested, for one reason: this decides whether
 * a real person's phone buzzes. An over-eager rule costs a merchant the pass
 * permanently — a customer who deletes a card never comes back — and an
 * over-strict one silently sends nothing, which merchants read as "the feature
 * is broken". Both failures are invisible in production, so they have to be
 * caught by tests instead.
 *
 * Every reason for refusal is returned, not just the first, so the campaign
 * editor can tell a merchant *"this would not send: today is Tuesday and your
 * campaign runs Fri–Sun, and the customer needs 10 points"*, which is the
 * difference between a debuggable feature and a mysterious one.
 */

import type { GeofenceTrigger } from '@/lib/wallet/types'

/** Weekday numbering matches `Date.getDay()` and the `weekdays` column. */
export type WeekdayNumber = 0 | 1 | 2 | 3 | 4 | 5 | 6

export type ProximityCampaignRule = {
  id: string
  name: string
  status: 'draft' | 'scheduled' | 'active' | 'paused' | 'ended'
  trigger: GeofenceTrigger
  priority: number

  startsOn: string | null
  endsOn: string | null
  weekdays: readonly number[]
  startTime: string | null
  endTime: string | null

  allLocations: boolean
  locationIds: readonly string[]
  segmentId: string | null
  minTierLevel: number | null
  minPoints: number | null
  minVisits: number | null
  maxDaysSinceVisit: number | null
  minDaysSinceVisit: number | null
  vipOnly: boolean
  /** Extra predicates the UI grows into without a migration. */
  eligibility: Record<string, unknown>

  cooldownHours: number
  maxSendsPerCustomer: number | null
}

/**
 * Everything known about the customer at the moment of evaluation.
 *
 * Assembled once per position report and reused across every campaign and rule,
 * so a merchant with twenty campaigns costs one read, not twenty.
 */
export type CustomerFacts = {
  customerId: string
  points: number
  visits: number
  tierLevel: number | null
  isVip: boolean
  /** Days since the last recorded visit; null for a customer who never visited. */
  daysSinceLastVisit: number | null
  /** True on the customer's birthday, in their local calendar. */
  isBirthdayToday: boolean
  /** True on the anniversary of joining. */
  isAnniversaryToday: boolean
  hasClaimableReward: boolean
  /** Segment ids the customer currently matches. */
  segmentIds: readonly string[]
  /** Whether the pass is installed, and where. */
  hasApplePass: boolean
  hasGooglePass: boolean
  /** Notifications already delivered — the frequency guard's input. */
  notificationsToday: number
  hoursSinceLastNotification: number | null
  sendsForCampaign: Record<string, number>
  hoursSinceCampaign: Record<string, number | null>
}

export type EvaluationContext = {
  /** Local time at the location being evaluated, not server time. */
  now: Date
  locationId: string | null
  trigger: GeofenceTrigger
  distanceMeters: number | null
}

export type IneligibleReason =
  | 'not_active'
  | 'wrong_trigger'
  | 'before_start_date'
  | 'after_end_date'
  | 'wrong_weekday'
  | 'outside_time_window'
  | 'wrong_location'
  | 'not_in_segment'
  | 'tier_too_low'
  | 'not_enough_points'
  | 'not_enough_visits'
  | 'visited_too_recently'
  | 'visited_too_long_ago'
  | 'not_vip'
  | 'not_birthday'
  | 'no_claimable_reward'
  | 'no_pass_installed'
  | 'within_cooldown'
  | 'send_limit_reached'

export type EligibilityResult = {
  eligible: boolean
  reasons: IneligibleReason[]
}

const ELIGIBLE: EligibilityResult = { eligible: true, reasons: [] }

/**
 * Minutes since midnight for an `HH:MM` or `HH:MM:SS` string, or null.
 * Exported because the campaign editor validates the merchant's input with it.
 */
export function parseTimeOfDay(value: string | null | undefined): number | null {
  if (!value) return null
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

/**
 * Whether `now` falls inside a possibly-overnight window.
 *
 * A window whose end is before its start wraps midnight, which is what a
 * merchant means by "late night menu, 22:00 to 02:00". Treating that as an
 * empty window — the naive `start <= t && t <= end` — silently disables exactly
 * the campaigns that matter most to bars and late-night food.
 */
export function isWithinTimeWindow(
  now: Date,
  startTime: string | null,
  endTime: string | null
): boolean {
  const start = parseTimeOfDay(startTime)
  const end = parseTimeOfDay(endTime)
  if (start === null && end === null) return true

  const minutes = now.getHours() * 60 + now.getMinutes()
  if (start !== null && end === null) return minutes >= start
  if (start === null && end !== null) return minutes <= end
  if (start! <= end!) return minutes >= start! && minutes <= end!
  return minutes >= start! || minutes <= end!
}

/** Whether a wallet notification is allowed to be sent at this local hour. */
export function isQuietHour(now: Date, start: number, end: number): boolean {
  const hour = now.getHours()
  if (start === end) return false
  // Quiet hours normally wrap midnight (22 → 8), so the wrapping case is the
  // default path rather than an edge case.
  return start < end ? hour >= start && hour < end : hour >= start || hour < end
}

/**
 * Evaluates one campaign against one customer at one moment.
 *
 * Ordered cheapest-first, and it never short-circuits: the campaign editor
 * shows every reason at once so a merchant fixes their campaign in one pass
 * rather than discovering four problems in four saves.
 */
export function evaluateCampaign(
  campaign: ProximityCampaignRule,
  facts: CustomerFacts,
  context: EvaluationContext
): EligibilityResult {
  const reasons: IneligibleReason[] = []

  if (campaign.status !== 'active') reasons.push('not_active')

  // `nearby` campaigns are ambient suggestions rather than crossings, so they
  // are also satisfied by an entry event: a customer who walks in was, a moment
  // earlier, nearby.
  const triggerMatches =
    campaign.trigger === context.trigger ||
    (campaign.trigger === 'nearby' && context.trigger === 'entry')
  if (!triggerMatches) reasons.push('wrong_trigger')

  const today = startOfDay(context.now)
  if (campaign.startsOn && today < startOfDay(new Date(campaign.startsOn))) {
    reasons.push('before_start_date')
  }
  if (campaign.endsOn && today > startOfDay(new Date(campaign.endsOn))) {
    reasons.push('after_end_date')
  }

  if (campaign.weekdays.length > 0 && !campaign.weekdays.includes(context.now.getDay())) {
    reasons.push('wrong_weekday')
  }

  if (!isWithinTimeWindow(context.now, campaign.startTime, campaign.endTime)) {
    reasons.push('outside_time_window')
  }

  if (!campaign.allLocations) {
    if (!context.locationId || !campaign.locationIds.includes(context.locationId)) {
      reasons.push('wrong_location')
    }
  }

  if (campaign.segmentId && !facts.segmentIds.includes(campaign.segmentId)) {
    reasons.push('not_in_segment')
  }

  if (campaign.minTierLevel !== null && (facts.tierLevel ?? 0) < campaign.minTierLevel) {
    reasons.push('tier_too_low')
  }
  if (campaign.minPoints !== null && facts.points < campaign.minPoints) {
    reasons.push('not_enough_points')
  }
  if (campaign.minVisits !== null && facts.visits < campaign.minVisits) {
    reasons.push('not_enough_visits')
  }

  // A customer who has never visited has no "days since", and treating that as
  // infinity is what makes win-back campaigns fire at people who just enrolled.
  if (campaign.minDaysSinceVisit !== null) {
    if (facts.daysSinceLastVisit === null || facts.daysSinceLastVisit < campaign.minDaysSinceVisit) {
      reasons.push('visited_too_recently')
    }
  }
  if (campaign.maxDaysSinceVisit !== null) {
    if (facts.daysSinceLastVisit !== null && facts.daysSinceLastVisit > campaign.maxDaysSinceVisit) {
      reasons.push('visited_too_long_ago')
    }
  }

  if (campaign.vipOnly && !facts.isVip) reasons.push('not_vip')

  const extra = campaign.eligibility ?? {}
  if (extra.birthday_only === true && !facts.isBirthdayToday) reasons.push('not_birthday')
  if (extra.requires_claimable_reward === true && !facts.hasClaimableReward) {
    reasons.push('no_claimable_reward')
  }
  if (extra.requires_pass_installed === true && !facts.hasApplePass && !facts.hasGooglePass) {
    reasons.push('no_pass_installed')
  }

  const hoursSince = facts.hoursSinceCampaign[campaign.id] ?? null
  if (campaign.cooldownHours > 0 && hoursSince !== null && hoursSince < campaign.cooldownHours) {
    reasons.push('within_cooldown')
  }

  const sends = facts.sendsForCampaign[campaign.id] ?? 0
  if (campaign.maxSendsPerCustomer !== null && sends >= campaign.maxSendsPerCustomer) {
    reasons.push('send_limit_reached')
  }

  return reasons.length === 0 ? ELIGIBLE : { eligible: false, reasons }
}

/**
 * The business-wide frequency guard, applied after per-campaign eligibility.
 *
 * Separate from `evaluateCampaign` because it is not a property of a campaign:
 * three eligible campaigns must still produce one notification, and that
 * decision belongs to the merchant's wallet settings rather than to whichever
 * campaign happened to be evaluated first.
 */
export function passesFrequencyGuard(
  facts: CustomerFacts,
  settings: {
    maxNotificationsPerDay: number
    minHoursBetweenNotifications: number
    respectQuietHours: boolean
    quietHoursStart: number
    quietHoursEnd: number
  },
  now: Date
): { allowed: boolean; reason?: 'daily_cap' | 'too_soon' | 'quiet_hours' } {
  if (settings.respectQuietHours && isQuietHour(now, settings.quietHoursStart, settings.quietHoursEnd)) {
    return { allowed: false, reason: 'quiet_hours' }
  }

  /*
   * An unreadable counter counts as maximum pressure.
   *
   * `notificationsToday` comes from `notificationPressure()`, a database read
   * that can fail — and when a numeric read fails or a row is malformed, the
   * value arriving here is `NaN`. Every comparison against `NaN` is false, so
   * the guard used to fall straight through to `allowed: true`: a database blip
   * became permission to ignore the merchant's daily cap.
   *
   * That is the one failure this subsystem cannot afford. A wallet pass is
   * deleted the first time it feels like spam and there is no way to ask again,
   * so losing a notification is cheap and losing the card is permanent
   * (architectural decision 14). Both counters are therefore checked for
   * readability *before* they are compared, and an unreadable one refuses.
   */
  if (!Number.isFinite(facts.notificationsToday)) {
    return { allowed: false, reason: 'daily_cap' }
  }
  if (
    settings.maxNotificationsPerDay > 0 &&
    facts.notificationsToday >= settings.maxNotificationsPerDay
  ) {
    return { allowed: false, reason: 'daily_cap' }
  }

  /*
   * `null` here is a *known* absence — this customer has never been notified —
   * and is the ordinary case for most of a merchant's list, so it allows. `NaN`
   * is the opposite: a value we tried to compute and could not, which refuses.
   * Collapsing the two is how "we do not know" quietly becomes "there is
   * nothing to know".
   */
  if (facts.hoursSinceLastNotification !== null) {
    if (!Number.isFinite(facts.hoursSinceLastNotification)) {
      return { allowed: false, reason: 'too_soon' }
    }
    if (
      settings.minHoursBetweenNotifications > 0 &&
      facts.hoursSinceLastNotification < settings.minHoursBetweenNotifications
    ) {
      return { allowed: false, reason: 'too_soon' }
    }
  }

  return { allowed: true }
}

/**
 * Picks the one campaign to send from those that qualify.
 *
 * Highest merchant-assigned priority wins; ties break towards the campaign with
 * the tighter audience, because a birthday reward should beat a generic
 * "we're nearby" every time even when a merchant forgot to set priorities.
 */
export function selectCampaign<T extends ProximityCampaignRule>(
  eligible: readonly T[]
): T | null {
  if (eligible.length === 0) return null
  return [...eligible].sort((a, b) => b.priority - a.priority || specificity(b) - specificity(a))[0]
}

function specificity(campaign: ProximityCampaignRule): number {
  let score = 0
  if (campaign.segmentId) score += 3
  if (campaign.vipOnly) score += 3
  if (campaign.eligibility?.birthday_only === true) score += 4
  if (campaign.minTierLevel !== null) score += 2
  if (campaign.minPoints !== null) score += 2
  if (campaign.minVisits !== null) score += 1
  if (!campaign.allLocations) score += 1
  if (campaign.startTime || campaign.endTime) score += 1
  if (campaign.weekdays.length > 0 && campaign.weekdays.length < 7) score += 1
  return score
}

function startOfDay(date: Date): Date {
  const copy = new Date(date)
  copy.setHours(0, 0, 0, 0)
  return copy
}

/** Merchant-facing explanations, used by the campaign editor's preflight check. */
export const INELIGIBLE_REASON_LABELS: Record<IneligibleReason, string> = {
  not_active: 'The campaign is not active',
  wrong_trigger: 'A different trigger fired',
  before_start_date: 'The campaign has not started yet',
  after_end_date: 'The campaign has ended',
  wrong_weekday: 'Not scheduled for today',
  outside_time_window: 'Outside the campaign hours',
  wrong_location: 'This location is not included',
  not_in_segment: 'The customer is not in the selected segment',
  tier_too_low: 'The customer has not reached the required tier',
  not_enough_points: 'The customer does not have enough points',
  not_enough_visits: 'The customer has not visited enough times',
  visited_too_recently: 'The customer visited too recently',
  visited_too_long_ago: 'The customer has not visited recently enough',
  not_vip: 'Only VIP customers qualify',
  not_birthday: 'Only on the customer’s birthday',
  no_claimable_reward: 'The customer has no reward ready to claim',
  no_pass_installed: 'The customer has not added the card to their wallet',
  within_cooldown: 'Sent too recently to this customer',
  send_limit_reached: 'This customer has already received it the maximum number of times',
}
