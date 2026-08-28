import { describe, expect, it } from 'vitest'
import { buildApplePassJson } from '@/lib/wallet/apple-pass'
import {
  buildGoogleLoyaltyClass,
  buildGoogleLoyaltyObject,
  googleClassId,
  googleObjectId,
} from '@/lib/wallet/google-loyalty-jwt'
import { buildPassLabels } from '@/lib/wallet/pass-content'
import { fillLabel, formatPassDate, formatPassMonthYear, passLocaleTag } from '@/lib/wallet/pass-format'
import { createTranslator } from '@/lib/i18n/translate'
import { DEFAULT_CARD_DESIGN, resolveCardDesign } from '@/lib/wallet/card-design'
import { placeholderBrandKit } from '@/lib/brand/kit'
import type { Locale } from '@/lib/i18n/locales'
import type { WalletPassContent } from '@/lib/wallet/types'

/**
 * What the two providers actually emit.
 *
 * `buildApplePassJson` and `buildGoogleLoyaltyObject` are exported separately
 * from the signing and network steps precisely so this file can exist: the
 * repository ships without Apple or Google credentials, so asserting on the
 * structure is the only way the pass builders are verifiable at all.
 *
 * The bulk of it is a language guard. Every label on a card used to be an
 * English literal in these two files, which meant a Spanish café's customers
 * carried a card reading MEMBER / SINCE / TO GO with `en-GB` dates. The card is
 * the most permanent surface the product has — installed once, read for months,
 * and not correctable by the merchant from the dashboard — so "no English leaked
 * into a Spanish pass" is asserted directly against the serialised output rather
 * than trusted.
 */

/**
 * Phrases distinctive enough to scan for as substrings.
 *
 * Deliberately multi-word or fully capitalised. Short words are excluded on
 * purpose: `Contact` is a substring of the correct Spanish `Contacto`, and
 * `logo` appears in every logo URL, so scanning for those produces failures
 * that say nothing about language. Those labels are pinned by exact assertion
 * in `EXPECTED_SPANISH_LABELS` instead.
 */
const ENGLISH_PHRASES_REMOVED = [
  'TO GO',
  'MEMBER',
  'SINCE',
  'TIER',
  'How it works',
  'Invite a friend',
  'Points expire',
  'Where to use it',
  'Manage your card',
  'View your card',
  'READY TO CLAIM',
  'NEXT REWARD',
  'Ready to claim',
  'Your next reward',
  'Show this card at the counter',
  'You now have',
  'Share your code',
  'Offer — until',
  'you both get rewarded',
]

/**
 * The short labels, pinned exactly.
 *
 * These are the ones a substring scan cannot police, so they are asserted by
 * value — which is stricter anyway: it catches a label going missing as well as
 * a label reverting to English.
 */
const EXPECTED_SPANISH_LABELS = {
  website: 'Web',
  contact: 'Contacto',
  goal: 'Objetivo',
  memberFallback: 'Cliente',
  offer: 'Oferta',
  where: 'Dónde usarla',
} as const

