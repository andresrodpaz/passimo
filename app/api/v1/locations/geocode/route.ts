import { defineRoute } from '@/lib/api/handler'
import { geocodeSchema } from '@/lib/api/wallet-schemas'
import { badRequest } from '@/lib/errors'
import {
  geocodeAddress,
  isGeocodingConfigured,
  placeDetails,
  reverseGeocode,
  suggestPlaces,
} from '@/lib/wallet/geocoding'

export const runtime = 'nodejs'

/**
 * Address → coordinates, and the place lookup behind the location form.
 *
 * Never fails hard on a missing API key. Geocoding saves a merchant from typing
 * latitude and longitude; it is not what makes proximity work. So an unconfigured
 * deployment returns `{ ok: false, reason: 'not_configured' }` with a 200, and the
 * form falls back to two number fields — which is a complete, working path, not a
 * degraded one.
 *
 * Rate-limited on the write bucket despite being a read: each call costs money at
 * Google, and autocomplete is the easiest endpoint in the product to run up a bill
 * with.
 */
export const POST = defineRoute(
  {
    name: 'locations.geocode',
    auth: 'required',
    body: geocodeSchema,
    businessIdFrom: { source: 'body', key: 'businessId' },
    permissions: ['locations:write'],
    rateLimit: 'dashboard',
  },
  async ({ body }) => {
    if (!isGeocodingConfigured()) {
      return {
        ok: false as const,
        reason: 'not_configured' as const,
        hint: 'Set GOOGLE_MAPS_API_KEY to look addresses up automatically. Coordinates can always be entered by hand.',
      }
    }

    switch (body.mode) {
      case 'suggest': {
        if (!body.address) throw badRequest('An address fragment is required to suggest places')
        return suggestPlaces(body.address, { sessionToken: body.sessionToken })
      }

      case 'details': {
        if (!body.placeId) throw badRequest('A placeId is required for place details')
        return placeDetails(body.placeId, { sessionToken: body.sessionToken })
      }

      case 'reverse': {
        if (body.lat === undefined || body.lng === undefined) {
          throw badRequest('Latitude and longitude are required to reverse geocode')
        }
        return reverseGeocode({ lat: body.lat, lng: body.lng })
      }

      default: {
        if (!body.address) throw badRequest('An address is required to geocode')
        return geocodeAddress(body.address)
      }
    }
  }
)
