import { describe, expect, it } from 'vitest'
import { en } from '@/lib/i18n/dictionaries/en'
import { es } from '@/lib/i18n/dictionaries/es'
import {
  DICTIONARIES,
  createTranslator,
  formatCurrency,
  formatDate,
  formatNumber,
  formatPercent,
  formatRelative,
} from '@/lib/i18n/translate'
import {
  DEFAULT_LOCALE,
  LOCALES,
  isLocale,
  localeFromAcceptLanguage,
  resolveLocale,
} from '@/lib/i18n/locales'

/**
 * The translation contract.
 *
 * The requirement is that the application never mixes languages on one page. The type
 * system enforces the *shape* — a key missing from Spanish is a build error — but it
 * cannot catch a key whose Spanish value was left in English, an interpolation
 * placeholder that was translated along with the sentence, or a plural pair that only
 * exists in one locale. Those are the failures this file exists for.
 */

type Leaf = { path: string; value: string }

function flatten(node: unknown, prefix = ''): Leaf[] {
  if (typeof node === 'string') return [{ path: prefix, value: node }]
  if (!node || typeof node !== 'object') return []
  return Object.entries(node as Record<string, unknown>).flatMap(([key, child]) =>
    flatten(child, prefix ? `${prefix}.${key}` : key)
  )
}

const enLeaves = flatten(en)
const esLeaves = flatten(es)
const enByPath = new Map(enLeaves.map((leaf) => [leaf.path, leaf.value]))
const esByPath = new Map(esLeaves.map((leaf) => [leaf.path, leaf.value]))

const PLACEHOLDER = /\{\s*([a-zA-Z0-9_]+)\s*\}/g

const placeholdersIn = (value: string): string[] =>
  [...value.matchAll(PLACEHOLDER)].map((match) => match[1]).sort()

/**
 * Values that are legitimately identical in both languages.
 *
 * Each entry is one of: a brand or product name (Passimo, Apple Wallet), a loan
 * word Spanish uses unchanged (emoji, beacon, cookies, plan), a proper noun (a
 * street name in a placeholder), or a symbol/unit. Anything not on this list and
 * identical is treated as an untranslated paste — which is exactly how a page
 * ends up half in English.
 *
 * Module scope rather than test scope, because both the whole-dictionary check
 * and the per-screen one need it, and two copies would drift.
 */
const ALLOWED_IDENTICAL = new Set([
  // Brand and product names
  'common.appName',
  'landing.compare.us',
  // A Madrid street name used as sample data on the landing page. Translating a
  // proper noun would be worse than leaving it: "Main Street 12" is not a place.
  'landing.demo.sampleLocation',
  'wallet.preview.apple',
  'wallet.preview.google',
  'admin.tabs.wallet',
  'landing.footer.blog',
  'settings.channelAppleWallet',
  'settings.channelGoogleWallet',
  'settings.noteResend',
  'settings.noteTwilio',
  'settings.noteMeta',
  'settings.noteAnthropic',
  'settings.noteStripe',
  'settings.palette.espresso',
  'settings.previewMember',
  'giftCards.recipientNamePlaceholder',
  'memberships.namePlaceholder',
  // Social networks are proper nouns in both languages
  'brandKit.instagram',
  'brandKit.facebook',
  'brandKit.tiktok',
  // Loan words and initialisms Spanish uses unchanged
  'brandKit.logo',
  'brandKit.email',
  'cardDesign.templates.premium.name',
  'landing.footer.legal',
  'landing.footer.cookies',
  'locations.visible',
  'wallet.campaigns.emoji',
  'wallet.providers.supportsBeacons',
  'wallet.masterSwitches.beaconsEnabled',
  'locations.geofence.beaconMajor',
  'locations.geofence.beaconMinor',
  'admin.businesses.plan',
  'auth.signup.categories.bar',
  'onboarding.step1.cityPlaceholder',
  'campaigns.channels.sms',
  'campaigns.channels.whatsapp',
  'campaigns.channels.push',
  'campaigns.channels.wallet',
  'campaigns.stats.roi',
  'campaigns.smsSection',
  'customers.profile.consentSms',
  'customers.profile.consentWhatsapp',
  'settings.channelSms',
  'settings.channelWhatsapp',
  'billing.features.webhooks',
  'overview.health.nps',
  'growth.nps',
  'insights.kinds.operations',
  // Symbols, units and interpolation-only values
  'common.metres',
  'common.kilometres',
  'wallet.providers.missing',
  'auth.login.email',
  'auth.signup.email',
  'locations.fields.email',
  'join.email',
  'landing.compare.rows.costApp',
  'customers.mobileSummary',
  'rewards.costLabel',
  'pos.awarded',
  'analytics.cohortMonth',
  // Proper nouns used as placeholder examples
  'locations.fields.namePlaceholder',
  // A Spanish given name used as the gift-card recipient example. It already
  // reads as Spanish, and "translating" a first name is not a thing.
  'giftShop.theirNamePlaceholder',
  // Section heading whose Spanish happens to match after shortening
  'wallet.rules.presets',
])