function content(locale: Locale, overrides: Partial<WalletPassContent> = {}): WalletPassContent {
  const t = createTranslator(locale)
  const brand = placeholderBrandKit('Café Central')
  const design = resolveCardDesign(DEFAULT_CARD_DESIGN, brand, {
    goal: 10,
    isStampProgram: true,
  })

  return {
    serialNumber: 'c0ffee00-1111-2222-3333-444455556666',
    customerId: 'c0ffee00-1111-2222-3333-444455556666',
    businessId: 'b0b0b0b0-1111-2222-3333-444455556666',
    authenticationToken: 'tok_abcdef0123456789',

    organizationName: 'Café Central',
    programName: 'Recompensas de Café Central',
    description: 'Tarjeta de fidelización de Café Central',

    labels: buildPassLabels(t, {
      locale,
      localeTag: passLocaleTag(locale),
      businessName: 'Café Central',
      goal: 10,
      unitPlural: locale === 'es' ? 'sellos' : 'stamps',
      rewardName: locale === 'es' ? 'un café gratis' : 'a free coffee',
      referralCode: 'CAFE123',
    }),

    branding: {
      backgroundColor: design.backgroundColor,
      foregroundColor: design.foregroundColor,
      labelColor: design.accentColor,
      logoUrl: 'https://cdn.example.test/logo.png',
      heroImageUrl: 'https://cdn.example.test/hero.png',
    },

    design,

    member: {
      name: 'Ana',
      since: formatPassMonthYear('2026-03-14T10:00:00.000Z', passLocaleTag(locale)),
      tierName: locale === 'es' ? 'Oro' : 'Gold',
      isVip: false,
    },

    progress: {
      balance: 7,
      goal: 10,
      unitSingular: locale === 'es' ? 'sello' : 'stamp',
      unitPlural: locale === 'es' ? 'sellos' : 'stamps',
      rewardName: locale === 'es' ? 'un café gratis' : 'a free coffee',
      rewardReady: false,
      remaining: 3,
      expiresAt: '2027-01-31T00:00:00.000Z',
    },

    relevantLocations: [
      {
        id: 'l1',
        name: 'Gran Vía',
        coordinates: { lat: 40.42, lng: -3.7 },
        radiusMeters: 150,
        relevantText: 'Estás cerca de Gran Vía',
        beacon: null,
      },
      {
        id: 'l2',
        name: 'Chamberí',
        coordinates: { lat: 40.43, lng: -3.71 },
        radiusMeters: 400,
        relevantText: 'Estás cerca de Chamberí',
        beacon: null,
      },
    ],

    offers: [
      {
        id: 'o1',
        title: 'Sellos dobles',
        description: 'Todo el fin de semana',
        expiresAt: '2026-12-24T00:00:00.000Z',
      },
      { id: 'o2', title: 'Bollería a mitad de precio', description: null, expiresAt: null },
    ],

    links: {
      cardUrl: 'https://passimo.test/card/tok',
      webServiceUrl: 'https://passimo.test/api/v1/wallet/apple',
      websiteUrl: 'https://cafecentral.test',
      supportEmail: 'hola@cafecentral.test',
    },

    referralCode: 'CAFE123',
    expiresAt: null,
    ...overrides,
  }
}

/** Every string anywhere in a structure, so a leak cannot hide in a nested field. */
function strings(node: unknown): string[] {
  if (typeof node === 'string') return [node]
  if (Array.isArray(node)) return node.flatMap(strings)
  if (node && typeof node === 'object') return Object.values(node).flatMap(strings)
  return []
}

describe('pass-format', () => {
  it('pins a region, not just a language', () => {
    /*
     * `es` and `en` alone would leave day/month order to the runtime default,
     * which differs between a laptop and a container — a card reading 03/14 in
     * production and 14/03 locally is not debuggable.
     */
    expect(passLocaleTag('es')).toBe('es-ES')
    expect(passLocaleTag('en')).toBe('en-GB')
  })

  it('formats a date in the given locale’s own convention', () => {
    expect(formatPassDate('2026-12-24T00:00:00.000Z', 'en-GB')).toBe('24/12/2026')
    expect(formatPassDate('2026-12-24T00:00:00.000Z', 'es-ES')).toBe('24/12/2026')
    // The two diverge on padding, which is each locale's correct default and
    // the reason the tag is pinned rather than left to the runtime.
    expect(formatPassDate('2027-01-31T00:00:00.000Z', 'en-GB')).toBe('31/01/2027')
    expect(formatPassDate('2027-01-31T00:00:00.000Z', 'es-ES')).toBe('31/1/2027')
  })

  it('returns an empty string for a missing or unparseable date', () => {
    // A card field must never read "Invalid Date".
    expect(formatPassDate(null, 'es-ES')).toBe('')
    expect(formatPassDate(undefined, 'es-ES')).toBe('')
    expect(formatPassDate('not a date', 'es-ES')).toBe('')
  })

  it('formats "member since" as a month and year in the right language', () => {
    expect(formatPassMonthYear('2026-03-14T00:00:00.000Z', 'en-GB')).toMatch(/Mar/)
    expect(formatPassMonthYear('2026-03-14T00:00:00.000Z', 'es-ES')).toMatch(/mar/)
    expect(formatPassMonthYear(null, 'es-ES')).toBeNull()
  })

  it('fills placeholders and leaves unknown ones intact', () => {
    expect(fillLabel('Oferta — hasta el {date}', { date: '24/12/2026' })).toBe(
      'Oferta — hasta el 24/12/2026'
    )
    // Blanking an unmatched token would silently delete part of a label.
    expect(fillLabel('a {unknown} b', {})).toBe('a {unknown} b')
  })
})

