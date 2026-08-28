import type { TranslationKey } from '@/lib/i18n/dictionaries/en'
import { templateForCategory } from '@/lib/wallet/card-templates'

/**
 * The setup we suggest for each trade.
 *
 * The product argument: a merchant signing up does not know what a good stamp
 * goal is, and asking them is asking the wrong person. They know they run a
 * bakery. Everything below turns that one fact into a complete, defensible
 * loyalty program they can accept in a glance or change in a click — which is
 * the difference between onboarding that feels like configuration and onboarding
 * that feels like the product doing its job.
 *
 * Every merchant-visible string is a *key*, never a sentence. The reward in
 * particular is prefilled into a field the merchant then saves to their program,
 * so it becomes customer-facing content — a Spanish café whose card reads "A
 * free coffee" because we chose the default in English is the mixed-language
 * failure at its most expensive: it is on the customer's phone, not on an admin
 * screen, and no merchant can correct it from the dashboard.
 *
 * Colours and numbers stay literal. A hex value and the number six are the same
 * in every language.
 */

export type LoyaltyStyle = 'stamps' | 'points'

export type BusinessType = {
  /** Matches `businesses.category` and the signup option list. */
  key: string
  labelKey: TranslationKey
  emoji: string

  /**
   * Stamps or points, and it is not a coin flip.
   *
   * Stamps suit a fixed-price repeat purchase — a coffee, a haircut, a loaf —
   * where "six and the seventh is free" is the whole mental model and a customer
   * can count their own progress. Points suit a variable basket, where a stamp
   * would reward a €4 dessert and a €90 dinner identically and teach the wrong
   * customers to come back.
   */
  loyalty: LoyaltyStyle
  goal: number
  rewardKey: TranslationKey
  /** The first campaign that pays for itself in this trade. */
  campaignKey: TranslationKey

  /** Starting point in the card designer's gallery. */
  cardTemplate: string
  primary: string
  accent: string
}

/**
 * Ordered by how many of them exist, not alphabetically.
 *
 * The first row of a picker is where most merchants stop looking, and cafés,
 * restaurants and bakeries are the bulk of the addressable market for a loyalty
 * card. `other` is deliberately last and deliberately present — a florist who
 * cannot find themselves in a list of nine will close the tab.
 */
