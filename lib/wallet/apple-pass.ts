import 'server-only'
import { PKPass } from 'passkit-generator'
import { env } from '@/lib/env'
import { notConfigured } from '@/lib/errors'
import { fillLabel, formatPassDate } from '@/lib/wallet/pass-format'
import type { WalletPassContent, WalletSettings } from '@/lib/wallet/types'

/**
 * Apple Wallet pass generation.
 *
 * The card is the customer-facing product: it lives on their lock screen and is
 * the thing that actually brings them back. So it carries real progress, the next
 * reward, tier status and — the reason proximity exists — the store locations
 * that make it surface when the customer is nearby.
 *
 * Content comes in as `WalletPassContent`, the provider-agnostic shape shared
 * with Google, so this file is only concerned with how Apple expresses it:
 * `pass.json` field groups, RGB colour strings, the ten-location cap, and the
 * `relevantText` that becomes the lock-screen line.
 */

/** 29×29 transparent PNG. Wallet rejects a pass without an icon. */
const FALLBACK_ICON = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAB0AAAAdCAYAAABWk2cPAAAAJ0lEQVR42u3BAQ0AAADCoPdPbQ8HFAAAAAAAAAAAAAAAAAAAAAB8GxwAAAHl9sHAAAAAAElFTkSuQmCC',
  'base64'
)

/**
 * Apple accepts at most 10 locations per pass and silently ignores the rest.
 * Callers order them nearest-first so the cap is invisible to the customer.
 */
const APPLE_MAX_LOCATIONS = 10

function hexToRgb(hex: string, fallback = 'rgb(17,24,39)'): string {
  const value = hex?.replace('#', '') ?? ''
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return fallback
  return `rgb(${parseInt(value.slice(0, 2), 16)},${parseInt(value.slice(2, 4), 16)},${parseInt(
    value.slice(4, 6),
    16
  )})`
}

export function appleWalletConfigured(): boolean {
  return env.apple.isConfigured
}

async function fetchImage(url: string | null | undefined): Promise<Buffer | null> {
  if (!url) return null
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 4000)
    const response = await fetch(url, { signal: controller.signal })
    clearTimeout(timer)
    if (!response.ok) return null
    const buffer = Buffer.from(await response.arrayBuffer())
    // Guard against a merchant pointing at a 20 MB image.
    return buffer.byteLength <= 512_000 ? buffer : null
  } catch {
    return null
  }
}

export type ApplePassOptions = {
  /**
   * Merchant settings, used only for the proximity switches. Omitted means
   * "embed everything the content carries", which is what a preview wants.
   */
  settings?: Pick<WalletSettings, 'appleLockScreenSuggestions' | 'beaconsEnabled'>
}

/**
 * Builds `pass.json` for a loyalty store card.
 *
 * Exported separately from the signing step so the dashboard preview and the unit
 * tests can assert on the exact structure Apple will receive without needing
 * certificates — which is the only way this code path is verifiable at all in a
 * repository that ships without Apple credentials.
 */
