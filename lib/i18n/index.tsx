'use client'

import * as React from 'react'
import {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_LABELS,
  LOCALE_SHORT,
  LOCALE_TAGS,
  isLocale,
  type Locale,
} from '@/lib/i18n/locales'
import {
  createTranslator,
  formatCurrency,
  formatDate,
  formatNumber,
  formatPercent,
  formatRelative,
  type TranslationValues,
  type Translator,
} from '@/lib/i18n/translate'
import type { TranslationKey } from '@/lib/i18n/dictionaries/en'

/**
 * The React binding for translations.
 *
 * The important change from the previous implementation: **the locale arrives as a
 * prop from the server**, read from a cookie during SSR. Before, it was read from
 * `localStorage` inside a `useState` initialiser, which meant the server rendered
 * Spanish, the client re-rendered in whatever was stored, React reported a
 * hydration mismatch, and — worst of all — a Spanish user's first paint was in
 * English. That first paint is precisely the "mixed languages on one page" failure
 * we are required to eliminate, and no amount of extracting strings would have
 * fixed it.
 *
 * Switching language sets the cookie and refreshes, so the server re-renders in the
 * new language. Slightly slower than a client-side swap, and correct — server
 * components, metadata, and emails triggered by the page all follow.
 */

export type I18nValue = {
  locale: Locale
  /** BCP-47 tag, for `Intl` calls in components. */
  tag: string
  t: Translator
  setLocale: (locale: Locale) => void
  locales: readonly Locale[]
  labels: Record<Locale, string>
  shortLabels: Record<Locale, string>
  /** Locale-aware formatters, so no component reaches for `Intl` directly. */
  formatCurrency: (amount: number, options?: { currency?: string; cents?: boolean }) => string
  formatNumber: (value: number) => string
  formatPercent: (ratio: number, fractionDigits?: number) => string
  formatDate: (value: string | Date, options?: Intl.DateTimeFormatOptions) => string
  formatRelative: (value: string | Date) => string
}

const I18nContext = React.createContext<I18nValue | null>(null)

export function I18nProvider({
  locale: initialLocale,
  children,
}: {
  /**
   * Resolved on the server from the cookie. Optional so a stray client-only tree
   * still renders, in the default locale, rather than crashing.
   */
  locale?: Locale
  children: React.ReactNode
}) {
  /*
   * No local state. The server prop is the only source of truth, which it can be
   * because switching language writes the cookie and reloads — so the next render
   * arrives with the new value already resolved server-side.
   *
   * Mirroring the prop into `useState` (the obvious first design) needs an effect to
   * stay in step, and a `setState` inside an effect is a cascading render on every
   * navigation. Deriving it is both simpler and strictly more correct: there is no
   * window in which the client's idea of the locale differs from the `<html lang>`
   * the server just sent.
   */
  const locale = initialLocale ?? DEFAULT_LOCALE

  const setLocale = React.useCallback((next: Locale) => {
    if (!isLocale(next)) return
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`
    // A full reload rather than `router.refresh()`: the `<html lang>` attribute and
    // the server-rendered metadata are set outside React's tree, and a soft refresh
    // leaves them stale — which screen readers and search engines both notice.
    window.location.reload()
  }, [])

  const value = React.useMemo<I18nValue>(() => {
    const t = createTranslator(locale)
    return {
      locale,
      tag: LOCALE_TAGS[locale],
      t,
      setLocale,
      locales: LOCALES,
      labels: LOCALE_LABELS,
      shortLabels: LOCALE_SHORT,
      formatCurrency: (amount, options) => formatCurrency(amount, locale, options),
      formatNumber: (input) => formatNumber(input, locale),
      formatPercent: (ratio, fractionDigits) => formatPercent(ratio, locale, fractionDigits),
      formatDate: (input, options) => formatDate(input, locale, options),
      formatRelative: (input) => formatRelative(input, locale),
    }
  }, [locale, setLocale])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const context = React.useContext(I18nContext)
  if (!context) throw new Error('useI18n must be used inside an I18nProvider')
  return context
}

/** The common case, so components can write `const t = useT()`. */
export function useT(): Translator {
  return useI18n().t
}

export type { Locale, TranslationKey, TranslationValues }
export { LOCALES, LOCALE_LABELS, LOCALE_SHORT, isLocale }
