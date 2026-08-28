import { z } from 'zod'
import { defineRoute } from '@/lib/api/handler'
import { getDb } from '@/lib/db'
import { badRequest, notFound, unprocessable } from '@/lib/errors'
import { env } from '@/lib/env'
import { recordAudit } from '@/lib/audit'
import { PLANS, isPurchasablePlan } from '@/lib/billing/plans'
import {
  createCheckoutSession,
  createCustomer,
  createPortalSession,
  isStripeConfigured,
  priceIdFor,
} from '@/lib/billing/stripe'

export const runtime = 'nodejs'

const checkoutSchema = z.object({
  businessId: z.string().uuid(),
  plan: z.string(),
  interval: z.enum(['month', 'year']).default('month'),
})

/**
 * Starts a subscription.
 *
 * The Stripe customer is created lazily and stored on first checkout, so a
 * business that never opens the billing screen never appears in Stripe. The id
 * is written back *before* the session is created: if the round trip fails, the
 * retry reuses the same customer instead of orphaning one per attempt.
 */
export const POST = defineRoute(
  {
    name: 'billing.checkout',
    auth: 'required',
    body: checkoutSchema,
    businessIdFrom: { source: 'body', key: 'businessId' },
    permissions: ['billing:manage'],
    rateLimit: 'dashboard',
    requires: isStripeConfigured,
    requiresLabel: 'Billing (STRIPE_SECRET_KEY)',
  },
  async ({ body, business, actor, request }) => {
    if (!isPurchasablePlan(body.plan)) {
      throw badRequest('That plan cannot be purchased online')
    }

    const priceId = priceIdFor(body.plan, body.interval)
    if (!priceId) {
      throw unprocessable(
        `No Stripe price configured for ${PLANS[body.plan].name} (${body.interval}ly). ` +
          `Set STRIPE_PRICE_${body.plan.toUpperCase()}_${body.interval === 'year' ? 'YEARLY' : 'MONTHLY'}.`
      )
    }

    const admin = getDb()
    const { data: record } = await admin
      .from('businesses')
      .select('id, name, stripe_customer_id, stripe_subscription_id, support_email')
      .eq('id', business.businessId)
      .maybeSingle()

    if (!record) throw notFound('Business')

    let customerId = record.stripe_customer_id as string | null

    if (!customerId) {
      const customer = await createCustomer({
        email: (record.support_email as string) ?? actor.email ?? 'billing@example.com',
        name: record.name as string,
        businessId: business.businessId,
      })
      customerId = customer.id
      await admin
        .from('businesses')
        .update({ stripe_customer_id: customerId })
        .eq('id', business.businessId)
    }

    // Changing plan while subscribed belongs in the portal, where Stripe handles
    // proration, tax recalculation and the confirmation screen properly.
    if (record.stripe_subscription_id) {
      const portal = await createPortalSession({
        customerId,
        returnUrl: `${env.appUrl}/dashboard/billing`,
      })
      return { url: portal.url, mode: 'portal' as const }
    }

    const session = await createCheckoutSession({
      customerId,
      priceId,
      businessId: business.businessId,
      plan: body.plan,
      interval: body.interval,
      successUrl: `${env.appUrl}/dashboard/billing?checkout=success`,
      cancelUrl: `${env.appUrl}/dashboard/billing?checkout=cancelled`,
    })

    await recordAudit({
      businessId: business.businessId,
      actor,
      action: 'billing.checkout_started',
      resourceType: 'business',
      resourceId: business.businessId,
      summary: `Started checkout for ${PLANS[body.plan].name} (${body.interval}ly)`,
      request,
    })

    return { url: session.url, mode: 'checkout' as const }
  }
)
