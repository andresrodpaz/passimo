/**
 * Geospatial primitives.
 *
 * Pure, isomorphic and dependency-free on purpose. Every proximity decision in
 * the product — which pass locations to embed, whether a device is inside a
 * geofence, how long it has dwelled, which store to suggest — reduces to the
 * four functions here, so they are unit-tested exhaustively and used everywhere
 * rather than reimplemented per caller.
 *
 * Deliberately not PostGIS. The whole point of the product is that a merchant
 * has between one and fifty locations, and at that scale a bounding-box index
 * plus haversine in the application is both faster than a spatial join and one
 * fewer database extension to depend on. If a tenant ever has ten thousand
 * sites, `nearestLocations` is the single function that changes.
 */

export type LatLng = {
  lat: number
  lng: number
}

/** Mean Earth radius in metres (WGS-84 authalic). */
const EARTH_RADIUS_M = 6_371_008.8

/** Metres per degree of latitude — constant enough for geofence maths. */
const METRES_PER_DEGREE_LAT = 111_320

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180

export function isValidLatLng(value: unknown): value is LatLng {
  if (!value || typeof value !== 'object') return false
  const { lat, lng } = value as Partial<LatLng>
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  )
}

/**
 * Great-circle distance in metres.
 *
 * Haversine rather than the faster equirectangular approximation: the error of
 * the cheap version is a few metres at city scale, and a few metres is the
 * difference between "inside the shop" and "across the street" for the 50 m
 * radiuses merchants actually configure.
 */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat)
  const dLng = toRadians(b.lng - a.lng)
  const lat1 = toRadians(a.lat)
  const lat2 = toRadians(b.lat)

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function isWithinRadius(point: LatLng, centre: LatLng, radiusMeters: number): boolean {
  if (radiusMeters <= 0) return false
  return distanceMeters(point, centre) <= radiusMeters
}

/**
 * A latitude/longitude window that fully contains a circle.
 *
 * Used to pre-filter candidate locations in SQL before computing exact
 * distances, because an index can serve a range scan and cannot serve
 * haversine. The longitude span widens with latitude; at the poles it
 * degenerates, so it is clamped to the whole world rather than producing NaN.
 */
export function boundingBox(
  centre: LatLng,
  radiusMeters: number
): { minLat: number; maxLat: number; minLng: number; maxLng: number } {
  const latDelta = radiusMeters / METRES_PER_DEGREE_LAT
  const cosLat = Math.cos(toRadians(centre.lat))
  const lngDelta =
    Math.abs(cosLat) < 1e-9 ? 180 : radiusMeters / (METRES_PER_DEGREE_LAT * Math.abs(cosLat))

  return {
    minLat: Math.max(-90, centre.lat - latDelta),
    maxLat: Math.min(90, centre.lat + latDelta),
    minLng: Math.max(-180, centre.lng - Math.min(180, lngDelta)),
    maxLng: Math.min(180, centre.lng + Math.min(180, lngDelta)),
  }
}

export type Geofenced<T> = T & {
  lat: number
  lng: number
}

export type ProximityMatch<T> = {
  target: Geofenced<T>
  distanceMeters: number
  /** True when the point is inside the target's own radius. */
  inside: boolean
}

/**
 * Ranks candidates by distance from a point.
 *
 * Returns *all* candidates with their distances rather than only those in range,
 * because the caller usually needs both answers: "am I at a store" (inside) and
 * "which store is closest" (for a nearby suggestion the customer might walk to).
 * Splitting those into two passes over the same list is how the two answers
 * drift apart.
 */
