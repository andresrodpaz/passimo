import { describe, expect, it } from 'vitest'
import { CARD_PALETTES, getSuggestedSetup } from '@/lib/onboarding/presets'
import { createTranslator } from '@/lib/i18n/translate'
import { en } from '@/lib/i18n/dictionaries/en'

/**
 * What a merchant is handed before they have made a single decision.
 *
 * The reward here is prefilled into a field they then save to their program, so
 * it becomes *customer-facing* content. That is why it is a dictionary key
 * rather than a sentence: a Spanish café whose card reads "A free coffee" is the
 * mixed-language failure at its most expensive, because it lands on a
 * customer's phone rather than on an admin screen.
 */
describe('getSuggestedSetup', () => {
  it('returns café defaults for cafés and a fast reward loop', () => {
    const setup = getSuggestedSetup('cafe')

    expect(setup.rewardKey).toBe('onboarding.presets.cafe')
    expect(setup.goal).toBe(6)
    expect(setup.primary).toBe('#111827')
    expect(setup.accent).toBe('#f59e0b')
  })

  it('falls back to the general starter preset for unknown categories', () => {
    const setup = getSuggestedSetup('something-else')

    expect(setup.rewardKey).toBe('onboarding.presets.other')
    expect(setup.goal).toBe(8)
    expect(setup.primary).toBe('#0f172a')
    expect(setup.accent).toBe('#38bdf8')
  })

  it('suggests a reward in the merchant’s own language, not the platform’s', () => {
    const english = createTranslator('en')
    const spanish = createTranslator('es')
    const setup = getSuggestedSetup('bakery')

    expect(english(setup.rewardKey)).toBe('A free pastry')
    expect(spanish(setup.rewardKey)).toBe('Un dulce gratis')
  })

  it('resolves every preset to a real dictionary entry', () => {
    // A missing key would write the literal string "onboarding.presets.gym" onto
    // a customer's loyalty card, which is worse than any wrong translation.
    for (const category of ['cafe', 'bakery', 'restaurant', 'bar', 'barber', 'beauty', 'gym', 'retail', 'unknown']) {
      const setup = getSuggestedSetup(category)
      const resolved = createTranslator('es')(setup.rewardKey)
      expect(resolved, `${category} resolves to its own key`).not.toBe(setup.rewardKey)
    }
  })
})

describe('CARD_PALETTES', () => {
  it('offers the same named palettes to onboarding and to settings', () => {
    // One list, two screens: a merchant who chose "Espresso" during setup has to
    // find that same name when they go back to change it.
    expect(CARD_PALETTES.length).toBeGreaterThanOrEqual(4)
    for (const palette of CARD_PALETTES) {
      expect(palette.primary).toMatch(/^#[0-9a-f]{6}$/i)
      expect(palette.accent).toMatch(/^#[0-9a-f]{6}$/i)
      expect(palette.labelKey.startsWith('settings.palette.')).toBe(true)
      const leaf = palette.labelKey.split('.').pop()!
      expect(Object.keys(en.settings.palette)).toContain(leaf)
    }
  })
})
