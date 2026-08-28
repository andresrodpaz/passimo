import { getDb } from '@/lib/db'
import { logger } from '@/lib/logger'
import { error, json } from '@/lib/http'
import { verifyWebhook, type StripeEvent } from '@/lib/billing/stripe'
import { applyPlan, invalidateEntitlements } from '@/lib/billing/entitlements'
import { PLANS, TRIAL_EXPIRED_PLAN, normalizePlanId, type PlanId } from '@/lib/billing/plans'
import { notify } from '@/lib/notifications'
import { enqueue } from '@/lib/jobs/queue'
import { creditMerchantReferral } from '@/lib/growth/referrals'
import { recordPaymentFailure, recordPaymentRecovered } from '@/lib/billing/dunning-store'
import { interpretClaim } from '@/lib/billing/webhook-idempotency'
import { translatorForBusiness } from '@/lib/i18n/business'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Stripe webhook — the only writer of subscription state.
 *
 * The checkout route never sets a plan. Stripe decides when money moved, and
 * believing anything else means a customer who abandons the payment sheet after
 * the redirect gets a free Pro account.
 *
 * Delivery is at-least-once, so the first thing we do after verifying the
 * signature is claim the event id. The unique index on
 * `(provider, provider_event_id)` turns a replay into a no-op rather than a
 * second plan change.
 */
export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text()

  let event: StripeEvent
  try {
    event = verifyWebhook(rawBody, request.headers.get('stripe-signature'))
  } catch (cause) {
    logger.warn('billing.webhook_rejected', { cause })
    return error('Invalid signature', 400, 'unauthorized')
  }

  const admin = getDb()
  const businessId = businessIdFrom(event)

  const { error: claimError } = await admin.from('subscription_events').insert({
    business_id: businessId,
    provider: 'stripe',
    provider_event_id: event.id,
    type: event.type,
    payload: event as unknown as Record<string, unknown>,
  })

  const verdict = interpretClaim(claimError)
  if (verdict === 'duplicate') {
    // Already handled. 200 so Stripe stops retrying — the effects it is asking
    // us to apply are already applied.
    return json({ received: true, duplicate: true })
  }
  if (verdict === 'unavailable') {
    logger.error('billing.webhook_claim_failed', { event_id: event.id, error: claimError })
    // 500 asks Stripe to retry, which is what we want when our own store failed.
    return error('Could not record event', 500, 'internal_error')
  }

  try {
    await handleEvent(event, businessId)
    await admin
      .from('subscription_events')
      .update({ processed_at: new Date().toISOString() })
      .eq('provider_event_id', event.id)
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    logger.error('billing.webhook_handler_failed', { event_id: event.id, type: event.type, cause })
    await admin
      .from('subscription_events')
      .update({ error: message.slice(0, 1000) })
      .eq('provider_event_id', event.id)
    return error('Handler failed', 500, 'internal_error')
  }

  return json({ received: true })
}

// -----------------------------------------------------------------------------

type StripeObject = Record<string, unknown>

function businessIdFrom(event: StripeEvent): string | null {
  const object = event.data.object as StripeObject
  const metadata = (object.metadata ?? {}) as Record<string, string>
  return metadata.business_id ?? null
}

async function handleEvent(event: StripeEvent, metadataBusinessId: string | null): Promise<void> {
  const object = event.data.object as StripeObject

  switch (event.type) {
    case 'checkout.session.completed': {
      if (object.mode === 'payment') {
        // A gift card purchase, not a subscription. The commerce module owns it.
        await enqueue('giftcard.fulfil', { session: object }, { businessId: metadataBusinessId })
        return
      }
      // Subscription checkout is finalised by `customer.subscription.*`, which
      // carries the authoritative status and period end.
      return
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.resumed': {
      await syncSubscription(object, metadataBusinessId)
      return
    }

    case 'customer.subscription.deleted': {
      const businessId = await resolveBusiness(object, metadataBusinessId)
      if (!businessId) return
      // Downgrade, never delete. Their customers, history and cards survive —
      // which is also what makes coming back a one-click decision.
      await applyPlan(businessId, {
        plan: TRIAL_EXPIRED_PLAN,
        status: 'canceled',
        cancelAtPeriodEnd: false,
        stripeSubscriptionId: null,
        currentPeriodEnd: null,
      })
      /*
       * The old copy here said "You are on the Free plan", which had been wrong
       * since the free tier was removed — the workspace lands on `lapsed`, and
       * telling someone they are on a plan that does not exist is exactly the
       * kind of thing that generates a support ticket during a cancellation.
       */
      const t = await translatorForBusiness(businessId)
      await notify(businessId, {
        type: 'billing',
        title: t('notify.subscriptionEndedTitle'),
        body: t('notify.subscriptionEndedBody'),
        url: '/dashboard/billing',
      })
      return
    }

    case 'invoice.payment_failed': {
      const businessId = await resolveBusiness(object, metadataBusinessId)
      if (!businessId) return

      // Stripe keeps its own plan for retries; we keep the merchant informed
      // about it. `past_due` preserves their features for the grace period.
      await applyPlan(businessId, { status: 'past_due' })
      await recordPaymentFailure({
        businessId,
        invoiceId: String(object.id ?? `invoice-${event.id}`),
        attemptCount: Number(object.attempt_count ?? 1),
        nextAttemptAt:
          typeof object.next_payment_attempt === 'number'
            ? new Date(object.next_payment_attempt * 1000)
            : null,
      })
      return
    }

    case 'invoice.paid': {
      const businessId = await resolveBusiness(object, metadataBusinessId)
      if (!businessId) return
      await applyPlan(businessId, { status: 'active' })
      // Closes any open dunning sequence and tells the merchant it worked.
      // Silence after three warnings reads as "still broken".
      await recordPaymentRecovered({
        businessId,
        invoiceId: typeof object.id === 'string' ? object.id : null,
      })
      return
    }

    default:
      // Everything else is recorded for the audit trail and ignored.
      return
  }
}