describe('buildPassLabels', () => {
  it('resolves every label in the business language', () => {
    const labels = content('es').labels
    expect(labels.member).toBe('CLIENTE')
    expect(labels.since).toBe('DESDE')
    expect(labels.toGo).toBe('TE FALTAN')
    expect(labels.manageCard).toBe('Gestiona tu tarjeta')
    expect(labels.localeTag).toBe('es-ES')
    expect(labels.language).toBe('es')
  })

  it('interpolates the merchant’s own unit into the balance-change message', () => {
    // `%@` is Apple's substitution token and has to survive translation.
    expect(content('es').labels.balanceChange).toBe('Ahora tienes %@ sellos')
    expect(content('en').labels.balanceChange).toBe('You now have %@ stamps')
  })

  it('describes a goal program and an open-ended one differently', () => {
    const withGoal = buildPassLabels(createTranslator('en'), {
      locale: 'en',
      localeTag: 'en-GB',
      businessName: 'B',
      goal: 10,
      unitPlural: 'stamps',
      rewardName: 'a free coffee',
      referralCode: null,
    })
    const openEnded = buildPassLabels(createTranslator('en'), {
      locale: 'en',
      localeTag: 'en-GB',
      businessName: 'B',
      goal: null,
      unitPlural: 'points',
      rewardName: null,
      referralCode: null,
    })

    expect(withGoal.howItWorksBody).toContain('10')
    expect(withGoal.howItWorksBody).toContain('a free coffee')
    expect(openEnded.howItWorksBody).not.toContain('10')
    expect(openEnded.howItWorksBody).toContain('points')
  })

  it('falls back to a translated "your reward" when the program names none', () => {
    const labels = buildPassLabels(createTranslator('es'), {
      locale: 'es',
      localeTag: 'es-ES',
      businessName: 'B',
      goal: 5,
      unitPlural: 'sellos',
      rewardName: null,
      referralCode: null,
    })
    expect(labels.howItWorksBody).toContain('tu recompensa')
  })

  it('leaves the referral lines empty when there is no code to share', () => {
    const labels = buildPassLabels(createTranslator('es'), {
      locale: 'es',
      localeTag: 'es-ES',
      businessName: 'B',
      goal: null,
      unitPlural: 'puntos',
      rewardName: null,
      referralCode: null,
    })
    expect(labels.referralBody).toBe('')
    expect(labels.referralBodyShort).toBe('')
  })
})

