import * as React from 'react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Loader2, PauseCircle } from 'lucide-react'
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

  /*
   * A club with no active default program is paused, not missing — so this is
   * not a 404. The business exists, its page is a real page, and the honest
   * thing to show is that enrolment is closed right now.
   *
   * It previously fell through to the form with generic fallback copy
   * ("collect 10 stamps and get a reward"), which advertised a program that was
   * switched off. Rendered here rather than inside `JoinFlow` so the fact is
   * settled server-side, like every other fact on this page.
   */
  if (!data.program) return <ClubUnavailable businessName={data.business.name} />

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

/**
 * The club exists but is not taking members.
 *
 * Named for the person reading it: somebody who just scanned a sticker on a
 * counter and needs to know it is not their phone's fault, and that asking at
 * the counter is the thing to do. No form, because there is nothing to join.
 */
async function ClubUnavailable({ businessName }: { businessName: string }) {
  const locale = await getLocale()
  const t = createTranslator(locale)

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/20 p-4">
      <div className="w-full max-w-[390px] rounded-2xl border bg-card p-6 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted">
          <PauseCircle className="size-6 text-muted-foreground" aria-hidden />
        </div>
        <h1 className="mt-4 text-lg font-semibold">{t('join.unavailable')}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t('join.unavailableBody', { business: businessName })}
        </p>
      </div>
    </main>
  )
}
