/**
 * Deciding what a failed event claim means.
 *
 * The Stripe webhook inserts the event id into `subscription_events` before it
 * does anything else. The unique index on `(provider, provider_event_id)` is
 * what turns at-least-once delivery into exactly-once effects: a replay loses
 * the race to insert, and the handler stops.
 *
 * That mechanism is only as good as the branch that reads the insert error, and
 * that branch decides whether a merchant's plan changes twice, whether they get
 * two "payment failed" emails, and whether Stripe retries. Getting it backwards
 * in either direction is expensive:
 *
 *   * treating a real database failure as a duplicate returns 200, Stripe never
 *     retries, and the event is lost — a paid upgrade that never applies;
 *   * treating a duplicate as a failure returns 500, Stripe retries forever, and
 *     the loop never terminates because the row will always be there.
 *
 * So it is a pure function with a name, tested against the codes Postgres
 * actually emits, rather than a `if (error.code === '23505')` inline in a route.
 */

/** Postgres `unique_violation`. */
export const UNIQUE_VIOLATION = '23505'

export type ClaimVerdict =
  /** First time we have seen this event: run the handler. */
  | 'fresh'
  /** Already processed. Acknowledge with 200 so Stripe stops retrying. */
  | 'duplicate'
  /** Our own storage failed. Answer 500 so Stripe retries. */
  | 'unavailable'

export function interpretClaim(error: { code?: string | null } | null | undefined): ClaimVerdict {
  if (!error) return 'fresh'
  if (error.code === UNIQUE_VIOLATION) return 'duplicate'
  return 'unavailable'
}

/**
 * The HTTP answer each verdict deserves.
 *
 * Stated here rather than at the call site because the *retry* behaviour is the
 * point: 200 means "stop", 500 means "try again", and which one a duplicate gets
 * is the whole idempotency contract.
 */
export function statusForClaim(verdict: ClaimVerdict): number {
  return verdict === 'unavailable' ? 500 : 200
}
