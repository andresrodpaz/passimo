import * as React from 'react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { getJoinPageData, toPublicJoinData } from '@/lib/public/join'
import { getLocale } from '@/lib/i18n/server'
import { createTranslator } from '@/lib/i18n/translate'
import { JoinFlow } from './join-flow'

/**
 * Public enrolment page — the server half.
 *
 * A thin shell that resolves the business before anything renders. That ordering
 * is the whole point: the form is interactive and has to be a client component,
 * but *whether this business exists* and *what colour it is* are facts the first
 * byte should already carry.
 *
 * What this buys, none of which the previous client-only version could do:
 *
 *   - **A real 404.** An unknown slug used to answer 200 with a Passimo shell and
 *     then say "not found" in the DOM. Now Next renders the 404 boundary with a
 *     404 status, so crawlers, link unfurlers and uptime checks agree with the
 *     page.
 *   - **The merchant's brand in the first paint.** The card, logo and palette are
 *     server-rendered. A customer scanning a QR on café wifi sees the café, not a
 *     spinner.
 *   - **Per-business link previews.** `generateMetadata` puts the business's own
 *     name and reward in the title, description and Open Graph tags, so a link
 *     shared to WhatsApp or printed under a QR advertises the shop rather than us.
 *
 * `dynamic` is left at the default: the palette and reward list are merchant-
 * editable and a stale cached join page would advertise last month's offer.
 */

type Props = { params: Promise<{ businessSlug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { businessSlug } = await params
  const [data, locale] = await Promise.all([getJoinPageData(businessSlug), getLocale()])
  const t = createTranslator(locale)

  if (!data) {
    return {
      title: t('join.notFound'),
      // A page that does not exist must not be indexed, and must not be
      // previewed as though it did.
      robots: { index: false, follow: false },
    }
  }

  const title = t('join.title', { business: data.business.name })
  const description = t('join.subtitle', {
    goal: data.program?.goal_amount ?? 10,
    unit: data.program?.unit_plural ?? t('join.unitFallback'),
    reward: data.program?.reward_description ?? t('join.rewardFallback'),
  })

  return {
    title: { absolute: title },
    description,
    alternates: { canonical: `/join/${data.business.slug}` },
    openGraph: {
      title,
      description,
      type: 'website',
      url: `/join/${data.business.slug}`,
      ...(data.business.cover_url ? { images: [{ url: data.business.cover_url }] } : {}),
    },
    twitter: {
      card: data.business.cover_url ? 'summary_large_image' : 'summary',
      title,
      description,
    },
  }
}

export default async function JoinPage({ params }: Props) {
  const { businessSlug } = await params
  const data = await getJoinPageData(businessSlug)
  if (!data) notFound()

  // The tenant primary key stays on the server; see `toPublicJoinData`.
  const payload = toPublicJoinData(data)

  return (
    /*
     * `useSearchParams` in the form (for `?ref=`) requires a Suspense boundary
     * during the server render. The fallback is a spinner rather than a skeleton
     * of the card because it is only ever visible for the duration of hydration.
     */
    <React.Suspense fallback={<LoadingScreen />}>
      <JoinFlow slug={businessSlug} data={payload} />
    </React.Suspense>
  )
}

function LoadingScreen() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </main>
  )
}
