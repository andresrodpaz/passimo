import 'server-only'
import { getDb } from '@/lib/db'
import { DEFAULT_LOCALE, resolveLocale, type Locale } from '@/lib/i18n/locales'
import { createTranslator, type Translator } from '@/lib/i18n/translate'

/**
 * The language a *business* is written to in, as opposed to the language the
 * person in front of a browser is reading in.
 *
 * Most translation in the product is request-scoped: the cookie says what the
 * viewer chose and `lib/i18n/server.ts` resolves it. That is exactly wrong for
 * anything produced without a request — a dunning email sent by a cron job, a
 * notification written by a Stripe webhook, an overage warning raised during
 * someone else's scan. Those have no viewer, and defaulting them to the
 * platform's language means a Spanish café gets an English invoice warning.
 *
 * The `businesses.locale` column already exists and is editable in Settings, so
 * merchant-facing background output resolves from there. Memoised for a minute:
 * a fan-out that writes one notification per business would otherwise read the
 * same row hundreds of times, and a language change is not urgent.
 */

const CACHE_TTL_MS = 60_000
const cache = new Map<string, { locale: Locale; expiresAt: number }>()

export function invalidateBusinessLocale(businessId?: string): void {
  if (businessId) cache.delete(businessId)
  else cache.clear()
}

export async function getBusinessLocale(businessId: string): Promise<Locale> {
  const cached = cache.get(businessId)
  if (cached && cached.expiresAt > Date.now()) return cached.locale

  try {
    const admin = getDb()
    const { data } = await admin
      .from('businesses')
      .select('locale')
      .eq('id', businessId)
      .maybeSingle()

    const locale = resolveLocale(data?.locale as string | undefined)
    cache.set(businessId, { locale, expiresAt: Date.now() + CACHE_TTL_MS })
    return locale
  } catch {
    // An unreadable row must not stop an email going out. The default locale is
    // a worse greeting than the right one and a far better outcome than silence.
    return DEFAULT_LOCALE
  }
}

/** A translator bound to the merchant's own language, for background work. */
export async function translatorForBusiness(businessId: string): Promise<Translator> {
  return createTranslator(await getBusinessLocale(businessId))
}