export function buildApplePassJson(
  content: WalletPassContent,
  options: ApplePassOptions = {}
): Record<string, unknown> {
  const passTypeId = env.apple.passTypeId
  const teamId = env.apple.teamId

  const { progress, member, branding, links, labels } = content
  const progressLabel =
    progress.goal && progress.goal > 0
      ? `${progress.balance} / ${progress.goal}`
      : `${progress.balance}`

  const remaining = progress.remaining
  const suggestionsOn = options.settings?.appleLockScreenSuggestions ?? true
  const locations = suggestionsOn ? content.relevantLocations.slice(0, APPLE_MAX_LOCATIONS) : []

  /*
   * `maxDistance` is a single pass-level value in Apple's format, while our
   * merchants configure a radius per site. The widest configured radius is the
   * only safe choice: a smaller value would silently suppress relevance for the
   * site the merchant deliberately widened.
   */
  const maxDistance = locations.length
    ? Math.max(...locations.map((location) => location.radiusMeters))
    : null

  return {
    formatVersion: 1,
    passTypeIdentifier: passTypeId,
    serialNumber: content.serialNumber,
    teamIdentifier: teamId,
    organizationName: content.organizationName,
    description: content.description,
    logoText: content.organizationName,
    backgroundColor: hexToRgb(branding.backgroundColor),
    foregroundColor: hexToRgb(branding.foregroundColor, 'rgb(255,255,255)'),
    labelColor: hexToRgb(branding.labelColor, 'rgb(255,255,255)'),
    sharingProhibited: false,
    webServiceURL: links.webServiceUrl,
    authenticationToken: content.authenticationToken,
    ...(content.expiresAt ? { expirationDate: content.expiresAt } : {}),
    storeCard: {
      headerFields: member.tierName
        ? [
            {
              key: 'tier',
              label: member.isVip ? labels.vip : labels.tier,
              value: member.tierName,
            },
          ]
        : [],
      primaryFields: [
        {
          key: 'balance',
          label: progress.unitPlural.toUpperCase(),
          value: progressLabel,
          changeMessage: labels.balanceChange,
        },
      ],
      secondaryFields: [
        {
          key: 'reward',
          label: progress.rewardReady ? labels.readyToClaim : labels.nextReward,
          value: progress.rewardName ?? labels.rewardFallback,
        },
        ...(remaining != null && remaining > 0
          ? [
              {
                key: 'remaining',
                label: labels.toGo,
                value: `${remaining} ${
                  remaining === 1 ? progress.unitSingular : progress.unitPlural
                }`,
              },
            ]
          : []),
      ],
      auxiliaryFields: [
        ...(member.name ? [{ key: 'member', label: labels.member, value: member.name }] : []),
        ...(member.since ? [{ key: 'since', label: labels.since, value: member.since }] : []),
      ],
      backFields: [
        {
          key: 'how',
          label: labels.howItWorks,
          value: labels.howItWorksBody,
        },
        // Offers are what makes the back of the card worth opening twice.
        ...content.offers.slice(0, 4).map((offer, index) => ({
          key: `offer-${index}`,
          label: offer.expiresAt
            ? fillLabel(labels.offerUntil, {
                date: formatPassDate(offer.expiresAt, labels.localeTag),
              })
            : labels.offer,
          value: offer.description ? `${offer.title} — ${offer.description}` : offer.title,
        })),
        ...(locations.length > 0
          ? [
              {
                key: 'where',
                label: labels.where,
                value: locations.map((location) => location.name).join('\n'),
              },
            ]
          : []),
        ...(content.referralCode
          ? [
              {
                key: 'referral',
                label: labels.referral,
                value: labels.referralBody,
              },
            ]
          : []),
        ...(progress.expiresAt
          ? [
              {
                key: 'expiry',
                label: labels.pointsExpire,
                value: formatPassDate(progress.expiresAt, labels.localeTag),
              },
            ]
          : []),
        ...(links.websiteUrl
          ? [{ key: 'web', label: labels.website, value: links.websiteUrl }]
          : []),
        ...(links.supportEmail
          ? [{ key: 'support', label: labels.contact, value: links.supportEmail }]
          : []),
        { key: 'card', label: labels.manageCard, value: links.cardUrl },
      ],
    },
    barcodes: [
      {
        // The QR encodes the customer id so any scanner — ours or the merchant's
        // phone camera — resolves to the right customer.
        format: 'PKBarcodeFormatQR',
        message: content.serialNumber,
        messageEncoding: 'iso-8859-1',
        altText: content.serialNumber.slice(0, 8).toUpperCase(),
      },
      {
        format: 'PKBarcodeFormatPDF417',
        message: content.serialNumber,
        messageEncoding: 'iso-8859-1',
      },
    ],
    ...(locations.length > 0
      ? {
          locations: locations.map((location) => ({
            latitude: location.coordinates.lat,
            longitude: location.coordinates.lng,
            relevantText: location.relevantText,
          })),
          ...(maxDistance ? { maxDistance } : {}),
        }
      : {}),
    ...(options.settings?.beaconsEnabled !== false && locations.some((l) => l.beacon)
      ? {
          beacons: locations
            .filter((location) => location.beacon)
            .map((location) => ({
              proximityUUID: location.beacon!.uuid,
              ...(location.beacon!.major !== null ? { major: location.beacon!.major } : {}),
              ...(location.beacon!.minor !== null ? { minor: location.beacon!.minor } : {}),
              relevantText: location.relevantText,
            })),
        }
      : {}),
  }
}

export async function buildLoyaltyPkPass(
  content: WalletPassContent,
  options: ApplePassOptions = {}
): Promise<Buffer> {
  const { teamId, passTypeId, wwdrCert, signerCert, signerKey, signerKeyPassphrase } = {
    teamId: env.apple.teamId,
    passTypeId: env.apple.passTypeId,
    wwdrCert: env.apple.wwdrCert,
    signerCert: env.apple.signerCert,
    signerKey: env.apple.signerKey,
    signerKeyPassphrase: env.apple.signerKeyPassphrase,
  }

  if (!teamId || !passTypeId || !wwdrCert || !signerCert || !signerKey) {
    throw notConfigured('Apple Wallet')
  }

  const passJson = buildApplePassJson(content, options)

  const [logo, hero] = await Promise.all([
    fetchImage(content.branding.logoUrl),
    fetchImage(content.branding.heroImageUrl),
  ])

  const buffers: Record<string, Buffer> = {
    'pass.json': Buffer.from(JSON.stringify(passJson)),
    'icon.png': logo ?? FALLBACK_ICON,
    'icon@2x.png': logo ?? FALLBACK_ICON,
    'icon@3x.png': logo ?? FALLBACK_ICON,
  }
  if (logo) {
    buffers['logo.png'] = logo
    buffers['logo@2x.png'] = logo
  }
  if (hero) {
    buffers['strip.png'] = hero
    buffers['strip@2x.png'] = hero
  }

  const pass = new PKPass(
    buffers,
    {
      wwdr: wwdrCert,
      signerCert,
      signerKey,
      signerKeyPassphrase: signerKeyPassphrase ?? undefined,
    },
    {}
  )

  const output = pass.getAsBuffer()
  return output instanceof Promise ? await output : output
}
