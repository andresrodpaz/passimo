import { z } from 'zod'
import { GEOFENCE_TRIGGERS, WALLET_EVENT_TYPES, WALLET_PLATFORMS, WEEKDAYS } from '@/lib/wallet/types'
import { RULE_ACTION_TYPES, RULE_FACTS, RULE_OPERATORS } from '@/lib/wallet/rules'
import { TEMPLATE_KEYS } from '@/lib/wallet/templates'
import { CARD_STYLES, PROGRESS_STYLES, TYPOGRAPHIES } from '@/lib/wallet/card-design'

/**
 * Request schemas for store locations, wallet settings, proximity campaigns,
 * automation rules and the event stream.
 *
 * Kept separate from `lib/api/schemas.ts` because the wallet surface is large
 * enough to be its own module, and because these shapes are also what the
 * dashboard forms validate against — one definition for the client-side check and
 * the server-side one.
 */

const uuid = z.string().uuid()

/**
 * Strips the routing keys from a validated body.
 *
 * `businessId` and `id` are how `defineRoute` finds the tenant and the row; they are
 * not fields on the record. Every write handler needs the rest, and destructuring
 * them into unused variables is both noisy and a lint error, so it happens once here.
 */
export function payloadOf<T extends object>(body: T): Omit<T, 'businessId' | 'id'> {
  const rest = { ...body } as Record<string, unknown>
  delete rest.businessId
  delete rest.id
  return rest as Omit<T, 'businessId' | 'id'>
}

const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Use a 6-digit hex colour, like #1F2937')

/** Latitude and longitude, validated as a pair. */
export const latitude = z.number().min(-90).max(90)
export const longitude = z.number().min(-180).max(180)

/** `HH:MM`, the only time format the merchant UI produces. */
const timeOfDay = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour HH:MM, like 18:30')

const openingRange = z.tuple([timeOfDay, timeOfDay])

/**
 * `{"mon": [["09:00","14:00"], ["17:00","20:00"]]}`.
 *
 * Up to four ranges per day: two covers a split shift, four covers anything real,
 * and an unbounded list is a denial-of-service vector on a jsonb column.
 */
export const openingHoursSchema = z
  .object(
    Object.fromEntries(
      WEEKDAYS.map((day) => [day, z.array(openingRange).max(4).optional()])
    ) as Record<(typeof WEEKDAYS)[number], z.ZodOptional<z.ZodArray<typeof openingRange>>>
  )
  .partial()

const radius = z.number().int().min(50).max(50_000)

const locationFields = {
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  address: z.string().trim().max(200).nullable().optional(),
  addressLine2: z.string().trim().max(200).nullable().optional(),
  city: z.string().trim().max(120).nullable().optional(),
  region: z.string().trim().max(120).nullable().optional(),
  postalCode: z.string().trim().max(24).nullable().optional(),
  country: z.string().trim().max(2).nullable().optional(),
  phone: z.string().trim().max(32).nullable().optional(),
  email: z.string().email().max(160).nullable().optional(),
  lat: latitude.nullable().optional(),
  lng: longitude.nullable().optional(),
  timezone: z.string().max(64).nullable().optional(),
  openingHours: openingHoursSchema.optional(),
  isVisible: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(9_999).optional(),
  externalRef: z.string().trim().max(80).nullable().optional(),

  geofenceEnabled: z.boolean().optional(),
  relevanceRadiusMeters: radius.nullable().optional(),
  notificationRadiusMeters: radius.nullable().optional(),
  secondaryRadiusMeters: radius.nullable().optional(),
  triggerOnEntry: z.boolean().optional(),
  triggerOnExit: z.boolean().optional(),
  triggerOnDwell: z.boolean().optional(),
  dwellMinutes: z.number().int().min(1).max(720).nullable().optional(),

  relevantText: z.string().trim().max(160).nullable().optional(),
  beaconUuid: z.string().uuid().nullable().optional(),
  beaconMajor: z.number().int().min(0).max(65_535).nullable().optional(),
  beaconMinor: z.number().int().min(0).max(65_535).nullable().optional(),
  googlePlaceId: z.string().max(200).nullable().optional(),
}

export const createLocationSchema = z.object({ businessId: uuid, ...locationFields })

/*
 * `.partial()` rather than rebuilding the field map: generating the shape with
 * `Object.fromEntries` erases every field's type, which propagates all the way into
 * the route handler as `any` — losing exactly the validation-to-handler type safety
 * the schemas exist to provide.
 */
