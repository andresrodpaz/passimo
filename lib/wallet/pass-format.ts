/**
 * Date and placeholder formatting for the card face.
 *
 * One module because three call sites need it — the content builder for "member
 * since", and each provider for offer and expiry dates — and because the bug it
 * exists to prevent is precisely three implementations disagreeing. Every one of
 * them was `toLocaleDateString('en-GB')` before this pass, which printed
 * `14/03/2026` on the card of every customer of every Spanish merchant.
 *
 * Isomorphic: no `server-only`. The dashboard preview formats dates the same way
 * the real pass does, so a merchant is never shown a date format their customer
 * will not get.
 */

import type { Locale } from '@/lib/i18n/locales'

/**
 * The BCP 47 tag a locale's dates are printed with.
 *
 * `es-ES` and `en-GB` rather than `es` and `en` because the bare language tags
 * leave the day/month order to the runtime's default region, which differs
 * between a developer's laptop and a Railway container — a card that reads
 * `03/14` in production and `14/03` locally is not a card anyone can debug.
 */
export function passLocaleTag(locale: Locale): string {
  return locale === 'en' ? 'en-GB' : 'es-ES'
}

/** A short date for a card field. Empty string for anything unparseable. */
export function formatPassDate(iso: string | null | undefined, localeTag: string): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString(localeTag)
}

/** `Mar 2026` / `mar 2026` for the "member since" field. */
export function formatPassMonthYear(
  iso: string | null | undefined,
  localeTag: string
): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString(localeTag, { month: 'short', year: 'numeric' })
}

/**
 * Fills the placeholders left in a `PassLabels` entry.
 *
 * The labels that carry one do so because their value varies per row, so the
 * substitution has to happen in the provider. Kept here rather than inlined so
 * both providers agree on the token syntax with the dictionaries.
 */
export function fillLabel(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match)
}