describe('dictionary completeness', () => {
  it('has the same set of keys in every locale', () => {
    const missingFromEs = [...enByPath.keys()].filter((path) => !esByPath.has(path))
    const extraInEs = [...esByPath.keys()].filter((path) => !enByPath.has(path))

    expect(missingFromEs, `missing from Spanish: ${missingFromEs.join(', ')}`).toEqual([])
    expect(extraInEs, `not in English: ${extraInEs.join(', ')}`).toEqual([])
  })

  it('registers a dictionary for every declared locale', () => {
    for (const locale of LOCALES) {
      expect(DICTIONARIES[locale], `no dictionary for ${locale}`).toBeDefined()
    }
  })

  it('has no empty values, which would render as a blank label', () => {
    for (const [locale, leaves] of [
      ['en', enLeaves],
      ['es', esLeaves],
    ] as const) {
      const blank = leaves.filter((leaf) => leaf.value.trim() === '').map((leaf) => leaf.path)
      expect(blank, `${locale} has blank values: ${blank.join(', ')}`).toEqual([])
    }
  })
})

/**
 * Screen coverage.
 *
 * The tests above walk the whole dictionary automatically, so a key added
 * anywhere is already checked for completeness, placeholder parity and an
 * untranslated Spanish value — the screen-by-screen assertions below add
 * nothing to *that*.
 *
 * What they do add is the other direction. A dictionary test can only check the
 * keys that exist; it cannot notice a screen that was never converted, because
 * a screen with no keys contributes no keys to walk. That is exactly how the
 * previous pass could report "the i18n system is enforced by the compiler" while
 * fourteen screens rendered in English: every key in the file was perfect, and
 * the English was in the components.
 *
 * So this asserts the *inventory*: every screen the product has must own a
 * namespace, and each namespace must carry the states a screen cannot render
 * without — its title, and wherever it applies its empty and error copy. It is
 * the cheapest available proxy for "this screen has been through the process",
 * and it fails loudly when the next screen is added without one.
 */