export const updateLocationSchema = z
  .object(locationFields)
  .partial()
  .extend({ businessId: uuid, id: uuid })

export const listLocationsQuery = z.object({
  businessId: uuid,
  includeArchived: z.enum(['true', 'false']).optional(),
})

export const deleteLocationSchema = z.object({ businessId: uuid, id: uuid })

export const importLocationsSchema = z.object({
  businessId: uuid,
  locations: z.array(z.object(locationFields)).min(1).max(500),
})

export const geocodeSchema = z.object({
  businessId: uuid,
  /** One of these three. `address` geocodes; `placeId` resolves a suggestion. */
  address: z.string().trim().min(3).max(300).optional(),
  placeId: z.string().trim().min(3).max(300).optional(),
  lat: latitude.optional(),
  lng: longitude.optional(),
  /** Google bills autocomplete per session, not per keystroke. */
  sessionToken: z.string().max(80).optional(),
  mode: z.enum(['geocode', 'reverse', 'suggest', 'details']).default('geocode'),
})

// -----------------------------------------------------------------------------
// Wallet settings
// -----------------------------------------------------------------------------

export const walletSettingsPatchSchema = z.object({
  businessId: uuid,

  proximityEnabled: z.boolean().optional(),
  geofencingEnabled: z.boolean().optional(),
  beaconsEnabled: z.boolean().optional(),

  appleLockScreenSuggestions: z.boolean().optional(),
  googleWalletSuggestions: z.boolean().optional(),
  nearbyRecommendations: z.boolean().optional(),
  automaticPassUpdates: z.boolean().optional(),
  dynamicPassContent: z.boolean().optional(),
  rewardNotifications: z.boolean().optional(),
  loyaltyReminders: z.boolean().optional(),
  maxRelevantLocations: z.number().int().min(1).max(10).optional(),

  defaultRadiusMeters: radius.optional(),
  defaultDwellMinutes: z.number().int().min(1).max(720).optional(),
  maxNotificationsPerDay: z.number().int().min(0).max(20).optional(),
  minHoursBetweenNotifications: z.number().int().min(0).max(168).optional(),

  quietHoursStart: z.number().int().min(0).max(23).optional(),
  quietHoursEnd: z.number().int().min(0).max(23).optional(),
  respectQuietHours: z.boolean().optional(),

  notificationEmoji: z.string().max(8).nullable().optional(),
  notificationTitle: z.string().trim().max(60).nullable().optional(),
  notificationMessage: z.string().trim().max(300).nullable().optional(),
  notificationCta: z.string().trim().max(40).nullable().optional(),
  brandColor: hexColor.nullable().optional(),
  brandTextColor: hexColor.nullable().optional(),
  logoUrl: z.string().url().max(500).nullable().optional(),
  heroImageUrl: z.string().url().max(500).nullable().optional(),
  passExpirationDays: z.number().int().min(1).max(3_650).nullable().optional(),
})

// -----------------------------------------------------------------------------
// Proximity campaigns
// -----------------------------------------------------------------------------

const CAMPAIGN_KINDS = [
  'welcome',
  'happy_hour',
  'double_points',
  'birthday',
  'weekend',
  'lunch',
  'coffee_morning',
  'vip_event',
  'seasonal',
  'win_back',
  'reward_ready',
  'new_location',
  'custom',
] as const

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')

const campaignFields = {
  name: z.string().trim().min(1).max(120),
  kind: z.enum(CAMPAIGN_KINDS).optional(),
  status: z.enum(['draft', 'scheduled', 'active', 'paused', 'ended']).optional(),
  description: z.string().trim().max(500).nullable().optional(),

  trigger: z.enum(GEOFENCE_TRIGGERS).optional(),
  radiusMeters: radius.nullable().optional(),
  dwellMinutes: z.number().int().min(1).max(720).nullable().optional(),

  startsOn: isoDate.nullable().optional(),
  endsOn: isoDate.nullable().optional(),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  startTime: timeOfDay.nullable().optional(),
  endTime: timeOfDay.nullable().optional(),

  allLocations: z.boolean().optional(),
  locationIds: z.array(uuid).max(200).optional(),
  segmentId: uuid.nullable().optional(),
  minTierLevel: z.number().int().min(0).max(20).nullable().optional(),
  minPoints: z.number().min(0).max(1_000_000).nullable().optional(),
  minVisits: z.number().int().min(0).max(100_000).nullable().optional(),
  maxDaysSinceVisit: z.number().int().min(0).max(3_650).nullable().optional(),
  minDaysSinceVisit: z.number().int().min(0).max(3_650).nullable().optional(),
  vipOnly: z.boolean().optional(),
  eligibility: z.record(z.unknown()).optional(),

  // Lengths are the vendors' own limits, not ours: Apple truncates lock-screen
  // text and Google rejects an over-long message header, so a merchant is stopped
  // in the editor rather than discovering it on a customer's phone.
  title: z.string().trim().min(1).max(60),
  message: z.string().trim().min(1).max(300),
  emoji: z.string().max(8).nullable().optional(),
  ctaLabel: z.string().trim().max(40).nullable().optional(),
  ctaUrl: z.string().url().max(500).nullable().optional(),
  rewardDescription: z.string().trim().max(200).nullable().optional(),
  imageUrl: z.string().url().max(500).nullable().optional(),
  backgroundColor: hexColor.nullable().optional(),
  textColor: hexColor.nullable().optional(),
  logoUrl: z.string().url().max(500).nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),

  priority: z.number().int().min(-100).max(100).optional(),
  cooldownHours: z.number().int().min(0).max(8_760).optional(),
  maxSendsPerCustomer: z.number().int().min(1).max(1_000).nullable().optional(),
  channels: z.array(z.enum(['wallet', 'push', 'email', 'sms'])).min(1).max(4).optional(),
}

