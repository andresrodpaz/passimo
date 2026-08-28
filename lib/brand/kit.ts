/**
 * The merchant's brand kit.
 *
 * One record of who the business is — name, logo, colours, description, contact
 * details, social profiles — read by everything that renders on a customer's
 * behalf: the wallet card, the public join page, the browser card, transactional
 * email, campaigns and notifications.
 *
 * It exists because that identity was previously stored in two places that
 * disagreed. `businesses.primary_color` was the brand, but `wallet_settings`
 * also carried `brand_color` and was consulted *first* when building a pass, so
 * a merchant who set a colour on the Settings screen and later opened the wallet
 * screen had two answers to one question with the less discoverable one winning.
 * Migration 21 made `businesses` authoritative and this module the only reader.
 *
 * Isomorphic: no `server-only`. The parsing and defaulting rules run in the
 * designer's live preview as well as on the server, so a merchant is never shown
 * a colour the pass builder would resolve differently.
 */

import { meetsContrastAA, normalizeHex, readableTextOn } from '@/lib/wallet/card-design'

export type BrandSocials = {
  instagram: string | null
  facebook: string | null
  tiktok: string | null
}

export type BrandContact = {
  email: string | null
  phone: string | null
  website: string | null
  address: string | null
  city: string | null
  postalCode: string | null
  country: string | null
}

export type BrandKit = {
  businessId: string
  name: string
  description: string | null

  logoUrl: string | null
  iconUrl: string | null
  coverUrl: string | null

  primaryColor: string
  secondaryColor: string | null
  accentColor: string
  textColor: string

  /** Typography for merchant-facing surfaces. The card has its own setting. */
  font: string

  contact: BrandContact
  socials: BrandSocials
}

/**
 * The brand a business has before anyone touches anything.
 *
 * Neutral rather than colourful on purpose: a default that looks like a design
 * decision stops merchants from making their own, and every café ending up with
 * the same teal card is worse for them than a plain dark one they will replace.
 */
export const DEFAULT_BRAND = {
  primaryColor: '#111827',
  accentColor: '#f59e0b',
  textColor: '#ffffff',
  font: 'Inter',
} as const

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Normalises a social handle to a bare username.
 *
 * Merchants paste whatever their phone gives them — a full URL, an `@handle`, or
 * the handle alone — and all three have to end up as one value, because the card
 * back and the public page build their own links from it. Storing a URL that
 * came from a paste means one merchant's link is `instagram.com/x` and another's
 * is `https://www.instagram.com/x/?hl=es`.
 */
