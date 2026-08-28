import { describe, expect, it } from 'vitest'
import {
  INELIGIBLE_REASON_LABELS,
  evaluateCampaign,
  isQuietHour,
  isWithinTimeWindow,
  parseTimeOfDay,
  passesFrequencyGuard,
  selectCampaign,
  type CustomerFacts,
  type EvaluationContext,
  type IneligibleReason,
  type ProximityCampaignRule,
} from '@/lib/wallet/eligibility'

/**
 * Campaign eligibility.
 *
 * This decides whether a real person's phone buzzes, and both failure modes are
 * invisible in production: an over-eager rule costs the merchant the wallet pass
 * permanently (a deleted card cannot be re-permissioned), while an over-strict one
 * silently sends nothing and reads as "the feature is broken". Neither shows up in an
 * error log, so they have to be caught here.
 */

function campaign(overrides: Partial<ProximityCampaignRule> = {}): ProximityCampaignRule {
  return {
    id: 'campaign-1',
    name: 'Morning coffee',
    status: 'active',
    trigger: 'entry',
    priority: 0,
    startsOn: null,
    endsOn: null,
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    startTime: null,
    endTime: null,
    allLocations: true,
    locationIds: [],
    segmentId: null,
    minTierLevel: null,
    minPoints: null,
    minVisits: null,
    maxDaysSinceVisit: null,
    minDaysSinceVisit: null,
    vipOnly: false,
    eligibility: {},
    cooldownHours: 24,
    maxSendsPerCustomer: null,
    ...overrides,
  }
}

function facts(overrides: Partial<CustomerFacts> = {}): CustomerFacts {
  return {
    customerId: 'customer-1',
    points: 40,
    visits: 6,
    tierLevel: 2,
    isVip: false,
    daysSinceLastVisit: 5,
    isBirthdayToday: false,
    isAnniversaryToday: false,
    hasClaimableReward: false,
    segmentIds: [],
    hasApplePass: true,
    hasGooglePass: false,
    notificationsToday: 0,
    hoursSinceLastNotification: null,
    sendsForCampaign: {},
    hoursSinceCampaign: {},
    ...overrides,
  }
}

/** A Wednesday at 09:00 local. */
const WEDNESDAY_MORNING = new Date('2026-07-29T09:00:00')

function context(overrides: Partial<EvaluationContext> = {}): EvaluationContext {
  return {
    now: WEDNESDAY_MORNING,
    locationId: 'location-1',
    trigger: 'entry',
    distanceMeters: 80,
    ...overrides,
  }
}

const reasons = (campaignInput: ProximityCampaignRule, factsInput = facts(), ctx = context()) =>
  evaluateCampaign(campaignInput, factsInput, ctx).reasons

describe('parseTimeOfDay', () => {
  it('parses HH:MM and HH:MM:SS', () => {
    expect(parseTimeOfDay('07:00')).toBe(420)
    expect(parseTimeOfDay('18:30')).toBe(1_110)
    // Postgres `time` columns come back with seconds.
    expect(parseTimeOfDay('18:30:00')).toBe(1_110)
    expect(parseTimeOfDay('00:00')).toBe(0)
    expect(parseTimeOfDay('23:59')).toBe(1_439)
  })

  it('returns null rather than a wrong number for unusable input', () => {
    expect(parseTimeOfDay(null)).toBeNull()
    expect(parseTimeOfDay('')).toBeNull()
    expect(parseTimeOfDay('25:00')).toBeNull()
    expect(parseTimeOfDay('12:60')).toBeNull()
    expect(parseTimeOfDay('noon')).toBeNull()
  })
})

describe('isWithinTimeWindow', () => {
  const at = (hour: number, minute = 0) => new Date(2026, 6, 29, hour, minute)

  it('matches everything when no window is set', () => {
    expect(isWithinTimeWindow(at(3), null, null)).toBe(true)
  })

  it('handles a normal daytime window inclusively at both ends', () => {
    expect(isWithinTimeWindow(at(7), '07:00', '10:30')).toBe(true)
    expect(isWithinTimeWindow(at(10, 30), '07:00', '10:30')).toBe(true)
    expect(isWithinTimeWindow(at(10, 31), '07:00', '10:30')).toBe(false)
    expect(isWithinTimeWindow(at(6, 59), '07:00', '10:30')).toBe(false)
  })

  it('wraps midnight, which is what a late-night menu means', () => {
    // The naive `start <= t && t <= end` reads 22:00–02:00 as an empty window and
    // silently disables exactly the campaigns bars and late-night food depend on.
    expect(isWithinTimeWindow(at(23), '22:00', '02:00')).toBe(true)
    expect(isWithinTimeWindow(at(1), '22:00', '02:00')).toBe(true)
    expect(isWithinTimeWindow(at(12), '22:00', '02:00')).toBe(false)
  })

  it('treats a one-sided window as open-ended', () => {
    expect(isWithinTimeWindow(at(23), '18:00', null)).toBe(true)
    expect(isWithinTimeWindow(at(9), '18:00', null)).toBe(false)
    expect(isWithinTimeWindow(at(9), null, '12:00')).toBe(true)
    expect(isWithinTimeWindow(at(13), null, '12:00')).toBe(false)
  })
})