describe('buildApplePassJson', () => {
  it('carries the identity Apple needs to install a pass', () => {
    const pass = buildApplePassJson(content('es'))
    expect(pass.formatVersion).toBe(1)
    expect(pass.serialNumber).toBe('c0ffee00-1111-2222-3333-444455556666')
    expect(pass.authenticationToken).toBe('tok_abcdef0123456789')
    expect(pass.organizationName).toBe('Café Central')
  })

  it('converts the resolved design colours to the rgb() strings Apple wants', () => {
    const pass = buildApplePassJson(content('es'))
    expect(pass.backgroundColor).toMatch(/^rgb\(\d+,\d+,\d+\)$/)
    expect(pass.foregroundColor).toMatch(/^rgb\(\d+,\d+,\d+\)$/)
    expect(pass.labelColor).toMatch(/^rgb\(\d+,\d+,\d+\)$/)
  })

  it('shows the balance against the goal, labelled with the merchant’s unit', () => {
    const store = (buildApplePassJson(content('es')) as never as {
      storeCard: { primaryFields: Array<{ label: string; value: string; changeMessage: string }> }
    }).storeCard
    expect(store.primaryFields[0]?.value).toBe('7 / 10')
    expect(store.primaryFields[0]?.label).toBe('SELLOS')
    expect(store.primaryFields[0]?.changeMessage).toBe('Ahora tienes %@ sellos')
  })

  it('drops the goal from the balance when the program is open-ended', () => {
    const open = content('es', {
      progress: { ...content('es').progress, goal: null, remaining: null },
    })
    const store = (buildApplePassJson(open) as never as {
      storeCard: { primaryFields: Array<{ value: string }> }
    }).storeCard
    expect(store.primaryFields[0]?.value).toBe('7')
  })

  it('switches the reward label when the reward is claimable', () => {
    const ready = content('es', {
      progress: { ...content('es').progress, rewardReady: true, remaining: 0 },
    })
    const store = (buildApplePassJson(ready) as never as {
      storeCard: { secondaryFields: Array<{ key: string; label: string }> }
    }).storeCard
    const reward = store.secondaryFields.find((field) => field.key === 'reward')
    expect(reward?.label).toBe('LISTA PARA CANJEAR')
    // Nothing left to go, so the field is omitted rather than showing zero.
    expect(store.secondaryFields.find((field) => field.key === 'remaining')).toBeUndefined()
  })

  it('uses the singular unit when exactly one is left', () => {
    const one = content('es', { progress: { ...content('es').progress, remaining: 1 } })
    const store = (buildApplePassJson(one) as never as {
      storeCard: { secondaryFields: Array<{ key: string; value: string }> }
    }).storeCard
    expect(store.secondaryFields.find((f) => f.key === 'remaining')?.value).toBe('1 sello')
  })

  it('formats the offer and expiry dates in the business locale', () => {
    const back = (buildApplePassJson(content('es')) as never as {
      storeCard: { backFields: Array<{ key: string; label: string; value: string }> }
    }).storeCard.backFields

    expect(back.find((f) => f.key === 'offer-0')?.label).toBe('Oferta — hasta el 24/12/2026')
    // An offer with no end date gets the bare label, not a broken one.
    expect(back.find((f) => f.key === 'offer-1')?.label).toBe('Oferta')
    expect(back.find((f) => f.key === 'expiry')?.label).toBe('Los sellos caducan')
    // Unpadded: `es-ES` renders 31/1/2027 where `en-GB` renders 31/01/2027.
    // Both are that locale's own convention, which is the point of the tag.
    expect(back.find((f) => f.key === 'expiry')?.value).toBe('31/1/2027')
  })

  it('caps locations at Apple’s limit and takes the widest configured radius', () => {
    const many = content('es', {
      relevantLocations: Array.from({ length: 14 }, (_, index) => ({
        id: `l${index}`,
        name: `Sitio ${index}`,
        coordinates: { lat: 40 + index / 100, lng: -3.7 },
        radiusMeters: 100 + index * 10,
        relevantText: `Estás cerca de Sitio ${index}`,
        beacon: null,
      })),
    })
    const pass = buildApplePassJson(many) as never as {
      locations: unknown[]
      maxDistance: number
    }
    expect(pass.locations).toHaveLength(10)
    /*
     * The widest of the *included* radii. A smaller value would silently
     * suppress relevance for the site the merchant deliberately widened.
     */
    expect(pass.maxDistance).toBe(190)
  })

  it('omits locations entirely when lock-screen suggestions are off', () => {
    const pass = buildApplePassJson(content('es'), {
      settings: { appleLockScreenSuggestions: false, beaconsEnabled: false },
    })
    expect(pass.locations).toBeUndefined()
    expect(pass.maxDistance).toBeUndefined()
  })

  it('always emits a QR the merchant scanner can resolve to the customer', () => {
    const barcodes = (buildApplePassJson(content('es')) as never as {
      barcodes: Array<{ format: string; message: string }>
    }).barcodes
    expect(barcodes.some((code) => code.format === 'PKBarcodeFormatQR')).toBe(true)
    for (const code of barcodes) {
      expect(code.message).toBe('c0ffee00-1111-2222-3333-444455556666')
    }
  })

  it('leaves no English phrase on a Spanish pass', () => {
    const values = strings(buildApplePassJson(content('es'))).join('\n')
    for (const phrase of ENGLISH_PHRASES_REMOVED) {
      expect(values, phrase).not.toContain(phrase)
    }
  })

  it('pins the short back-field labels to their Spanish values', () => {
    const back = (buildApplePassJson(content('es')) as never as {
      storeCard: { backFields: Array<{ key: string; label: string }> }
    }).storeCard.backFields
    const labelFor = (key: string) => back.find((field) => field.key === key)?.label

    expect(labelFor('web')).toBe(EXPECTED_SPANISH_LABELS.website)
    expect(labelFor('support')).toBe(EXPECTED_SPANISH_LABELS.contact)
    expect(labelFor('where')).toBe(EXPECTED_SPANISH_LABELS.where)
    expect(labelFor('offer-1')).toBe(EXPECTED_SPANISH_LABELS.offer)
  })

  it('still produces an English pass for an English merchant', () => {
    const back = (buildApplePassJson(content('en')) as never as {
      storeCard: { backFields: Array<{ key: string; label: string }> }
    }).storeCard.backFields
    expect(back.find((f) => f.key === 'how')?.label).toBe('How it works')
    expect(back.find((f) => f.key === 'card')?.label).toBe('Manage your card')
  })
})

