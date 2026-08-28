import { z } from 'zod'
import { defineRoute } from '@/lib/api/handler'
import { recordAudit } from '@/lib/audit'
import { listOffers, redeemOffer } from '@/lib/growth/coalition'

export const runtime = 'nodejs'

const listQuery = z.object({
  businessId: z.string().uuid(),
})

/**
 * Partner offers claimable at this counter.
 *
 * A separate route from `/network` because this is a *counter* action, not an
 * administrative one. Joining a network and granting another business rights
 * over your members is an owner decision (`settings:write`); handing someone
 * their free coffee is a barista's (`loyalty:redeem`). Putting both behind one
 * permission would either lock staff out of the till or hand them the
 * partnership settings.
 */
export const GET = defineRoute(
  {
    name: 'network.claimable',
    auth: 'required',
    query: listQuery,
    businessIdFrom: { source: 'query', key: 'businessId' },
    permissions: ['loyalty:redeem'],
    feature: 'coalition',
    rateLimit: 'pos',
  },
  async ({ business }) => {
    const offers = await listOffers(business.businessId, { fromPartners: true })
    const now = Date.now()

    return {
      offers: offers
        .filter((offer) => {
          if (!offer.isActive) return false
          if (offer.startsAt && new Date(offer.startsAt).getTime() > now) return false
          if (offer.endsAt && new Date(offer.endsAt).getTime() < now) return false
          if (offer.redemptionLimit !== null && offer.redeemedCount >= offer.redemptionLimit) {
            return false
          }
          return true
        })
        .map((offer) => ({
          id: offer.id,
          title: offer.title,
          description: offer.description,
          business_name: offer.businessName,
          terms: offer.terms,
        })),
    }
  }
)

const redeemSchema = z.object({
  businessId: z.string().uuid(),
  offerId: z.string().uuid(),
  customerId: z.string().uuid(),
  idempotencyKey: z.string().max(120).optional().nullable(),
})

/**
 * Claims a partner's offer for a customer standing here.
 *
 * The SQL function enforces the global and per-customer limits under a row
 * lock, so a popular offer cannot be over-redeemed by a race between two tills.
 */
export const POST = defineRoute(
  {
    name: 'network.redeem',
    auth: 'required',
    body: redeemSchema,
    businessIdFrom: { source: 'body', key: 'businessId' },
    permissions: ['loyalty:redeem'],
    feature: 'coalition',
    rateLimit: 'pos',
  },
  async ({ body, actor, business, request }) => {
    const result = await redeemOffer({
      offerId: body.offerId,
      customerId: body.customerId,
      redeemingBusinessId: business.businessId,
      idempotencyKey: body.idempotencyKey ?? null,
    })

    if (!result.duplicate) {
      await recordAudit({
        businessId: business.businessId,
        actor,
        action: 'coalition_offer.redeemed',
        resourceType: 'coalition_offer',
        resourceId: body.offerId,
        summary: `Claimed the partner offer "${result.title}"`,
        metadata: { customer_id: body.customerId },
        request,
      })
    }

    return result
  }
)