describe('screen coverage', () => {
  type ScreenSpec = { screen: string; namespace: string; requires: string[] }

  const SCREENS: ScreenSpec[] = [
    { screen: 'overview', namespace: 'overview', requires: ['members', 'noMembers', 'doThisNext'] },
    { screen: 'customers', namespace: 'customers', requires: ['title', 'empty', 'emptyBody'] },
    { screen: 'customer profile', namespace: 'customers.profile', requires: ['back', 'history'] },
    { screen: 'customer import', namespace: 'customers.importer', requires: ['title', 'preview'] },
    { screen: 'rewards', namespace: 'rewards', requires: ['title', 'empty', 'emptyBody'] },
    { screen: 'gift cards', namespace: 'giftCards', requires: ['title', 'empty', 'emptyBody'] },
    { screen: 'memberships', namespace: 'memberships', requires: ['title', 'empty', 'emptyBody'] },
    { screen: 'campaigns', namespace: 'campaigns', requires: ['title', 'empty', 'emptyBody'] },
    { screen: 'automations', namespace: 'automations', requires: ['title', 'empty', 'emptyBody'] },
    { screen: 'growth', namespace: 'growth', requires: ['title', 'subtitle', 'noReferrals'] },
    { screen: 'network', namespace: 'network', requires: ['title', 'noPartners', 'nobodyNearby'] },
    { screen: 'analytics', namespace: 'analytics', requires: ['title', 'notEnoughHistory'] },
    { screen: 'insights', namespace: 'insights', requires: ['title', 'empty', 'emptyBody'] },
    { screen: 'settings', namespace: 'settings', requires: ['title', 'businessDetails', 'team'] },
    { screen: 'billing', namespace: 'billing', requires: ['title', 'usage', 'plans'] },
    { screen: 'onboarding', namespace: 'onboarding', requires: ['steps', 'plan', 'location'] },
    { screen: 'point of sale', namespace: 'pos', requires: ['scan', 'noAccess', 'scanFailed'] },
    { screen: 'locations', namespace: 'locations', requires: ['title', 'empty', 'emptyBody'] },
    { screen: 'wallet', namespace: 'wallet', requires: ['title', 'tabs', 'campaigns'] },
    /*
     * The public pages. A stranger's only view of the product, and the reason
     * this inventory exists: the gift shop shipped fully in English because it
     * owned no keys at all, so no dictionary walk could see it.
     */
    { screen: 'gift shop', namespace: 'giftShop', requires: ['header', 'howMuch', 'failed'] },
    { screen: 'join', namespace: 'join', requires: ['title', 'notFound', 'loadFailed'] },
    /*
     * The wallet card face. Not a screen a merchant can open — it renders on a
     * customer's phone — but it is the surface with the longest life and the one
     * nobody can correct after the fact, so it is held to the same rule.
     */
    { screen: 'wallet card face', namespace: 'wallet.pass', requires: ['member', 'howItWorks'] },
    { screen: 'proximity push', namespace: 'wallet.push', requires: ['nearbyTitle', 'rewardTitle'] },
    { screen: 'outbound email', namespace: 'emails', requires: ['shell', 'giftCard', 'dunning'] },
    { screen: 'first-steps checklist', namespace: 'checklist', requires: ['title', 'items'] },
    { screen: 'shared states', namespace: 'states', requires: ['loading', 'unexpected'] },
  ]

  function resolve(root: unknown, path: string): unknown {
    return path.split('.').reduce<unknown>((node, segment) => {
      if (typeof node !== 'object' || node === null) return undefined
      return (node as Record<string, unknown>)[segment]
    }, root)
  }

  it('gives every screen its own namespace in both locales', () => {
    const missing: string[] = []
    for (const spec of SCREENS) {
      for (const [locale, dictionary] of [
        ['en', en],
        ['es', es],
      ] as const) {
        const namespace = resolve(dictionary, spec.namespace)
        if (typeof namespace !== 'object' || namespace === null) {
          missing.push(`${locale}: ${spec.screen} (${spec.namespace})`)
        }
      }
    }
    expect(missing, `screens with no dictionary namespace: ${missing.join(', ')}`).toEqual([])
  })

  it('gives every screen the copy it cannot render without', () => {
    // Titles, empty states and error states. A screen that translated only its
    // main content still shows English while it is loading or when it has
    // nothing to show, and those are the states a new merchant sees first.
    const gaps: string[] = []
    for (const spec of SCREENS) {
      for (const requirement of spec.requires) {
        const value = resolve(en, `${spec.namespace}.${requirement}`)
        if (value === undefined) gaps.push(`${spec.screen}: ${spec.namespace}.${requirement}`)
      }
    }
    expect(gaps, `missing screen copy: ${gaps.join(', ')}`).toEqual([])
  })

  it('translates every screen namespace into Spanish, leaf by leaf', () => {
    /*
     * The generic "not identical to English" test above already covers the whole
     * dictionary, but it is allowed exceptions. This one narrows to the fourteen
     * screens converted in this pass and reports *by screen*, so a regression
     * names the page a merchant would see it on rather than a dotted key.
     */
    const englishLeft: string[] = []
    for (const spec of SCREENS) {
      const englishNode = resolve(en, spec.namespace)
      const spanishNode = resolve(es, spec.namespace)
      const englishLeaves = flatten(englishNode, spec.namespace)
      const spanishByPath = new Map(flatten(spanishNode, spec.namespace).map((l) => [l.path, l.value]))

      for (const leaf of englishLeaves) {
        if (ALLOWED_IDENTICAL.has(leaf.path)) continue
        // Short values (units, symbols, ROI) are legitimately identical.
        if (leaf.value.replace(PLACEHOLDER, '').trim().length <= 3) continue
        if (spanishByPath.get(leaf.path) === leaf.value) {
          englishLeft.push(`${spec.screen} → ${leaf.path}`)
        }
      }
    }
    expect(
      englishLeft,
      `still in English (translate, or add to ALLOWED_IDENTICAL): ${englishLeft.join(', ')}`
    ).toEqual([])
  })
})

