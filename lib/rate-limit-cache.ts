/**
 * The in-process short-circuit in front of the database rate limiter.
 *
 * Extracted from `lib/rate-limit.ts` so the part with a memory profile can be
 * tested without a database. The question it has to answer is narrow and
 * important: under the traffic the product actually generates — customer
 * position reports, which arrive per device per minute and are keyed by customer
 * id — does this map grow without bound, and can a stale window keep refusing a
 * request after it has expired?
 *
 * Both answers have to be no, and neither was previously provable: the map was a
 * module-private `const` with no way to observe its size.
 *
 * The cache is deliberately *pessimistic only*. It never allows a request the
 * database would refuse; it only refuses one the database has already refused
 * inside the current window. A wrong entry therefore costs a rejected request
 * that would have been rejected anyway, which is why it is safe for it to be
 * approximate and safe for it to be cleared at any moment.
 */

export type WindowRule = {
  /** Requests allowed inside the window. */
  limit: number
  /** Window length in seconds. */
  windowSeconds: number
}

export type WindowVerdict = {
  allowed: false
  limit: number
  remaining: 0
  resetAtMs: number
  retryAfterSeconds: number
}

type Entry = { count: number; resetAtMs: number }

/**
 * The hard ceiling on entries.
 *
 * Sized for the busiest realistic single process: a deployment tracking a few
 * thousand distinct customers inside one 60-second proximity window. Above it
 * the cache sheds rather than grows — losing entries costs one database round
 * trip each, and an unbounded map costs the process.
 */
export const DEFAULT_MAX_ENTRIES = 5_000

export class RateLimitWindowCache {
  private readonly entries = new Map<string, Entry>()

  constructor(private readonly maxEntries: number = DEFAULT_MAX_ENTRIES) {}

  /** How many entries are held. Exposed so the bound is testable, not guessed. */
  get size(): number {
    return this.entries.size
  }

  /**
   * Refuses without a query when this key is already known to be over the limit
   * *inside a window that has not expired*. Returns null in every other case,
   * including an expired window — which is the bug an eager check would create:
   * a key that hit the limit at 12:00:59 must be free again at 12:01:00.
   */
  check(key: string, rule: WindowRule, now: number): WindowVerdict | null {
    const entry = this.entries.get(key)
    if (!entry) return null

    if (entry.resetAtMs <= now) {
      // Expired. Dropped on read as well as on sweep, so a key that is polled
      // steadily never accumulates a stale entry waiting for the next sweep.
      this.entries.delete(key)
      return null
    }

    if (entry.count < rule.limit) return null

    return {
      allowed: false,
      limit: rule.limit,
      remaining: 0,
      resetAtMs: entry.resetAtMs,
      retryAfterSeconds: Math.ceil((entry.resetAtMs - now) / 1000),
    }
  }

  /**
   * Records the authoritative count the database returned.
   *
   * Sweeps expired entries first when at the ceiling, and only clears wholesale
   * if the sweep freed nothing — which means every entry is live, and shedding
   * the lot is the correct trade against unbounded growth.
   */
  record(key: string, count: number, resetAtMs: number, now: number): void {
    if (this.entries.size >= this.maxEntries) {
      this.evictExpired(now)
      if (this.entries.size >= this.maxEntries) this.entries.clear()
    }
    this.entries.set(key, { count, resetAtMs })
  }

  /** Drops every window that has closed. Returns how many were removed. */
  evictExpired(now: number): number {
    let removed = 0
    for (const [key, entry] of this.entries) {
      if (entry.resetAtMs <= now) {
        this.entries.delete(key)
        removed += 1
      }
    }
    return removed
  }

  clear(): void {
    this.entries.clear()
  }
}
