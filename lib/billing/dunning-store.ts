import 'server-only'
import { getDb } from '@/lib/db'
import { logger } from '@/lib/logger'
import { notify } from '@/lib/notifications'
import { sendTransactionalEmail } from '@/lib/messaging/transactional'
import { translatorForBusiness } from '@/lib/i18n/business'
import { applyPlan, invalidateEntitlements } from '@/lib/billing/entitlements'
import { PLANS, TRIAL_EXPIRED_PLAN, normalizePlanId } from '@/lib/billing/plans'
import {
  MAX_PAYMENT_ATTEMPTS,
  decideDunning,
  decideRecovery,
  type DunningStage,
} from '@/lib/billing/dunning'

/**
 * The dunning sequence, persisted and delivered.
 *
 * The decision is pure (`lib/billing/dunning.ts`); this is the shell that reads
 * the merchant's state, writes the new one, and sends. It reuses the existing
 * transactional email path rather than introducing a second sender — the same
 * one that delivers gift cards and GDPR exports — because a payment problem is
 * precisely a message the recipient asked for by having an account, and a second
 * email system would be a second set of credentials, templates and failure modes
 * for four messages.
 *
 * The idempotency story is worth stating, because Stripe's at-least-once
 * delivery makes it load-bearing:
 *
 *   * the webhook already refuses a replayed `event.id` at the door;
 *   * `billing_dunning` is unique on `(business_id, provider_invoice_id)`, so a
 *     second failure on the same invoice *updates* rather than starting over;
 *   * `shouldNotify` compares against the last stage the merchant was told, so
 *     even a genuinely new delivery for an attempt they have already heard about
 *     sends nothing.
 *
 * Three independent guards, because sending a merchant four copies of "we could
 * not take payment" is worse than sending none.
 */

export type DunningRow = {
  id: string
  attempt_count: number
  stage: DunningStage
  resolved_at: string | null
  last_notified_at: string | null
}

export type DunningOutcome = {
  stage: DunningStage
  notified: boolean
  lapsed: boolean
  emailed: boolean
}

/** Records a declined invoice and, when the stage advances, tells the merchant. */
export async function recordPaymentFailure(input: {
  businessId: string
  invoiceId: string
  attemptCount: number
  nextAttemptAt: Date | null
}): Promise<DunningOutcome> {
  const admin = getDb()

  const { data: existing } = await admin
    .from('billing_dunning')
    .select('id, attempt_count, stage, resolved_at, last_notified_at')
    .eq('business_id', input.businessId)
    .eq('provider_invoice_id', input.invoiceId)
    .maybeSingle()

  const previous = (existing as DunningRow | null) ?? null
  const decision = decideDunning({
    attemptCount: input.attemptCount,
    nextAttemptAt: input.nextAttemptAt,
    // A resolved row is a *previous* problem on the same invoice — vanishingly
    // rare, but treating it as ongoing would suppress the first warning of a new
    // sequence, which is the one that matters most.
    previousStage: previous && !previous.resolved_at ? previous.stage : null,
  })

  const { error: writeError } = await admin.from('billing_dunning').upsert(
    {
      business_id: input.businessId,
      provider_invoice_id: input.invoiceId,
      provider: 'stripe',
      attempt_count: input.attemptCount,
      stage: decision.stage,
      next_attempt_at: input.nextAttemptAt?.toISOString() ?? null,
      /*
       * Only advanced when something is actually sent. A replay that decides not
       * to notify must leave the timestamp where it was, or "when did we last
       * write to this merchant?" becomes unanswerable — which is the question
       * support asks first.
       */
      last_notified_at: decision.shouldNotify
        ? new Date().toISOString()
        : ((previous?.last_notified_at as string | null) ?? null),
      resolved_at: null,
    },
    { onConflict: 'business_id,provider_invoice_id' }
  )

  if (writeError) {
    // The state write failing must not stop the merchant being told. Worst case
    // they hear about the same attempt twice, which is far better than a
    // workspace that goes quiet with no warning at all.
    logger.error('billing.dunning_write_failed', {
      business_id: input.businessId,
      invoice_id: input.invoiceId,
      error: writeError,
    })
  }

  let emailed = false
  if (decision.shouldNotify) {
    emailed = await deliver(input.businessId, decision, input.attemptCount)
  }

  if (decision.shouldLapse) {
    /*
     * Downgrade, never delete. `lapsed` is a tier with no features, so every
     * screen still reads and every write meets one upgrade button — which is
     * what makes coming back a single decision rather than a migration.
     */
    await applyPlan(input.businessId, { plan: TRIAL_EXPIRED_PLAN, status: 'unpaid' })
    invalidateEntitlements(input.businessId)
  }

  return {
    stage: decision.stage,
    notified: decision.shouldNotify,
    lapsed: decision.shouldLapse,
    emailed,
  }
}

