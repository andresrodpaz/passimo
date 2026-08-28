import { en, type Dictionary, type TranslationKey } from '@/lib/i18n/dictionaries/en'
import { es } from '@/lib/i18n/dictionaries/es'
import { DEFAULT_LOCALE, LOCALE_TAGS, type Locale } from '@/lib/i18n/locales'

/**
 * The translation function, as a pure module.
 *
 * Isomorphic and free of React, for two reasons: server components need it without
 * a provider, and it is unit-testable on its own. The React binding in
 * `lib/i18n/index.tsx` is a thin wrapper over these two functions.
 */

export const DICTIONARIES: Record<Locale, Dictionary> = { en, es }

export type TranslationValues = Record<string, string | number | null | undefined>

export type Translator = {
  (key: TranslationKey, values?: TranslationValues): string
  locale: Locale
  /** BCP-47 tag, for `Intl` and the `lang` attribute. */
  tag: string
}

/**
 * Resolves a dotted key against a dictionary.
 *
 * Returns `null` rather than throwing on a miss, so the caller decides. In practice
 * a miss is impossible for a typed key — `TranslationKey` is derived from the
 * dictionary — but a key can also arrive from data (a plan's `copyKey`, a skip
 * reason from the database), and a page must not blank out because a database row
 * named something we do not translate.
 */
function lookup(dictionary: Dictionary, key: string): string | null {
  let node: unknown = dictionary
  for (const segment of key.split('.')) {
    if (typeof node !== 'object' || node === null) return null
    node = (node as Record<string, unknown>)[segment]
  }
  return typeof node === 'string' ? node : null
}

/**
 * Selects the plural form.
 *
 * `Intl.PluralRules` rather than `count === 1`, because the rule differs by
 * language and hardcoding English's is how a Polish or Russian locale becomes
 * impossible to add later. Both languages here happen to be `one`/`other`; the
 * point is that the third one will not need this code changed.
 */
function pluralKey(key: string, locale: Locale, count: number): string {
  const category = new Intl.PluralRules(LOCALE_TAGS[locale]).select(count)
  return `${key}_${category}`
}

const INTERPOLATION = /\{\s*([a-zA-Z0-9_]+)\s*\}/g

function interpolate(template: string, values: TranslationValues, locale: Locale): string {
  return template.replace(INTERPOLATION, (_match, name: string) => {
    const value = values[name]
    if (value === null || value === undefined) return ''
    // Numbers are localised on the way in: 1,000 in English is 1.000 in Spanish,
    // and a template that inserted a raw number would leak the wrong separator
    // into every count in the product.
    return typeof value === 'number'
      ? value.toLocaleString(LOCALE_TAGS[locale])
      : String(value)
  })
}

/**
 * Builds a translator bound to one locale.
 *
 * Fallback order: the requested locale, then the default locale, then the key
 * itself. The middle step matters during development — a key added to English and
 * not yet to Spanish renders in English rather than as `wallet.rules.summary` on a
 * customer's screen. The type system stops that reaching production; this stops it
 * being ugly before then.
 */
export function createTranslator(locale: Locale): Translator {
  const dictionary = DICTIONARIES[locale] ?? DICTIONARIES[DEFAULT_LOCALE]
  const fallback = DICTIONARIES[DEFAULT_LOCALE]

  const translate = ((key: TranslationKey, values?: TranslationValues): string => {
    const count = values?.count
    const resolvedKey =
      typeof count === 'number' ? pluralKey(key, locale, count) : (key as string)

    const template =
      lookup(dictionary, resolvedKey) ??
      lookup(dictionary, key as string) ??
      lookup(fallback, resolvedKey) ??
      lookup(fallback, key as string)

    if (template === null) return key as string
    return values ? interpolate(template, values, locale) : template
  }) as Translator

  translate.locale = locale
  translate.tag = LOCALE_TAGS[locale]
  return translate
}

/**
 * Formats money in the viewer's locale.
 *
 * Here rather than in a component because currency placement is a language fact:
 * `$5.00` in English is `5,00 $` in Spanish, and any component that concatenates a
 * symbol gets one of them wrong.
 */
export function formatCurrency(
  amount: number,
  locale: Locale,
  options: { currency?: string; cents?: boolean; maximumFractionDigits?: number } = {}
): string {
  const value = options.cents ? amount / 100 : amount
  return new Intl.NumberFormat(LOCALE_TAGS[locale], {
    style: 'currency',
    currency: options.currency ?? 'USD',
    /*
     * `narrowSymbol`, not the default.
     *
     * `en-GB` disambiguates a foreign currency by prefixing the country: USD renders
     * as `US$5`, so the pricing page read "From US$5/month" to every English visitor.
     * The narrow symbol is the plain `$` a prospect expects, and the currency is
     * stated once in the plan catalogue rather than repeated in every price.
     */
    currencyDisplay: 'narrowSymbol',
    maximumFractionDigits:
      options.maximumFractionDigits ?? (Number.isInteger(value) ? 0 : 2),
  }).format(value)
}

export function formatNumber(value: number, locale: Locale): string {
  return new Intl.NumberFormat(LOCALE_TAGS[locale]).format(value)
}

export function formatPercent(ratio: number, locale: Locale, fractionDigits = 1): string {
  return new Intl.NumberFormat(LOCALE_TAGS[locale], {
    style: 'percent',
    maximumFractionDigits: fractionDigits,
  }).format(ratio)
}

export function formatDate(
  value: string | Date,
  locale: Locale,
  options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }
): string {
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat(LOCALE_TAGS[locale], options).format(date)
}

/** Relative time ("3 days ago"), which `Intl` gets right in both languages. */
export function formatRelative(value: string | Date, locale: Locale): string {
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return '—'

  const seconds = (date.getTime() - Date.now()) / 1000
  const formatter = new Intl.RelativeTimeFormat(LOCALE_TAGS[locale], { numeric: 'auto' })

  const thresholds: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ]

  for (const [unit, size] of thresholds) {
    if (Math.abs(seconds) >= size) return formatter.format(Math.round(seconds / size), unit)
  }
  return formatter.format(Math.round(seconds), 'second')
}
