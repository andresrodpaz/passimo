/**
 * Wallet domain types.
 *
 * The contract between the three layers of the wallet stack:
 *
 *   * **content** — what a card *says* (`WalletPassContent`), derived from
 *     loyalty state and merchant configuration and identical for both wallets;
 *   * **providers** — how each vendor renders and delivers that content
 *     (`WalletProvider`);
 *   * **orchestration** — when to build, update or notify (the services).
 *
 * Keeping content provider-agnostic is what makes "the pass shows the tier now"
 * a one-line change instead of two, and what stops the two wallets from
 * silently drifting apart — the failure mode of every loyalty platform that
 * grew Apple support first and bolted Google on later.
 *
 * Isomorphic: no `server-only`, so the dashboard can render an accurate preview
 * of the real pass from the real types.
 */

import type { LatLng } from '@/lib/wallet/geo'
import type { ResolvedCardDesign } from '@/lib/wallet/card-design'

export const WALLET_PLATFORMS = ['apple', 'google', 'web', 'unknown'] as const
export type WalletPlatform = (typeof WALLET_PLATFORMS)[number]

export const GEOFENCE_TRIGGERS = ['entry', 'exit', 'dwell', 'nearby', 'manual'] as const
export type GeofenceTrigger = (typeof GEOFENCE_TRIGGERS)[number]

export const WALLET_EVENT_TYPES = [
  'geofence_enter',
  'geofence_exit',
  'geofence_dwell',
  'wallet_suggestion',
  'notification_sent',
  'notification_impression',
  'notification_click',
  'wallet_open',
  'pass_installed',
  'pass_updated',
  'pass_removed',
  'store_visit',
  'reward_redeemed',
  'offer_viewed',
] as const
export type WalletEventType = (typeof WALLET_EVENT_TYPES)[number]

// -----------------------------------------------------------------------------
// Store locations
// -----------------------------------------------------------------------------

export type OpeningHoursRange = [open: string, close: string]

/**
 * Opening hours keyed by weekday. Multiple ranges per day because split shifts
 * are the norm, not the exception, in the businesses this product serves.
 */
export type OpeningHours = Partial<Record<Weekday, OpeningHoursRange[]>>

export const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const
export type Weekday = (typeof WEEKDAYS)[number]

export type StoreLocation = {
  id: string
  businessId: string
  name: string
  description: string | null
  address: string | null
  addressLine2: string | null
  city: string | null
  region: string | null
  postalCode: string | null
  country: string | null
  phone: string | null
  email: string | null
  coordinates: LatLng | null
  timezone: string | null
  openingHours: OpeningHours
  isDefault: boolean
  isVisible: boolean
  sortOrder: number
  externalRef: string | null

  /** Geofence configuration, resolved against the business defaults. */
  geofence: GeofenceConfig

  /** Copy shown when the pass becomes relevant on the lock screen. */
  relevantText: string | null
  beacon: BeaconIdentifier | null

  googlePlaceId: string | null
  geocodeSource: string | null
  geocodedAt: string | null
  archivedAt: string | null
  createdAt: string
}

export type GeofenceConfig = {
  enabled: boolean
  /** Radius at which the pass becomes relevant on the lock screen. */
  relevanceRadiusMeters: number
  /** Radius at which a notification is triggered. Often wider than relevance. */
  notificationRadiusMeters: number
  /** Optional outer ring: "getting close" versus "at the door". */
  secondaryRadiusMeters: number | null
  triggerOnEntry: boolean
  triggerOnExit: boolean
  triggerOnDwell: boolean
  dwellMinutes: number
}

export type BeaconIdentifier = {
  uuid: string
  major: number | null
  minor: number | null
}

// -----------------------------------------------------------------------------
// Merchant wallet configuration
// -----------------------------------------------------------------------------

export type WalletSettings = {
  businessId: string

  proximityEnabled: boolean
  geofencingEnabled: boolean
  beaconsEnabled: boolean

  appleLockScreenSuggestions: boolean
  googleWalletSuggestions: boolean
  nearbyRecommendations: boolean
  automaticPassUpdates: boolean
  dynamicPassContent: boolean
  rewardNotifications: boolean
  loyaltyReminders: boolean
  maxRelevantLocations: number

  defaultRadiusMeters: number
  defaultDwellMinutes: number
  maxNotificationsPerDay: number
  minHoursBetweenNotifications: number

  quietHoursStart: number
  quietHoursEnd: number
  respectQuietHours: boolean

  branding: WalletBranding
  passExpirationDays: number | null

  appliedTemplate: string | null
  appliedTemplateAt: string | null
}

export type WalletBranding = {
  emoji: string | null
  title: string | null
  message: string | null
  cta: string | null
  brandColor: string | null
  brandTextColor: string | null
  logoUrl: string | null
  heroImageUrl: string | null
}

// -----------------------------------------------------------------------------
// Pass content — provider-agnostic
// -----------------------------------------------------------------------------

/**
 * Everything on a customer's card, in the shape both providers render from.
 *
 * This is the single source of truth for "what does the card say". Adding a
 * field here and consuming it in both providers is the only way to change a
 * card, which is what guarantees an Apple and a Google user see the same
 * program.
 */
