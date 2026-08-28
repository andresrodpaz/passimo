import 'server-only'
import { getDb } from '@/lib/db'
import { notFound, unprocessable } from '@/lib/errors'
import { num } from '@/lib/domain/types'
import { boundingBox, isValidLatLng, nearestLocations, type LatLng } from '@/lib/wallet/geo'
import { getWalletSettings } from '@/lib/wallet/settings'
import { WEEKDAYS, type OpeningHours, type StoreLocation, type Weekday } from '@/lib/wallet/types'
import { translatorForBusiness } from '@/lib/i18n/business'

/**
 * Store location service.
 *
 * The single reader and writer of `locations`. Everything that needs to know
 * where a business is — pass relevance, geofence evaluation, the join page, scan
 * attribution, the merchant's own list — comes through here, so "which sites
 * count" can never be answered two different ways.
 *
 * Two decisions worth stating:
 *
 *   * **Geofence config is resolved, not stored twice.** A location row holds
 *     nullable overrides; `mapLocation` merges them with the business defaults so
 *     every consumer receives a complete `GeofenceConfig`. A merchant who changes
 *     the business-wide radius therefore changes every site that has not been
 *     individually customised, which is what they expect and what a
 *     copy-defaults-on-write design silently fails to do.
 *
 *   * **Archived and hidden are different.** Archiving removes a site from the
 *     product; hiding stops it appearing on passes and the join page while
 *     keeping its history and its staff. Closing for a refit is the common case,
 *     and conflating the two makes merchants delete data to achieve it.
 */

const SELECT = '*'

type LocationRow = Record<string, unknown>

export type GeofenceDefaults = {
  radiusMeters: number
  dwellMinutes: number
}

export function mapLocation(row: LocationRow, defaults: GeofenceDefaults): StoreLocation {
  const lat = row.lat === null || row.lat === undefined ? null : Number(row.lat)
  const lng = row.lng === null || row.lng === undefined ? null : Number(row.lng)
  const coordinates = lat !== null && lng !== null && isValidLatLng({ lat, lng }) ? { lat, lng } : null

  const relevanceRadius = num(row.geo_radius_m, defaults.radiusMeters)

  return {
    id: row.id as string,
    businessId: row.business_id as string,
    name: (row.name as string) ?? 'Location',
    description: (row.description as string) ?? null,
    address: (row.address as string) ?? null,
    addressLine2: (row.address_line2 as string) ?? null,
    city: (row.city as string) ?? null,
    region: (row.region as string) ?? null,
    postalCode: (row.postal_code as string) ?? null,
    country: (row.country as string) ?? null,
    phone: (row.phone as string) ?? null,
    email: (row.email as string) ?? null,
    coordinates,
    timezone: (row.timezone as string) ?? null,
    openingHours: normalizeOpeningHours(row.opening_hours),
    isDefault: Boolean(row.is_default),
    isVisible: row.is_visible === undefined ? true : Boolean(row.is_visible),
    sortOrder: num(row.sort_order, 0),
    externalRef: (row.external_ref as string) ?? null,

    geofence: {
      enabled: row.geofence_enabled === undefined ? true : Boolean(row.geofence_enabled),
      relevanceRadiusMeters: relevanceRadius,
      // Notification radius defaults to the relevance radius rather than to the
      // business default: a merchant who narrowed one site to 60 m means it for
      // notifications too, and inheriting 200 m there would send a push to
      // somebody standing three streets away from that specific shop.
      notificationRadiusMeters: row.notification_radius_m
        ? num(row.notification_radius_m)
        : relevanceRadius,
      secondaryRadiusMeters: row.secondary_radius_m ? num(row.secondary_radius_m) : null,
      triggerOnEntry: row.trigger_on_entry === undefined ? true : Boolean(row.trigger_on_entry),
      triggerOnExit: Boolean(row.trigger_on_exit),
      triggerOnDwell: Boolean(row.trigger_on_dwell),
      dwellMinutes: num(row.dwell_minutes, defaults.dwellMinutes),
    },

    relevantText: (row.relevant_text as string) ?? null,
    beacon: row.beacon_uuid
      ? {
          uuid: row.beacon_uuid as string,
          major: row.beacon_major === null ? null : num(row.beacon_major),
          minor: row.beacon_minor === null ? null : num(row.beacon_minor),
        }
      : null,

    googlePlaceId: (row.google_place_id as string) ?? null,
    geocodeSource: (row.geocode_source as string) ?? null,
    geocodedAt: (row.geocoded_at as string) ?? null,
    archivedAt: (row.archived_at as string) ?? null,
    createdAt: (row.created_at as string) ?? new Date().toISOString(),
  }
}