describe('buildGoogleLoyaltyObject', () => {
  it('matches the class it belongs to', () => {
    const object = buildGoogleLoyaltyObject(content('es')) as never as {
      id: string
      classId: string
      state: string
    }
    const klass = buildGoogleLoyaltyClass(content('es')) as never as { id: string }
    expect(object.classId).toBe(klass.id)
    expect(object.state).toBe('ACTIVE')
  })

  it('reports the same balance Apple reports', () => {
    // The whole point of one content shape: two customers standing next to each
    // other must not be told different balances.
    const apple = buildApplePassJson(content('es')) as never as {
      storeCard: { primaryFields: Array<{ value: string }> }
    }
    const google = buildGoogleLoyaltyObject(content('es')) as never as {
      loyaltyPoints: { balance: { string: string } }
      secondaryLoyaltyPoints: { balance: { string: string } }
    }
    expect(google.loyaltyPoints.balance.string).toBe('7')
    expect(google.secondaryLoyaltyPoints.balance.string).toBe('10')
    expect(apple.storeCard.primaryFields[0]?.value).toBe('7 / 10')
  })

  it('labels the goal in the business language', () => {
    const google = buildGoogleLoyaltyObject(content('es')) as never as {
      secondaryLoyaltyPoints: { label: string }
    }
    expect(google.secondaryLoyaltyPoints.label).toBe('Objetivo')
  })

  it('omits the goal block for an open-ended program', () => {
    const open = content('es', { progress: { ...content('es').progress, goal: null } })
    expect(
      (buildGoogleLoyaltyObject(open) as never as { secondaryLoyaltyPoints?: unknown })
        .secondaryLoyaltyPoints
    ).toBeUndefined()
  })

  it('drops offers when dynamic content is switched off', () => {
    const modules = (
      buildGoogleLoyaltyObject(content('es'), {
        settings: { googleWalletSuggestions: true, dynamicPassContent: false },
      }) as never as { textModulesData: Array<{ id: string }> }
    ).textModulesData
    expect(modules.some((module) => module.id.startsWith('offer-'))).toBe(false)
    // The reward module is not an offer and must survive.
    expect(modules.some((module) => module.id === 'reward')).toBe(true)
  })

  it('declares the business language on its localised metadata', () => {
    /*
     * Google reads these tags to decide what a screen reader announces.
     * Declaring Spanish copy as English made the accessibility label wrong on
     * every Android phone that installed the card.
     */
    const klass = buildGoogleLoyaltyClass(content('es')) as never as {
      localizedIssuerName: { defaultValue: { language: string } }
      programLogo: { contentDescription: { defaultValue: { language: string; value: string } } }
    }
    expect(klass.localizedIssuerName.defaultValue.language).toBe('es')
    expect(klass.programLogo.contentDescription.defaultValue.language).toBe('es')
    expect(klass.programLogo.contentDescription.defaultValue.value).toBe('Logo de Café Central')
  })

  it('leaves no English phrase on a Spanish pass', () => {
    const values = [
      ...strings(buildGoogleLoyaltyObject(content('es'))),
      ...strings(buildGoogleLoyaltyClass(content('es'))),
    ].join('\n')
    for (const phrase of ENGLISH_PHRASES_REMOVED) {
      expect(values, phrase).not.toContain(phrase)
    }
  })

  it('pins the short labels to their Spanish values', () => {
    const object = buildGoogleLoyaltyObject(
      content('es', { member: { ...content('es').member, name: null } })
    ) as never as {
      accountName: string
      secondaryLoyaltyPoints: { label: string }
      linksModuleData: { uris: Array<{ description: string }> }
    }
    expect(object.secondaryLoyaltyPoints.label).toBe(EXPECTED_SPANISH_LABELS.goal)
    // The fallback used when a customer never gave a name.
    expect(object.accountName).toBe(EXPECTED_SPANISH_LABELS.memberFallback)
    expect(object.linksModuleData.uris[0]?.description).toBe('Gestiona tu tarjeta')
  })
})

describe('google ids', () => {
  it('strips hyphens, because Google requires an alphanumeric suffix', () => {
    expect(googleClassId('b0b0b0b0-1111-2222', 'issuer')).toBe('issuer.b0b0b0b011112222')
    expect(googleObjectId('c0ffee00-1111-2222', 'issuer')).toBe('issuer.c0ffee0011112222')
  })

  it('is stable, because a Google id is immutable once created', () => {
    // A second implementation that formatted a hyphen differently would create
    // a duplicate class per merchant, which is not reversible.
    expect(googleClassId('b-1', 'i')).toBe(googleClassId('b-1', 'i'))
  })
})
