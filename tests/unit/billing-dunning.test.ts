import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  MAX_PAYMENT_ATTEMPTS,
  decideDunning,
  decideRecovery,
  type DunningStage,
} from '@/lib/billing/dunning'
import {
  UNIQUE_VIOLATION,
  interpretClaim,
  statusForClaim,
} from '@/lib/billing/webhook-idempotency'

/**
 * What happens between a declined card and a paused workspace.
 *
 * This is the least-exercised path in the product and the most expensive to get
 * wrong in either direction: too eager and a paying merchant is cut off over a
 * bank's fraud check; too quiet and the first they hear of a problem is their
 * own workspace refusing writes. Both failures are invisible until a real
 * customer hits them, so the transitions are asserted rather than trusted.
 */

const RETRY_TOMORROW = new Date('2026-06-16T09:00:00Z')

function attempt(
  attemptCount: number,
  previousStage: DunningStage | null = null,
  nextAttemptAt: Date | null = RETRY_TOMORROW
) {
  return decideDunning({ attemptCount, nextAttemptAt, previousStage })
}

describe('the dunning sequence', () => {
  it('warns on the first decline without changing anything', () => {
    const decision = attempt(1)
    expect(decision.stage).toBe('first')
    expect(decision.shouldNotify).toBe(true)
    expect(decision.shouldLapse).toBe(false)
  })

  it('escalates through retry to a final warning', () => {
    expect(attempt(2, 'first').stage).toBe('retry')
    expect(attempt(3, 'retry').stage).toBe('final')
    // The final stage still only warns. Nothing is paused until the retries are
    // actually exhausted — a merchant must never be cut off while Stripe still
    // intends to try again.
    expect(attempt(3, 'retry').shouldLapse).toBe(false)
  })

  it('pauses the workspace only when the attempts are exhausted', () => {
    const decision = attempt(MAX_PAYMENT_ATTEMPTS, 'final')
    expect(decision.stage).toBe('lapsed')
    expect(decision.shouldLapse).toBe(true)
    expect(decision.shouldNotify).toBe(true)
  })

  it('believes the provider over its own counter', () => {
    // Stripe saying "no further attempt" ends the sequence whatever the count
    // says. The inverse — our counter reaching the cap while a retry is still
    // scheduled — would pause someone whose payment was about to succeed.
    const stopped = attempt(2, 'first', null)
    expect(stopped.stage).toBe('lapsed')
    expect(stopped.shouldLapse).toBe(true)
  })

  it('sends nothing for a replay of an attempt the merchant already heard about', () => {
    // Stripe delivers at least once. The webhook rejects a duplicate `event.id`,
    // but a genuinely new event about the same attempt must also be silent, or a
    // merchant gets four copies of the same warning.
    const replay = attempt(1, 'first')
    expect(replay.stage).toBe('first')
    expect(replay.shouldNotify).toBe(false)
  })

  it('never walks the sequence backwards', () => {
    // Out-of-order delivery is normal. An event for attempt 1 arriving after
    // attempt 3 must not re-send the gentle first warning.
    const late = attempt(1, 'final')
    expect(late.shouldNotify).toBe(false)
  })

  it('still pauses when the lapse event arrives out of order', () => {
    const decision = attempt(MAX_PAYMENT_ATTEMPTS, 'lapsed')
    // Already told, so no second email — but the downgrade is idempotent and
    // must still be applied, in case the first attempt at it failed.
    expect(decision.shouldNotify).toBe(false)
    expect(decision.shouldLapse).toBe(true)
  })

  it('gives every stage real copy, so no merchant gets a blank email', () => {
    for (const count of [1, 2, 3, MAX_PAYMENT_ATTEMPTS]) {
      const decision = attempt(count)
      expect(decision.subjectKey).toMatch(/^emails\.dunning\./)
      expect(decision.bodyKey).toMatch(/^emails\.dunning\./)
      expect(decision.noticeTitleKey).toMatch(/^notify\./)
    }
  })

  it('offers reactivation rather than a card update once paused', () => {
    // The button has to match the situation: "update payment details" on a
    // paused workspace sends someone to a portal for a subscription that is no
    // longer running.
    expect(attempt(MAX_PAYMENT_ATTEMPTS).ctaKey).toBe('emails.dunning.ctaReactivate')
    expect(attempt(1).ctaKey).toBe('emails.dunning.cta')
  })
})

