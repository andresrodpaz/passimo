/**
 * Locale definitions and detection.
 *
 * Isomorphic and dependency-free, so the middleware, the server components, the
 * client provider and the language toggle all agree about what a locale is and
 * where it is stored.
 */

export const LOCALES = ['es', 'en'] as const
export type Locale = (typeof LOCALES)[number]

/**
 * Spanish is the default because the product is sold into Spanish-speaking local
 * businesses first. This is a market decision, not an accident of ordering.
 */
export const DEFAULT_LOCALE: Locale = 'es'

/**
 * A cookie, not `localStorage`.
 *
 * The previous implementation read `localStorage` inside a `useState` initialiser,
 * which cannot work: the server renders in the default locale, the client
 * re-renders in the stored one, and React reports a hydration mismatch. Worse, the
 * *first paint* a Spanish user saw was English — the exact "mixed language" failure
 * we are required to eliminate. A cookie is readable during SSR, so the first byte
 * is already in the right language.
 */
export const LOCALE_COOKIE = 'passimo_locale'
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

export const LOCALE_LABELS: Record<Locale, string> = {
  es: 'Español',
  en: 'English',
}

/** Short label for the toggle, where horizontal space is scarce. */
export const LOCALE_SHORT: Record<Locale, string> = {
  es: 'ES',
  en: 'EN',
}

/** BCP-47 tags for `Intl` formatting and the `lang` attribute. */
export const LOCALE_TAGS: Record<Locale, string> = {
  es: 'es-ES',
  en: 'en-GB',
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
}

/**
 * Picks a locale from an `Accept-Language` header.
 *
 * Used only when the visitor has no cookie yet — a first-time arrival should land
 * in their own language rather than in ours. Quality values are honoured because a
 * browser configured `en;q=0.9, es;q=1.0` means it.
 */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null

  const ranked = header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';')
      const quality = params
        .map((param) => param.trim())
        .find((param) => param.startsWith('q='))
      return {
        tag: (tag ?? '').trim().toLowerCase(),
        quality: quality ? Number(quality.slice(2)) || 0 : 1,
      }
    })
    .filter((entry) => entry.tag.length > 0)
    .sort((a, b) => b.quality - a.quality)

  for (const entry of ranked) {
    // Match the primary subtag: `es-419` and `es-MX` are both Spanish for us.
    const primary = entry.tag.split('-')[0]
    if (isLocale(primary)) return primary
  }
  return null
}

/** Resolves a locale from a raw cookie value, falling back to the default. */
export function resolveLocale(cookieValue: string | null | undefined): Locale {
  return isLocale(cookieValue) ? cookieValue : DEFAULT_LOCALE
}
