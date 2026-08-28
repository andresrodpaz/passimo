import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { JOB_TYPES } from '@/lib/jobs/queue'
import { MAX_NOTIFICATION_ATTEMPTS } from '@/lib/wallet/notifications'
import {
  MAX_SYNC_ATTEMPTS,
  planSync,
  reduceProviderState,
  retryDelaySeconds,
  type ProviderState,
} from '@/lib/wallet/sync-state'
import { RateLimitWindowCache, DEFAULT_MAX_ENTRIES } from '@/lib/rate-limit-cache'
import {
  passesFrequencyGuard,
  type CustomerFacts,
} from '@/lib/wallet/eligibility'
import type { WalletSettings } from '@/lib/wallet/types'

/**
 * The wallet failure paths.
 *
 * Everything here is a case the happy path hides: one vendor down while the
 * other is fine, a guard whose own inputs cannot be read, a cache that has to
 * stay bounded under the noisiest endpoint in the product. None of them show up
 * in an error log, because none of them are errors — they are silences.
 */

// -----------------------------------------------------------------------------
// Partial vendor failure
// -----------------------------------------------------------------------------

describe('a sync where one wallet fails and the other does not', () => {
  it('records the succeeding vendor as current and the failing one as stale', () => {
    const plan = planSync([
      { provider: 'apple', ok: true, devices: 2 },
      { provider: 'google', ok: false, devices: 0, error: 'HTTP 503' },
    ])

    const apple = plan.states.find((state) => state.provider === 'apple')!
    const google = plan.states.find((state) => state.provider === 'google')!

    expect(apple.status).toBe('synced')
    expect(google.status).toBe('stale')
    expect(google.lastError).toBe('HTTP 503')
    expect(plan.degraded).toBe(true)
  })

  it('retries only the vendor that failed', () => {
    // Re-pushing the healthy vendor would wake the customer's phone a second
    // time for a card that did not change — and a customer whose watch buzzes
    // twice for one coffee deletes the card.
    const plan = planSync([
      { provider: 'apple', ok: true, devices: 2 },
      { provider: 'google', ok: false, devices: 0, error: 'timeout' },
    ])

    expect(plan.retry.map((entry) => entry.provider)).toEqual(['google'])
  })

  it('queues nothing when both vendors succeed', () => {
    const plan = planSync([
      { provider: 'apple', ok: true, devices: 1 },
      { provider: 'google', ok: true, devices: 1 },
    ])
    expect(plan.retry).toEqual([])
    expect(plan.degraded).toBe(false)
  })

  it('treats "installed nowhere" as success rather than as a failure', () => {
    // Most enrolled customers never add the card. Zero devices with no error is
    // the normal case, and marking it stale would put the majority of a
    // merchant's list into a permanent retry loop.
    const plan = planSync([{ provider: 'apple', ok: true, devices: 0 }])
    expect(plan.states[0]!.status).toBe('synced')
    expect(plan.retry).toEqual([])
  })

  it('counts consecutive failures and gives up rather than retrying forever', () => {
    let state: ProviderState | null = null
    for (let index = 0; index < MAX_SYNC_ATTEMPTS; index += 1) {
      state = reduceProviderState(state, {
        provider: 'google',
        ok: false,
        devices: 0,
        error: 'revoked credentials',
      })
    }

    expect(state!.attempts).toBe(MAX_SYNC_ATTEMPTS)
    expect(state!.status).toBe('abandoned')
    // Abandoned, not deleted: a merchant asking why a card is wrong gets an
    // answer, and an unbounded retry on a revoked certificate is a self-inflicted
    // outage.
    expect(planSync([{ provider: 'google', ok: false, devices: 0 }], [state!]).retry).toEqual([])
  })

  it('forgets old failures the moment a vendor works again', () => {
    const failed: ProviderState = {
      provider: 'apple',
      status: 'stale',
      attempts: 3,
      lastError: 'timeout',
    }
    const recovered = reduceProviderState(failed, { provider: 'apple', ok: true, devices: 4 })

    expect(recovered.attempts).toBe(0)
    expect(recovered.status).toBe('synced')
    expect(recovered.lastError).toBeNull()
  })

  it('backs off exponentially and caps, so an outage does not become a storm', () => {
    expect(retryDelaySeconds(1)).toBe(60)
    expect(retryDelaySeconds(2)).toBe(120)
    expect(retryDelaySeconds(3)).toBe(240)
    expect(retryDelaySeconds(20)).toBe(3_600)
  })
})

// -----------------------------------------------------------------------------
// Proximity guards, under failure rather than under load
// -----------------------------------------------------------------------------

/**
 * Architectural decision 14: proximity guards fail closed.
 *
 * A wallet pass is deleted the first time it feels like spam and there is no
 * re-permission flow, so an unreadable frequency counter has to count as maximum
 * pressure. The pure guard was already covered for the *known* cases; what was
 * missing was the case where its own inputs are unreadable, which is exactly
 * what a database blip produces.
 */