describe('interpolation placeholders', () => {
  it('uses exactly the same placeholders in every locale', () => {
    // A translated placeholder — `{precio}` instead of `{price}` — renders as an
    // empty string, so a price silently disappears from a pricing page.
    const mismatched: string[] = []
    for (const [path, value] of enByPath) {
      const spanish = esByPath.get(path)
      if (!spanish) continue
      const expected = placeholdersIn(value).join(',')
      const actual = placeholdersIn(spanish).join(',')
      if (expected !== actual) mismatched.push(`${path}: {${expected}} vs {${actual}}`)
    }
    expect(mismatched, mismatched.join(' | ')).toEqual([])
  })
})

describe('plural pairs', () => {
  it('declares both forms wherever either exists, in both locales', () => {
    // `Intl.PluralRules` selects `_one` or `_other`; a pair with only one form falls
    // back to the raw key and prints `wallet.rules.matched_other` at a merchant.
    const bases = new Set(
      [...enByPath.keys(), ...esByPath.keys()]
        .filter((path) => /_(one|other)$/.test(path))
        .map((path) => path.replace(/_(one|other)$/, ''))
    )

    const incomplete: string[] = []
    for (const base of bases) {
      for (const [locale, map] of [
        ['en', enByPath],
        ['es', esByPath],
      ] as const) {
        if (!map.has(`${base}_one`)) incomplete.push(`${locale}:${base}_one`)
        if (!map.has(`${base}_other`)) incomplete.push(`${locale}:${base}_other`)
      }
    }
    expect(incomplete, incomplete.join(', ')).toEqual([])
  })

  it('selects the right form by count', () => {
    const t = createTranslator('en')
    expect(t('common.days', { count: 1 })).toBe('1 day')
    expect(t('common.days', { count: 3 })).toBe('3 days')
    expect(t('common.days', { count: 0 })).toBe('0 days')
  })

  it('selects the right Spanish form', () => {
    const t = createTranslator('es')
    expect(t('common.days', { count: 1 })).toBe('1 día')
    expect(t('common.days', { count: 5 })).toBe('5 días')
  })
})

describe('translation quality', () => {
  it('actually translates the Spanish, rather than copying the English', () => {
    // The failure this catches is a key added to English and pasted into Spanish
    // untranslated — which produces exactly the mixed-language page the brief
    // forbids, and which the type system cannot see.
    const untranslated = [...enByPath.entries()]
      .filter(([path, value]) => {
        if (ALLOWED_IDENTICAL.has(path)) return false
        const spanish = esByPath.get(path)
        if (!spanish) return false
        // Short values (units, single symbols) are often legitimately identical.
        if (value.replace(PLACEHOLDER, '').trim().length <= 3) return false
        return spanish === value
      })
      .map(([path]) => path)

    expect(
      untranslated,
      `identical to English (translate, or add to ALLOWED_IDENTICAL): ${untranslated.join(', ')}`
    ).toEqual([])
  })
})

describe('createTranslator', () => {
  it('returns the value for a known key', () => {
    expect(createTranslator('en')('common.save')).toBe('Save')
    expect(createTranslator('es')('common.save')).toBe('Guardar')
  })

  it('covers the merchant launch strings', () => {
    expect(createTranslator('en')('common.copy')).toBe('Copy')
    expect(createTranslator('es')('common.copy')).toBe('Copiar')
  })

  it('interpolates named values', () => {
    const t = createTranslator('en')
    expect(t('common.upgradeToUse', { plan: 'Growth' })).toBe('Available from Growth')
  })

  it('localises interpolated numbers', () => {
    // A raw number would leak the wrong thousands separator into every count in the
    // product: 25,000 in English is 25.000 in Spanish.
    //
    // Six figures, not four: Spanish deliberately omits the group separator for
    // exactly four digits (`minimumGroupingDigits: 2`), so `5000` is correct Spanish
    // and would make this assertion test ICU rather than our code.
    expect(createTranslator('en')('landing.pricing.limitCustomers', { count: 123_456 })).toContain(
      '123,456'
    )
    expect(createTranslator('es')('landing.pricing.limitCustomers', { count: 123_456 })).toContain(
      '123.456'
    )
  })

  it('renders a missing interpolation value as empty, not as the placeholder', () => {
    // `{{first_name}}` appearing on a stranger's lock screen is worse than a gap.
    const t = createTranslator('en')
    expect(t('common.upgradeToUse', { plan: undefined })).toBe('Available from ')
    expect(t('common.upgradeToUse', { plan: null })).toBe('Available from ')
  })

  it('returns the key itself for something unknown, rather than throwing', () => {
    // Keys can arrive from data (a skip reason, a template key), and a page must not
    // blank out because a database row named something we do not translate.
    const t = createTranslator('en')
    expect(t('nope.not.a.key' as 'common.save')).toBe('nope.not.a.key')
  })

  it('carries its locale and BCP-47 tag', () => {
    const t = createTranslator('es')
    expect(t.locale).toBe('es')
    expect(t.tag).toBe('es-ES')
  })
})

