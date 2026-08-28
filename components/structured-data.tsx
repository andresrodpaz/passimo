import { env } from '@/lib/env'
import { PLAN_CURRENCY, PUBLIC_PLANS } from '@/lib/billing/plans'
import type { Locale } from '@/lib/i18n/locales'
import { createTranslator } from '@/lib/i18n/translate'

/**
 * Schema.org markup for the marketing page.
 *
 * Two things it buys: a search result that can show the price range rather than
 * a bare blue link, and a machine-readable answer to "what is this and what does
 * it cost" for the assistants that increasingly answer that question instead of
 * a search page.
 *
 * The offers are generated from `lib/billing/plans.ts` — the same catalogue the
 * pricing cards, the checkout session and the entitlement checks read. Structured
 * data is the easiest thing in a codebase to leave stale, and stale pricing in a
 * rich result is the kind of error that gets quoted back during a support
 * conversation. If a tier's price changes, this changes with it or not at all.
 *
 * Deliberately modest in its claims: `Organization`, `SoftwareApplication` and
 * the real offers. No `aggregateRating`, no `review` — inventing either would put
 * fabricated stars in a search result, which is both a lie and a Google
 * structured-data violation.
 */
export function StructuredData({ locale }: { locale: Locale }) {
  const t = createTranslator(locale)
  const base = env.appUrl
  const appName = t('common.appName')

  const prices = PUBLIC_PLANS.map((plan) => plan.monthlyPrice).filter(
    (price): price is number => price !== null
  )

  const graph = [
    {
      '@type': 'Organization',
      '@id': `${base}/#organization`,
      name: appName,
      url: base,
      logo: `${base}/icon.svg`,
      description: t('common.tagline'),
    },
    {
      '@type': 'WebSite',
      '@id': `${base}/#website`,
      url: base,
      name: appName,
      description: t('common.tagline'),
      publisher: { '@id': `${base}/#organization` },
      inLanguage: locale,
    },
    {
      '@type': 'SoftwareApplication',
      '@id': `${base}/#application`,
      name: appName,
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web, iOS, Android',
      description: t('landing.hero.subtitle'),
      publisher: { '@id': `${base}/#organization` },
      /*
       * `AggregateOffer` rather than a list of `Offer`s: it is what lets a result
       * render "from $5" honestly, which is the number a café owner is deciding
       * on. `offerCount` and the bounds all come from the catalogue.
       */
      offers: {
        '@type': 'AggregateOffer',
        priceCurrency: PLAN_CURRENCY,
        lowPrice: Math.min(...prices),
        highPrice: Math.max(...prices),
        offerCount: PUBLIC_PLANS.length,
        offers: PUBLIC_PLANS.map((plan) => ({
          '@type': 'Offer',
          name: plan.name,
          price: plan.monthlyPrice,
          priceCurrency: PLAN_CURRENCY,
          description: t(plan.taglineKey),
          url: `${base}/signup`,
        })),
      },
    },
  ]

  return (
    <script
      type="application/ld+json"
      /*
       * Every value here originates in our own dictionaries and plan catalogue —
       * no request input reaches it — but `<` is still escaped so that a future
       * change which does interpolate data cannot close the script tag.
       */
      dangerouslySetInnerHTML={{
        __html: JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(
          /</g,
          '\\u003c'
        ),
      }}
    />
  )
}