describe('proximity guards when their own inputs cannot be read', () => {
  const settings = {
    maxNotificationsPerDay: 2,
    minHoursBetweenNotifications: 4,
    respectQuietHours: true,
    quietHoursStart: 21,
    quietHoursEnd: 9,
  } as unknown as WalletSettings

  const noon = new Date('2026-06-15T12:00:00Z')

  function facts(overrides: Partial<CustomerFacts> = {}): CustomerFacts {
    return {
      customerId: 'cus-1',
      points: 10,
      visits: 4,
      tierLevel: 1,
      isVip: false,
      daysSinceLastVisit: 3,
      isBirthdayToday: false,
      isAnniversaryToday: false,
      hasClaimableReward: false,
      segmentIds: [],
      hasApplePass: true,
      hasGooglePass: false,
      notificationsToday: 0,
      hoursSinceLastNotification: 24,
      sendsForCampaign: {},
      hoursSinceCampaign: {},
      ...overrides,
    }
  }

  it('allows a send when the counters read normally', () => {
    expect(passesFrequencyGuard(facts(), settings, noon).allowed).toBe(true)
  })

  it('refuses when the daily counter is unreadable rather than assuming zero', () => {
    // `notificationPressure` reports the day's count. If that read fails and the
    // caller substituted 0, a broken database would become permission to spam —
    // the single most expensive failure this product has, because the customer's
    // remedy is deleting the card.
    const unreadable = facts({ notificationsToday: Number.NaN })
    expect(passesFrequencyGuard(unreadable, settings, noon).allowed).toBe(false)
  })

  it('refuses when the time since the last notification is unknown', () => {
    const unreadable = facts({ hoursSinceLastNotification: Number.NaN })
    const guard = passesFrequencyGuard(unreadable, settings, noon)
    expect(guard.allowed).toBe(false)
  })

  it('honours the sentinel `notificationPressure` returns when its read throws', () => {
    // The two halves of decision 14 have to agree. `notificationPressure`
    // reports maximum pressure on a database error — this asserts the guard
    // actually treats that as a refusal, rather than the two modules each
    // assuming the other is failing closed.
    const onError = facts({
      notificationsToday: Number.MAX_SAFE_INTEGER,
      hoursSinceLastNotification: 0,
    })
    expect(passesFrequencyGuard(onError, settings, noon).allowed).toBe(false)
  })

  it('still allows a customer who has genuinely never been notified', () => {
    // `null` is a known absence, not a failed read, and it is the ordinary case
    // for most of a merchant's list. Collapsing it into the failure case would
    // silence the feature for everyone who has not yet received anything.
    const never = facts({ hoursSinceLastNotification: null })
    expect(passesFrequencyGuard(never, settings, noon).allowed).toBe(true)
  })

  it('still refuses inside quiet hours whatever the counters say', () => {
    const night = new Date('2026-06-15T22:30:00Z')
    const guard = passesFrequencyGuard(facts(), settings, night)
    expect(guard.allowed).toBe(false)
    expect(guard.reason).toBe('quiet_hours')
  })

  it('refuses once the daily cap is reached', () => {
    const guard = passesFrequencyGuard(facts({ notificationsToday: 2 }), settings, noon)
    expect(guard.allowed).toBe(false)
    expect(guard.reason).toBe('daily_cap')
  })

  it('refuses when the last notification is too recent', () => {
    const guard = passesFrequencyGuard(facts({ hoursSinceLastNotification: 1 }), settings, noon)
    expect(guard.allowed).toBe(false)
    expect(guard.reason).toBe('too_soon')
  })
})

// -----------------------------------------------------------------------------
// The in-process rate-limit cache
// -----------------------------------------------------------------------------

/**
 * The `proximity` bucket is the highest-volume authenticated path in the
 * product: a browser watching `geolocation` reports whenever the device moves,
 * keyed by customer id. The cache in front of the database limiter therefore
 * sees one entry per active customer per window, and "does it have a ceiling"
 * was previously unanswerable — the map was module-private with no way to
 * observe its size.
 */
