import { z } from 'zod'
import { defineRoute } from '@/lib/api/handler'
import { recordAudit } from '@/lib/audit'
import {
  GIFT_CARD_DESIGNS,
  getGiftCardStats,
  issueGiftCard,
  listGiftCards,
} from '@/lib/commerce/gift-cards'

export const runtime = 'nodejs'

const listQuery = z.object({
  businessId: z.string().uuid(),
  status: z.enum(['active', 'depleted', 'expired', 'void', 'all']).optional(),
  search: z.string().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

/** The portfolio plus the liability figure an accountant asks for, in one call. */
export const GET = defineRoute(
  {
    name: 'giftcards.list',
    auth: 'required',
    query: listQuery,
    businessIdFrom: { source: 'query', key: 'businessId' },
    permissions: ['programs:read'],
    feature: 'gift_cards',
    rateLimit: 'dashboard',
  },
  async ({ query, business }) => {
    const [portfolio, stats] = await Promise.all([
      listGiftCards(business.businessId, {
        status: query.status,
        search: query.search,
        limit: query.limit,
        offset: query.offset,
      }),
      getGiftCardStats(business.businessId),
    ])

    return {
      gift_cards: portfolio.cards,
      stats,
      pagination: { total: portfolio.total, limit: query.limit, offset: query.offset },
    }
  }
)

const issueSchema = z.object({
  businessId: z.string().uuid(),
  amount: z.number().positive().max(10_000),
  purchaserEmail: z.string().email().optional().nullable(),
  purchaserName: z.string().max(120).optional().nullable(),
  recipientEmail: z.string().email().optional().nullable(),
  recipientName: z.string().max(120).optional().nullable(),
  message: z.string().max(500).optional().nullable(),
  design: z.enum(GIFT_CARD_DESIGNS).default('classic'),
  expiresInMonths: z.number().int().min(1).max(120).optional().nullable(),
  deliverAt: z.string().datetime().optional().nullable(),
  locationId: z.string().uuid().optional().nullable(),
  /** Printed card handed over the counter — no email, no delivery job. */
  skipDelivery: z.boolean().default(false),
  idempotencyKey: z.string().max(120).optional().nullable(),
})

/** Staff selling a card at the counter, or issuing one as a goodwill gesture. */
export const POST = defineRoute(
  {
    name: 'giftcards.issue',
    auth: 'required',
    body: issueSchema,
    businessIdFrom: { source: 'body', key: 'businessId' },
    permissions: ['programs:write'],
    feature: 'gift_cards',
    rateLimit: 'dashboard',
  },
  async ({ body, actor, business, request }) => {
    const result = await issueGiftCard({
      businessId: business.businessId,
      amount: body.amount,
      purchaserEmail: body.purchaserEmail,
      purchaserName: body.purchaserName,
      recipientEmail: body.recipientEmail,
      recipientName: body.recipientName,
      message: body.message,
      design: body.design,
      expiresInMonths: body.expiresInMonths,
      deliverAt: body.deliverAt,
      source: 'pos',
      issuedBy: actor.kind === 'user' ? actor.id : null,
      locationId: body.locationId,
      idempotencyKey: body.idempotencyKey,
      skipDelivery: body.skipDelivery,
    })

    if (!result.duplicate) {
      await recordAudit({
        businessId: business.businessId,
        actor,
        action: 'gift_card.issued',
        resourceType: 'gift_card',
        resourceId: result.giftCardId,
        summary: `Issued a ${body.amount} gift card`,
        metadata: { amount: body.amount, source: 'pos' },
        request,
      })
    }

    return result
  }
)
