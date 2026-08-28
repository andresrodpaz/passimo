import type { MetadataRoute } from 'next'
import { env } from '@/lib/env'
import { LEGAL_DOCUMENTS } from '@/lib/legal/documents'
import { LOCALES } from '@/lib/i18n/locales'

/**
 * The sitemap.
 *
 * Deliberately short. Only pages that are genuinely public, genuinely stable and
 * genuinely worth ranking are listed: the marketing page, the two entry points,
 * and the three legal documents. There is no attempt to enumerate merchant join
 * pages — `/join/<slug>` is a live tenant surface, and a sitemap that grew a row
 * per business would publish our customer list to competitors.
 *
 * No invented pages either. It would be easy to manufacture a dozen
 * `/features/<thing>` routes for keyword coverage; they would be thin, they would
 * not convert, and they would each be another screen to keep translated.
 *
 * `alternates.languages` is what tells a crawler that one URL serves two
 * languages. The product picks the locale from a cookie and `Accept-Language`
 * rather than a path prefix, so English and Spanish share a URL — without the
 * hreflang hints, a search engine indexes whichever language it happened to be
 * served and shows it to everyone.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = env.appUrl

  /*
   * A build-time constant, not `new Date()`. `lastModified` is a claim about the
   * content, and stamping every route with the moment the sitemap was requested
   * tells crawlers the whole site changed on every deploy — which trains them to
   * ignore the field.
   */
  const lastModified = new Date('2026-08-18')

  const alternates = {
    languages: Object.fromEntries(LOCALES.map((locale) => [locale, base])),
  }

  const entries: MetadataRoute.Sitemap = [
    {
      url: base,
      lastModified,
      changeFrequency: 'weekly',
      priority: 1,
      alternates,
    },
    {
      url: `${base}/signup`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.8,
      alternates: { languages: languagesFor(base, '/signup') },
    },
    {
      url: `${base}/login`,
      lastModified,
      changeFrequency: 'yearly',
      priority: 0.3,
      alternates: { languages: languagesFor(base, '/login') },
    },
  ]

  for (const document of LEGAL_DOCUMENTS) {
    entries.push({
      url: `${base}/legal/${document}`,
      lastModified,
      changeFrequency: 'yearly',
      priority: 0.2,
      alternates: { languages: languagesFor(base, `/legal/${document}`) },
    })
  }

  return entries
}

function languagesFor(base: string, path: string): Record<string, string> {
  return Object.fromEntries(LOCALES.map((locale) => [locale, `${base}${path}`]))
}
