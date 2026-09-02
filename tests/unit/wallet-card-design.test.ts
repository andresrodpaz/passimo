import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CARD_DESIGN_COLUMNS,
  CARD_STYLES,
  DEFAULT_CARD_DESIGN,
  MAX_RENDERABLE_STAMPS,
  cardBackground,
  contrastRatio,
  effectiveProgressStyle,
  fontStack,
  isHexColor,
  mapCardDesign,
  meetsContrastAA,
  normalizeHex,
  readableTextOn,
  relativeLuminance,
  resolveCardDesign,
  shift,
  type CardDesign,
} from '@/lib/wallet/card-design'
import {
  DEFAULT_BRAND,
  brandKitUpdate,
  mapBrandKit,
  normalizeHandle,
  placeholderBrandKit,
  resolveBrandPalette,
  socialUrl,
} from '@/lib/brand/kit'

/**
 * The card's appearance model.
 *
 * This is the feature merchants are actually buying — a card that looks like
 * their business — and it shipped with no tests at all. What makes it worth a
 * dedicated file rather than a few assertions is that every bug in here is
 * *invisible to us and permanent for the customer*: the artefact is a pass
 * installed on a phone, so an unreadable colour pair or a stamp grid with forty
 * dots is not something a merchant can report and we can hotfix out of their
 * customers' wallets.
 *
 * The contrast rules get the most attention because they are the only part that
 * silently overrides what the merchant chose, and the reason it does so is
 * legibility at a counter.
 */

const BRAND = {
  primaryColor: '#1d4ed8',
  accentColor: '#f59e0b',
  textColor: '#ffffff',
  logoUrl: 'https://cdn.example.test/logo.png',
}

describe('hex parsing', () => {
  it('accepts three- and six-digit hex, with or without case', () => {
    expect(isHexColor('#abc')).toBe(true)
    expect(isHexColor('#AABBCC')).toBe(true)
    expect(isHexColor('#abcdef')).toBe(true)
  })

  it('rejects anything that is not a usable CSS colour', () => {
    for (const value of ['abc', '#ab', '#abcd', '#gggggg', 'red', '', null, undefined, 42, {}]) {
      expect(isHexColor(value), String(value)).toBe(false)
    }
  })

  it('expands shorthand so two spellings of one colour compare equal', () => {
    expect(normalizeHex('#abc')).toBe('#aabbcc')
    expect(normalizeHex('#AABBCC')).toBe('#aabbcc')
    // The designer autosaves whatever the colour input produced; a stored
    // '#FFF' and a stored '#ffffff' must not read as two different brands.
    expect(normalizeHex('  #FFF  ')).toBe('#ffffff')
  })

  it('returns null rather than a default for unusable input', () => {
    // Null lets each caller decide its own fallback. Defaulting here would mean
    // a merchant's broken paste silently became platform black everywhere.
    expect(normalizeHex('not a colour')).toBeNull()
    expect(normalizeHex(null)).toBeNull()
  })
})

describe('contrast', () => {
  it('computes WCAG relative luminance at the endpoints', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5)
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5)
  })

  it('matches the published WCAG ratio for black on white', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1)
  })

  it('is symmetric, so argument order cannot change a verdict', () => {
    expect(contrastRatio('#1d4ed8', '#ffffff')).toBeCloseTo(
      contrastRatio('#ffffff', '#1d4ed8'),
      10
    )
  })

  it('picks dark text on a pale background and light text on a dark one', () => {
    // The bug this prevents: a merchant chooses cream, and their customers get
    // white text on cream on a card they cannot read at a till.
    expect(readableTextOn('#fef3c7')).toBe('#000000')
    expect(readableTextOn('#ffffff')).toBe('#000000')
    expect(readableTextOn('#111827')).toBe('#ffffff')
    expect(readableTextOn('#000000')).toBe('#ffffff')
  })

  it('holds body copy to AA rather than the large-text threshold', () => {
    // 4.5:1, not 3:1 — the balance and reward lines are read at arm's length.
    expect(meetsContrastAA('#ffffff', '#111827')).toBe(true)
    expect(meetsContrastAA('#ffffff', '#fef3c7')).toBe(false)
    // A pair that clears 3:1 but not 4.5:1 must be rejected.
    const ratio = contrastRatio('#767676', '#ffffff')
    expect(ratio).toBeGreaterThan(4)
    expect(meetsContrastAA('#949494', '#ffffff')).toBe(false)
  })
})

