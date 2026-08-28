/**
 * The loyalty card's design model.
 *
 * Passimo's product is a card that lives in a customer's pocket, so how that
 * card looks is not a settings screen — it is the thing being sold. This module
 * owns that decision and nothing else.
 *
 * Three layers, deliberately kept apart, because merchants think about them
 * separately and mixing them is what makes loyalty dashboards unusable:
 *
 *   BRAND KIT   who the business is        `lib/brand/kit.ts`
 *   CARD DESIGN how the card looks         this file
 *   BEHAVIOUR   when the card notifies     `lib/wallet/settings.ts`
 *
 * Isomorphic on purpose — no `server-only`. The designer's live preview and the
 * real pass builder resolve the same design through the same function, so what
 * a merchant sees while dragging a colour picker is what their customer gets.
 * A preview that renders through a second, parallel implementation is a preview
 * that lies the first time the two drift.
 */

import type { BrandKit } from '@/lib/brand/kit'

// -----------------------------------------------------------------------------
// The model
// -----------------------------------------------------------------------------

export const CARD_STYLES = ['solid', 'gradient', 'duotone', 'frosted'] as const
export type CardStyle = (typeof CARD_STYLES)[number]

/**
 * How loyalty progress is drawn.
 *
 * `auto` follows the program, which is right almost always: a stamp card gets
 * stamps, a points program gets a bar. The override exists because "almost" is
 * doing real work — a stamp program with a goal of 40 renders as forty dots the
 * size of a pinhead, and the merchant is the one who can see that.
 */
export const PROGRESS_STYLES = ['auto', 'bar', 'stamps', 'points', 'none'] as const
export type ProgressStyle = (typeof PROGRESS_STYLES)[number]

export const TYPOGRAPHIES = ['system', 'rounded', 'serif', 'mono'] as const
export type Typography = (typeof TYPOGRAPHIES)[number]

/** What the merchant has chosen. Every colour null means "inherit the brand". */
export type CardDesign = {
  template: string
  cardStyle: CardStyle
  progressStyle: ProgressStyle
  typography: Typography

  backgroundColor: string | null
  foregroundColor: string | null
  accentColor: string | null

  logoUrl: string | null
  heroImageUrl: string | null

  showMemberName: boolean
  showMemberSince: boolean
  showTier: boolean
  showLocation: boolean
  showReward: boolean
  showProgress: boolean

  headline: string | null
  customMessage: string | null
  termsText: string | null
}

export const DEFAULT_CARD_DESIGN: CardDesign = {
  template: 'minimal',
  cardStyle: 'solid',
  progressStyle: 'auto',
  typography: 'system',
  backgroundColor: null,
  foregroundColor: null,
  accentColor: null,
  logoUrl: null,
  heroImageUrl: null,
  showMemberName: true,
  showMemberSince: true,
  showTier: true,
  showLocation: true,
  showReward: true,
  showProgress: true,
  headline: null,
  customMessage: null,
  termsText: null,
}

/**
 * A design with every inheritance resolved — no nulls, safe to render.
 *
 * This is what both the preview and the pass builder consume. Producing it is
 * the only place brand-kit fallback logic is allowed to live.
 */
export type ResolvedCardDesign = Omit<
  CardDesign,
  'backgroundColor' | 'foregroundColor' | 'accentColor' | 'logoUrl'
> & {
  backgroundColor: string
  foregroundColor: string
  accentColor: string
  /**
   * The brand's second colour, when it has one.
   *
   * Null for most businesses. It is the far stop of a `gradient` card, which is
   * the only thing it drives — and the reason it now drives anything at all: the
   * Brand panel offered it beside three colours that all rendered, so a merchant
   * could set it, save it, and watch nothing happen. A field that does nothing is
   * worse than an absent one, because it makes the rest of the screen suspect.
   */
  secondaryColor: string | null
  logoUrl: string | null
  /** Resolved from `progressStyle: 'auto'` against the program. */
  effectiveProgress: Exclude<ProgressStyle, 'auto'>
}

// -----------------------------------------------------------------------------
// Colour helpers
// -----------------------------------------------------------------------------

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

/** True for a value safe to drop into a `background-color`. */
export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX.test(value.trim())
}

/** Normalises `#abc` to `#aabbcc`; returns null for anything unusable. */
export function normalizeHex(value: unknown): string | null {
  if (!isHexColor(value)) return null
  const hex = (value as string).trim().toLowerCase()
  if (hex.length === 4) {
    return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
  }
  return hex
}

function channels(hex: string): [number, number, number] {
  const normal = normalizeHex(hex) ?? '#000000'
  return [
    parseInt(normal.slice(1, 3), 16),
    parseInt(normal.slice(3, 5), 16),
    parseInt(normal.slice(5, 7), 16),
  ]
}

