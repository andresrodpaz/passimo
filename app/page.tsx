import type { Metadata } from 'next'
import { LandingPage } from '@/components/landing/landing-page'
import { StructuredData } from '@/components/structured-data'
import { getLocale } from '@/lib/i18n/server'
import { env } from '@/lib/env'
import { createTranslator } from '@/lib/i18n/translate'

/**
 * The marketing page.
 *
 * A thin server shell around a client component. The page itself is interactive
 * — the demo runs a simulated scan, the pricing table toggles interval, the
 * comparison table animates — so it has to be a client component, and a client
 * component can neither read `lib/env` (which touches the filesystem for wallet
 * certificates) nor export `generateMetadata`.
 *
 * Splitting them buys the two things a launch page cannot ship without: a
 * `<script type="application/ld+json">` rendered in the initial HTML where
 * crawlers and link scrapers actually look for it, and page-level metadata that
 * follows the visitor's language.
 */

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale()
  const t = createTranslator(locale)

  const title = `${t('common.appName')} — ${t('common.tagline')}`

  return {
    // `absolute`, so the root layout's `%s — Passimo` template does not turn the
    // home page into "Passimo — … — Passimo".
    title: { absolute: title },
    description: t('landing.hero.subtitle'),
    alternates: { canonical: '/' },
  }
}

export default async function Page() {
  const locale = await getLocale()

  /*
   * Two things the client component cannot read for itself, resolved here.
   *
   * `siteHost` is what the mock browser chrome in the product showcase displays.
   * Hardcoding `passimo.app` there would put an unpurchased domain on the
   * marketing page as if it were live.
   *
   * `contactEmail` is null until a mailbox exists, and the footer omits the link
   * rather than rendering a `mailto:` that silently goes nowhere.
   */
  let siteHost = 'localhost:3000'
  try {
    siteHost = new URL(env.appUrl).host
  } catch {
    // Keep the default; a malformed app URL is reported elsewhere.
  }

  return (
    <>
      <StructuredData locale={locale} />
      <LandingPage siteHost={siteHost} contactEmail={env.contact.support} />
    </>
  )
}