/**
 * Coerces whatever is in the `opening_hours` column into the typed shape.
 *
 * Written defensively because this value is merchant-supplied through an API and
 * a bad row must degrade to "hours unknown" rather than break the pass that
 * embeds them.
 */
export function normalizeOpeningHours(value: unknown): OpeningHours {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const source = value as Record<string, unknown>
  const result: OpeningHours = {}

  for (const day of WEEKDAYS) {
    const ranges = source[day]
    if (!Array.isArray(ranges)) continue
    const parsed = ranges
      .filter(
        (range): range is [string, string] =>
          Array.isArray(range) &&
          range.length === 2 &&
          typeof range[0] === 'string' &&
          typeof range[1] === 'string'
      )
      .slice(0, 4)
    if (parsed.length > 0) result[day] = parsed
  }

  return result
}

/**
 * Whether a location is open at a given local time.
 *
 * Used to suppress "we're open, come in" notifications outside trading hours —
 * the fastest way to make a merchant look careless is to invite someone to a
 * closed shop. Unknown hours return `true`: a merchant who has not filled them in
 * should not silently lose every notification.
 */
export function isOpenAt(hours: OpeningHours, when: Date): boolean {
  const day = WEEKDAYS[when.getDay()] as Weekday
  const ranges = hours[day]
  if (!ranges || ranges.length === 0) return Object.keys(hours).length === 0
  const minutes = when.getHours() * 60 + when.getMinutes()

  return ranges.some(([open, close]) => {
    const from = toMinutes(open)
    const to = toMinutes(close)
    if (from === null || to === null) return false
    // A closing time before the opening time means past midnight — a bar closing
    // at 02:00 is open at 01:00, and reading it as an empty range would close it.
    return from <= to ? minutes >= from && minutes <= to : minutes >= from || minutes <= to
  })
}

function toMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

// -----------------------------------------------------------------------------
// Reads
// -----------------------------------------------------------------------------

export async function listLocations(
  businessId: string,
  options: { includeArchived?: boolean; visibleOnly?: boolean } = {}
): Promise<StoreLocation[]> {
  const admin = getDb()
  const settings = await getWalletSettings(businessId)

  let query = admin
    .from('locations')
    .select(SELECT)
    .eq('business_id', businessId)
    .order('is_default', { ascending: false })
    .order('sort_order')
    .order('name')

  if (!options.includeArchived) query = query.is('archived_at', null)
  if (options.visibleOnly) query = query.eq('is_visible', true)

  const { data, error } = await query
  if (error) throw error

  return (data ?? []).map((row) =>
    mapLocation(row, {
      radiusMeters: settings.defaultRadiusMeters,
      dwellMinutes: settings.defaultDwellMinutes,
    })
  )
}

export async function getLocation(businessId: string, id: string): Promise<StoreLocation> {
  const admin = getDb()
  const [settings, { data }] = await Promise.all([
    getWalletSettings(businessId),
    admin.from('locations').select(SELECT).eq('business_id', businessId).eq('id', id).maybeSingle(),
  ])
  if (!data) throw notFound('Location')
  return mapLocation(data, {
    radiusMeters: settings.defaultRadiusMeters,
    dwellMinutes: settings.defaultDwellMinutes,
  })
}

/**
 * The locations a pass should carry, nearest first when a position is known.
 *
 * Ordering matters because both wallets cap the number of relevant locations on
 * a pass. With more sites than the cap, embedding the nearest ones is the only
 * ordering that makes the cap invisible to the customer.
 */
export async function relevantLocationsFor(
  businessId: string,
  options: { near?: LatLng | null; limit?: number } = {}
): Promise<StoreLocation[]> {
  const locations = (await listLocations(businessId, { visibleOnly: true })).filter(
    (location) => location.coordinates && location.geofence.enabled
  )

  const limit = options.limit ?? 10
  const near = options.near
  if (!near || !isValidLatLng(near)) return locations.slice(0, limit)

  const candidates = locations.map((location) => ({
    location,
    lat: location.coordinates!.lat,
    lng: location.coordinates!.lng,
  }))

  return nearestLocations(near, candidates, { limit }).map((match) => match.target.location)
}

