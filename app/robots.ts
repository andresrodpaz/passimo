import type { MetadataRoute } from 'next'
import { env } from '@/lib/env'

/**
 * Crawler rules.
 *
 * The disallow list is not about SEO — it is about not publishing customers.
 * Several public routes are public only in the sense that they need no login:
 * `/card/<token>` is one customer's loyalty balance, `/u/<token>` is an
 * unsubscribe action, `/join/<slug>?ref=` carries a referral attribution. They
 * are reachable by anyone holding the link, which is the point, and they must
 * never appear in a search index.
 *
 * `/u/` is the sharpest case: it is an unsubscribe link, so a crawler that
 * fetched it would unsubscribe the customer. `nofollow` in a page's metadata
 * would not stop that, because the fetch is the side effect.
 *
 * Host-derived from `NEXT_PUBLIC_APP_URL`, so a preview deployment publishes its
 * own sitemap URL rather than pointing crawlers at production.
 */
export default function robots(): MetadataRoute.Robots {
  const base = env.appUrl

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          // Signed, per-customer capability links. Indexing one publishes it.
          '/card/',
          '/u/',
          // Authenticated surfaces. They redirect to /login, so indexing them
          // would put a login page in results under a dashboard title.
          '/dashboard',
          '/onboarding',
          '/admin',
          '/pos',
          '/offline',
        ],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  }
}