export const createCampaignSchema = z.object({ businessId: uuid, ...campaignFields })

export const updateCampaignSchema = z
  .object(campaignFields)
  .partial()
  .extend({ businessId: uuid, id: uuid })

export const listCampaignsQuery = z.object({
  businessId: uuid,
  status: z.enum(['draft', 'scheduled', 'active', 'paused', 'ended']).optional(),
  includeArchived: z.enum(['true', 'false']).optional(),
})

export const deleteCampaignSchema = z.object({ businessId: uuid, id: uuid })

// -----------------------------------------------------------------------------
// Automation rules
// -----------------------------------------------------------------------------

/**
 * The condition tree, described recursively.
 *
 * `z.lazy` is required because the schema references itself; the depth limit lives
 * in `validateConditions`, which the store calls, because expressing "at most five
 * levels" in Zod produces an error message no merchant could act on.
 */
const ruleConditionSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.object({ all: z.array(ruleConditionSchema).max(25) }),
    z.object({ any: z.array(ruleConditionSchema).max(25) }),
    z.object({ none: z.array(ruleConditionSchema).max(25) }),
    z.object({
      fact: z.enum(RULE_FACTS),
      op: z.enum(RULE_OPERATORS),
      value: z.unknown().optional(),
    }),
  ])
)

const ruleActionSchema = z
  .object({ type: z.enum(RULE_ACTION_TYPES) })
  .passthrough()

const ruleFields = {
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  isActive: z.boolean().optional(),
  priority: z.number().int().min(-100).max(100).optional(),
  stopOnMatch: z.boolean().optional(),
  conditions: ruleConditionSchema.optional(),
  actions: z.array(ruleActionSchema).min(1).max(10).optional(),
  cooldownHours: z.number().int().min(0).max(8_760).optional(),
  templateKey: z.string().max(60).nullable().optional(),
}

export const createRuleSchema = z.object({ businessId: uuid, ...ruleFields })

export const updateRuleSchema = z.object({
  businessId: uuid,
  id: uuid,
  ...ruleFields,
  name: ruleFields.name.optional(),
})

export const deleteRuleSchema = z.object({ businessId: uuid, id: uuid })

export const listRulesQuery = z.object({
  businessId: uuid,
  activeOnly: z.enum(['true', 'false']).optional(),
})

// -----------------------------------------------------------------------------
// Templates
// -----------------------------------------------------------------------------

export const applyTemplateSchema = z.object({
  businessId: uuid,
  templateKey: z.enum(TEMPLATE_KEYS as [string, ...string[]]),
  /** Which parts to write. A merchant may want the campaigns but not the radiuses. */
  include: z
    .object({
      settings: z.boolean().default(true),
      campaigns: z.boolean().default(true),
      rules: z.boolean().default(true),
    })
    .default({ settings: true, campaigns: true, rules: true }),
})

// -----------------------------------------------------------------------------
// Events and position reports
// -----------------------------------------------------------------------------

/**
 * A position report from a customer's browser.
 *
 * Authenticated by the signed card token, not by a session: the reporter is a
 * customer on a public page, and the token is the only thing that proves which
 * card they hold.
 */
export const positionReportSchema = z.object({
  token: z.string().min(10).max(2_000),
  lat: latitude,
  lng: longitude,
  accuracyMeters: z.number().min(0).max(100_000).optional(),
  platform: z.enum(WALLET_PLATFORMS).optional(),
})

