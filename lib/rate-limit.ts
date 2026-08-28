import 'server-only'
import { getDb } from '@/lib/db'
import { logger } from '@/lib/logger'
import { RateLimitWindowCache } from '@/lib/rate-limit-cache'

/**
 * Distributed fixed-window rate limiting backed by Postgres.
 *
 * Serverless functions have no shared memory, so the authoritative counter
 * lives in the database (`passimo_rate_limit` RPC — a single atomic upsert).
 * An in-process cache short-circuits obvious over-limit bursts so a hot attack
 * loop does not translate into one database round trip per request.
 *
 * Fails open: if the database is unreachable we let the request through rather
 * than taking the whole product down. Abuse is logged loudly.
 */

export type RateLimitRule = {
  /** Requests allowed inside the window. */
  limit: number
  /** Window length in seconds. */
  windowSeconds: number
}

export type RateLimitResult = {
  allowed: boolean
  limit: number
  remaining: number
  resetAt: Date
  retryAfterSeconds: number
}

/** Named policies keep limits reviewable in one place. */
export const RATE_LIMITS = {
  /** Anonymous, unauthenticated public endpoints. */
  publicStrict: { limit: 10, windowSeconds: 60 },
  publicRelaxed: { limit: 60, windowSeconds: 60 },
  /**
   * Sign-up, password reset, email verification.
   *
   * Deliberately tight: each of these creates a row or sends mail to a third
   * party, and none has a second control behind it.
   */
  auth: { limit: 8, windowSeconds: 300 },
  /**
   * Sign-in only.
   *
   * Looser than `auth` because it is not the control that stops password
   * guessing — `authenticate()` locks an account for fifteen minutes after five
   * wrong passwords, and that limit is per *account*, so it holds however many
   * addresses an attacker rotates through. This bucket's job is volume abuse.
   *
   * At eight per five minutes it was doing a different job badly: a shop is one
   * IP, so a counter tablet, the owner's laptop and a second till share the
   * budget, and one person fumbling their password locked out colleagues who had
   * typed nothing wrong. On shared infrastructure — a mall, a coworking space —
   * that is a denial of service one tenant can inflict on another. The account
   * lockout is unchanged, so an attacker still gets five guesses per account per
   * fifteen minutes no matter what this number says.
   */
  authSignIn: { limit: 30, windowSeconds: 300 },
  /** Anything that sends an email/SMS to a third party. */
  outbound: { limit: 20, windowSeconds: 3600 },
  /** Authenticated dashboard traffic. */
  dashboard: { limit: 300, windowSeconds: 60 },
  /** Point-of-sale actions — high frequency by design. */
  pos: { limit: 600, windowSeconds: 60 },
  /** Public REST API per key. */
  api: { limit: 120, windowSeconds: 60 },
  /** AI generation: costly, so deliberately tight. */
  ai: { limit: 30, windowSeconds: 3600 },
  /** Bulk operations (import/export). */
  bulk: { limit: 5, windowSeconds: 3600 },
  /**
   * Binary uploads — the brand logo.
   *
   * Not `bulk`: five an hour is right for a 40,000-row customer import and wrong
   * for a merchant trying three versions of their logo against the live card
   * preview, which is exactly the interaction the designer is built around.
   * Not `dashboard` either, because each of these costs a write to disk or to an
   * object store rather than a query. Twenty an hour lets someone iterate on
   * their brand for an afternoon and still bounds the damage.
   */
  upload: { limit: 20, windowSeconds: 3600 },
  /**
   * Customer position reports and wallet funnel events.
   *
   * A browser watching `geolocation` emits a report whenever the device moves,
   * which on a bus is several a minute. Generous enough that a genuine walk past a
   * shop is never dropped, tight enough that a loop cannot be used to hammer the
   * geofence evaluator — the most expensive public path in the product.
   */
  proximity: { limit: 120, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitRule>

export type RateLimitName = keyof typeof RATE_LIMITS

/**
 * The in-process short-circuit, extracted into `lib/rate-limit-cache.ts`.
 *
 * It lives there so its memory behaviour is testable without a database:
 * the concern is `proximity`, whose keys are customer ids and whose volume is
 * one report per device per minute, and "does this map have a ceiling" was
 * previously unanswerable from outside the module.
 */
const localCache = new RateLimitWindowCache()

/** Test seam. Clearing only ever costs a database round trip. */
export function resetRateLimitCache(): void {
  localCache.clear()
}

/** Entries currently held, for tests and for an operational readout. */
export function rateLimitCacheSize(): number {
  return localCache.size
}

export async function checkRateLimit(
  bucket: string,
  identifier: string,
  rule: RateLimitRule
): Promise<RateLimitResult> {
  const key = `${bucket}:${identifier}`
  const now = Date.now()

  const short = localCache.check(key, rule, now)
  if (short) {
    return {
      allowed: false,
      limit: short.limit,
      remaining: short.remaining,
      resetAt: new Date(short.resetAtMs),
      retryAfterSeconds: short.retryAfterSeconds,
    }
  }

  try {
    const admin = getDb()
    const { data, error } = await admin.rpc('passimo_rate_limit', {
      p_key: key,
      p_limit: rule.limit,
      p_window_seconds: rule.windowSeconds,
    })
    if (error) throw error

    const row = Array.isArray(data) ? data[0] : data
    const count = Number(row?.current_count ?? 0)
    const resetAt = new Date(row?.reset_at ?? now + rule.windowSeconds * 1000)
    localCache.record(key, count, resetAt.getTime(), now)

    const allowed = Boolean(row?.allowed)
    return {
      allowed,
      limit: rule.limit,
      remaining: Math.max(0, rule.limit - count),
      resetAt,
      retryAfterSeconds: Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 1000)),
    }
  } catch (cause) {
    logger.error('rate_limit.unavailable', { bucket, cause })
    return {
      allowed: true,
      limit: rule.limit,
      remaining: rule.limit,
      resetAt: new Date(Date.now() + rule.windowSeconds * 1000),
      retryAfterSeconds: 0,
    }
  }
}

/** Best-effort client IP from the usual proxy headers. */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0]!.trim()
  return (
    request.headers.get('x-real-ip') ??
    request.headers.get('cf-connecting-ip') ??
    'unknown'
  )
}

export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(Math.floor(result.resetAt.getTime() / 1000)),
  }
}
