import { defineRoute } from '@/lib/api/handler'
import {
  createCampaignSchema,
  deleteCampaignSchema,
  listCampaignsQuery,
  updateCampaignSchema,
  payloadOf,
} from '@/lib/api/wallet-schemas'
import { recordAudit } from '@/lib/audit'
import { requireWithinLimit } from '@/lib/billing/entitlements'
import {
  archiveCampaign,
  createCampaign,
  listCampaigns,
  updateCampaign,
  type CampaignInput,
} from '@/lib/wallet/campaigns'
import { listLocations } from '@/lib/wallet/locations'

export const runtime = 'nodejs'

/**
 * Location-based wallet campaigns.
 *
 * Everything a merchant needs to define one — trigger, radius, dates, weekdays,
 * hours, locations, segment, tier, points, visits, notification copy, emoji, CTA,
 * colours, expiry — is a column here, because the product principle is that no
 * campaign behaviour requires a deploy.
 *
 * The plan cap counts *active* campaigns, not drafts. A merchant experimenting with
 * twenty ideas and running two is inside a two-campaign plan; charging for drafts
 * teaches people to delete their own work.
 */

export const GET = defineRoute(
  {
    name: 'wallet.campaigns.list',
    auth: 'required',
    query: listCampaignsQuery,
    businessIdFrom: { source: 'query', key: 'businessId' },
    permissions: ['wallet:read'],
    rateLimit: 'dashboard',
  },
  async ({ query, business }) => {
    const [campaigns, locations] = await Promise.all([
      listCampaigns(business.businessId, {
        status: query.status,
        includeArchived: query.includeArchived === 'true',
      }),
      listLocations(business.businessId),
    ])

    return {
      campaigns,
      // Returned alongside so the campaign editor can render its location picker
      // without a second request — the picker is on the same screen every time.
      locations: locations.map((location) => ({
        id: location.id,
        name: location.name,
        city: location.city,
        hasCoordinates: Boolean(location.coordinates),
      })),
    }
  }
)

export const POST = defineRoute(
  {
    name: 'wallet.campaigns.create',
    auth: 'required',
    body: createCampaignSchema,
    businessIdFrom: { source: 'body', key: 'businessId' },
    permissions: ['wallet:write'],
    feature: 'proximity_campaigns',
    rateLimit: 'dashboard',
  },
  async ({ body, business, actor, request }) => {
    if (body.status === 'active') {
      await requireWithinLimit(business.businessId, 'proximity_campaigns')
    }

    const campaign = await createCampaign(
      business.businessId,
      payloadOf(body) as CampaignInput,
      actor.id
    )

    await recordAudit({
      businessId: business.businessId,
      actor,
      action: 'wallet.campaign_created',
      resourceType: 'proximity_campaign',
      resourceId: campaign.id,
      summary: `Created proximity campaign "${campaign.name}" (${campaign.status})`,
      request,
    })

    return { campaign }
  }
)

export const PATCH = defineRoute(
  {
    name: 'wallet.campaigns.update',
    auth: 'required',
    body: updateCampaignSchema,
    businessIdFrom: { source: 'body', key: 'businessId' },
    permissions: ['wallet:write'],
    feature: 'proximity_campaigns',
    rateLimit: 'dashboard',
  },
  async ({ body, business, actor, request }) => {
    const input = payloadOf(body) as Partial<CampaignInput>

    // Only *activating* consumes the cap, so pausing is always allowed — a
    // merchant over their limit after a downgrade must still be able to turn
    // things off.
    if (input.status === 'active') {
      await requireWithinLimit(business.businessId, 'proximity_campaigns')
    }

    const campaign = await updateCampaign(business.businessId, body.id, input)

    await recordAudit({
      businessId: business.businessId,
      actor,
      action: 'wallet.campaign_updated',
      resourceType: 'proximity_campaign',
      resourceId: body.id,
      summary: `Updated proximity campaign "${campaign.name}"`,
      request,
    })

    return { campaign }
  }
)

export const DELETE = defineRoute(
  {
    name: 'wallet.campaigns.archive',
    auth: 'required',
    body: deleteCampaignSchema,
    businessIdFrom: { source: 'body', key: 'businessId' },
    permissions: ['wallet:write'],
    rateLimit: 'dashboard',
  },
  async ({ body, business, actor, request }) => {
    // Archived rather than deleted: the campaign's events are the merchant's
    // performance history, and deleting the row would erase the numbers that
    // justify the feature.
    await archiveCampaign(business.businessId, body.id)

    await recordAudit({
      businessId: business.businessId,
      actor,
      action: 'wallet.campaign_archived',
      resourceType: 'proximity_campaign',
      resourceId: body.id,
      summary: 'Archived a proximity campaign',
      request,
    })

    return { ok: true }
  }
)