async function syncSubscription(
  subscription: StripeObject,
  metadataBusinessId: string | null
): Promise<void> {
  const businessId = await resolveBusiness(subscription, metadataBusinessId)
  if (!businessId) {
    logger.warn('billing.webhook_unmatched_business', { subscription_id: subscription.id })
    return
  }

  const plan = planFrom(subscription)
  const interval = intervalFrom(subscription)
  const status = String(subscription.status ?? 'active')
  const periodEnd =
    typeof subscription.current_period_end === 'number'
      ? new Date(subscription.current_period_end * 1000).toISOString()
      : null

  // An active subscription supersedes any remaining trial; leaving the trial
  // date in the future would show "3 days left" to someone who just paid.
  const active = status === 'active' || status === 'trialing'

  await applyPlan(businessId, {
    plan: active ? plan : TRIAL_EXPIRED_PLAN,
    interval,
    status,
    currentPeriodEnd: periodEnd,
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    stripeSubscriptionId: String(subscription.id),
    ...(active ? { trialEndsAt: null } : {}),
  })

  invalidateEntitlements(businessId)

  if (active && plan !== TRIAL_EXPIRED_PLAN) {
    // Pay the merchant who referred them. Idempotent, so the many subscription
    // updates Stripe sends over a lifetime credit the referrer exactly once.
    await creditMerchantReferral(businessId)
  }

  if (active) {
    const t = await translatorForBusiness(businessId)
    await notify(businessId, {
      type: 'billing',
      title: t('notify.planActiveTitle', { plan: PLANS[plan].name }),
      body: t('notify.planActiveBody'),
      url: '/dashboard/billing',
    })
  }
}

/** Metadata first (cheap), then the stored Stripe customer id (reliable). */
async function resolveBusiness(
  object: StripeObject,
  metadataBusinessId: string | null
): Promise<string | null> {
  if (metadataBusinessId) return metadataBusinessId

  const customerId =
    typeof object.customer === 'string'
      ? object.customer
      : ((object.customer as StripeObject | undefined)?.id as string | undefined)

  if (!customerId) return null

  const admin = getDb()
  const { data } = await admin
    .from('businesses')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle()

  return (data?.id as string) ?? null
}

function planFrom(subscription: StripeObject): PlanId {
  const metadata = (subscription.metadata ?? {}) as Record<string, string>
  const declared = normalizePlanId(metadata.plan)
  if (declared) return declared

  // Fall back to the price id → plan mapping in the environment, so a
  // subscription created outside our checkout (sales-assisted, imported) still
  // resolves to the right tier.
  const priceId = firstPriceId(subscription)
  if (priceId) {
    for (const candidate of ['starter', 'growth', 'pro', 'business'] as const) {
      for (const interval of ['MONTHLY', 'YEARLY'] as const) {
        if (process.env[`STRIPE_PRICE_${candidate.toUpperCase()}_${interval}`] === priceId) {
          return candidate
        }
      }
    }
  }
  return TRIAL_EXPIRED_PLAN
}

function intervalFrom(subscription: StripeObject): 'month' | 'year' {
  const items = subscription.items as { data?: Array<StripeObject> } | undefined
  const price = items?.data?.[0]?.price as { recurring?: { interval?: string } } | undefined
  return price?.recurring?.interval === 'year' ? 'year' : 'month'
}

function firstPriceId(subscription: StripeObject): string | null {
  const items = subscription.items as { data?: Array<StripeObject> } | undefined
  const price = items?.data?.[0]?.price as { id?: string } | undefined
  return price?.id ?? null
}
