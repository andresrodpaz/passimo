import { z } from 'zod'
import { defineRoute } from '@/lib/api/handler'
import { getDb } from '@/lib/db'
import { unprocessable } from '@/lib/errors'
import { env } from '@/lib/env'
import { createPortalSession, isStripeConfigured } from '@/lib/billing/stripe'

export const runtime = 'nodejs'

const portalSchema = z.object({ businessId: z.string().uuid() })

/**
 * Opens the Stripe billing portal.
 *
 * Card updates, invoices, VAT details, plan changes and cancellation all live
 * there. Rebuilding any of that in our UI would mean handling PCI scope and
 * dunning ourselves for no product benefit.
 */
export const POST = defineRoute(
  {
    name: 'billing.portal',
    auth: 'required',
    body: portalSchema,
    businessIdFrom: { source: 'body', key: 'businessId' },
    permissions: ['billing:manage'],
    rateLimit: 'dashboard',
    requires: isStripeConfigured,
    requiresLabel: 'Billing (STRIPE_SECRET_KEY)',
  },
  async ({ business }) => {
    const admin = getDb()
    const { data } = await admin
      .from('businesses')
      .select('stripe_customer_id')
      .eq('id', business.businessId)
      .maybeSingle()

    const customerId = data?.stripe_customer_id as string | null
    if (!customerId) {
      throw unprocessable('This workspace has no billing account yet. Choose a plan first.')
    }

    const session = await createPortalSession({
      customerId,
      returnUrl: `${env.appUrl}/dashboard/billing`,
    })

    return { url: session.url }
  }
)