/** Closes an open sequence after a successful charge, and says so. */
export async function recordPaymentRecovered(input: {
  businessId: string
  invoiceId: string | null
}): Promise<DunningOutcome | null> {
  const admin = getDb()

  let query = admin
    .from('billing_dunning')
    .select('id, attempt_count, stage, resolved_at, last_notified_at')
    .eq('business_id', input.businessId)
    .is('resolved_at', null)
    .order('created_at', { ascending: false })
    .limit(1)

  // Scoped to the invoice when Stripe tells us which one; otherwise the newest
  // open sequence, because a merchant with two open dunning rows has a bigger
  // problem than which one we close first.
  if (input.invoiceId) query = query.eq('provider_invoice_id', input.invoiceId)

  const { data } = await query
  const open = ((data ?? [])[0] as DunningRow | undefined) ?? null
  const decision = decideRecovery(open?.stage ?? null)
  if (!open || !decision) return null

  await admin
    .from('billing_dunning')
    .update({ stage: 'recovered', resolved_at: new Date().toISOString() })
    .eq('id', open.id)

  const emailed = await deliver(input.businessId, decision, open.attempt_count)
  return { stage: 'recovered', notified: true, lapsed: false, emailed }
}

// -----------------------------------------------------------------------------

type Deliverable = ReturnType<typeof decideDunning>

/**
 * Sends one stage: an email to the billing contact and a row in the merchant's
 * own notification feed.
 *
 * Both are attempted; neither is allowed to fail the other. An unconfigured
 * email provider is the normal state of a fresh deployment, and it must not stop
 * the in-product notification — which is the only channel guaranteed to exist.
 */
async function deliver(
  businessId: string,
  decision: Deliverable,
  attemptCount: number
): Promise<boolean> {
  const admin = getDb()
  const t = await translatorForBusiness(businessId)

  const { data: business } = await admin
    .from('businesses')
    .select('name, support_email, plan')
    .eq('id', businessId)
    .maybeSingle()

  const planId = normalizePlanId(business?.plan) ?? TRIAL_EXPIRED_PLAN
  const values = {
    business: (business?.name as string) ?? t('common.appName'),
    plan: PLANS[planId].name,
    // Stripe's own attempt number, so "attempt 2 of 4" in the email matches what
    // the merchant sees on their Stripe invoice.
    attempt: attemptCount,
    maxAttempts: MAX_PAYMENT_ATTEMPTS,
  }

  await notify(businessId, {
    type: 'billing',
    severity: decision.shouldLapse ? 'critical' : 'warning',
    title: t(decision.noticeTitleKey),
    body: t(decision.noticeBodyKey),
    url: '/dashboard/billing',
  }).catch((cause: unknown) => {
    logger.warn('billing.dunning_notify_failed', { business_id: businessId, cause })
  })

  const to = business?.support_email as string | undefined
  if (!to) {
    // No billing contact on file. The in-product notification still landed, and
    // inventing a recipient would be worse than the gap.
    logger.warn('billing.dunning_no_recipient', { business_id: businessId })
    return false
  }

  const result = await sendTransactionalEmail({
    to,
    businessId,
    subject: t(decision.subjectKey, values),
    body: t(decision.bodyKey, values),
    ctaLabel: t(decision.ctaKey),
    ctaUrl: '/dashboard/billing',
  })

  if (!result.ok) {
    logger.warn('billing.dunning_email_failed', {
      business_id: businessId,
      stage: decision.stage,
      error: result.error,
    })
  }
  return result.ok
}
