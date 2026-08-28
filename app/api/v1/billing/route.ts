import { z } from 'zod'
import { defineRoute } from '@/lib/api/handler'
import { getBillingSummary } from '@/lib/billing/entitlements'
import { PUBLIC_PLANS, annualSaving } from '@/lib/billing/plans'
import { isStripeConfigured, priceIdFor } from '@/lib/billing/stripe'
import { env } from '@/lib/env'

export const runtime = 'nodejs'

const summaryQuery = z.object({ businessId: z.string().uuid() })

/**
 * Everything the billing screen renders, in one request: the current plan, live
 * usage against every limit, and the catalogue with its purchasability.
 *
 * `purchasable` is computed server-side because the client cannot know whether
 * a Stripe price is configured for a tier — and a checkout button that 503s is
 * worse than no button.
 */
export const GET = defineRoute(
  {
    name: 'billing.summary',
    auth: 'required',
    query: summaryQuery,
    businessIdFrom: { source: 'query', key: 'businessId' },
    permissions: ['settings:read'],
    rateLimit: 'dashboard',
  },
  async ({ business }) => {
    const summary = await getBillingSummary(business.businessId)
    const stripeReady = isStripeConfigured()

    return {
      plan: summary.plan,
      effective_plan: summary.effectivePlan,
      trial: summary.trial,
      subscription: summary.subscription,
      referral_credit: summary.referralCredit,
      features: [...summary.features],
      usage: summary.usage,
      pressure: summary.pressure,
      billing_configured: stripeReady,
      /*
       * Where a merchant on a custom plan writes to us, or null. The billing
       * screen hides the "talk to us" button when it is null rather than
       * offering a `mailto:` at a domain that does not receive mail yet.
       */
      sales_email: env.contact.sales,
      catalogue: PUBLIC_PLANS.map((plan) => ({
        id: plan.id,
        name: plan.name,
        tagline_key: plan.taglineKey,
        monthly_price: plan.monthlyPrice,
        annual_price: plan.annualPrice,
        annual_saving: annualSaving(plan),
        highlight_keys: plan.highlightKeys,
        features: plan.features,
        limits: plan.limits,
        popular: plan.popular ?? false,
        purchasable:
          stripeReady &&
          plan.monthlyPrice !== null &&
          plan.monthlyPrice > 0 &&
          Boolean(priceIdFor(plan.id, 'month')),
      })),
    }
  }
)
