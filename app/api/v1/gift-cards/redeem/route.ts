import { z } from 'zod'
import { defineRoute } from '@/lib/api/handler'
import { recordAudit } from '@/lib/audit'
import { lookupForRedemption, redeemGiftCard } from '@/lib/commerce/gift-cards'

export const runtime = 'nodejs'

const lookupQuery = z.object({
  businessId: z.string().uuid(),
  code: z.string().min(4).max(40),
})

/**
 * Balance check before taking payment.
 *
 * Separate from the redemption itself so a cashier can answer "how much is on
 * this?" without spending it — the single most common gift card question, and
 * one that must never have a side effect.
 */
export const GET = defineRoute(
  {
    name: 'giftcards.lookup',
    auth: 'required',
    query: lookupQuery,
    businessIdFrom: { source: 'query', key: 'businessId' },
    permissions: ['loyalty:redeem'],
    feature: 'gift_cards',
    rateLimit: 'pos',
  },
  async ({ query, business }) => {
    const result = await lookupForRedemption(business.businessId, query.code)
    if (!result.found || !result.card) return { found: false }

    const card = result.card
    const expired = card.expiresAt !== null && new Date(card.expiresAt) < new Date()

    return {
      found: true,
      code: card.code,
      status: expired && card.status === 'active' ? 'expired' : card.status,
      remaining_value: card.remainingValue,
      initial_value: card.initialValue,
      currency: card.currency,
      recipient_name: card.recipientName,
      expires_at: card.expiresAt,
      // Precomputed so the POS never has to reimplement the rules.
      redeemable: card.status === 'active' && !expired && card.remainingValue > 0,
    }
  }
)

const redeemSchema = z.object({
  businessId: z.string().uuid(),
  code: z.string().min(4).max(40),
  /** Omit to spend the whole remaining balance. */
  amount: z.number().positive().max(10_000).optional().nullable(),
  locationId: z.string().uuid().optional().nullable(),
  idempotencyKey: z.string().max(120).optional().nullable(),
})

/**
 * Spends against a gift card.
 *
 * Idempotent by key, because the realistic failure at a counter is a cashier
 * tapping twice on bad wifi — and a double redemption is real money taken from
 * a real customer.
 */
export const POST = defineRoute(
  {
    name: 'giftcards.redeem',
    auth: 'required',
    body: redeemSchema,
    businessIdFrom: { source: 'body', key: 'businessId' },
    permissions: ['loyalty:redeem'],
    feature: 'gift_cards',
    rateLimit: 'pos',
  },
  async ({ body, actor, business, request }) => {
    const result = await redeemGiftCard({
      businessId: business.businessId,
      code: body.code,
      amount: body.amount ?? null,
      locationId: body.locationId ?? null,
      staffUserId: actor.kind === 'user' ? actor.id : null,
      idempotencyKey: body.idempotencyKey ?? null,
    })

    if (!result.duplicate) {
      await recordAudit({
        businessId: business.businessId,
        actor,
        action: 'gift_card.redeemed',
        resourceType: 'gift_card',
        resourceId: result.giftCardId,
        summary: `Redeemed ${result.redeemedAmount.toFixed(2)} from a gift card`,
        metadata: { amount: result.redeemedAmount, remaining: result.remainingValue },
        request,
      })
    }

    return result
  }
)
