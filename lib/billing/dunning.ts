import type { TranslationKey } from '@/lib/i18n/dictionaries/en'

/**
 * Dunning: what we do between a declined card and a paused workspace.
 *
 * Stripe retries a failed invoice several times over roughly two weeks. Until
 * now the product recorded `past_due` and said nothing, so the first a merchant
 * heard about a payment problem was their own workspace going quiet — which is
 * both the worst possible support experience and the most avoidable churn in the
 * product. Nothing here charges anyone; Stripe owns the retries. This owns the
 * *conversation*.
 *
 * Four rules the schedule encodes:
 *
 *  1. **Warn before, never after.** Every stage has an email, including the one
 *     that says "this is the last attempt". A merchant should never be surprised.
 *  2. **Say what is not happening.** Each message states plainly that nothing has
 *     been deleted, because the fear a payment failure produces is
 *     disproportionate to what actually happens (a `lapsed` tier, fully readable).
 *  3. **Advance on attempts, not on days.** Stripe decides when to retry, so
 *     driving the sequence off `attempt_count` keeps our story and their schedule
 *     in step even when they change the retry cadence.
 *  4. **Recovery is a message too.** A merchant who fixed their card gets told it
 *     worked; silence after three warnings reads as "still broken".
 *
 * Pure and dependency-free so the transitions are unit-testable — the part that
 * decides whether a paying customer is emailed, downgraded, or both.
 */

export type DunningStage = 'first' | 'retry' | 'final' | 'lapsed' | 'recovered'

/**
 * How many declines before the workspace is paused.
 *
 * Matches Stripe's default of four attempts (initial + three retries). If the
 * provider says it has stopped trying — `next_payment_attempt` is null — we act
 * on that instead, whatever the count says. Believing our own counter over
 * Stripe's is how a merchant gets paused while a retry is still pending.
 */
export const MAX_PAYMENT_ATTEMPTS = 4

export type DunningInput = {
  /** Stripe's `attempt_count` for the invoice: how many charges have failed. */
  attemptCount: number
  /** Stripe's `next_payment_attempt`, or null when it has given up. */
  nextAttemptAt: Date | null
  /** The stage the merchant was last told about, or null for a new sequence. */
  previousStage: DunningStage | null
}

export type DunningDecision = {
  stage: DunningStage
  /** False when the merchant has already been told this, so nothing is sent. */
  shouldNotify: boolean
  /** True only on the terminal step: move the workspace to the inactive tier. */
  shouldLapse: boolean
  subjectKey: TranslationKey
  bodyKey: TranslationKey
  ctaKey: TranslationKey
  /** For the merchant's notification feed, which is shorter than the email. */
  noticeTitleKey: TranslationKey
  noticeBodyKey: TranslationKey
}

const STAGE_COPY: Record<DunningStage, Omit<DunningDecision, 'stage' | 'shouldNotify' | 'shouldLapse'>> = {
  first: {
    subjectKey: 'emails.dunning.firstSubject',
    bodyKey: 'emails.dunning.firstBody',
    ctaKey: 'emails.dunning.cta',
    noticeTitleKey: 'notify.paymentFailedTitle',
    noticeBodyKey: 'notify.paymentFailedBody',
  },
  retry: {
    subjectKey: 'emails.dunning.retrySubject',
    bodyKey: 'emails.dunning.retryBody',
    ctaKey: 'emails.dunning.cta',
    noticeTitleKey: 'notify.paymentFailedTitle',
    noticeBodyKey: 'notify.paymentFailedBody',
  },
  final: {
    subjectKey: 'emails.dunning.finalSubject',
    bodyKey: 'emails.dunning.finalBody',
    ctaKey: 'emails.dunning.cta',
    noticeTitleKey: 'notify.paymentFailedTitle',
    noticeBodyKey: 'notify.paymentFailedBody',
  },
  lapsed: {
    subjectKey: 'emails.dunning.lapsedSubject',
    bodyKey: 'emails.dunning.lapsedBody',
    ctaKey: 'emails.dunning.ctaReactivate',
    noticeTitleKey: 'notify.subscriptionLapsedTitle',
    noticeBodyKey: 'notify.subscriptionLapsedBody',
  },
  recovered: {
    subjectKey: 'emails.dunning.recoveredSubject',
    bodyKey: 'emails.dunning.recoveredBody',
    ctaKey: 'emails.dunning.cta',
    noticeTitleKey: 'notify.paymentRecoveredTitle',
    noticeBodyKey: 'notify.paymentRecoveredBody',
  },
}

const STAGE_ORDER: DunningStage[] = ['first', 'retry', 'final', 'lapsed']

/**
 * Decides what one failed payment means.
 *
 * Deliberately total: every combination of attempt count, retry state and prior
 * stage produces an answer, because the alternative is a webhook handler with
 * branches nobody has read since it was written.
 */
export function decideDunning(input: DunningInput): DunningDecision {
  const stage = stageFor(input)

  /*
   * Stripe delivers at least once, and a retry of the *same* declined attempt
   * must not produce a second email. Comparing against the last stage the
   * merchant was told about is what makes the sequence idempotent per attempt
   * rather than per delivery.
   */
  const previousRank = input.previousStage ? STAGE_ORDER.indexOf(input.previousStage) : -1
  const currentRank = STAGE_ORDER.indexOf(stage)

  return {
    stage,
    shouldNotify: currentRank > previousRank,
    shouldLapse: stage === 'lapsed',
    ...STAGE_COPY[stage],
  }
}

function stageFor(input: DunningInput): DunningStage {
  // The provider has stopped trying. Whatever our counter says, this is the end
  // of the sequence — a merchant paused while Stripe is still retrying would be
  // paused for a payment that was about to succeed.
  if (input.nextAttemptAt === null) return 'lapsed'
  if (input.attemptCount >= MAX_PAYMENT_ATTEMPTS) return 'lapsed'
  if (input.attemptCount >= MAX_PAYMENT_ATTEMPTS - 1) return 'final'
  if (input.attemptCount <= 1) return 'first'
  return 'retry'
}

/**
 * The message for a payment that finally went through.
 *
 * Returned separately because recovery is not a stage in the failure sequence:
 * it can arrive from any of them, and it always sends — a merchant who has been
 * warned three times needs the all-clear more than they needed the warnings.
 */
export function decideRecovery(previousStage: DunningStage | null): DunningDecision | null {
  // Nothing to recover from: a first successful invoice is not news.
  if (previousStage === null || previousStage === 'recovered') return null

  return {
    stage: 'recovered',
    shouldNotify: true,
    shouldLapse: false,
    ...STAGE_COPY.recovered,
  }
}