describe('isQuietHour', () => {
  const at = (hour: number) => new Date(2026, 6, 29, hour)

  it('handles the wrapping default of 22:00 to 08:00', () => {
    expect(isQuietHour(at(23), 22, 8)).toBe(true)
    expect(isQuietHour(at(3), 22, 8)).toBe(true)
    expect(isQuietHour(at(7), 22, 8)).toBe(true)
    expect(isQuietHour(at(8), 22, 8)).toBe(false)
    expect(isQuietHour(at(14), 22, 8)).toBe(false)
  })

  it('handles a non-wrapping window', () => {
    expect(isQuietHour(at(14), 13, 16)).toBe(true)
    expect(isQuietHour(at(16), 13, 16)).toBe(false)
  })

  it('treats an equal start and end as no quiet hours at all', () => {
    // Never "quiet 24 hours a day": that would silently disable every campaign a
    // merchant has, with no visible cause.
    expect(isQuietHour(at(3), 0, 0)).toBe(false)
    expect(isQuietHour(at(15), 9, 9)).toBe(false)
  })
})

describe('evaluateCampaign', () => {
  it('passes a campaign with no restrictions', () => {
    const result = evaluateCampaign(campaign(), facts(), context())
    expect(result.eligible).toBe(true)
    expect(result.reasons).toEqual([])
  })

  it('refuses a campaign that is not active', () => {
    expect(reasons(campaign({ status: 'paused' }))).toContain('not_active')
    expect(reasons(campaign({ status: 'draft' }))).toContain('not_active')
  })

  it('reports every reason, not just the first', () => {
    // The campaign editor shows all of them at once so a merchant fixes their
    // campaign in one pass instead of discovering four problems in four saves.
    const result = evaluateCampaign(
      campaign({ status: 'paused', vipOnly: true, minPoints: 500, weekdays: [0] }),
      facts(),
      context()
    )
    expect(result.reasons.length).toBeGreaterThanOrEqual(4)
    expect(result.reasons).toContain('not_active')
    expect(result.reasons).toContain('not_vip')
    expect(result.reasons).toContain('not_enough_points')
    expect(result.reasons).toContain('wrong_weekday')
  })

  it('matches triggers exactly, except that nearby also accepts an arrival', () => {
    expect(reasons(campaign({ trigger: 'exit' }))).toContain('wrong_trigger')
    // A customer who walked in was, moments earlier, nearby.
    expect(reasons(campaign({ trigger: 'nearby' }))).not.toContain('wrong_trigger')
    expect(
      reasons(campaign({ trigger: 'entry' }), facts(), context({ trigger: 'dwell' }))
    ).toContain('wrong_trigger')
  })

  it('honours the date window', () => {
    expect(reasons(campaign({ startsOn: '2026-08-01' }))).toContain('before_start_date')
    expect(reasons(campaign({ endsOn: '2026-07-01' }))).toContain('after_end_date')
    // Inclusive on both ends: a campaign that "ends today" runs today.
    expect(reasons(campaign({ startsOn: '2026-07-29', endsOn: '2026-07-29' }))).toEqual([])
  })

  it('honours weekdays and the time window', () => {
    // 2026-07-29 is a Wednesday, day 3.
    expect(reasons(campaign({ weekdays: [3] }))).toEqual([])
    expect(reasons(campaign({ weekdays: [1, 2] }))).toContain('wrong_weekday')
    expect(reasons(campaign({ startTime: '07:00', endTime: '10:30' }))).toEqual([])
    expect(reasons(campaign({ startTime: '18:00', endTime: '22:00' }))).toContain(
      'outside_time_window'
    )
  })

  it('treats an empty weekday list as every day rather than none', () => {
    // A row whose array was cleared must not silently disable the campaign.
    expect(reasons(campaign({ weekdays: [] }))).not.toContain('wrong_weekday')
  })

  it('scopes to selected locations when not chain-wide', () => {
    expect(
      reasons(campaign({ allLocations: false, locationIds: ['location-1'] }))
    ).not.toContain('wrong_location')
    expect(
      reasons(campaign({ allLocations: false, locationIds: ['location-9'] }))
    ).toContain('wrong_location')
    // No location at all cannot satisfy a location-scoped campaign.
    expect(
      reasons(
        campaign({ allLocations: false, locationIds: ['location-1'] }),
        facts(),
        context({ locationId: null })
      )
    ).toContain('wrong_location')
  })

  it('checks segment membership', () => {
    expect(reasons(campaign({ segmentId: 'segment-1' }))).toContain('not_in_segment')
    expect(
      reasons(campaign({ segmentId: 'segment-1' }), facts({ segmentIds: ['segment-1'] }))
    ).not.toContain('not_in_segment')
  })

  it('checks tier, points and visits at the boundary', () => {
    expect(reasons(campaign({ minTierLevel: 2 }))).toEqual([])
    expect(reasons(campaign({ minTierLevel: 3 }))).toContain('tier_too_low')
    expect(reasons(campaign({ minPoints: 40 }))).toEqual([])
    expect(reasons(campaign({ minPoints: 41 }))).toContain('not_enough_points')
    expect(reasons(campaign({ minVisits: 6 }))).toEqual([])
    expect(reasons(campaign({ minVisits: 7 }))).toContain('not_enough_visits')
  })

  it('treats an unknown tier as level zero', () => {
    expect(reasons(campaign({ minTierLevel: 1 }), facts({ tierLevel: null }))).toContain(
      'tier_too_low'
    )
  })

  it('never fires a win-back at a customer who has never visited', () => {
    // Treating "never visited" as infinite days is how every win-back campaign
    // reaches people who enrolled this morning.
    expect(
      reasons(campaign({ minDaysSinceVisit: 30 }), facts({ daysSinceLastVisit: null }))
    ).toContain('visited_too_recently')
  })

  it('checks both directions of recency at the boundary', () => {
    expect(
      reasons(campaign({ minDaysSinceVisit: 5 }), facts({ daysSinceLastVisit: 5 }))
    ).toEqual([])
    expect(
      reasons(campaign({ minDaysSinceVisit: 6 }), facts({ daysSinceLastVisit: 5 }))
    ).toContain('visited_too_recently')
    expect(
      reasons(campaign({ maxDaysSinceVisit: 5 }), facts({ daysSinceLastVisit: 5 }))
    ).toEqual([])
    expect(
      reasons(campaign({ maxDaysSinceVisit: 4 }), facts({ daysSinceLastVisit: 5 }))
    ).toContain('visited_too_long_ago')
  })

  it('does not exclude a never-visited customer from a max-recency campaign', () => {
    // "Visited within the last 30 days" is a filter on people who *have* visited;
    // a new enrolment should not be judged against it.
    expect(
      reasons(campaign({ maxDaysSinceVisit: 30 }), facts({ daysSinceLastVisit: null }))
    ).not.toContain('visited_too_long_ago')
  })

  it('honours the extra eligibility predicates', () => {
    expect(reasons(campaign({ eligibility: { birthday_only: true } }))).toContain('not_birthday')
    expect(
      reasons(campaign({ eligibility: { birthday_only: true } }), facts({ isBirthdayToday: true }))
    ).toEqual([])

    expect(
      reasons(campaign({ eligibility: { requires_claimable_reward: true } }))
    ).toContain('no_claimable_reward')

    expect(
      reasons(
        campaign({ eligibility: { requires_pass_installed: true } }),
        facts({ hasApplePass: false, hasGooglePass: false })
      )
    ).toContain('no_pass_installed')
    // Either wallet satisfies it.
    expect(
      reasons(
        campaign({ eligibility: { requires_pass_installed: true } }),
        facts({ hasApplePass: false, hasGooglePass: true })
      )
    ).toEqual([])
  })

  it('enforces the per-campaign cooldown', () => {
    expect(
      reasons(campaign({ cooldownHours: 24 }), facts({ hoursSinceCampaign: { 'campaign-1': 3 } }))
    ).toContain('within_cooldown')
    expect(
      reasons(campaign({ cooldownHours: 24 }), facts({ hoursSinceCampaign: { 'campaign-1': 25 } }))
    ).toEqual([])
    // A zero cooldown means the merchant switched it off deliberately.
    expect(
      reasons(campaign({ cooldownHours: 0 }), facts({ hoursSinceCampaign: { 'campaign-1': 0.1 } }))
    ).toEqual([])
  })

  it('enforces the lifetime send cap', () => {
    expect(
      reasons(campaign({ maxSendsPerCustomer: 2 }), facts({ sendsForCampaign: { 'campaign-1': 2 } }))
    ).toContain('send_limit_reached')
    expect(
      reasons(campaign({ maxSendsPerCustomer: 3 }), facts({ sendsForCampaign: { 'campaign-1': 2 } }))
    ).toEqual([])
  })

  it('labels every reason it can produce, so no merchant sees a raw enum', () => {
    const codes: IneligibleReason[] = Object.keys(
      INELIGIBLE_REASON_LABELS
    ) as IneligibleReason[]
    for (const code of codes) {
      expect(INELIGIBLE_REASON_LABELS[code], `${code} has no label`).toBeTruthy()
    }
  })
})

