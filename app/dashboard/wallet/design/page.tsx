'use client'

import Link from 'next/link'
import { ArrowRight, Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { LoadingCards } from '@/components/states'
import { CardDesignPanel } from '@/components/wallet/design-panel'
import { useWorkspace } from '@/lib/client/workspace'
import { useI18n } from '@/lib/i18n'

/**
 * The card designer, on its own route.
 *
 * It used to be the first tab of `/dashboard/wallet`, a screen the sidebar
 * called "Wallet & proximity" and filed under "Configure". Everything worked —
 * the editor, the templates, the previews, the endpoint, the table — and
 * merchants could not find it, because nothing in the navigation, the dashboard
 * or the checklist contained the word *card*. A feature nobody can reach is not
 * shipped, so it now has:
 *
 *   * its own address, `/dashboard/wallet/design`, which can be linked from the
 *     dashboard, the checklist, settings and the end of onboarding;
 *   * its own heading, which says what a merchant came here to do in the words
 *     they would have used;
 *   * a sidebar entry under "Your card" called "Card design".
 *
 * The page itself is deliberately thin. `CardDesignPanel` fetches and saves,
 * `CardDesigner` renders the controls, `lib/wallet/card-design.ts` holds the
 * rules — this is a title, a sentence and a mount point. A second copy of the
 * editor living at a second URL is exactly the kind of duplication that made
 * the original problem hard to see.
 */
export default function WalletCardDesignPage() {
  const { businessId, can, capabilities, loading } = useWorkspace()
  const { t } = useI18n()

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t('cardDesign.pageTitle')}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          {t('cardDesign.pageSubtitle')}
        </p>
      </header>

      {loading && <LoadingCards count={2} />}

      {!loading && !can('wallet:read') && (
        <section className="rounded-2xl border bg-card p-6">
          <span className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Lock className="size-4" aria-hidden />
          </span>
          <h2 className="mt-3 text-base font-semibold">{t('cardDesign.noAccess')}</h2>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            {t('cardDesign.noAccessBody')}
          </p>
        </section>
      )}

      {!loading && businessId && can('wallet:read') && (
        <>
          <CardDesignPanel
            businessId={businessId}
            canWrite={can('wallet:write')}
            uploadsEnabled={capabilities?.storage ?? false}
            /* The heading is the page's, not the panel's — repeating it inside
               the panel would give one screen two titles. */
            withHeading={false}
          />

          {/* Where the neighbouring decisions live. Brand identity and
              notification behaviour are genuinely different questions from the
              card face, and the relationship is stated rather than left for the
              merchant to work out from two similar-looking screens. */}
          <nav
            aria-label={t('cardDesign.related.title')}
            className="rounded-2xl border border-dashed p-4"
          >
            <p className="text-sm font-medium">{t('cardDesign.related.title')}</p>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              <li>
                <RelatedLink
                  href="/dashboard/wallet?tab=brand"
                  title={t('cardDesign.related.brandKit')}
                  body={t('cardDesign.related.brandKitBody')}
                />
              </li>
              <li>
                <RelatedLink
                  href="/dashboard/wallet"
                  title={t('cardDesign.related.proximity')}
                  body={t('cardDesign.related.proximityBody')}
                />
              </li>
            </ul>
          </nav>
        </>
      )}
    </div>
  )
}

function RelatedLink({ href, title, body }: { href: string; title: string; body: string }) {
  return (
    <Button
      asChild
      variant="ghost"
      className="h-auto w-full justify-start whitespace-normal p-3 text-left"
    >
      <Link href={href}>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{title}</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">{body}</span>
        </span>
        <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </Link>
    </Button>
  )
}
