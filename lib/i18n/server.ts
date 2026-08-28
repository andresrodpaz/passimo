import 'server-only'
import { cookies, headers } from 'next/headers'
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  localeFromAcceptLanguage,
  resolveLocale,
  type Locale,
} from '@/lib/i18n/locales'
import { createTranslator, type Translator } from '@/lib/i18n/translate'

/**
 * Server-side locale resolution.
 *
 * The single source of "what language is this request in", used by the root layout
 * (to set `<html lang>` and seed the client provider), by server components, and by
 * metadata generation.
 *
 * Resolution order:
 *   1. the cookie — an explicit choice always wins;
 *   2. `Accept-Language` — a first-time visitor should land in their own language
 *      rather than in ours;
 *   3. the default.
 */
export async function getLocale(): Promise<Locale> {
  const store = await cookies()
  const chosen = store.get(LOCALE_COOKIE)?.value
  if (chosen) return resolveLocale(chosen)

  try {
    const headerList = await headers()
    return localeFromAcceptLanguage(headerList.get('accept-language')) ?? DEFAULT_LOCALE
  } catch {
    // `headers()` is unavailable during static generation; the default is correct
    // there, and the client provider corrects it on first paint from the cookie.
    return DEFAULT_LOCALE
  }
}

/** A translator for a server component. */
export async function getTranslator(): Promise<Translator> {
  return createTranslator(await getLocale())
}