export const BUSINESS_TYPES: readonly BusinessType[] = [
  {
    key: 'cafe',
    labelKey: 'auth.signup.categories.cafe',
    emoji: '☕',
    loyalty: 'stamps',
    goal: 6,
    rewardKey: 'onboarding.presets.cafe',
    campaignKey: 'onboarding.program.campaigns.cafe',
    cardTemplate: 'coffee',
    primary: '#3f2212',
    accent: '#e0a458',
  },
  {
    key: 'restaurant',
    labelKey: 'auth.signup.categories.restaurant',
    emoji: '🍽️',
    // Spend-based: a €12 lunch and a €90 dinner are not the same visit.
    loyalty: 'points',
    goal: 500,
    rewardKey: 'onboarding.presets.restaurant',
    campaignKey: 'onboarding.program.campaigns.restaurant',
    cardTemplate: 'restaurant',
    primary: '#4a1129',
    accent: '#f9a8d4',
  },
  {
    key: 'bakery',
    labelKey: 'auth.signup.categories.bakery',
    emoji: '🥐',
    loyalty: 'stamps',
    goal: 6,
    rewardKey: 'onboarding.presets.bakery',
    campaignKey: 'onboarding.program.campaigns.bakery',
    cardTemplate: 'bakery',
    primary: '#b45309',
    accent: '#fed7aa',
  },
  {
    key: 'barber',
    labelKey: 'auth.signup.categories.barber',
    emoji: '💈',
    // Appointment-based, so the count is visits and the goal is longer: a cut
    // every four weeks means eight stamps is most of a year of loyalty.
    loyalty: 'stamps',
    goal: 8,
    rewardKey: 'onboarding.presets.barber',
    campaignKey: 'onboarding.program.campaigns.barber',
    cardTemplate: 'barber',
    primary: '#0c4a6e',
    accent: '#7dd3fc',
  },
  {
    key: 'beauty',
    labelKey: 'auth.signup.categories.beauty',
    emoji: '💅',
    loyalty: 'points',
    goal: 400,
    rewardKey: 'onboarding.presets.beauty',
    campaignKey: 'onboarding.program.campaigns.beauty',
    cardTemplate: 'beauty',
    primary: '#831843',
    accent: '#fbcfe8',
  },
  {
    key: 'gym',
    labelKey: 'auth.signup.categories.gym',
    emoji: '🏋️',
    // Attendance is the metric a gym actually cares about: a member who stops
    // showing up cancels three months later.
    loyalty: 'stamps',
    goal: 10,
    rewardKey: 'onboarding.presets.gym',
    campaignKey: 'onboarding.program.campaigns.gym',
    cardTemplate: 'gym',
    primary: '#0f172a',
    accent: '#a3e635',
  },
  {
    key: 'retail',
    labelKey: 'auth.signup.categories.retail',
    emoji: '🛍️',
    loyalty: 'points',
    goal: 500,
    rewardKey: 'onboarding.presets.retail',
    campaignKey: 'onboarding.program.campaigns.retail',
    cardTemplate: 'retail',
    primary: '#065f46',
    accent: '#6ee7b7',
  },
  {
    key: 'bar',
    labelKey: 'auth.signup.categories.bar',
    emoji: '🍸',
    loyalty: 'stamps',
    goal: 8,
    rewardKey: 'onboarding.presets.bar',
    campaignKey: 'onboarding.program.campaigns.bar',
    cardTemplate: 'restaurant',
    primary: '#1f3d2b',
    accent: '#a7d7a0',
  },
  {
    key: 'pet',
    labelKey: 'auth.signup.categories.pet',
    emoji: '🐾',
    loyalty: 'points',
    goal: 300,
    rewardKey: 'onboarding.presets.pet',
    campaignKey: 'onboarding.program.campaigns.pet',
    cardTemplate: 'retail',
    primary: '#0f172a',
    accent: '#38bdf8',
  },
  {
    key: 'other',
    labelKey: 'auth.signup.categories.other',
    emoji: '✨',
    loyalty: 'stamps',
    goal: 8,
    rewardKey: 'onboarding.presets.other',
    campaignKey: 'onboarding.program.campaigns.other',
    cardTemplate: 'minimal',
    primary: '#0f172a',
    accent: '#38bdf8',
  },
]

const BY_KEY = new Map(BUSINESS_TYPES.map((type) => [type.key, type]))

/** The `other` profile, which is also the fallback for anything unrecognised. */
export const DEFAULT_BUSINESS_TYPE = BY_KEY.get('other')!

export function findBusinessType(category: string | null | undefined): BusinessType {
  return BY_KEY.get((category ?? '').toLowerCase()) ?? DEFAULT_BUSINESS_TYPE
}

/**
 * The unit a balance is counted in, for this trade.
 *
 * Returned as keys so the card says "sellos" to a Spanish café's customers and
 * "stamps" to an English one's. `pass-content.ts` classifies by program *type*
 * rather than by this word for exactly that reason — the label is localised, the
 * behaviour must not be.
 */
export function unitKeysFor(loyalty: LoyaltyStyle): {
  singular: TranslationKey
  plural: TranslationKey
} {
  return loyalty === 'stamps'
    ? { singular: 'onboarding.units.stamp', plural: 'onboarding.units.stamps' }
    : { singular: 'onboarding.units.point', plural: 'onboarding.units.points' }
}