describe('locale resolution', () => {
  it('validates locale identifiers', () => {
    expect(isLocale('es')).toBe(true)
    expect(isLocale('en')).toBe(true)
    expect(isLocale('fr')).toBe(false)
    expect(isLocale(null)).toBe(false)
  })

  it('falls back to the default for an unusable cookie', () => {
    expect(resolveLocale('en')).toBe('en')
    expect(resolveLocale('klingon')).toBe(DEFAULT_LOCALE)
    expect(resolveLocale(undefined)).toBe(DEFAULT_LOCALE)
  })

  it('reads Accept-Language, honouring quality values', () => {
    expect(localeFromAcceptLanguage('en-GB,en;q=0.9')).toBe('en')
    expect(localeFromAcceptLanguage('es-ES,es;q=0.9,en;q=0.8')).toBe('es')
    // Quality decides, not order.
    expect(localeFromAcceptLanguage('en;q=0.4,es;q=0.9')).toBe('es')
  })

  it('matches on the primary subtag, so regional Spanish is Spanish', () => {
    expect(localeFromAcceptLanguage('es-419')).toBe('es')
    expect(localeFromAcceptLanguage('es-MX,es-419;q=0.9')).toBe('es')
  })

  it('returns null when nothing matches, so the caller picks the default', () => {
    expect(localeFromAcceptLanguage('fr-FR,de;q=0.8')).toBeNull()
    expect(localeFromAcceptLanguage('')).toBeNull()
    expect(localeFromAcceptLanguage(null)).toBeNull()
  })
})

describe('formatters', () => {
  it('places the currency symbol as each language does', () => {
    // Any component concatenating a symbol gets one of these wrong.
    expect(formatCurrency(5, 'en', { currency: 'USD' })).toBe('$5')
    expect(formatCurrency(5, 'es', { currency: 'USD' })).toContain('5')
    expect(formatCurrency(5, 'es', { currency: 'USD' })).toContain('$')
  })

  it('converts minor units when asked', () => {
    expect(formatCurrency(1_999, 'en', { currency: 'USD', cents: true })).toBe('$19.99')
  })

  it('uses the locale thousands separator', () => {
    expect(formatNumber(1_234_567, 'en')).toBe('1,234,567')
    expect(formatNumber(1_234_567, 'es')).toBe('1.234.567')
  })

  it('formats a ratio as a percentage', () => {
    expect(formatPercent(0.2456, 'en')).toBe('24.6%')
    expect(formatPercent(0, 'en')).toBe('0%')
  })

  it('orders date parts as each language does', () => {
    // 2026-03-09 is 9 March. An en-US reader would see 3/9 and a Spanish one 9/3, so
    // any component assembling a date by hand gets one of them wrong.
    const date = '2026-03-09T10:00:00Z'
    expect(formatDate(date, 'en')).toContain('9')
    expect(formatDate(date, 'en')).toMatch(/Mar/)
    expect(formatDate(date, 'es')).toContain('9')
    expect(formatDate(date, 'es')).toMatch(/mar/)
  })

  it('renders a placeholder for an unparseable date rather than "Invalid Date"', () => {
    expect(formatDate('not a date', 'en')).toBe('—')
    expect(formatRelative('not a date', 'en')).toBe('—')
  })

  it('accepts a Date as well as a string', () => {
    expect(formatDate(new Date('2026-03-09T10:00:00Z'), 'en')).toContain('2026')
  })

  it('describes relative time in the right unit and direction', () => {
    const now = Date.now()
    expect(formatRelative(new Date(now - 3 * 86_400_000), 'en')).toBe('3 days ago')
    expect(formatRelative(new Date(now + 2 * 3_600_000), 'en')).toBe('in 2 hours')
    // `numeric: 'auto'` is what turns "1 day ago" into "yesterday".
    expect(formatRelative(new Date(now - 86_400_000), 'en')).toBe('yesterday')
    expect(formatRelative(new Date(now - 5_000), 'en')).toMatch(/second/)
  })

  it('describes relative time in Spanish', () => {
    expect(formatRelative(new Date(Date.now() - 3 * 86_400_000), 'es')).toContain('días')
  })
})
