import { defineRoute } from '@/lib/api/handler'
import {
  createLocationSchema,
  deleteLocationSchema,
  listLocationsQuery,
  updateLocationSchema,
  payloadOf,
} from '@/lib/api/wallet-schemas'
import { recordAudit } from '@/lib/audit'
import { requireWithinLimit } from '@/lib/billing/entitlements'
import {
  archiveLocation,
  createLocation,
  listLocations,
  updateLocation,
} from '@/lib/wallet/locations'
import { scheduleBusinessWalletSync } from '@/lib/wallet/sync'
import type { LocationInput } from '@/lib/wallet/locations'

export const runtime = 'nodejs'

/**
 * Store locations.
 *
 * A location is not just an address: it is a geofence, a set of opening hours, a
 * scan attribution target and — the reason this matters — a point that makes a
 * wallet pass appear on a lock screen. Every one of those is merchant-editable
 * here, which is what the product principle requires: no code change, no support
 * ticket, no environment variable.
 *
 * Every write queues a pass refresh across the business, because a location a
 * merchant added this morning is worthless if it only reaches cards installed
 * after it.
 */

export const GET = defineRoute(
  {
    name: 'locations.list',
    auth: 'required',
    query: listLocationsQuery,
    businessIdFrom: { source: 'query', key: 'businessId' },
    permissions: ['locations:read'],
    rateLimit: 'dashboard',
  },
  async ({ query, business }) => {
    const locations = await listLocations(business.businessId, {
      includeArchived: query.includeArchived === 'true',
    })
    return { locations }
  }
)

export const POST = defineRoute(
  {
    name: 'locations.create',
    auth: 'required',
    body: createLocationSchema,
    businessIdFrom: { source: 'body', key: 'businessId' },
    permissions: ['locations:write'],
    rateLimit: 'dashboard',
  },
  async ({ body, business, actor, request }) => {
    // The plan's location cap is checked before the write, so the merchant never
    // sees a half-created site. Starter is deliberately one location: multi-site
    // is the clearest reason to move up a tier.
    await requireWithinLimit(business.businessId, 'locations')

    const location = await createLocation(
      business.businessId,
      payloadOf(body) as LocationInput
    )

    await recordAudit({
      businessId: business.businessId,
      actor,
      action: 'location.created',
      resourceType: 'location',
      resourceId: location.id,
      summary: `Added location "${location.name}"`,
      request,
    })

    if (location.coordinates) {
      await scheduleBusinessWalletSync(business.businessId, 'locations_changed')
    }

    return { location }
  }
)

export const PATCH = defineRoute(
  {
    name: 'locations.update',
    auth: 'required',
    body: updateLocationSchema,
    businessIdFrom: { source: 'body', key: 'businessId' },
    permissions: ['locations:write'],
    rateLimit: 'dashboard',
  },
  async ({ body, business, actor, request }) => {
    const location = await updateLocation(
      business.businessId,
      body.id as string,
      payloadOf(body) as Partial<LocationInput>
    )

    await recordAudit({
      businessId: business.businessId,
      actor,
      action: 'location.updated',
      resourceType: 'location',
      resourceId: body.id,
      summary: `Updated location "${location.name}"`,
      request,
    })

    // Coordinates, radius, visibility and the lock-screen line all change what an
    // installed pass carries, so any edit is worth a refresh.
    await scheduleBusinessWalletSync(business.businessId, 'locations_changed')

    return { location }
  }
)

export const DELETE = defineRoute(
  {
    name: 'locations.archive',
    auth: 'required',
    body: deleteLocationSchema,
    businessIdFrom: { source: 'body', key: 'businessId' },
    permissions: ['locations:write'],
    rateLimit: 'dashboard',
  },
  async ({ body, business, actor, request }) => {
    // Archive, never delete: visits, scans and gift cards reference the site, and
    // a merchant who closes a shop still needs last year's numbers for it.
    await archiveLocation(business.businessId, body.id)

    await recordAudit({
      businessId: business.businessId,
      actor,
      action: 'location.archived',
      resourceType: 'location',
      resourceId: body.id,
      summary: 'Archived a location',
      request,
    })

    await scheduleBusinessWalletSync(business.businessId, 'locations_changed')

    return { ok: true }
  }
)