describe('the in-process rate-limit cache under proximity volume', () => {
  const rule = { limit: 120, windowSeconds: 60 }
  let cache: RateLimitWindowCache

  beforeEach(() => {
    cache = new RateLimitWindowCache(500)
  })

  it('never exceeds its ceiling, however many distinct customers report', () => {
    const now = 1_000_000
    // Ten times the ceiling, all live: the worst case, where no entry can be
    // swept because none has expired.
    for (let index = 0; index < 5_000; index += 1) {
      cache.record(`proximity:customer-${index}`, 1, now + 60_000, now)
    }
    expect(cache.size).toBeLessThanOrEqual(500)
  })

  it('sheds expired windows before resorting to clearing everything', () => {
    const now = 1_000_000
    for (let index = 0; index < 400; index += 1) {
      // Already closed.
      cache.record(`old-${index}`, 1, now - 1, now - 120_000)
    }
    for (let index = 0; index < 100; index += 1) {
      cache.record(`live-${index}`, 1, now + 60_000, now)
    }

    cache.record('one-more', 1, now + 60_000, now)

    // The live entries survived: a sweep freed enough that nothing had to be
    // thrown away, so a busy process does not lose its short-circuit.
    expect(cache.check('live-0', rule, now)).toBeNull()
    expect(cache.size).toBeLessThanOrEqual(500)
  })

  it('stops refusing the moment a window closes', () => {
    // The bug an eager cache would create: a customer who hit the limit at
    // 12:00:59 must be able to report again at 12:01:00, not when something
    // happens to sweep the map.
    const now = 1_000_000
    cache.record('proximity:cus-1', 999, now + 1_000, now)
    expect(cache.check('proximity:cus-1', rule, now)?.allowed).toBe(false)
    expect(cache.check('proximity:cus-1', rule, now + 2_000)).toBeNull()
  })

  it('drops an expired entry on read, not only on sweep', () => {
    const now = 1_000_000
    cache.record('proximity:cus-1', 999, now + 1_000, now)
    cache.check('proximity:cus-1', rule, now + 2_000)
    // A steadily-polled key must not accumulate a stale entry waiting for the
    // ceiling to be reached.
    expect(cache.size).toBe(0)
  })

  it('never refuses a request the database would have allowed', () => {
    // The cache is pessimistic only. A recorded count below the limit yields no
    // verdict at all, so the database stays authoritative.
    const now = 1_000_000
    cache.record('proximity:cus-1', 5, now + 60_000, now)
    expect(cache.check('proximity:cus-1', rule, now)).toBeNull()
  })

  it('ships with a ceiling sized for a real deployment', () => {
    expect(DEFAULT_MAX_ENTRIES).toBeGreaterThanOrEqual(1_000)
  })
})

// -----------------------------------------------------------------------------
// A notification deduplicated by cooldown whose send then fails
// -----------------------------------------------------------------------------

/**
 * The gap this closes.
 *
 * `sendWalletNotification` claims the dedupe key *before* attempting delivery.
 * That ordering is deliberate and load-bearing: it is what makes the dozens of
 * geofence crossings a phone emits at a boundary collapse into one notification,
 * with no lock and no cleanup job (architectural decision 15).
 *
 * It also meant that a delivery failing *after* the claim held the key for the
 * whole cooldown window. The next crossing produced the same key, conflicted
 * with the corpse of the failed attempt, and was dropped as a duplicate — so one
 * transient APNs error silently cost the merchant every send in that window, and
 * the delivery log showed a `failed` row that nothing would ever revisit.
 *
 * The fix is structural rather than procedural: the column is nullable, a failed
 * attempt releases its claim, and Postgres treats nulls as distinct in a unique
 * index — so the row survives for the audit trail while the slot is freed. A
 * bounded retry job then re-attempts the same recorded copy.
 */
describe('a notification whose delivery fails after the dedupe key is claimed', () => {
  const migration = readFileSync(
    path.join(process.cwd(), 'db/migrations/000016_launch_hardening.sql'),
    'utf8'
  )

  it('can release its claim, because the column is nullable', () => {
    expect(migration).toMatch(/alter table wallet_notifications alter column dedupe_key drop not null/)
  })

  it('counts its attempts, so the retry is bounded rather than eternal', () => {
    expect(migration).toMatch(/add column if not exists attempts int not null default 0/)
  })

  it('gives up before the copy goes stale', () => {
    // "You are near the shop" is worthless an hour later, so the retries exist
    // to survive a blip, not an outage. A campaign that still matters will fire
    // again on the next crossing.
    expect(MAX_NOTIFICATION_ATTEMPTS).toBeGreaterThan(1)
    expect(MAX_NOTIFICATION_ATTEMPTS).toBeLessThanOrEqual(5)
  })

  it('has a job type to retry on', () => {
    // Without a registered type the release would be half a fix: the window
    // would be freed, but nothing would re-send the notification that failed.
    expect(JOB_TYPES).toContain('wallet.notification_retry')
    expect(JOB_TYPES).toContain('wallet.sync_retry')
  })

  it('keeps the unique index that makes the cooldown work at all', () => {
    // The release must not have quietly removed the guarantee it depends on.
    const original = readFileSync(
      path.join(process.cwd(), 'db/migrations/000015_wallet_proximity_and_paid_plans.sql'),
      'utf8'
    )
    expect(original).toMatch(
      /create unique index[^;]*idx_wallet_notifications_dedupe[\s\S]*?on wallet_notifications \(business_id, dedupe_key\)/
    )
  })

  it('records per-vendor sync state under RLS like every other tenant table', () => {
    expect(migration).toMatch(/create table if not exists wallet_sync_state/)
    expect(migration).toMatch(/'business_onboarding', 'billing_dunning', 'wallet_sync_state'/)
    expect(migration).toMatch(/create policy "tenant read" on %I/)
  })
})