/**
 * Candidate locations for a geofence evaluation.
 *
 * Pre-filtered in SQL by a bounding box around the point so a chain with two
 * hundred sites does not transfer two hundred rows to compute two hundred
 * distances. The box is sized to the widest radius any of this merchant's sites
 * could use, then exact distances are computed in `lib/wallet/proximity.ts`.
 */
export async function locationsNear(
  businessId: string,
  point: LatLng,
  searchRadiusMeters: number
): Promise<StoreLocation[]> {
  if (!isValidLatLng(point)) return []
  const admin = getDb()
  const settings = await getWalletSettings(businessId)
  const box = boundingBox(point, Math.max(searchRadiusMeters, settings.defaultRadiusMeters) + 2_000)

  const { data, error } = await admin
    .from('locations')
    .select(SELECT)
    .eq('business_id', businessId)
    .is('archived_at', null)
    .eq('is_visible', true)
    .gte('lat', box.minLat)
    .lte('lat', box.maxLat)
    .gte('lng', box.minLng)
    .lte('lng', box.maxLng)
    .limit(200)

  if (error) throw error

  return (data ?? [])
    .map((row) =>
      mapLocation(row, {
        radiusMeters: settings.defaultRadiusMeters,
        dwellMinutes: settings.defaultDwellMinutes,
      })
    )
    .filter((location) => location.coordinates && location.geofence.enabled)
}

// -----------------------------------------------------------------------------
// Writes
// -----------------------------------------------------------------------------

export type LocationInput = {
  name: string
  description?: string | null
  address?: string | null
  addressLine2?: string | null
  city?: string | null
  region?: string | null
  postalCode?: string | null
  country?: string | null
  phone?: string | null
  email?: string | null
  lat?: number | null
  lng?: number | null
  timezone?: string | null
  openingHours?: OpeningHours
  isVisible?: boolean
  isDefault?: boolean
  sortOrder?: number
  externalRef?: string | null

  geofenceEnabled?: boolean
  relevanceRadiusMeters?: number | null
  notificationRadiusMeters?: number | null
  secondaryRadiusMeters?: number | null
  triggerOnEntry?: boolean
  triggerOnExit?: boolean
  triggerOnDwell?: boolean
  dwellMinutes?: number | null

  relevantText?: string | null
  beaconUuid?: string | null
  beaconMajor?: number | null
  beaconMinor?: number | null
  googlePlaceId?: string | null
  geocodeSource?: string | null
}

function toRow(input: Partial<LocationInput>): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  const set = (column: string, value: unknown) => {
    if (value !== undefined) row[column] = value
  }

  set('name', input.name)
  set('description', input.description)
  set('address', input.address)
  set('address_line2', input.addressLine2)
  set('city', input.city)
  set('region', input.region)
  set('postal_code', input.postalCode)
  set('country', input.country)
  set('phone', input.phone)
  set('email', input.email)
  set('lat', input.lat)
  set('lng', input.lng)
  set('timezone', input.timezone)
  set('opening_hours', input.openingHours)
  set('is_visible', input.isVisible)
  set('sort_order', input.sortOrder)
  set('external_ref', input.externalRef)
  set('geofence_enabled', input.geofenceEnabled)
  set('geo_radius_m', input.relevanceRadiusMeters)
  set('notification_radius_m', input.notificationRadiusMeters)
  set('secondary_radius_m', input.secondaryRadiusMeters)
  set('trigger_on_entry', input.triggerOnEntry)
  set('trigger_on_exit', input.triggerOnExit)
  set('trigger_on_dwell', input.triggerOnDwell)
  set('dwell_minutes', input.dwellMinutes)
  set('relevant_text', input.relevantText)
  set('beacon_uuid', input.beaconUuid)
  set('beacon_major', input.beaconMajor)
  set('beacon_minor', input.beaconMinor)
  set('google_place_id', input.googlePlaceId)
  set('geocode_source', input.geocodeSource)
  if (input.googlePlaceId !== undefined || input.geocodeSource !== undefined) {
    row.geocoded_at = new Date().toISOString()
  }
  return row
}

export async function createLocation(
  businessId: string,
  input: LocationInput
): Promise<StoreLocation> {
  const admin = getDb()
  const { data, error } = await admin
    .from('locations')
    .insert({ ...toRow(input), business_id: businessId })
    .select('id')
    .single()

  if (error) throw unprocessable(error.message)
  if (input.isDefault) await setPrimaryLocation(businessId, data.id as string)
  return getLocation(businessId, data.id as string)
}

