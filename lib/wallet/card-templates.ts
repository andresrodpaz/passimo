/**
 * Starting points for the card designer.
 *
 * The brief for these was "templates should feel genuinely different — do not
 * create ten copies of the same design", which is the right instruction and the
 * one most template galleries fail. A palette swap is not a template.
 *
 * So each of these varies on four axes at once — surface treatment, how progress
 * is drawn, typography, and which rows are shown — and each is anchored to how
 * that trade actually operates:
 *
 *   * a café's customer is counting to six, so it shows stamps and hides the
 *     tier it does not have;
 *   * a gym's member is on a plan, so the tier is the point and the stamp grid
 *     is meaningless;
 *   * a restaurant's guest is accruing spend, so it is a points bar;
 *   * a luxury retailer wants a tier and almost nothing else on the face.
 *
 * A merchant picks one and edits from there. Nothing here is locked — a template
 * is a set of starting values, not a mode.
 *
 * Isomorphic, so the onboarding preview, the designer gallery and the landing
 * page's customisation demo all render the same definitions.
 */

import type { TranslationKey } from '@/lib/i18n/dictionaries/en'
import type { CardDesign, CardStyle, ProgressStyle, Typography } from '@/lib/wallet/card-design'

export type CardTemplate = {
  key: string
  nameKey: TranslationKey
  descriptionKey: TranslationKey
  /** Trades this suits, matched against the signup category. */
  categories: readonly string[]
  design: {
    cardStyle: CardStyle
    progressStyle: ProgressStyle
    typography: Typography
    backgroundColor: string
    accentColor: string
    /** Omitted means "compute a legible one from the background". */
    foregroundColor?: string
    showMemberName: boolean
    showMemberSince: boolean
    showTier: boolean
    showLocation: boolean
    showReward: boolean
    showProgress: boolean
  }
}