/**
 * Stamp goals worth offering.
 *
 * Six to twelve. Below six the reward is not worth chasing and the margin hurts;
 * above twelve a customer visiting weekly is three months from their first
 * reward, which is longer than most people will hold an intention.
 */
export const STAMP_GOALS = [6, 8, 10, 12] as const

/**
 * Points goals worth offering.
 *
 * An order of magnitude apart from stamps because a point is roughly a unit of
 * currency spent — 500 points is a customer who has spent €500, not one who has
 * visited 500 times.
 */
export const POINT_GOALS = [200, 300, 500, 1000] as const

export function goalsFor(loyalty: LoyaltyStyle): readonly number[] {
  return loyalty === 'stamps' ? STAMP_GOALS : POINT_GOALS
}

// -----------------------------------------------------------------------------
// Backwards-compatible surface
// -----------------------------------------------------------------------------

export type SuggestedSetup = {
  primary: string
  accent: string
  /** Dictionary key — resolve with the merchant's translator before writing. */
  rewardKey: TranslationKey
  goal: number
}

/**
 * The older, narrower view of the same data.
 *
 * Kept because Settings and the tests read it, and because a caller that only
 * wants "what colour and what reward" should not have to know about loyalty
 * styles. It is derived from `BUSINESS_TYPES` rather than duplicated, so the two
 * cannot disagree.
 *
 * Two profiles keep the colours they had before this module grew, because they
 * are already on live cards: `cafe` and the `other` fallback. Changing a default
 * colour would repaint the card of every business that accepted it.
 */
const LEGACY_OVERRIDES: Record<string, Partial<SuggestedSetup>> = {
  cafe: { primary: '#111827', accent: '#f59e0b' },
  gym: { primary: '#111827', accent: '#f59e0b' },
  beauty: { primary: '#0f172a', accent: '#38bdf8' },
  bakery: { primary: '#3f2212', accent: '#e0a458' },
  retail: { primary: '#0f172a', accent: '#38bdf8' },
}

export function getSuggestedSetup(category: string | null | undefined): SuggestedSetup {
  const type = findBusinessType(category)
  const override = LEGACY_OVERRIDES[type.key] ?? {}

  return {
    primary: override.primary ?? type.primary,
    accent: override.accent ?? type.accent,
    rewardKey: type.rewardKey,
    /*
     * Stamp goals travel through unchanged. Points goals do not: this function's
     * `goal` is written to `loyalty_programs.goal_amount` by callers that assume
     * a stamp count, and handing them 500 would put "0 / 500" on a card that
     * counts visits.
     */
    goal: type.loyalty === 'stamps' ? type.goal : 8,
  }
}

/** The card template we open the designer on for a trade. */
export function cardTemplateFor(category: string | null | undefined): string {
  const type = BY_KEY.get((category ?? '').toLowerCase())
  return type ? type.cardTemplate : templateForCategory(category).key
}

/**
 * The colour palettes offered in onboarding and in Settings.
 *
 * One list, two screens: a merchant who picked "Espresso" during setup should
 * find the same name when they go back to change it.
 */
export const CARD_PALETTES: ReadonlyArray<{
  key: string
  labelKey: TranslationKey
  primary: string
  accent: string
}> = [
  { key: 'ink', labelKey: 'settings.palette.ink', primary: '#111827', accent: '#f59e0b' },
  { key: 'espresso', labelKey: 'settings.palette.espresso', primary: '#3f2212', accent: '#e0a458' },
  { key: 'sage', labelKey: 'settings.palette.sage', primary: '#1f3d2b', accent: '#a7d7a0' },
  { key: 'ocean', labelKey: 'settings.palette.ocean', primary: '#0c4a6e', accent: '#7dd3fc' },
  { key: 'rose', labelKey: 'settings.palette.rose', primary: '#4a1129', accent: '#f9a8d4' },
  { key: 'midnight', labelKey: 'settings.palette.midnight', primary: '#0f172a', accent: '#38bdf8' },
]
