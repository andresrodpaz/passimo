import 'server-only'
import { env } from '@/lib/env'
import { logger } from '@/lib/logger'
import { isValidLatLng, type LatLng } from '@/lib/wallet/geo'

/**
 * Geolocation service — address to coordinates, and place lookup.
 *
 * Wraps the Google Maps platform behind a narrow interface for one reason worth
 * stating: **geocoding is a convenience, never a dependency.** Proximity works
 * entirely from latitude and longitude, and a merchant can type those. Google's
 * only job is to save them the typing. So every function here returns a result
 * object instead of throwing, and an unconfigured or failing provider degrades to
 * `{ ok: false, reason }` which the UI renders as "enter coordinates manually"
 * rather than as an error.
 *
 * That is also why the provider is injectable: the geocoding path is exercised in
 * tests and in local development with no API key at all.
 */

export type GeocodeResult = {
  coordinates: LatLng
  formattedAddress: string | null
  placeId: string | null
  city: string | null
  region: string | null
  postalCode: string | null
  country: string | null
  /** Google's confidence bucket: ROOFTOP is exact, APPROXIMATE is a district. */
  precision: 'rooftop' | 'interpolated' | 'centroid' | 'approximate' | 'unknown'
}

export type GeocodeOutcome =
  | { ok: true; result: GeocodeResult }
  | { ok: false; reason: 'not_configured' | 'not_found' | 'upstream_failed' | 'invalid_input' }

export type PlaceSuggestion = {
  placeId: string
  description: string
  mainText: string
  secondaryText: string | null
}

/**
 * The dependency the service needs. Swapped in tests; there is no other reason
 * for this indirection, and no other implementation is planned.
 */
export type GeocodingTransport = {
  fetch: typeof fetch
}

const defaultTransport: GeocodingTransport = { fetch: (...args) => fetch(...args) }

const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json'
const PLACES_AUTOCOMPLETE_URL =
  'https://maps.googleapis.com/maps/api/place/autocomplete/json'
const PLACE_DETAILS_URL = 'https://maps.googleapis.com/maps/api/place/details/json'

const PRECISION_MAP: Record<string, GeocodeResult['precision']> = {
  ROOFTOP: 'rooftop',
  RANGE_INTERPOLATED: 'interpolated',
  GEOMETRIC_CENTER: 'centroid',
  APPROXIMATE: 'approximate',
}

type AddressComponent = { long_name: string; short_name: string; types: string[] }

type GoogleGeocodeResponse = {
  status: string
  results?: Array<{
    formatted_address?: string
    place_id?: string
    geometry?: { location?: { lat?: number; lng?: number }; location_type?: string }
    address_components?: AddressComponent[]
  }>
}

function componentOf(
  components: AddressComponent[] | undefined,
  type: string,
  form: 'long' | 'short' = 'long'
): string | null {
  const hit = (components ?? []).find((component) => component.types.includes(type))
  if (!hit) return null
  return form === 'short' ? hit.short_name : hit.long_name
}

/** City naming differs by country; `postal_town` is how the UK expresses it. */
function cityOf(components: AddressComponent[] | undefined): string | null {
  return componentOf(components, 'locality') ?? componentOf(components, 'postal_town')
}

export function isGeocodingConfigured(): boolean {
  return env.maps.isGeocodingConfigured
}

/**
 * Resolves a street address to coordinates.
 *
 * `region` biases ambiguous results — "Main Street" exists in every
 * English-speaking country — and comes from the merchant's own country, which we
 * already know.
 */
