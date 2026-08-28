import { z } from 'zod'
import { defineRoute } from '@/lib/api/handler'
import { getDb } from '@/lib/db'
import { recordAudit } from '@/lib/audit'
import {
  browseDirectory,
  endPartnership,
  invitePartner,
  listOffers,
  listPartners,
  respondToInvite,
  setNetworkParticipation,
  updatePartnershipPermissions,
  upsertOffer,
} from '@/lib/growth/coalition'

export const runtime = 'nodejs'

const listQuery = z.object({
  businessId: z.string().uuid(),
  search: z.string().max(120).optional(),
  category: z.string().max(60).optional(),
})

/**
 * The partner network in one payload: who we work with, who else is nearby, and
 * what is on offer in both directions.
 */
export const GET = defineRoute(
  {
    name: 'network.summary',
    auth: 'required',
    query: listQuery,
    businessIdFrom: { source: 'query', key: 'businessId' },
    permissions: ['settings:read'],
    feature: 'coalition',
    rateLimit: 'dashboard',
  },
  async ({ query, business }) => {
    const admin = getDb()

    const [partners, directory, ourOffers, theirOffers, record] = await Promise.all([
      listPartners(business.businessId),
      browseDirectory(business.businessId, { search: query.search, category: query.category }),
      listOffers(business.businessId, { includeInactive: true }),
      listOffers(business.businessId, { fromPartners: true }),
      admin
        .from('businesses')
        .select('network_opt_in, network_bio, city, category')
        .eq('id', business.businessId)
        .maybeSingle(),
    ])

    return {
      participation: {
        opted_in: Boolean(record.data?.network_opt_in),
        bio: (record.data?.network_bio as string) ?? null,
        city: (record.data?.city as string) ?? null,
        category: (record.data?.category as string) ?? null,
      },
      partners,
      directory,
      our_offers: ourOffers,
      partner_offers: theirOffers,
    }
  }
)

const bodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('set_participation'),
    businessId: z.string().uuid(),
    optIn: z.boolean(),
    bio: z.string().max(280).optional().nullable(),
  }),
  z.object({
    action: z.literal('invite'),
    businessId: z.string().uuid(),
    partnerBusinessId: z.string().uuid(),
    allowCrossEarn: z.boolean().default(false),
    allowCrossRedeem: z.boolean().default(false),
  }),
  z.object({
    action: z.literal('respond'),
    businessId: z.string().uuid(),
    partnershipId: z.string().uuid(),
    accept: z.boolean(),
  }),
  z.object({
    action: z.literal('update_permissions'),
    businessId: z.string().uuid(),
    partnershipId: z.string().uuid(),
    allowCrossEarn: z.boolean().optional(),
    allowCrossRedeem: z.boolean().optional(),
    shareAudience: z.boolean().optional(),
  }),
  z.object({
    action: z.literal('end'),
    businessId: z.string().uuid(),
    partnershipId: z.string().uuid(),
  }),
  z.object({
    action: z.literal('upsert_offer'),
    businessId: z.string().uuid(),
    id: z.string().uuid().optional().nullable(),
    partnershipId: z.string().uuid().optional().nullable(),
    title: z.string().min(1).max(120),
    description: z.string().max(500).optional().nullable(),
    rewardId: z.string().uuid().optional().nullable(),
    terms: z.string().max(500).optional().nullable(),
    startsAt: z.string().datetime().optional().nullable(),
    endsAt: z.string().datetime().optional().nullable(),
    redemptionLimit: z.number().int().min(1).max(1_000_000).optional().nullable(),
    perCustomerLimit: z.number().int().min(1).max(100).default(1),
    isActive: z.boolean().default(true),
  }),
])

export const POST = defineRoute(
  {
    name: 'network.action',
    auth: 'required',
    body: bodySchema,
    businessIdFrom: { source: 'body', key: 'businessId' },
    // Joining a network and granting another business rights over your members
    // is an owner/admin decision, not a marketing one.
    permissions: ['settings:write'],
    feature: 'coalition',
    rateLimit: 'dashboard',
  },
  async ({ body, actor, business, request }) => {
    const businessId = business.businessId

    switch (body.action) {
      case 'set_participation': {
        await setNetworkParticipation({ businessId, optIn: body.optIn, bio: body.bio })
        await recordAudit({
          businessId,
          actor,
          action: body.optIn ? 'network.joined' : 'network.left',
          summary: body.optIn
            ? 'Joined the local partner network'
            : 'Left the local partner network',
          request,
        })
        return { opted_in: body.optIn }
      }

      case 'invite': {
        const result = await invitePartner({
          businessId,
          partnerBusinessId: body.partnerBusinessId,
          invitedBy: actor.kind === 'user' ? actor.id : null,
          allowCrossEarn: body.allowCrossEarn,
          allowCrossRedeem: body.allowCrossRedeem,
        })
        await recordAudit({
          businessId,
          actor,
          action: 'partnership.invited',
          resourceType: 'partnership',
          resourceId: result.partnershipId,
          summary: 'Invited a local business to partner',
          request,
        })
        return result
      }

      case 'respond': {
        const result = await respondToInvite({
          businessId,
          partnershipId: body.partnershipId,
          accept: body.accept,
        })
        await recordAudit({
          businessId,
          actor,
          action: body.accept ? 'partnership.accepted' : 'partnership.declined',
          resourceType: 'partnership',
          resourceId: body.partnershipId,
          summary: body.accept ? 'Accepted a partnership' : 'Declined a partnership',
          request,
        })
        return result
      }

      case 'update_permissions': {
        await updatePartnershipPermissions({
          businessId,
          partnershipId: body.partnershipId,
          allowCrossEarn: body.allowCrossEarn,
          allowCrossRedeem: body.allowCrossRedeem,
          shareAudience: body.shareAudience,
        })
        return { ok: true }
      }

      case 'end': {
        const result = await endPartnership(businessId, body.partnershipId)
        await recordAudit({
          businessId,
          actor,
          action: 'partnership.ended',
          resourceType: 'partnership',
          resourceId: body.partnershipId,
          summary: 'Ended a partnership',
          request,
        })
        return result
      }

      case 'upsert_offer': {
        const result = await upsertOffer({ ...body, businessId })
        await recordAudit({
          businessId,
          actor,
          action: body.id ? 'coalition_offer.updated' : 'coalition_offer.created',
          resourceType: 'coalition_offer',
          resourceId: result.id,
          summary: `${body.id ? 'Updated' : 'Published'} the offer "${body.title}"`,
          request,
        })
        return result
      }
    }
  }
)