export const CARD_TEMPLATES: readonly CardTemplate[] = [
  {
    key: 'minimal',
    nameKey: 'cardDesign.templates.minimal.name',
    descriptionKey: 'cardDesign.templates.minimal.description',
    categories: ['other'],
    design: {
      cardStyle: 'solid',
      progressStyle: 'bar',
      typography: 'system',
      backgroundColor: '#111827',
      accentColor: '#9ca3af',
      showMemberName: true,
      showMemberSince: false,
      showTier: false,
      showLocation: false,
      showReward: true,
      showProgress: true,
    },
  },
  {
    key: 'premium',
    nameKey: 'cardDesign.templates.premium.name',
    descriptionKey: 'cardDesign.templates.premium.description',
    categories: ['other'],
    design: {
      cardStyle: 'gradient',
      progressStyle: 'bar',
      typography: 'serif',
      backgroundColor: '#1c1917',
      accentColor: '#d6b16a',
      showMemberName: true,
      showMemberSince: true,
      showTier: true,
      showLocation: true,
      showReward: true,
      showProgress: true,
    },
  },
  {
    key: 'modern',
    nameKey: 'cardDesign.templates.modern.name',
    descriptionKey: 'cardDesign.templates.modern.description',
    categories: ['other'],
    design: {
      cardStyle: 'duotone',
      progressStyle: 'bar',
      typography: 'rounded',
      backgroundColor: '#4338ca',
      accentColor: '#22d3ee',
      showMemberName: true,
      showMemberSince: false,
      showTier: true,
      showLocation: false,
      showReward: true,
      showProgress: true,
    },
  },
  {
    key: 'coffee',
    nameKey: 'cardDesign.templates.coffee.name',
    descriptionKey: 'cardDesign.templates.coffee.description',
    // A café card is a stamp card. Ten dots and a free coffee is the entire
    // mental model, and anything else on the face is noise.
    categories: ['cafe'],
    design: {
      cardStyle: 'solid',
      progressStyle: 'stamps',
      typography: 'rounded',
      backgroundColor: '#3f2212',
      accentColor: '#e0a458',
      showMemberName: true,
      showMemberSince: false,
      showTier: false,
      showLocation: true,
      showReward: true,
      showProgress: true,
    },
  },
  {
    key: 'restaurant',
    nameKey: 'cardDesign.templates.restaurant.name',
    descriptionKey: 'cardDesign.templates.restaurant.description',
    // Spend-based, so points and a tier — a regular who books the private room
    // should be visibly a different customer from a walk-in.
    categories: ['restaurant', 'bar'],
    design: {
      cardStyle: 'gradient',
      progressStyle: 'points',
      typography: 'serif',
      backgroundColor: '#4a1129',
      accentColor: '#f9a8d4',
      showMemberName: true,
      showMemberSince: true,
      showTier: true,
      showLocation: true,
      showReward: true,
      showProgress: true,
    },
  },
  {
    key: 'bakery',
    nameKey: 'cardDesign.templates.bakery.name',
    descriptionKey: 'cardDesign.templates.bakery.description',
    categories: ['bakery'],
    design: {
      cardStyle: 'frosted',
      progressStyle: 'stamps',
      typography: 'rounded',
      backgroundColor: '#b45309',
      accentColor: '#fed7aa',
      showMemberName: true,
      showMemberSince: false,
      showTier: false,
      showLocation: true,
      showReward: true,
      showProgress: true,
    },
  },
  {
    key: 'barber',
    nameKey: 'cardDesign.templates.barber.name',
    descriptionKey: 'cardDesign.templates.barber.description',
    // Appointment-based: the count is visits, and the customer's name matters
    // because the barber greets them by it.
    categories: ['barber'],
    design: {
      cardStyle: 'duotone',
      progressStyle: 'stamps',
      typography: 'mono',
      backgroundColor: '#0c4a6e',
      accentColor: '#7dd3fc',
      showMemberName: true,
      showMemberSince: true,
      showTier: false,
      showLocation: true,
      showReward: true,
      showProgress: true,
    },
  },
  {
    key: 'beauty',
    nameKey: 'cardDesign.templates.beauty.name',
    descriptionKey: 'cardDesign.templates.beauty.description',
    categories: ['beauty'],
    design: {
      cardStyle: 'gradient',
      progressStyle: 'points',
      typography: 'serif',
      backgroundColor: '#831843',
      accentColor: '#fbcfe8',
      showMemberName: true,
      showMemberSince: true,
      showTier: true,
      showLocation: true,
      showReward: true,
      showProgress: true,
    },
  },
  {
    key: 'gym',
    nameKey: 'cardDesign.templates.gym.name',
    descriptionKey: 'cardDesign.templates.gym.description',
    // Membership tiers are the product, so the tier is promoted and the stamp
    // grid — meaningless for an unlimited plan — is off.
    categories: ['gym'],
    design: {
      cardStyle: 'duotone',
      progressStyle: 'bar',
      typography: 'system',
      backgroundColor: '#0f172a',
      accentColor: '#a3e635',
      showMemberName: true,
      showMemberSince: true,
      showTier: true,
      showLocation: false,
      showReward: true,
      showProgress: true,
    },
  },
  {
    key: 'retail',
    nameKey: 'cardDesign.templates.retail.name',
    descriptionKey: 'cardDesign.templates.retail.description',
    categories: ['retail'],
    design: {
      cardStyle: 'solid',
      progressStyle: 'points',
      typography: 'system',
      backgroundColor: '#065f46',
      accentColor: '#6ee7b7',
      showMemberName: true,
      showMemberSince: false,
      showTier: true,
      showLocation: true,
      showReward: true,
      showProgress: true,
    },
  },
  {
    key: 'luxury',
    nameKey: 'cardDesign.templates.luxury.name',
    descriptionKey: 'cardDesign.templates.luxury.description',
    // Restraint is the design. Progress bars and stamp grids read as discount
    // mechanics, which is the opposite of what this customer is buying.
    categories: ['retail', 'beauty'],
    design: {
      cardStyle: 'solid',
      progressStyle: 'none',
      typography: 'serif',
      backgroundColor: '#0a0a0a',
      accentColor: '#c8a951',
      foregroundColor: '#f5f5f4',
      showMemberName: true,
      showMemberSince: true,
      showTier: true,
      showLocation: false,
      showReward: true,
      showProgress: false,
    },
  },
]

export function findCardTemplate(key: string | null | undefined): CardTemplate | null {
  if (!key) return null
  return CARD_TEMPLATES.find((template) => template.key === key) ?? null
}

/**
 * The template we open the designer on for a given trade.
 *
 * Falls back to `minimal` rather than to the first entry, so adding a template
 * to the top of the list cannot silently change every new merchant's default.
 */
export function templateForCategory(category: string | null | undefined): CardTemplate {
  const key = (category ?? '').toLowerCase()
  const match = CARD_TEMPLATES.find(
    (template) => template.key === key || template.categories.includes(key)
  )
  return match ?? findCardTemplate('minimal') ?? CARD_TEMPLATES[0]!
}

/**
 * Applies a template on top of an existing design.
 *
 * Merchant copy — headline, custom message, terms — and the uploaded logo are
 * deliberately preserved. Someone trying templates to see which they prefer must
 * not lose the sentence they wrote, or they will stop trying templates.
 */
export function applyCardTemplate(current: CardDesign, template: CardTemplate): CardDesign {
  return {
    ...current,
    template: template.key,
    cardStyle: template.design.cardStyle,
    progressStyle: template.design.progressStyle,
    typography: template.design.typography,
    backgroundColor: template.design.backgroundColor,
    accentColor: template.design.accentColor,
    foregroundColor: template.design.foregroundColor ?? null,
    showMemberName: template.design.showMemberName,
    showMemberSince: template.design.showMemberSince,
    showTier: template.design.showTier,
    showLocation: template.design.showLocation,
    showReward: template.design.showReward,
    showProgress: template.design.showProgress,
  }
}