export async function geocodeAddress(
  address: string,
  options: { region?: string | null; transport?: GeocodingTransport } = {}
): Promise<GeocodeOutcome> {
  const query = address.trim()
  if (query.length < 3) return { ok: false, reason: 'invalid_input' }

  const key = env.maps.geocodingApiKey
  if (!key) return { ok: false, reason: 'not_configured' }

  const params = new URLSearchParams({ address: query, key })
  if (options.region) params.set('region', options.region.toLowerCase())

  const transport = options.transport ?? defaultTransport

  try {
    const response = await transport.fetch(`${GEOCODE_URL}?${params.toString()}`, {
      signal: AbortSignal.timeout(6_000),
    })
    if (!response.ok) {
      logger.warn('wallet.geocode_http_error', { status: response.status })
      return { ok: false, reason: 'upstream_failed' }
    }

    const payload = (await response.json()) as GoogleGeocodeResponse
    if (payload.status === 'ZERO_RESULTS') return { ok: false, reason: 'not_found' }
    if (payload.status !== 'OK' || !payload.results?.length) {
      logger.warn('wallet.geocode_failed', { status: payload.status })
      return { ok: false, reason: 'upstream_failed' }
    }

    const best = payload.results[0]
    const lat = best.geometry?.location?.lat
    const lng = best.geometry?.location?.lng
    if (typeof lat !== 'number' || typeof lng !== 'number' || !isValidLatLng({ lat, lng })) {
      return { ok: false, reason: 'not_found' }
    }

    return {
      ok: true,
      result: {
        coordinates: { lat, lng },
        formattedAddress: best.formatted_address ?? null,
        placeId: best.place_id ?? null,
        city: cityOf(best.address_components),
        region: componentOf(best.address_components, 'administrative_area_level_1'),
        postalCode: componentOf(best.address_components, 'postal_code'),
        country: componentOf(best.address_components, 'country', 'short'),
        precision: PRECISION_MAP[best.geometry?.location_type ?? ''] ?? 'unknown',
      },
    }
  } catch (cause) {
    logger.warn('wallet.geocode_error', { cause })
    return { ok: false, reason: 'upstream_failed' }
  }
}

/** Coordinates to an address, for the "drop a pin" flow. */
export async function reverseGeocode(
  point: LatLng,
  options: { transport?: GeocodingTransport } = {}
): Promise<GeocodeOutcome> {
  if (!isValidLatLng(point)) return { ok: false, reason: 'invalid_input' }
  const key = env.maps.geocodingApiKey
  if (!key) return { ok: false, reason: 'not_configured' }

  const params = new URLSearchParams({ latlng: `${point.lat},${point.lng}`, key })
  const transport = options.transport ?? defaultTransport

  try {
    const response = await transport.fetch(`${GEOCODE_URL}?${params.toString()}`, {
      signal: AbortSignal.timeout(6_000),
    })
    if (!response.ok) return { ok: false, reason: 'upstream_failed' }
    const payload = (await response.json()) as GoogleGeocodeResponse
    if (payload.status === 'ZERO_RESULTS') return { ok: false, reason: 'not_found' }
    if (payload.status !== 'OK' || !payload.results?.length) {
      return { ok: false, reason: 'upstream_failed' }
    }
    const best = payload.results[0]
    return {
      ok: true,
      result: {
        coordinates: point,
        formattedAddress: best.formatted_address ?? null,
        placeId: best.place_id ?? null,
        city: cityOf(best.address_components),
        region: componentOf(best.address_components, 'administrative_area_level_1'),
        postalCode: componentOf(best.address_components, 'postal_code'),
        country: componentOf(best.address_components, 'country', 'short'),
        precision: PRECISION_MAP[best.geometry?.location_type ?? ''] ?? 'unknown',
      },
    }
  } catch {
    return { ok: false, reason: 'upstream_failed' }
  }
}

/**
 * Address autocomplete for the location form.
 *
 * `sessionToken` is passed through because Google bills autocomplete per session
 * rather than per keystroke; omitting it turns a form into a per-character
 * charge. The client generates one per editing session.
 */
export async function suggestPlaces(
  input: string,
  options: {
    sessionToken?: string
    country?: string | null
    transport?: GeocodingTransport
  } = {}
): Promise<{ ok: true; suggestions: PlaceSuggestion[] } | { ok: false; reason: string }> {
  const query = input.trim()
  if (query.length < 3) return { ok: true, suggestions: [] }

  const key = env.maps.placesApiKey
  if (!key) return { ok: false, reason: 'not_configured' }

  const params = new URLSearchParams({ input: query, key, types: 'establishment|geocode' })
  if (options.sessionToken) params.set('sessiontoken', options.sessionToken)
  if (options.country) params.set('components', `country:${options.country.toLowerCase()}`)

  const transport = options.transport ?? defaultTransport

  try {
    const response = await transport.fetch(`${PLACES_AUTOCOMPLETE_URL}?${params.toString()}`, {
      signal: AbortSignal.timeout(5_000),
    })
    if (!response.ok) return { ok: false, reason: 'upstream_failed' }
    const payload = (await response.json()) as {
      status: string
      predictions?: Array<{
        place_id: string
        description: string
        structured_formatting?: { main_text?: string; secondary_text?: string }
      }>
    }
    if (payload.status === 'ZERO_RESULTS') return { ok: true, suggestions: [] }
    if (payload.status !== 'OK') return { ok: false, reason: 'upstream_failed' }

    return {
      ok: true,
      suggestions: (payload.predictions ?? []).slice(0, 8).map((prediction) => ({
        placeId: prediction.place_id,
        description: prediction.description,
        mainText: prediction.structured_formatting?.main_text ?? prediction.description,
        secondaryText: prediction.structured_formatting?.secondary_text ?? null,
      })),
    }
  } catch {
    return { ok: false, reason: 'upstream_failed' }
  }
}