export function normalizeHandle(value: unknown): string | null {
  const raw = text(value)
  if (!raw) return null

  const withoutUrl = raw
    .replace(/^https?:\/\//i, '')
    .replace(/^(?:www\.)?(?:instagram|facebook|tiktok)\.com\//i, '')
  const handle = withoutUrl.replace(/^@/, '').split(/[/?#]/)[0]?.trim() ?? ''

  if (!handle) return null
  // Anything with whitespace or an illegal character is a paste that went wrong;
  // storing it would render a broken link on a customer's card.
  return /^[A-Za-z0-9._-]{1,64}$/.test(handle) ? handle : null
}

/** Maps a `businesses` row into the brand kit. */
export function mapBrandKit(row: Record<string, unknown>): BrandKit {
  const primaryColor = normalizeHex(row.primary_color) ?? DEFAULT_BRAND.primaryColor
  const storedText = normalizeHex(row.text_color)

  return {
    businessId: String(row.id ?? ''),
    name: text(row.name) ?? '',
    description: text(row.description),

    logoUrl: text(row.logo_url),
    iconUrl: text(row.icon_url),
    coverUrl: text(row.cover_url),

    primaryColor,
    secondaryColor: normalizeHex(row.secondary_color),
    accentColor: normalizeHex(row.accent_color) ?? DEFAULT_BRAND.accentColor,
    // A stored text colour is kept as-is here — the card resolver is where
    // legibility against a specific background is enforced, because only it
    // knows what the text will actually sit on.
    textColor: storedText ?? readableTextOn(primaryColor),

    font: text(row.font) ?? DEFAULT_BRAND.font,

    contact: {
      email: text(row.support_email),
      phone: text(row.phone),
      website: text(row.website),
      address: text(row.address),
      city: text(row.city),
      postalCode: text(row.postal_code),
      country: text(row.country),
    },

    socials: {
      instagram: normalizeHandle(row.instagram),
      facebook: normalizeHandle(row.facebook),
      tiktok: normalizeHandle(row.tiktok),
    },
  }
}

/** The columns a brand kit read needs. Kept here so callers cannot drift. */
export const BRAND_KIT_COLUMNS =
  'id, name, description, logo_url, icon_url, cover_url, primary_color, secondary_color, ' +
  'accent_color, text_color, font, support_email, phone, website, address, city, ' +
  'postal_code, country, instagram, facebook, tiktok'

/** The API-facing patch shape. Every field optional; only what is sent changes. */
export type BrandKitPatch = {
  name?: string
  description?: string | null
  logoUrl?: string | null
  iconUrl?: string | null
  coverUrl?: string | null
  primaryColor?: string | null
  secondaryColor?: string | null
  accentColor?: string | null
  textColor?: string | null
  font?: string | null
  supportEmail?: string | null
  phone?: string | null
  website?: string | null
  address?: string | null
  city?: string | null
  postalCode?: string | null
  country?: string | null
  instagram?: string | null
  facebook?: string | null
  tiktok?: string | null
}

export const BRAND_KIT_FIELD_COLUMNS: Record<keyof BrandKitPatch, string> = {
  name: 'name',
  description: 'description',
  logoUrl: 'logo_url',
  iconUrl: 'icon_url',
  coverUrl: 'cover_url',
  primaryColor: 'primary_color',
  secondaryColor: 'secondary_color',
  accentColor: 'accent_color',
  textColor: 'text_color',
  font: 'font',
  supportEmail: 'support_email',
  phone: 'phone',
  website: 'website',
  address: 'address',
  city: 'city',
  postalCode: 'postal_code',
  country: 'country',
  instagram: 'instagram',
  facebook: 'facebook',
  tiktok: 'tiktok',
}

/** Colour fields, which are validated rather than trusted. */
const COLOR_FIELDS = new Set<keyof BrandKitPatch>([
  'primaryColor',
  'secondaryColor',
  'accentColor',
  'textColor',
])

const HANDLE_FIELDS = new Set<keyof BrandKitPatch>(['instagram', 'facebook', 'tiktok'])

/**
 * Turns a patch into the row update, dropping anything invalid.
 *
 * A rejected colour is *dropped*, not defaulted: a merchant who sends a broken
 * hex keeps the colour they had rather than silently reverting to platform
 * black, which would look like the product losing their brand.
 */
export function brandKitUpdate(patch: BrandKitPatch): Record<string, unknown> {
  const update: Record<string, unknown> = {}

  for (const [field, column] of Object.entries(BRAND_KIT_FIELD_COLUMNS) as Array<
    [keyof BrandKitPatch, string]
  >) {
    const value = patch[field]
    if (value === undefined) continue

    if (value === null) {
      update[column] = null
      continue
    }

    if (COLOR_FIELDS.has(field)) {
      const hex = normalizeHex(value)
      if (hex) update[column] = hex
      continue
    }

    if (HANDLE_FIELDS.has(field)) {
      update[column] = normalizeHandle(value)
      continue
    }

    const trimmed = String(value).trim()
    update[column] = trimmed.length > 0 ? trimmed : null
  }

  return update
}

/**
 * The colour triple a customer-facing surface paints with.
 *
 * The join page, the browser card and the email shell all render a merchant's
 * brand, and each one used to inline its own `?? '#111827'` / `?? '#f59e0b'` /
 * `?? '#ffffff'` chain against the raw row. Two problems with that, both of
 * which reached customers:
 *
 *   * four copies of the defaults meant changing the platform's fallback colour
 *     was a four-file edit nobody would remember to finish;
 *   * more seriously, they used the *stored* `text_color` verbatim, while
 *     `resolveCardDesign` only honours a stored foreground that actually passes
 *     WCAG AA against the background. A merchant who set white text and later
 *     picked a cream background therefore got a legible wallet card and an
 *     illegible join page from the same two columns.
 *
 * This applies the card's rule to every other surface: a stored text colour is
 * kept when it is readable and recomputed when it is not.
 *
 * Takes the loose shape rather than a `BrandKit` so a client component holding
 * a JSON row can call it without reassembling a kit.
 */
export function resolveBrandPalette(input: {
  primaryColor?: string | null
  accentColor?: string | null
  textColor?: string | null
}): { background: string; accent: string; text: string } {
  const background = normalizeHex(input.primaryColor) ?? DEFAULT_BRAND.primaryColor
  const accent = normalizeHex(input.accentColor) ?? DEFAULT_BRAND.accentColor
  const stored = normalizeHex(input.textColor)

  return {
    background,
    accent,
    text: stored && meetsContrastAA(stored, background) ? stored : readableTextOn(background),
  }
}

/** A public profile URL for a stored handle. */
export function socialUrl(network: keyof BrandSocials, handle: string | null): string | null {
  if (!handle) return null
  switch (network) {
    case 'instagram':
      return `https://instagram.com/${handle}`
    case 'facebook':
      return `https://facebook.com/${handle}`
    case 'tiktok':
      return `https://tiktok.com/@${handle}`
    default:
      return null
  }
}

/** The brand kit used by previews before a business exists (onboarding, landing). */
export function placeholderBrandKit(name: string): BrandKit {
  return {
    businessId: '',
    name,
    description: null,
    logoUrl: null,
    iconUrl: null,
    coverUrl: null,
    primaryColor: DEFAULT_BRAND.primaryColor,
    secondaryColor: null,
    accentColor: DEFAULT_BRAND.accentColor,
    textColor: DEFAULT_BRAND.textColor,
    font: DEFAULT_BRAND.font,
    contact: {
      email: null,
      phone: null,
      website: null,
      address: null,
      city: null,
      postalCode: null,
      country: null,
    },
    socials: { instagram: null, facebook: null, tiktok: null },
  }
}