describe('shift', () => {
  it('moves toward white for a positive amount and black for a negative one', () => {
    expect(shift('#000000', 1)).toBe('#ffffff')
    expect(shift('#ffffff', -1)).toBe('#000000')
    expect(shift('#808080', 0)).toBe('#808080')
  })

  it('always produces a six-digit hex, including for single-digit channels', () => {
    // Padding matters: '#0f0f0f' losing a pad becomes '#fff', a different colour.
    expect(shift('#000000', 0.06)).toMatch(/^#[0-9a-f]{6}$/)
  })
})

describe('cardBackground', () => {
  const colors = { backgroundColor: '#1d4ed8', accentColor: '#f59e0b' }

  it('returns the bare colour for a solid card', () => {
    expect(cardBackground({ ...colors, cardStyle: 'solid' })).toBe('#1d4ed8')
  })

  it('returns a gradient that includes the chosen colour for every other style', () => {
    for (const cardStyle of CARD_STYLES.filter((style) => style !== 'solid')) {
      const value = cardBackground({ ...colors, cardStyle })
      expect(value, cardStyle).toContain('gradient')
      expect(value, cardStyle).toContain('#1d4ed8')
    }
  })

  it('uses the accent as the second half of a duotone', () => {
    expect(cardBackground({ ...colors, cardStyle: 'duotone' })).toContain('#f59e0b')
  })

  it('covers every declared style, so a new one cannot fall through silently', () => {
    for (const cardStyle of CARD_STYLES) {
      expect(cardBackground({ ...colors, cardStyle }).length, cardStyle).toBeGreaterThan(0)
    }
  })
})

describe('fontStack', () => {
  it('ends every stack in a generic family', () => {
    // Without one, a device missing every named font falls back to the browser
    // default, which on Android is not what the merchant previewed.
    for (const typography of ['system', 'rounded', 'serif', 'mono'] as const) {
      expect(fontStack(typography), typography).toMatch(/(sans-serif|serif|monospace)$/)
    }
  })
})

describe('effectiveProgressStyle', () => {
  it('passes an explicit choice straight through', () => {
    // The override exists because the merchant can see their own card; `auto`
    // must never win over a deliberate decision.
    expect(effectiveProgressStyle('bar', { goal: 6, isStampProgram: true })).toBe('bar')
    expect(effectiveProgressStyle('none', { goal: 6, isStampProgram: true })).toBe('none')
    expect(effectiveProgressStyle('stamps', { goal: 400, isStampProgram: false })).toBe('stamps')
  })

  it('resolves an open-ended points program to a points readout', () => {
    expect(effectiveProgressStyle('auto', { goal: null, isStampProgram: false })).toBe('points')
    expect(effectiveProgressStyle('auto', { goal: 0, isStampProgram: false })).toBe('points')
    expect(effectiveProgressStyle('auto', { goal: -5, isStampProgram: false })).toBe('points')
  })

  it('draws stamps for a stamp card up to the readable limit', () => {
    expect(effectiveProgressStyle('auto', { goal: 1, isStampProgram: true })).toBe('stamps')
    expect(
      effectiveProgressStyle('auto', { goal: MAX_RENDERABLE_STAMPS, isStampProgram: true })
    ).toBe('stamps')
  })

  it('switches to a bar once stamps would stop being tappable', () => {
    // Forty dots on a card is not a progress indicator, it is a texture.
    expect(
      effectiveProgressStyle('auto', { goal: MAX_RENDERABLE_STAMPS + 1, isStampProgram: true })
    ).toBe('bar')
    expect(effectiveProgressStyle('auto', { goal: 40, isStampProgram: true })).toBe('bar')
  })

  it('never draws stamps for a spend-based program with a goal', () => {
    expect(effectiveProgressStyle('auto', { goal: 10, isStampProgram: false })).toBe('bar')
  })
})

describe('resolveCardDesign', () => {
  const design = (overrides: Partial<CardDesign> = {}): CardDesign => ({
    ...DEFAULT_CARD_DESIGN,
    ...overrides,
  })

  it('prefers the design over the brand, and the brand over a platform default', () => {
    expect(resolveCardDesign(design({ backgroundColor: '#ff0000' }), BRAND).backgroundColor).toBe(
      '#ff0000'
    )
    expect(resolveCardDesign(design(), BRAND).backgroundColor).toBe('#1d4ed8')
    expect(
      resolveCardDesign(design(), { ...BRAND, primaryColor: 'broken' }).backgroundColor
    ).toBe('#111827')
  })

  it('normalises shorthand on the way out, so callers get a usable value', () => {
    expect(resolveCardDesign(design({ backgroundColor: '#abc' }), BRAND).backgroundColor).toBe(
      '#aabbcc'
    )
  })

  it('derives an accent from the background when neither layer supplies a usable one', () => {
    /*
     * `BrandKit.accentColor` is typed non-null because `mapBrandKit` always
     * defaults it, so the reachable failure is not absence but a stored value
     * that is not a colour — a legacy row, or a hand-edited one.
     */
    const resolved = resolveCardDesign(design(), { ...BRAND, accentColor: 'inherit' })
    expect(resolved.accentColor).toMatch(/^#[0-9a-f]{6}$/)
    expect(resolved.accentColor).not.toBe(resolved.backgroundColor)
  })

  it('honours a stored text colour that is legible', () => {
    const resolved = resolveCardDesign(
      design({ backgroundColor: '#111827', foregroundColor: '#ffffff' }),
      BRAND
    )
    expect(resolved.foregroundColor).toBe('#ffffff')
  })

  it('overrides a stored text colour that has stopped being legible', () => {
    /*
     * The scenario this exists for: white text was chosen in March against a
     * dark background, the background was changed to cream in April, and the
     * text setting was never revisited. Honouring the stored value would ship
     * white-on-cream to every installed pass.
     */
    const resolved = resolveCardDesign(
      design({ backgroundColor: '#fef3c7', foregroundColor: '#ffffff' }),
      BRAND
    )
    expect(resolved.foregroundColor).toBe('#000000')
    expect(meetsContrastAA(resolved.foregroundColor, resolved.backgroundColor)).toBe(true)
  })

  it('computes a legible foreground when no layer states one', () => {
    const resolved = resolveCardDesign(design({ backgroundColor: '#fef3c7' }), {
      ...BRAND,
      textColor: '',
    })
    expect(resolved.foregroundColor).toBe('#000000')
  })

  it('guarantees AA for every template-and-brand combination', () => {
    // The invariant the whole module exists to hold. Anything that resolves has
    // to be readable, whatever the merchant picked.
    const backgrounds = ['#ffffff', '#000000', '#fef3c7', '#1d4ed8', '#7f1d1d', '#a3e635']
    for (const backgroundColor of backgrounds) {
      for (const foregroundColor of [null, '#ffffff', '#000000', '#888888']) {
        const resolved = resolveCardDesign(design({ backgroundColor, foregroundColor }), BRAND)
        expect(
          meetsContrastAA(resolved.foregroundColor, resolved.backgroundColor),
          `${foregroundColor ?? 'auto'} on ${backgroundColor}`
        ).toBe(true)
      }
    }
  })

  it('falls back to the brand logo but lets the design override it', () => {
    expect(resolveCardDesign(design(), BRAND).logoUrl).toBe(BRAND.logoUrl)
    expect(resolveCardDesign(design({ logoUrl: '/other.png' }), BRAND).logoUrl).toBe('/other.png')
  })

  it('resolves the progress style against the program', () => {
    const resolved = resolveCardDesign(design(), BRAND, { goal: 6, isStampProgram: true })
    expect(resolved.effectiveProgress).toBe('stamps')
    expect(resolved.progressStyle).toBe('auto')
  })

  it('carries the merchant’s own copy through untouched', () => {
    const resolved = resolveCardDesign(
      design({ headline: 'Café Central', customMessage: 'Gracias', termsText: 'Sin caducidad' }),
      BRAND
    )
    expect(resolved.headline).toBe('Café Central')
    expect(resolved.customMessage).toBe('Gracias')
    expect(resolved.termsText).toBe('Sin caducidad')
  })
})

describe('the brand’s second colour', () => {
  const design = (overrides: Partial<CardDesign> = {}): CardDesign => ({
    ...DEFAULT_CARD_DESIGN,
    ...overrides,
  })

  it('is ignored by every style except gradient', () => {
    // Duotone has its own second tone (the accent) and a solid card has none.
    for (const cardStyle of CARD_STYLES.filter((style) => style !== 'gradient')) {
      const resolved = resolveCardDesign(design({ cardStyle }), {
        ...BRAND,
        secondaryColor: '#7f1d1d',
      })
      expect(resolved.secondaryColor, cardStyle).toBeNull()
    }
  })

  it('drives the far stop of a gradient', () => {
    const resolved = resolveCardDesign(design({ cardStyle: 'gradient' }), {
      ...BRAND,
      secondaryColor: '#7f1d1d',
    })
    expect(resolved.secondaryColor).toBe('#7f1d1d')
    const background = cardBackground(resolved)
    expect(background).toContain(resolved.backgroundColor)
    expect(background).toContain('#7f1d1d')
  })

  it('falls back to the derived gradient when the brand has no second colour', () => {
    const resolved = resolveCardDesign(design({ cardStyle: 'gradient' }), BRAND)
    expect(resolved.secondaryColor).toBeNull()
    expect(cardBackground(resolved)).toContain('gradient')
  })

  it('ignores an unusable stored value', () => {
    const resolved = resolveCardDesign(design({ cardStyle: 'gradient' }), {
      ...BRAND,
      secondaryColor: 'not a colour',
    })
    expect(resolved.secondaryColor).toBeNull()
  })

  it('rejects a stored text colour that fails on the second stop alone', () => {
    /*
     * The failure this prevents: text checked only against `backgroundColor` —
     * which is all every other card style needs — is readable at the top of a
     * gradient and invisible at the bottom.
     *
     * White clears AA on neither white nor cream, and black clears both, so
     * there is a right answer here and the resolver has to find it. Both stops
     * are pale on purpose: a dark-to-pale pair has no single legible colour at
     * all, which is the separate case below.
     */
    const resolved = resolveCardDesign(
      design({ cardStyle: 'gradient', foregroundColor: '#ffffff' }),
      { ...BRAND, primaryColor: '#ffffff', secondaryColor: '#fef3c7' }
    )
    expect(resolved.foregroundColor).toBe('#000000')
  })

  it('would have accepted that same colour without the second stop', () => {
    // Proves the previous assertion is actually about the gradient rule rather
    // than about white being rejected on a pale background anyway.
    const solid = resolveCardDesign(
      design({ cardStyle: 'gradient', foregroundColor: '#ffffff' }),
      { ...BRAND, primaryColor: '#111827', secondaryColor: null }
    )
    expect(solid.foregroundColor).toBe('#ffffff')
  })

  it('falls back to the background’s own answer for a dark-to-pale gradient', () => {
    /*
     * `#111827` → `#fef3c7` spans nearly the whole luminance range, so neither
     * black nor white clears AA on both stops. The card must still render, and
     * the background is what carries the balance, so its answer wins. Documented
     * rather than silently arbitrary.
     */
    const resolved = resolveCardDesign(
      design({ cardStyle: 'gradient', foregroundColor: '#ffffff' }),
      { ...BRAND, primaryColor: '#111827', secondaryColor: '#fef3c7' }
    )
    expect(resolved.foregroundColor).toBe(readableTextOn('#111827'))
  })

  it('never leaves a gradient stop failing AA when one colour can serve both', () => {
    const pairs: Array<[string, string]> = [
      ['#111827', '#1f2937'],
      ['#ffffff', '#fef3c7'],
      ['#0c4a6e', '#075985'],
      ['#3f2212', '#4a1129'],
    ]
    for (const [primaryColor, secondaryColor] of pairs) {
      const resolved = resolveCardDesign(design({ cardStyle: 'gradient' }), {
        ...BRAND,
        primaryColor,
        secondaryColor,
      })
      for (const stop of [resolved.backgroundColor, resolved.secondaryColor!]) {
        expect(
          meetsContrastAA(resolved.foregroundColor, stop),
          `${resolved.foregroundColor} on ${stop} (${primaryColor}→${secondaryColor})`
        ).toBe(true)
      }
    }
  })

  it('still resolves something readable when the two stops are irreconcilable', () => {
    /*
     * A mid-grey background against a mid-grey secondary leaves no single text
     * colour clearing AA on both. The card must still render, and the background
     * is what carries the balance, so its own best answer wins rather than the
     * resolver returning nothing.
     */
    const resolved = resolveCardDesign(design({ cardStyle: 'gradient' }), {
      ...BRAND,
      primaryColor: '#767676',
      secondaryColor: '#8a8a8a',
    })
    expect(resolved.foregroundColor).toMatch(/^#(?:000000|ffffff)$/)
  })
})

describe('mapCardDesign', () => {
  it('treats a missing row as the default design', () => {
    expect(mapCardDesign(null)).toEqual(DEFAULT_CARD_DESIGN)
  })

  it('does not hand back the shared default object', () => {
    // A caller mutating the result must not change the module-level default for
    // every other business in the process.
    const mapped = mapCardDesign(null)
    mapped.template = 'mutated'
    expect(DEFAULT_CARD_DESIGN.template).toBe('minimal')
  })

  it('maps a full row', () => {
    const mapped = mapCardDesign({
      template: 'bold',
      card_style: 'gradient',
      progress_style: 'stamps',
      typography: 'rounded',
      background_color: '#ABC',
      foreground_color: '#000000',
      accent_color: '#f59e0b',
      logo_url: 'https://cdn.example.test/l.png',
      hero_image_url: ' ',
      show_member_name: false,
      show_tier: false,
      headline: '  Café  ',
      custom_message: null,
      terms_text: '',
    })

    expect(mapped.template).toBe('bold')
    expect(mapped.cardStyle).toBe('gradient')
    expect(mapped.progressStyle).toBe('stamps')
    expect(mapped.typography).toBe('rounded')
    expect(mapped.backgroundColor).toBe('#aabbcc')
    expect(mapped.showMemberName).toBe(false)
    expect(mapped.showTier).toBe(false)
    // Absent booleans default to shown rather than hidden: a row written before
    // a toggle existed should not blank a field on an installed card.
    expect(mapped.showMemberSince).toBe(true)
    expect(mapped.showReward).toBe(true)
    // Whitespace-only text is nothing, not a value.
    expect(mapped.heroImageUrl).toBeNull()
    expect(mapped.termsText).toBeNull()
    expect(mapped.headline).toBe('Café')
  })

  it('falls back rather than trusting an out-of-range enum from the database', () => {
    const mapped = mapCardDesign({
      card_style: 'holographic',
      progress_style: 'spiral',
      typography: 'comic',
      background_color: 'rgb(1,2,3)',
    })
    expect(mapped.cardStyle).toBe(DEFAULT_CARD_DESIGN.cardStyle)
    expect(mapped.progressStyle).toBe(DEFAULT_CARD_DESIGN.progressStyle)
    expect(mapped.typography).toBe(DEFAULT_CARD_DESIGN.typography)
    expect(mapped.backgroundColor).toBeNull()
  })

  it('names a column for every field of the design', () => {
    // The API layer writes through this map; a field without an entry would be
    // silently dropped on save.
    for (const key of Object.keys(DEFAULT_CARD_DESIGN)) {
      expect(CARD_DESIGN_COLUMNS[key as keyof CardDesign], key).toBeTruthy()
    }
    expect(Object.keys(CARD_DESIGN_COLUMNS).sort()).toEqual(
      Object.keys(DEFAULT_CARD_DESIGN).sort()
    )
  })
})

describe('brand kit', () => {
  it('maps a row and defaults what is missing', () => {
    const kit = mapBrandKit({ id: 'b1', name: 'Café Central' })
    expect(kit.businessId).toBe('b1')
    expect(kit.name).toBe('Café Central')
    expect(kit.primaryColor).toBe(DEFAULT_BRAND.primaryColor)
    expect(kit.accentColor).toBe(DEFAULT_BRAND.accentColor)
    expect(kit.font).toBe(DEFAULT_BRAND.font)
    expect(kit.logoUrl).toBeNull()
  })

  it('computes a text colour from the primary when none is stored', () => {
    expect(mapBrandKit({ id: 'b', name: 'n', primary_color: '#fef3c7' }).textColor).toBe('#000000')
    expect(mapBrandKit({ id: 'b', name: 'n', primary_color: '#111827' }).textColor).toBe('#ffffff')
  })

  it('reads contact and social fields', () => {
    const kit = mapBrandKit({
      id: 'b',
      name: 'n',
      support_email: 'hola@cafe.test',
      phone: '+34 600 000 000',
      city: 'Madrid',
      instagram: 'https://www.instagram.com/cafecentral/?hl=es',
    })
    expect(kit.contact.email).toBe('hola@cafe.test')
    expect(kit.contact.city).toBe('Madrid')
    expect(kit.socials.instagram).toBe('cafecentral')
  })

  it('reduces every spelling of a social handle to the bare username', () => {
    for (const input of [
      'cafecentral',
      '@cafecentral',
      'instagram.com/cafecentral',
      'https://instagram.com/cafecentral',
      'https://www.instagram.com/cafecentral/',
      'https://www.facebook.com/cafecentral?ref=page',
    ]) {
      expect(normalizeHandle(input), input).toBe('cafecentral')
    }
  })

  it('rejects a paste that is not a handle at all', () => {
    // Storing one would render a broken link on a customer's card.
    for (const input of ['two words', '', '   ', 'has spaces', 'emoji☕', null, undefined, 12]) {
      expect(normalizeHandle(input), String(input)).toBeNull()
    }
  })

  it('takes the first path segment, so a trailing URL path is not a rejection', () => {
    // `instagram.com/cafecentral/reels` is a real paste; the handle is the first
    // segment, and treating the whole path as invalid would reject it outright.
    expect(normalizeHandle('cafecentral/reels')).toBe('cafecentral')
  })

  it('builds a profile URL only for a known network and a real handle', () => {
    expect(socialUrl('instagram', 'cafecentral')).toBe('https://instagram.com/cafecentral')
    expect(socialUrl('tiktok', 'cafecentral')).toBe('https://tiktok.com/@cafecentral')
    expect(socialUrl('facebook', null)).toBeNull()
  })

  it('gives an unsaved preview a neutral, complete kit', () => {
    const kit = placeholderBrandKit('Mi Negocio')
    expect(kit.name).toBe('Mi Negocio')
    expect(kit.primaryColor).toBe(DEFAULT_BRAND.primaryColor)
    // Onboarding renders a real `CardPreview` from this, so nothing may be
    // missing that the resolver needs.
    expect(resolveCardDesign(DEFAULT_CARD_DESIGN, kit).backgroundColor).toBe(kit.primaryColor)
  })
})

describe('brandKitUpdate', () => {
  it('sends only the fields present in the patch', () => {
    // An untouched field must not appear in the update at all, or a partial
    // save from one tab would overwrite what another tab just changed.
    expect(brandKitUpdate({ name: 'Café' })).toEqual({ name: 'Café' })
  })

  it('maps camelCase fields to their columns', () => {
    expect(brandKitUpdate({ supportEmail: 'a@b.test', postalCode: '28001' })).toEqual({
      support_email: 'a@b.test',
      postal_code: '28001',
    })
  })

  it('clears a field on an explicit null', () => {
    expect(brandKitUpdate({ logoUrl: null })).toEqual({ logo_url: null })
  })

  it('drops an invalid colour instead of defaulting it', () => {
    /*
     * A merchant who sends a broken hex keeps the colour they had. Defaulting
     * to platform black would look like the product losing their brand, which
     * is a far worse outcome than the save appearing to do nothing.
     */
    expect(brandKitUpdate({ primaryColor: 'rgb(1,2,3)' })).toEqual({})
    expect(brandKitUpdate({ primaryColor: '#abc' })).toEqual({ primary_color: '#aabbcc' })
  })

  it('normalises a handle and nulls an unusable one', () => {
    expect(brandKitUpdate({ instagram: '@cafe' })).toEqual({ instagram: 'cafe' })
    expect(brandKitUpdate({ instagram: 'two words' })).toEqual({ instagram: null })
  })

  it('treats a blank string as a cleared field', () => {
    expect(brandKitUpdate({ description: '   ' })).toEqual({ description: null })
  })

  it('is a no-op for an empty patch, because the designer autosaves', () => {
    expect(brandKitUpdate({})).toEqual({})
  })
})

/**
 * One implementation of luminance, enforced structurally.
 *
 * This is the only test here that reads the source rather than calling it, and
 * it earns that because the bug it prevents is not a wrong answer — it is a
 * *second* answer. Three separate copies of an ungamma'd channel average, each
 * claiming WCAG in a comment, existed simultaneously in `card-design.ts`,
 * `messaging/email-layout.ts` and `components/loyalty-card.tsx`. They disagreed,
 * so one brand colour produced white text on the installed wallet pass and dark
 * text on the join page advertising it.
 *
 * No unit test on any one of them could have caught that. Only the count can.
 */
describe('contrast is implemented exactly once', () => {
  const ROOT = join(__dirname, '..', '..')
  const SEARCHED = ['app', 'components', 'lib']
  const CANONICAL = join('lib', 'wallet', 'card-design.ts')

  function sourceFiles(dir: string): string[] {
    const entries = readdirSync(join(ROOT, dir))
    return entries.flatMap((entry) => {
      const relative = join(dir, entry)
      if (statSync(join(ROOT, relative)).isDirectory()) return sourceFiles(relative)
      return /\.tsx?$/.test(entry) ? [relative] : []
    })
  }

  const files = SEARCHED.flatMap(sourceFiles)

  /*
   * A generous timeout, because this is the one test in the suite whose cost is
   * disk rather than CPU: it opens every `.ts` and `.tsx` file under `app`,
   * `components` and `lib`. On a warm cache that is ~130 ms; on a cold one, or
   * behind a Windows virus scanner reading several hundred files for the first
   * time, it has been seen to pass 5 s and fail as a timeout while the assertion
   * itself was fine. A structural check that fails intermittently gets muted, and
   * a muted check is worse than none — the three-copies bug it exists to catch is
   * exactly the kind that reappears.
   */
  it(
    'finds the luminance coefficients in one file only',
    () => {
      // 0.0722 is the blue coefficient from WCAG 2.1. Anything computing it again
      // is a second opinion on legibility.
      const carriers = files.filter((file) => {
        const source = readFileSync(join(ROOT, file), 'utf8')
        return source.includes('0.0722') || source.includes('0.7152')
      })

      expect(carriers, `luminance re-implemented in: ${carriers.join(', ')}`).toEqual([CANONICAL])
    },
    30_000
  )

  it('scanned a plausible number of files, so a broken walk cannot pass silently', () => {
    // Without this, a bad path would make the check above vacuously true.
    expect(files.length).toBeGreaterThan(100)
    expect(files).toContain(CANONICAL)
    expect(files).toContain(join('components', 'loyalty-card.tsx'))
    expect(files).toContain(join('lib', 'messaging', 'email-layout.ts'))
  })
})

describe('resolveBrandPalette', () => {
  it('defaults each slot independently', () => {
    const palette = resolveBrandPalette({})
    expect(palette.background).toBe(DEFAULT_BRAND.primaryColor)
    expect(palette.accent).toBe(DEFAULT_BRAND.accentColor)
    expect(palette.text).toBe(readableTextOn(DEFAULT_BRAND.primaryColor))
  })

  it('keeps a stored text colour that is readable', () => {
    expect(
      resolveBrandPalette({ primaryColor: '#111827', textColor: '#ffffff' }).text
    ).toBe('#ffffff')
  })

  it('recomputes a stored text colour that is not', () => {
    /*
     * This is the bug the helper was extracted to fix: the join page and the
     * browser card used `text_color` verbatim, so the same two columns produced
     * a legible wallet pass and an illegible public page.
     */
    expect(
      resolveBrandPalette({ primaryColor: '#fef3c7', textColor: '#ffffff' }).text
    ).toBe('#000000')
  })

  it('agrees with the card resolver for the same brand', () => {
    // The two must not diverge: a customer sees the join page and the installed
    // pass within a minute of each other.
    for (const primaryColor of ['#ffffff', '#fef3c7', '#111827', '#1d4ed8']) {
      const palette = resolveBrandPalette({ primaryColor, textColor: '#ffffff' })
      const card = resolveCardDesign(
        { ...DEFAULT_CARD_DESIGN, foregroundColor: '#ffffff' },
        { primaryColor, accentColor: '#f59e0b', textColor: '#ffffff', logoUrl: null }
      )
      expect(palette.text, primaryColor).toBe(card.foregroundColor)
      expect(palette.background, primaryColor).toBe(card.backgroundColor)
    }
  })
})