/**
 * A client-reported funnel event.
 *
 * `revenue_cents` is deliberately absent: revenue is only ever attributed by
 * server code reading a real ledger entry, because a client-supplied figure would
 * make the merchant's ROI column fiction.
 */
export const walletEventSchema = z.object({
  token: z.string().min(10).max(2_000),
  type: z.enum(
    WALLET_EVENT_TYPES.filter((type) =>
      [
        'wallet_suggestion',
        'notification_impression',
        'notification_click',
        'wallet_open',
        'offer_viewed',
        'pass_installed',
        'pass_removed',
      ].includes(type)
    ) as [string, ...string[]]
  ),
  campaignId: uuid.optional(),
  locationId: uuid.optional(),
  platform: z.enum(WALLET_PLATFORMS).optional(),
})

export const analyticsQuery = z.object({
  businessId: uuid,
  days: z.coerce.number().int().min(1).max(365).default(30),
})

/**
 * Preflight: "would this campaign send to this customer right now, and if not,
 * why?" Powers the campaign editor's test button.
 */
export const previewCampaignSchema = z.object({
  businessId: uuid,
  campaignId: uuid,
  customerId: uuid.optional(),
  locationId: uuid.optional(),
  trigger: z.enum(GEOFENCE_TRIGGERS).default('entry'),
})

// -----------------------------------------------------------------------------
// Card design and brand kit
// -----------------------------------------------------------------------------

/**
 * A colour that can be cleared.
 *
 * `null` is meaningful here and distinct from omission: sending null resets the
 * field to the brand kit, whereas omitting it leaves the override in place. A
 * schema that coerced null to undefined would make "go back to my brand colour"
 * unexpressible over the API.
 */
const nullableHex = hexColor.nullable()

/** Trimmed merchant copy, cleared when emptied. */
const merchantText = (max: number) =>
  z
    .string()
    .max(max)
    .transform((value) => value.trim())
    .transform((value) => (value.length > 0 ? value : null))
    .nullable()

export const cardDesignPatchSchema = z.object({
  businessId: uuid,

  template: z.string().max(40).optional(),
  cardStyle: z.enum(CARD_STYLES).optional(),
  progressStyle: z.enum(PROGRESS_STYLES).optional(),
  typography: z.enum(TYPOGRAPHIES).optional(),

  backgroundColor: nullableHex.optional(),
  foregroundColor: nullableHex.optional(),
  accentColor: nullableHex.optional(),

  logoUrl: z.string().url().max(2048).nullable().optional(),
  heroImageUrl: z.string().url().max(2048).nullable().optional(),

  showMemberName: z.boolean().optional(),
  showMemberSince: z.boolean().optional(),
  showTier: z.boolean().optional(),
  showLocation: z.boolean().optional(),
  showReward: z.boolean().optional(),
  showProgress: z.boolean().optional(),

  headline: merchantText(40).optional(),
  customMessage: merchantText(280).optional(),
  termsText: merchantText(500).optional(),
})

export const cardDesignTemplateSchema = z.object({
  businessId: uuid,
  template: z.string().min(1).max(40),
})

/**
 * A social handle.
 *
 * Accepts what a merchant actually pastes — a URL, an `@handle` or a bare
 * username — and lets `normalizeHandle` reduce it. Validating the strict form
 * here would reject the most common input and teach merchants the field is
 * broken.
 */
const socialHandle = z.string().max(200).nullable()

export const brandKitPatchSchema = z.object({
  businessId: uuid,

  name: z.string().min(1).max(120).optional(),
  description: merchantText(200).optional(),

  logoUrl: z.string().url().max(2048).nullable().optional(),
  iconUrl: z.string().url().max(2048).nullable().optional(),
  coverUrl: z.string().url().max(2048).nullable().optional(),

  primaryColor: nullableHex.optional(),
  secondaryColor: nullableHex.optional(),
  accentColor: nullableHex.optional(),
  textColor: nullableHex.optional(),
  font: z.string().max(60).nullable().optional(),

  supportEmail: z.string().email().max(320).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  website: z.string().url().max(2048).nullable().optional(),
  address: z.string().max(300).nullable().optional(),
  city: z.string().max(120).nullable().optional(),
  postalCode: z.string().max(20).nullable().optional(),
  country: z.string().max(80).nullable().optional(),

  instagram: socialHandle.optional(),
  facebook: socialHandle.optional(),
  tiktok: socialHandle.optional(),
})
