import { z } from 'zod'
import { defineRoute } from '@/lib/api/handler'
import { getDb } from '@/lib/db'
import { notFound, unprocessable } from '@/lib/errors'
import { env } from '@/lib/env'
import { hasFeature } from '@/lib/billing/entitlements'
import { GIFT_CARD_DESIGNS, SUGGESTED_AMOUNTS } from '@/lib/commerce/gift-cards'
import { createGiftCardCheckout, isStripeConfigured } from '@/lib/billing/stripe'

export const runtime = 'nodejs'

const shopQuery = z.object({ slug: z.string().min(1).max(80) })

/**
 * The public gift card shop for one business.
 *
 * Anonymous: the whole point is that a stranger buying a present for a regular
 * can complete the purchase without an account. That stranger becomes a
 * customer the first time they redeem, which is the acquisition loop.
 */
export const GET = defineRoute(
  {
    name: 'public.giftcards.shop',
    auth: 'none',
    query: shopQuery,
    rateLimit: 'publicRelaxed',
  },
  async ({ query }) => {
    const admin = getDb()
    const { data: business } = await admin
      .from('businesses')
      .select('id, name, slug, logo_url, cover_url, primary_color, accent_color, currency, city, category')
      .eq('slug', query.slug)
      .is('archived_at', null)
      .maybeSingle()

    if (!business) throw notFound('Business')

    // A merchant on a plan without gift cards simply has no shop, rather than a
    // shop that errors at checkout.
    const enabled = (await hasFeature(business.id as string, 'gift_cards')) && isStripeConfigured()

    return {
      business: {
        name: business.name,
        slug: business.slug,
        logo_url: business.logo_url,
        cover_url: business.cover_url,
        primary_color: business.primary_color,
        accent_color: business.accent_color,
        currency: business.currency ?? 'EUR',
        city: business.city,
        category: business.category,
      },
      enabled,
      suggested_amounts: SUGGESTED_AMOUNTS,
      designs: GIFT_CARD_DESIGNS,
      min_amount: 5,
      max_amount: 500,
    }
  }
)

const purchaseSchema = z.object({
  slug: z.string().min(1).max(80),
  amount: z.number().int().min(5).max(500),
  purchaserEmail: z.string().email(),
  purchaserName: z.string().min(1).max(120),
  recipientEmail: z.string().email(),
  recipientName: z.string().min(1).max(120),
  message: z.string().max(400).optional().nullable(),
  design: z.enum(GIFT_CARD_DESIGNS).default('classic'),
  /** ISO date; the card is emailed that morning instead of immediately. */
  deliverOn: z.string().date().optional().nullable(),
})

/**
 * Starts a gift card purchase.
 *
 * No card is created here. Stripe's `checkout.session.completed` webhook issues
 * it, because a card minted before payment is a card someone can obtain by
 * abandoning the payment sheet. The whole purchase intent travels in the
 * session metadata so the webhook needs no pending-order table.
 */
export const POST = defineRoute(
  {
    name: 'public.giftcards.purchase',
    auth: 'none',
    body: purchaseSchema,
    rateLimit: 'publicStrict',
    requires: isStripeConfigured,
    requiresLabel: 'Online gift card purchase (STRIPE_SECRET_KEY)',
  },
  async ({ body }) => {
    const admin = getDb()
    const { data: business } = await admin
      .from('businesses')
      .select('id, name, slug, currency')
      .eq('slug', body.slug)
      .is('archived_at', null)
      .maybeSingle()

    if (!business) throw notFound('Business')

    if (!(await hasFeature(business.id as string, 'gift_cards'))) {
      throw unprocessable('This business is not selling gift cards right now.')
    }

    // Delivered at 9am local rather than midnight: a birthday email that lands
    // while someone is asleep is read with the rest of the overnight noise.
    const deliverAt = body.deliverOn ? `${body.deliverOn}T09:00:00.000Z` : null

    const session = await createGiftCardCheckout({
      businessId: business.id as string,
      businessName: business.name as string,
      amountCents: Math.round(body.amount * 100),
      currency: (business.currency as string) ?? 'EUR',
      purchaserEmail: body.purchaserEmail,
      successUrl: `${env.appUrl}/gift/${business.slug}?purchase=success`,
      cancelUrl: `${env.appUrl}/gift/${business.slug}?purchase=cancelled`,
      metadata: {
        amount: String(body.amount),
        purchaser_email: body.purchaserEmail,
        purchaser_name: body.purchaserName,
        recipient_email: body.recipientEmail,
        recipient_name: body.recipientName,
        gift_message: (body.message ?? '').slice(0, 300),
        design: body.design,
        deliver_at: deliverAt ?? '',
      },
    })

    return { url: session.url }
  }
)