/**
 * Resolves a chosen suggestion to a full location, including opening hours.
 *
 * The hours are the real prize here: a merchant selecting their own shop from
 * autocomplete gets their trading hours filled in without typing fourteen times.
 */
export async function placeDetails(
  placeId: string,
  options: { sessionToken?: string; transport?: GeocodingTransport } = {}
): Promise<
  | {
      ok: true
      result: GeocodeResult & {
        name: string | null
        phone: string | null
        website: string | null
        openingHours: Record<string, [string, string][]>
      }
    }
  | { ok: false; reason: string }
> {
  const key = env.maps.placesApiKey
  if (!key) return { ok: false, reason: 'not_configured' }

  const params = new URLSearchParams({
    place_id: placeId,
    key,
    fields:
      'name,formatted_address,formatted_phone_number,website,geometry,place_id,address_components,opening_hours',
  })
  if (options.sessionToken) params.set('sessiontoken', options.sessionToken)

  const transport = options.transport ?? defaultTransport

  try {
    const response = await transport.fetch(`${PLACE_DETAILS_URL}?${params.toString()}`, {
      signal: AbortSignal.timeout(6_000),
    })
    if (!response.ok) return { ok: false, reason: 'upstream_failed' }
    const payload = (await response.json()) as {
      status: string
      result?: {
        name?: string
        formatted_address?: string
        formatted_phone_number?: string
        website?: string
        place_id?: string
        geometry?: { location?: { lat?: number; lng?: number }; location_type?: string }
        address_components?: AddressComponent[]
        opening_hours?: {
          periods?: Array<{
            open?: { day?: number; time?: string }
            close?: { day?: number; time?: string }
          }>
        }
      }
    }
    if (payload.status !== 'OK' || !payload.result) return { ok: false, reason: 'not_found' }

    const place = payload.result
    const lat = place.geometry?.location?.lat
    const lng = place.geometry?.location?.lng
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return { ok: false, reason: 'not_found' }
    }

    return {
      ok: true,
      result: {
        coordinates: { lat, lng },
        formattedAddress: place.formatted_address ?? null,
        placeId: place.place_id ?? placeId,
        city: cityOf(place.address_components),
        region: componentOf(place.address_components, 'administrative_area_level_1'),
        postalCode: componentOf(place.address_components, 'postal_code'),
        country: componentOf(place.address_components, 'country', 'short'),
        precision: PRECISION_MAP[place.geometry?.location_type ?? ''] ?? 'rooftop',
        name: place.name ?? null,
        phone: place.formatted_phone_number ?? null,
        website: place.website ?? null,
        openingHours: convertPlaceHours(place.opening_hours?.periods ?? []),
      },
    }
  } catch {
    return { ok: false, reason: 'upstream_failed' }
  }
}

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

/** Google's `{day, time: "0900"}` periods to our `{"mon": [["09:00","18:00"]]}`. */
function convertPlaceHours(
  periods: Array<{ open?: { day?: number; time?: string }; close?: { day?: number; time?: string } }>
): Record<string, [string, string][]> {
  const hours: Record<string, [string, string][]> = {}
  for (const period of periods) {
    const day = period.open?.day
    const open = period.open?.time
    const close = period.close?.time
    if (day === undefined || !open) continue
    const key = DAY_KEYS[day]
    if (!key) continue
    // A period with no close is Google's "open 24 hours".
    hours[key] = [...(hours[key] ?? []), [formatTime(open), close ? formatTime(close) : '23:59']]
  }
  return hours
}

function formatTime(value: string): string {
  const padded = value.padStart(4, '0')
  return `${padded.slice(0, 2)}:${padded.slice(2, 4)}`
}
