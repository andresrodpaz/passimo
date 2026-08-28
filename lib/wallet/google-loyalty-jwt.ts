import 'server-only'
import { env } from '@/lib/env'
import { createGoogleWalletSaveJwt } from '@/lib/wallet/google-save-jwt'
import type { WalletPassContent, WalletSettings } from '@/lib/wallet/types'

/**
 * Google Wallet loyalty class + object.
 *
 * Renders the same `WalletPassContent` that Apple renders, so the two cards can
 * never describe different programs. The class is per-business (branding, program
 * name) and the object is per-customer (balance, locations, messages); both are
 * sent inline so a first-time save works without a pre-provisioning call against
 * the Wallet API — a step that would otherwise fail silently for every merchant
 * who has not been through Google's issuer review.
 *
 * Proximity on Google works through `locations` on the *object*: Wallet surfaces
 * the pass when the device is near one of them. Google's practical limit is 10,
 * matching Apple's, so the same nearest-first ordering serves both.
 */

const GOOGLE_MAX_LOCATIONS = 10

export type GooglePassOptions = {
  settings?: Pick<WalletSettings, 'googleWalletSuggestions' | 'dynamicPassContent'>
}

/**
 * The loyalty object, exported for the sync path and for tests.
 *
 * `PATCH`ing this exact shape is what keeps an installed Google card in step
 * with the balance, which the original integration did not do — a card that
 * showed the balance at install time and never again.
 */
export function buildGoogleLoyaltyObject(
  content: WalletPassContent,
  options: GooglePassOptions = {}
): Record<string, unknown> {
  const issuerId = env.google.issuerId ?? 'issuer'
  const classId = googleClassId(content.businessId, issuerId)
  const suggestionsOn = options.settings?.googleWalletSuggestions ?? true
  const dynamic = options.settings?.dynamicPassContent ?? true

  const locations = suggestionsOn
    ? content.relevantLocations.slice(0, GOOGLE_MAX_LOCATIONS)
    : []

  return {
    id: googleObjectId(content.customerId, issuerId),
    classId,
    state: 'ACTIVE',
    accountName: content.member.name || content.labels.memberFallback,
    accountId: content.customerId,
    loyaltyPoints: {
      label: capitalize(content.progress.unitPlural),
      balance: { string: String(content.progress.balance) },
    },
    ...(content.progress.goal
      ? {
          secondaryLoyaltyPoints: {
            label: content.labels.goal,
            balance: { string: String(content.progress.goal) },
          },
        }
      : {}),
    barcode: {
      type: 'QR_CODE',
      value: content.serialNumber,
      alternateText: content.serialNumber.slice(0, 8).toUpperCase(),
    },
    ...(content.member.tierName
      ? { accountIdLabel: content.member.tierName }
      : {}),
    textModulesData: [
      ...(content.progress.rewardName
        ? [
            {
              id: 'reward',
              header: content.progress.rewardReady
                ? content.labels.readyToClaim
                : content.labels.nextReward,
              body: content.progress.rewardName,
            },
          ]
        : []),
      ...(dynamic
        ? content.offers.slice(0, 3).map((offer, index) => ({
            id: `offer-${index}`,
            header: offer.title,
            body: offer.description ?? '',
          }))
        : []),
      ...(content.referralCode
        ? [
            {
              id: 'referral',
              header: content.labels.referral,
              body: content.labels.referralBodyShort,
            },
          ]
        : []),
    ],
    linksModuleData: {
      uris: [
        { uri: content.links.cardUrl, description: content.labels.manageCard, id: 'card' },
      ],
    },
    // Geofenced relevance. Google matches on coordinates alone — there is no
    // per-location radius in its schema — so the merchant's radius governs when
    // *we* send a notification, and this governs when Google surfaces the card.
    ...(locations.length > 0
      ? {
          locations: locations.map((location) => ({
            kind: 'walletobjects#latLongPoint',
            latitude: location.coordinates.lat,
            longitude: location.coordinates.lng,
          })),
        }
      : {}),
    ...(content.expiresAt
      ? { validTimeInterval: { end: { date: content.expiresAt } } }
      : {}),
  }
}

export function buildGoogleLoyaltyClass(content: WalletPassContent): Record<string, unknown> {
  const issuerId = env.google.issuerId ?? 'issuer'
  const hexBackground = /^#[0-9a-fA-F]{6}$/.test(content.branding.backgroundColor)
    ? content.branding.backgroundColor
    : '#111827'

  return {
    id: googleClassId(content.businessId, issuerId),
    issuerName: content.organizationName,
    programName: content.programName,
    reviewStatus: 'UNDER_REVIEW',
    hexBackgroundColor: hexBackground,
    /*
     * `language` is the business's, not `en`. Google reads these tags to decide
     * what a screen reader announces and which string a device in another
     * language falls back to — declaring Spanish copy as English makes the
     * accessibility label wrong on every Android phone that installs the card.
     */
    ...(content.branding.logoUrl
      ? {
          programLogo: {
            sourceUri: { uri: content.branding.logoUrl },
            contentDescription: {
              defaultValue: {
                language: content.labels.language,
                value: content.labels.logoAlt,
              },
            },
          },
        }
      : {}),
    ...(content.branding.heroImageUrl
      ? {
          heroImage: {
            sourceUri: { uri: content.branding.heroImageUrl },
            contentDescription: {
              defaultValue: { language: content.labels.language, value: content.programName },
            },
          },
        }
      : {}),
    localizedIssuerName: {
      defaultValue: { language: content.labels.language, value: content.organizationName },
    },
    linksModuleData: {
      uris: [
        { uri: content.links.cardUrl, description: content.labels.viewCard, id: 'card' },
      ],
    },
  }
}

/** The "Save to Google Wallet" JWT for a first install. */
export function buildGoogleWalletSaveJwt(
  content: WalletPassContent,
  options: GooglePassOptions = {}
): string {
  return createGoogleWalletSaveJwt({
    loyaltyClasses: [buildGoogleLoyaltyClass(content)],
    loyaltyObjects: [buildGoogleLoyaltyObject(content, options)],
  })
}

/**
 * Google ids must be `<issuerId>.<suffix>` with an alphanumeric suffix, and are
 * immutable once created — so both id builders live here and nowhere else. A
 * second implementation that formatted a hyphen differently would create a
 * duplicate class per merchant, which is not reversible.
 */
export function googleClassId(businessId: string, issuerId: string): string {
  return `${issuerId}.${businessId.replace(/-/g, '')}`
}

export function googleObjectId(customerId: string, issuerId: string): string {
  return `${issuerId}.${customerId.replace(/-/g, '')}`
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}