describe('passesFrequencyGuard', () => {
  const settings = {
    maxNotificationsPerDay: 2,
    minHoursBetweenNotifications: 6,
    respectQuietHours: true,
    quietHoursStart: 22,
    quietHoursEnd: 8,
  }

  const midday = new Date(2026, 6, 29, 13)
  const night = new Date(2026, 6, 29, 23)

  it('allows a first notification in the middle of the day', () => {
    expect(passesFrequencyGuard(facts(), settings, midday)).toEqual({ allowed: true })
  })

  it('refuses during quiet hours, whatever the campaign says', () => {
    expect(passesFrequencyGuard(facts(), settings, night)).toEqual({
      allowed: false,
      reason: 'quiet_hours',
    })
  })

  it('ignores quiet hours when the merchant has switched them off', () => {
    expect(
      passesFrequencyGuard(facts(), { ...settings, respectQuietHours: false }, night)
    ).toEqual({ allowed: true })
  })

  it('enforces the daily cap at the boundary', () => {
    expect(passesFrequencyGuard(facts({ notificationsToday: 1 }), settings, midday).allowed).toBe(
      true
    )
    expect(passesFrequencyGuard(facts({ notificationsToday: 2 }), settings, midday)).toEqual({
      allowed: false,
      reason: 'daily_cap',
    })
  })

  it('enforces the minimum gap', () => {
    expect(
      passesFrequencyGuard(facts({ hoursSinceLastNotification: 2 }), settings, midday)
    ).toEqual({ allowed: false, reason: 'too_soon' })
    expect(
      passesFrequencyGuard(facts({ hoursSinceLastNotification: 7 }), settings, midday).allowed
    ).toBe(true)
  })

  it('fails closed when pressure is unreadable', () => {
    // `notificationPressure` returns MAX_SAFE_INTEGER on a database error. Failing
    // open there would spam a customer during a hiccup, and a deleted pass cannot
    // be recovered; losing one notification can.
    expect(
      passesFrequencyGuard(
        facts({ notificationsToday: Number.MAX_SAFE_INTEGER, hoursSinceLastNotification: 0 }),
        settings,
        midday
      ).allowed
    ).toBe(false)
  })

  it('treats a zero cap as unlimited rather than as silence', () => {
    // Zero means "no cap configured"; reading it as "send nothing" would disable
    // every campaign for a merchant who cleared the field.
    expect(
      passesFrequencyGuard(
        facts({ notificationsToday: 99 }),
        { ...settings, maxNotificationsPerDay: 0 },
        midday
      ).allowed
    ).toBe(true)
  })
})