export type WalletPassContent = {
  /** Stable pass identity. Apple's serialNumber, Google's object suffix. */
  serialNumber: string
  customerId: string
  businessId: string
  authenticationToken: string

  organizationName: string
  programName: string
  description: string

  /**
   * Every fixed string the card prints, already in the business's language.
   *
   * Carried on the content for the same reason `design` is: a provider must not
   * have to know what language a merchant writes in, and two providers reaching
   * for their own literals is how one card ends up saying MEMBER and the other
   * CLIENTE for the same customer.
   */
  labels: PassLabels

  branding: {
    backgroundColor: string
    foregroundColor: string
    labelColor: string
    logoUrl: string | null
    heroImageUrl: string | null
  }

  /**
   * The merchant's card design, resolved.
   *
   * Carried on the content rather than looked up per provider so Apple and
   * Google cannot disagree about whether the tier row is shown. `branding` above
   * is kept as the flat colour triple both provider SDKs want; this is the rest
   * of the design — layout, typography, visibility and the merchant's own copy.
   */
  design: ResolvedCardDesign

  member: {
    name: string | null
    since: string | null
    tierName: string | null
    isVip: boolean
  }

  progress: {
    balance: number
    goal: number | null
    unitSingular: string
    unitPlural: string
    rewardName: string | null
    /** True when the customer can claim right now — changes the whole card. */
    rewardReady: boolean
    remaining: number | null
    expiresAt: string | null
  }

  /**
   * Location relevance. Ordered nearest-first when a device position is known,
   * otherwise by merchant sort order, and capped at the provider's limit by the
   * provider — never here, so the content stays provider-agnostic.
   */
  relevantLocations: RelevantLocation[]

  /** Offers currently available to this customer, shown on the back of the card. */
  offers: PassOffer[]

  links: {
    cardUrl: string
    webServiceUrl: string
    websiteUrl: string | null
    supportEmail: string | null
  }

  referralCode: string | null
  expiresAt: string | null
}

/**
 * The card's fixed vocabulary, resolved once per build.
 *
 * Plain strings rather than a translator, so the content stays serialisable —
 * the preview endpoint returns it as JSON and the sync path stores it. Two
 * entries (`offerUntil`, `pointsExpire`) keep a `{date}` / `{unit}` placeholder
 * because their value varies per row; providers fill those in with
 * `formatPassDate` and a plain replace rather than re-deriving the wording.
 */
export type PassLabels = {
  /** BCP 47 tag for any date the card prints. Never the platform default. */
  localeTag: string
  /** Two-letter language, for provider localisation metadata. */
  language: string

  tier: string
  vip: string
  balanceChange: string
  readyToClaim: string
  nextReward: string
  rewardFallback: string
  toGo: string
  member: string
  since: string
  howItWorks: string
  /** Already interpolated with the goal, unit and reward. */
  howItWorksBody: string
  offer: string
  offerUntil: string
  where: string
  referral: string
  /** Already interpolated with the customer's code. */
  referralBody: string
  referralBodyShort: string
  pointsExpire: string
  website: string
  contact: string
  manageCard: string
  viewCard: string
  goal: string
  memberFallback: string
  /** Already interpolated with the business name. */
  logoAlt: string
}

export type RelevantLocation = {
  id: string
  name: string
  coordinates: LatLng
  /** Metres at which the pass should surface. */
  radiusMeters: number
  /** Lock-screen copy. Provider-specific defaults are applied downstream. */
  relevantText: string
  beacon: BeaconIdentifier | null
}

export type PassOffer = {
  id: string
  title: string
  description: string | null
  expiresAt: string | null
}

// -----------------------------------------------------------------------------
// Provider abstraction
// -----------------------------------------------------------------------------

export type WalletProviderId = 'apple' | 'google'

export type PassArtifact =
  | { kind: 'file'; contentType: string; filename: string; body: Uint8Array }
  | { kind: 'redirect'; url: string }

export type ProviderStatus = {
  id: WalletProviderId
  label: string
  /** Signing / issuing credentials present. */
  configured: boolean
  /** Push credentials present, so pass updates can be delivered. */
  pushConfigured: boolean
  /** Which of the proximity capabilities this provider supports. */
  supports: {
    geofencedRelevance: boolean
    lockScreenSuggestions: boolean
    beacons: boolean
    pushUpdates: boolean
    /** Whether the provider can render arbitrary notification copy. */
    richNotifications: boolean
  }
  /** Human explanation when `configured` is false, for the settings screen. */
  missing: string[]
}

/**
 * What every wallet vendor must be able to do.
 *
 * Injected rather than imported by the orchestration layer (see
 * `lib/wallet/service.ts`), which is what lets a test drive the whole proximity
 * engine with two fake providers and no credentials — the situation this
 * codebase is actually developed in.
 */
export type WalletProvider = {
  readonly id: WalletProviderId
  status(): ProviderStatus
  /** Builds the installable pass. Throws `notConfigured` without credentials. */
  issue(content: WalletPassContent): Promise<PassArtifact>
  /**
   * Pushes updated content to installed passes.
   * Returns the number of devices reached; 0 is a normal outcome for a customer
   * who never installed the pass, not an error.
   */
  update(content: WalletPassContent): Promise<{ devices: number }>
  /**
   * Delivers a proximity notification through the wallet itself, where the
   * vendor supports it. Apple delivers the pass's `relevantText`; Google
   * delivers a message on the object. Returns false when the vendor cannot.
   */
  notify(input: WalletNotificationPayload): Promise<{ delivered: boolean }>
}

export type WalletNotificationPayload = {
  content: WalletPassContent
  title: string
  message: string
  emoji: string | null
  ctaLabel: string | null
  ctaUrl: string | null
  expiresAt: string | null
  location: RelevantLocation | null
}
