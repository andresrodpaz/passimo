import { z } from 'zod'
import { defineRoute } from '@/lib/api/handler'
import { recordAudit } from '@/lib/audit'
import { getGiftCard, voidGiftCard } from '@/lib/commerce/gift-cards'

export const runtime = 'nodejs'

const paramsSchema = z.object({ id: z.string().min(4) })
const businessQuery = z.object({ businessId: z.string().uuid() })

/** A single card with its transaction history — the answer to a customer dispute. */
export const GET = defineRoute(
  {
    name: 'giftcards.get',
    auth: 'required',
    params: paramsSchema,
    query: businessQuery,
    businessIdFrom: { source: 'query', key: 'businessId' },
    permissions: ['programs:read'],
    feature: 'gift_cards',
    rateLimit: 'dashboard',
  },
  async ({ params, business }) => getGiftCard(business.businessId, params.id)
)

const voidSchema = z.object({ businessId: z.string().uuid() })

/**
 * Cancels the unspent remainder — a refund, a chargeback, a card reported lost.
 *
 * A void is recorded as a transaction rather than a deletion: the money moved,
 * and the merchant's books need to show that it moved back.
 */
export const DELETE = defineRoute(
  {
    name: 'giftcards.void',
    auth: 'required',
    params: paramsSchema,
    body: voidSchema,
    businessIdFrom: { source: 'body', key: 'businessId' },
    permissions: ['programs:write'],
    feature: 'gift_cards',
    rateLimit: 'dashboard',
  },
  async ({ params, actor, business, request }) => {
    const result = await voidGiftCard(
      business.businessId,
      params.id,
      actor.kind === 'user' ? actor.id : null
    )

    if (!result.alreadyVoid) {
      await recordAudit({
        businessId: business.businessId,
        actor,
        action: 'gift_card.voided',
        resourceType: 'gift_card',
        resourceId: params.id,
        summary: `Voided a gift card with ${result.voidedValue.toFixed(2)} remaining`,
        metadata: { voided_value: result.voidedValue },
        request,
      })
    }

    return result
  }
)