export async function updateLocation(
  businessId: string,
  id: string,
  input: Partial<LocationInput>
): Promise<StoreLocation> {
  const patch = toRow(input)
  if (Object.keys(patch).length > 0) {
    const admin = getDb()
    const { error, count } = await admin
      .from('locations')
      .update(patch, { count: 'exact' })
      .eq('id', id)
      .eq('business_id', businessId)
    if (error) throw unprocessable(error.message)
    if (!count) throw notFound('Location')
  }
  if (input.isDefault) await setPrimaryLocation(businessId, id)
  return getLocation(businessId, id)
}

/**
 * Promotes one location to primary.
 *
 * Two statements rather than one because a partial unique index enforces
 * "at most one default per business" — clearing before setting is what makes the
 * write legal. Both run through the service role inside one request, and the
 * worst interleaving leaves a business with no default, which the reader already
 * tolerates (it falls back to sort order).
 */
export async function setPrimaryLocation(businessId: string, id: string): Promise<void> {
  const admin = getDb()
  await admin
    .from('locations')
    .update({ is_default: false })
    .eq('business_id', businessId)
    .eq('is_default', true)
    .neq('id', id)
  const { error } = await admin
    .from('locations')
    .update({ is_default: true })
    .eq('business_id', businessId)
    .eq('id', id)
  if (error) throw unprocessable(error.message)
}

/**
 * Archives a location.
 *
 * Never a hard delete: visits, scans and gift cards reference it, and a merchant
 * who closes a shop still needs last year's numbers for that shop. The primary
 * flag moves to another site so a business is never left without one.
 */
export async function archiveLocation(businessId: string, id: string): Promise<void> {
  const admin = getDb()
  const { count: remaining } = await admin
    .from('locations')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', businessId)
    .is('archived_at', null)

  if ((remaining ?? 0) <= 1) {
    throw unprocessable('A business needs at least one location')
  }

  const { data: target } = await admin
    .from('locations')
    .select('id, is_default')
    .eq('business_id', businessId)
    .eq('id', id)
    .maybeSingle()
  if (!target) throw notFound('Location')

  await admin
    .from('locations')
    .update({ archived_at: new Date().toISOString(), is_default: false, is_visible: false })
    .eq('id', id)
    .eq('business_id', businessId)

  if (target.is_default) {
    const { data: replacement } = await admin
      .from('locations')
      .select('id')
      .eq('business_id', businessId)
      .is('archived_at', null)
      .order('sort_order')
      .limit(1)
      .maybeSingle()
    if (replacement) await setPrimaryLocation(businessId, replacement.id as string)
  }
}

/**
 * Bulk import.
 *
 * Matches on `externalRef` when the merchant supplies one, so re-importing a
 * corrected spreadsheet updates rows instead of duplicating every store — the
 * single most common way a location import goes wrong.
 */
export async function importLocations(
  businessId: string,
  rows: LocationInput[]
): Promise<{ created: number; updated: number; errors: Array<{ row: number; message: string }> }> {
  const admin = getDb()
  const errors: Array<{ row: number; message: string }> = []
  let created = 0
  let updated = 0

  // The merchant reads these row-by-row in the import preview, so they are
  // written in the business's language rather than the platform's.
  const t = await translatorForBusiness(businessId)

  const { data: existing } = await admin
    .from('locations')
    .select('id, external_ref, name')
    .eq('business_id', businessId)

  const byRef = new Map<string, string>()
  const byName = new Map<string, string>()
  for (const row of existing ?? []) {
    if (row.external_ref) byRef.set(String(row.external_ref).toLowerCase(), row.id as string)
    if (row.name) byName.set(String(row.name).trim().toLowerCase(), row.id as string)
  }

  for (const [index, input] of rows.entries()) {
    if (!input.name?.trim()) {
      errors.push({ row: index + 1, message: t('locations.import.nameRequired') })
      continue
    }
    try {
      const match =
        (input.externalRef && byRef.get(input.externalRef.toLowerCase())) ??
        byName.get(input.name.trim().toLowerCase())

      if (match) {
        await updateLocation(businessId, match, input)
        updated += 1
      } else {
        const location = await createLocation(businessId, input)
        byName.set(location.name.trim().toLowerCase(), location.id)
        if (location.externalRef) byRef.set(location.externalRef.toLowerCase(), location.id)
        created += 1
      }
    } catch (cause) {
      errors.push({
        row: index + 1,
        message: cause instanceof Error ? cause.message : t('locations.import.rowFailed'),
      })
    }
  }

  return { created, updated, errors }
}