export function nearestLocations<T>(
  point: LatLng,
  candidates: readonly Geofenced<T>[],
  options: { radiusMeters?: number | ((target: Geofenced<T>) => number); limit?: number } = {}
): ProximityMatch<T>[] {
  const configuredRadius = options.radiusMeters
  const radiusOf: (target: Geofenced<T>) => number =
    typeof configuredRadius === 'function' ? configuredRadius : () => configuredRadius ?? 0

  const matches = candidates
    .filter((candidate) => isValidLatLng(candidate))
    .map((target) => {
      const metres = distanceMeters(point, target)
      const radius = radiusOf(target)
      return {
        target,
        distanceMeters: Math.round(metres),
        inside: radius > 0 && metres <= radius,
      }
    })
    .sort((a, b) => a.distanceMeters - b.distanceMeters)

  return options.limit ? matches.slice(0, options.limit) : matches
}

/**
 * Coarsens a coordinate before it is stored.
 *
 * We need "is this customer near a shop", never "where has this customer been".
 * Rounding to roughly 100 m keeps every geofence decision correct — merchant
 * radiuses start at 50 m and the evaluation is re-run on each report — while
 * making the stored value useless as a movement trail. Privacy that depends on
 * remembering to delete rows is not privacy.
 */
export function coarsen(point: LatLng, precisionMeters = 100): LatLng {
  const latStep = precisionMeters / METRES_PER_DEGREE_LAT
  const lat = Number((Math.round(point.lat / latStep) * latStep).toFixed(6))

  /*
   * The longitude step is derived from the *coarsened* latitude, not the raw one.
   *
   * Deriving it from the raw value makes the function non-idempotent: two readings a
   * couple of metres apart land in the same latitude cell but compute slightly
   * different longitude steps, so the same cell produces two different stored
   * coordinates. Since the row is replaced on every position report, that made a
   * stationary phone on a table look like it was drifting — and re-coarsening a stored
   * value returned something different again.
   */
  const cosLat = Math.max(0.01, Math.abs(Math.cos(toRadians(lat))))
  const lngStep = precisionMeters / (METRES_PER_DEGREE_LAT * cosLat)

  return {
    lat,
    lng: Number((Math.round(point.lng / lngStep) * lngStep).toFixed(6)),
  }
}

/**
 * Which trigger a position report represents, given the previous state.
 *
 * The state machine is the whole reason geofencing is hard in practice: phones
 * report positions in bursts, and a device sitting on a table at the boundary
 * will oscillate in and out dozens of times an hour. Entry therefore fires only
 * on a genuine transition, and a hysteresis band means leaving requires clearing
 * the radius by a margin rather than wobbling across it.
 */
export type GeofenceTransition = 'enter' | 'exit' | 'dwell' | 'inside' | 'outside'

export function classifyTransition(input: {
  distanceMeters: number
  radiusMeters: number
  /** Whether the device was already inside this fence on the last report. */
  wasInside: boolean
  /** When it entered, if it was inside. */
  enteredAt?: Date | null
  dwellMinutes?: number
  now?: Date
  /** Extra metres a device must clear before we call it an exit. */
  hysteresisMeters?: number
}): GeofenceTransition {
  const {
    distanceMeters: metres,
    radiusMeters,
    wasInside,
    enteredAt = null,
    dwellMinutes = 0,
    now = new Date(),
    hysteresisMeters = 25,
  } = input

  const exitThreshold = radiusMeters + Math.max(0, hysteresisMeters)
  const isInside = wasInside ? metres <= exitThreshold : metres <= radiusMeters

  if (!isInside) return wasInside ? 'exit' : 'outside'
  if (!wasInside) return 'enter'

  if (dwellMinutes > 0 && enteredAt) {
    const elapsedMinutes = (now.getTime() - enteredAt.getTime()) / 60_000
    if (elapsedMinutes >= dwellMinutes) return 'dwell'
  }

  return 'inside'
}

/** Human distance for merchant-facing and customer-facing copy. */
export function formatDistance(metres: number, locale = 'en'): string {
  if (!Number.isFinite(metres) || metres < 0) return '—'
  if (metres < 1_000) return `${Math.round(metres / 10) * 10} m`
  const km = metres / 1_000
  return `${km.toLocaleString(locale, { maximumFractionDigits: km < 10 ? 1 : 0 })} km`
}