/**
 * Relative luminance, per WCAG 2.1.
 *
 * Used to decide whether text on a merchant's colour should be black or white.
 * A merchant who picks a pale yellow background must not end up with white text
 * on their customer's card — that is not a styling nitpick, it is a card nobody
 * can read at a counter.
 */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = channels(hex).map((value) => {
    const channel = value / 255
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio between two colours, 1–21. */
export function contrastRatio(a: string, b: string): number {
  const light = relativeLuminance(a)
  const dark = relativeLuminance(b)
  const [hi, lo] = light > dark ? [light, dark] : [dark, light]
  return (hi + 0.05) / (lo + 0.05)
}

/** Black or white, whichever is legible on `background`. */
export function readableTextOn(background: string): string {
  return contrastRatio(background, '#ffffff') >= contrastRatio(background, '#000000')
    ? '#ffffff'
    : '#000000'
}

/**
 * Whether a foreground passes WCAG AA for the card's body text.
 *
 * 4.5:1 rather than 3:1 because the balance and reward lines are body copy read
 * at arm's length in a shop, not display type.
 */
export function meetsContrastAA(foreground: string, background: string): boolean {
  return contrastRatio(foreground, background) >= 4.5
}

/** Lightens or darkens toward white/black by `amount` (0–1). */
export function shift(hex: string, amount: number): string {
  const [r, g, b] = channels(hex)
  const target = amount >= 0 ? 255 : 0
  const ratio = Math.abs(amount)
  const mix = (value: number) => Math.round(value + (target - value) * ratio)
  return `#${[mix(r), mix(g), mix(b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

/**
 * The CSS background for a card style.
 *
 * Returned as a single `background` value so the preview and any future
 * server-side raster share one definition of what "gradient" means.
 */
export function cardBackground(design: {
  cardStyle: CardStyle
  backgroundColor: string
  accentColor: string
  /** The brand's second colour. Only `gradient` uses it. */
  secondaryColor?: string | null
}): string {
  const { cardStyle, backgroundColor, accentColor } = design
  const secondary = normalizeHex(design.secondaryColor)
  switch (cardStyle) {
    case 'gradient':
      /*
       * A brand with a second colour gets a gradient between its two colours,
       * which is what a merchant means by picking one. Without it the gradient is
       * derived from the single background via `shift`, which is a good default
       * and was previously the only behaviour.
       *
       * `duotone` deliberately keeps using the *accent* as its second tone: it is
       * a hard split rather than a blend, and the accent is the colour chosen to
       * stand against the background.
       */
      if (secondary) {
        return `linear-gradient(145deg, ${backgroundColor} 0%, ${secondary} 100%)`
      }
      return `linear-gradient(145deg, ${shift(backgroundColor, 0.12)} 0%, ${backgroundColor} 55%, ${shift(backgroundColor, -0.25)} 100%)`
    case 'duotone':
      return `linear-gradient(135deg, ${backgroundColor} 0%, ${backgroundColor} 58%, ${accentColor} 58%, ${accentColor} 100%)`
    case 'frosted':
      return `linear-gradient(160deg, ${shift(backgroundColor, 0.2)} 0%, ${backgroundColor} 100%)`
    case 'solid':
    default:
      return backgroundColor
  }
}

/** The font stack for a typography choice. */
export function fontStack(typography: Typography): string {
  switch (typography) {
    case 'rounded':
      return "ui-rounded, 'SF Pro Rounded', 'Nunito', 'Quicksand', system-ui, sans-serif"
    case 'serif':
      return "'Iowan Old Style', 'Palatino Linotype', Georgia, 'Times New Roman', serif"
    case 'mono':
      return "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace"
    case 'system':
    default:
      return "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
  }
}

// -----------------------------------------------------------------------------
// Resolution
// -----------------------------------------------------------------------------

export type ProgramShape = {
  /** Null for an open-ended points program. */
  goal: number | null
  /** True when the program counts discrete visits rather than spend. */
  isStampProgram: boolean
}

/**
 * Stamps stop being readable somewhere around here.
 *
 * Twelve fits two rows of six on the narrowest card without the dots dropping
 * below a touch-sized target. Past that `auto` switches to a bar, which conveys
 * the same information at any goal.
 */
export const MAX_RENDERABLE_STAMPS = 12

export function effectiveProgressStyle(
  style: ProgressStyle,
  program: ProgramShape
): Exclude<ProgressStyle, 'auto'> {
  if (style !== 'auto') return style
  if (program.goal === null || program.goal <= 0) return 'points'
  if (program.isStampProgram && program.goal <= MAX_RENDERABLE_STAMPS) return 'stamps'
  return 'bar'
}

/**
 * Collapses design + brand kit into something renderable.
 *
 * The fallback chain is deliberately short and always ends somewhere valid:
 * design → brand kit → a legible default. The foreground has one extra rule —
 * if neither the design nor the brand specifies one, it is *computed* from the
 * background rather than defaulting to white, so a merchant who picks a cream
 * background gets dark text without knowing what contrast means.
 */
export function resolveCardDesign(
  design: CardDesign,
  brand: Pick<BrandKit, 'primaryColor' | 'accentColor' | 'textColor' | 'logoUrl'> & {
    /** Optional so a caller holding a partial brand still type-checks. */
    secondaryColor?: string | null
  },
  program: ProgramShape = { goal: null, isStampProgram: false }
): ResolvedCardDesign {
  const backgroundColor =
    normalizeHex(design.backgroundColor) ?? normalizeHex(brand.primaryColor) ?? '#111827'

  const accentColor =
    normalizeHex(design.accentColor) ?? normalizeHex(brand.accentColor) ?? shift(backgroundColor, 0.4)

  /*
   * The second brand colour only applies when the merchant has explicitly
   * overridden the card's background. If they have, the gradient runs between
   * *their* background and their secondary — but if the card's background came
   * from a template while the brand's secondary came from the Brand panel, the
   * two were never chosen together and blending them is a guess. Honoured only
   * on `gradient`, which is the only style that reads it.
   */
  const secondaryColor = design.cardStyle === 'gradient' ? normalizeHex(brand.secondaryColor) : null

  const chosenForeground =
    normalizeHex(design.foregroundColor) ?? normalizeHex(brand.textColor)

  /*
   * A stored foreground is honoured only if it can actually be read. Merchants
   * change their background far more often than their text colour, so the pair
   * that was legible in March stops being legible in April without anyone
   * touching the text setting — and the result ships to every customer's phone.
   *
   * With a gradient the text crosses two colours, so it has to clear AA against
   * *both* stops. Checking only the background is how a card ends up readable at
   * the top and invisible at the bottom.
   */
  const stops = secondaryColor ? [backgroundColor, secondaryColor] : [backgroundColor]
  const legibleOnEveryStop = (candidate: string) =>
    stops.every((stop) => meetsContrastAA(candidate, stop))

  const foregroundColor = chosenForeground && legibleOnEveryStop(chosenForeground)
    ? chosenForeground
    : legibleOnEveryStop('#ffffff')
      ? '#ffffff'
      : legibleOnEveryStop('#000000')
        ? '#000000'
        : // Neither pure colour clears both stops — the two brand colours are too
          // close in luminance to sit under one text colour. The background is
          // what carries the balance, so its own best answer wins.
          readableTextOn(backgroundColor)

  return {
    ...design,
    backgroundColor,
    foregroundColor,
    accentColor,
    secondaryColor,
    logoUrl: design.logoUrl ?? brand.logoUrl ?? null,
    effectiveProgress: effectiveProgressStyle(design.progressStyle, program),
  }
}

// -----------------------------------------------------------------------------
// Parsing
// -----------------------------------------------------------------------------

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/** Maps a `wallet_card_designs` row. A missing row is the default design. */
export function mapCardDesign(row: Record<string, unknown> | null): CardDesign {
  if (!row) return { ...DEFAULT_CARD_DESIGN }

  return {
    template: text(row.template) ?? DEFAULT_CARD_DESIGN.template,
    cardStyle: oneOf(row.card_style, CARD_STYLES, DEFAULT_CARD_DESIGN.cardStyle),
    progressStyle: oneOf(row.progress_style, PROGRESS_STYLES, DEFAULT_CARD_DESIGN.progressStyle),
    typography: oneOf(row.typography, TYPOGRAPHIES, DEFAULT_CARD_DESIGN.typography),
    backgroundColor: normalizeHex(row.background_color),
    foregroundColor: normalizeHex(row.foreground_color),
    accentColor: normalizeHex(row.accent_color),
    logoUrl: text(row.logo_url),
    heroImageUrl: text(row.hero_image_url),
    showMemberName: bool(row.show_member_name, true),
    showMemberSince: bool(row.show_member_since, true),
    showTier: bool(row.show_tier, true),
    showLocation: bool(row.show_location, true),
    showReward: bool(row.show_reward, true),
    showProgress: bool(row.show_progress, true),
    headline: text(row.headline),
    customMessage: text(row.custom_message),
    termsText: text(row.terms_text),
  }
}

/** Column names, so the API layer never spells one differently. */
export const CARD_DESIGN_COLUMNS: Record<keyof CardDesign, string> = {
  template: 'template',
  cardStyle: 'card_style',
  progressStyle: 'progress_style',
  typography: 'typography',
  backgroundColor: 'background_color',
  foregroundColor: 'foreground_color',
  accentColor: 'accent_color',
  logoUrl: 'logo_url',
  heroImageUrl: 'hero_image_url',
  showMemberName: 'show_member_name',
  showMemberSince: 'show_member_since',
  showTier: 'show_tier',
  showLocation: 'show_location',
  showReward: 'show_reward',
  showProgress: 'show_progress',
  headline: 'headline',
  customMessage: 'custom_message',
  termsText: 'terms_text',
}