describe('selectCampaign', () => {
  it('returns nothing when nothing qualifies', () => {
    expect(selectCampaign([])).toBeNull()
  })

  it('prefers the highest merchant-assigned priority', () => {
    const chosen = selectCampaign([
      campaign({ id: 'low', priority: 1 }),
      campaign({ id: 'high', priority: 50 }),
    ])
    expect(chosen?.id).toBe('high')
  })

  it('breaks a priority tie towards the more specific campaign', () => {
    // A birthday reward should beat a generic "we're nearby" even when the merchant
    // forgot to set priorities — which they will.
    const chosen = selectCampaign([
      campaign({ id: 'generic', priority: 10 }),
      campaign({ id: 'birthday', priority: 10, eligibility: { birthday_only: true } }),
    ])
    expect(chosen?.id).toBe('birthday')
  })

  it('ranks a segmented, VIP-only campaign above an unrestricted one', () => {
    const chosen = selectCampaign([
      campaign({ id: 'all', priority: 0 }),
      campaign({ id: 'vip', priority: 0, vipOnly: true, segmentId: 'segment-1' }),
    ])
    expect(chosen?.id).toBe('vip')
  })

  it('does not mutate the list it was given', () => {
    const list = [campaign({ id: 'a', priority: 1 }), campaign({ id: 'b', priority: 9 })]
    selectCampaign(list)
    expect(list.map((entry) => entry.id)).toEqual(['a', 'b'])
  })
})