describe('recovery', () => {
  it('tells the merchant when a retry finally succeeds', () => {
    const decision = decideRecovery('retry')
    expect(decision?.stage).toBe('recovered')
    expect(decision?.shouldNotify).toBe(true)
    expect(decision?.shouldLapse).toBe(false)
  })

  it('says nothing when there was no problem to recover from', () => {
    // A first successful invoice is not news, and "your payment went through"
    // out of nowhere reads as a charge the merchant did not expect.
    expect(decideRecovery(null)).toBeNull()
  })

  it('does not repeat itself', () => {
    expect(decideRecovery('recovered')).toBeNull()
  })

  it('recovers from a paused workspace too', () => {
    // The most important one: they paid after being paused, and the all-clear is
    // what tells them everything is back.
    expect(decideRecovery('lapsed')?.stage).toBe('recovered')
  })
})

/**
 * Webhook idempotency.
 *
 * Stripe guarantees at-least-once delivery, so every effect the webhook applies
 * — a plan change, an invoice, a dunning email — has to survive the same event
 * arriving twice. The mechanism is an insert into `subscription_events` guarded
 * by a unique index, and it is only as good as the branch that reads the insert
 * error.
 */
describe('duplicate Stripe events', () => {
  it('treats a unique violation as already handled, not as a failure', () => {
    expect(interpretClaim({ code: UNIQUE_VIOLATION })).toBe('duplicate')
  })

  it('acknowledges a duplicate so Stripe stops retrying', () => {
    // 500 here would be an infinite loop: the row will always be there, so every
    // retry would fail the same way for ever.
    expect(statusForClaim('duplicate')).toBe(200)
  })

  it('asks Stripe to retry when our own storage failed', () => {
    // The opposite error is worse and quieter: answering 200 to a real database
    // failure loses the event, and a paid upgrade silently never applies.
    expect(interpretClaim({ code: '08006' })).toBe('unavailable')
    expect(statusForClaim('unavailable')).toBe(500)
  })

  it('runs the handler when the claim succeeded', () => {
    expect(interpretClaim(null)).toBe('fresh')
    expect(interpretClaim(undefined)).toBe('fresh')
    expect(interpretClaim({})).toBe('unavailable')
  })

  it('is backed by a unique index in the schema, not only by the branch above', () => {
    /*
     * The branch is meaningless without the constraint that produces it. Two
     * concurrent deliveries of one event would otherwise both insert, both see
     * no error, and both apply the effects — which is precisely the race the
     * index exists to lose on purpose.
     */
    const migration = readFileSync(
      path.join(process.cwd(), 'db/migrations/000013_commerce_and_growth.sql'),
      'utf8'
    )
    expect(migration).toMatch(
      /create unique index[^;]*idx_subscription_events_provider_id[\s\S]*?on subscription_events \(provider, provider_event_id\)/
    )
  })

  it('keeps the dunning sequence on the invoice, so one event cannot double-charge the story', () => {
    const migration = readFileSync(
      path.join(process.cwd(), 'db/migrations/000016_launch_hardening.sql'),
      'utf8'
    )
    // A replayed `invoice.payment_failed` upserts the same row rather than
    // opening a second sequence and sending a second first-warning email.
    expect(migration).toMatch(
      /create unique index[^;]*idx_billing_dunning_invoice[\s\S]*?on billing_dunning \(business_id, provider_invoice_id\)/
    )
  })
})
