'use client'

import * as React from 'react'
import Link from 'next/link'
import { ArrowRight, Palette, Sparkles } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { CardPreview, type CardPreviewData } from '@/components/wallet/card-preview'
import { PlatformSwitch } from '@/components/wallet/platform-switch'
import type { CardDesignResponse } from '@/components/wallet/design-types'
import { useApi, query } from '@/lib/client/api'
import { useWorkspace } from '@/lib/client/workspace'
import { resolveCardDesign } from '@/lib/wallet/card-design'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'

/** Where every entry point into the designer goes. Written once. */
export const CARD_DESIGNER_HREF = '/dashboard/wallet/design'

/**
 * "Your Wallet card" — the entry point into the designer.
 *
 * One component, three placements: the dashboard overview, the wallet screen and
 * (compactly) anywhere else that should lead here. It exists because the
 * designer was unreachable in practice, and the fix for that is not a better
 * editor — it is a merchant seeing their own card on the first screen they open,
 * with a button under it.
 *
 * It shows the *real* saved design, resolved through `resolveCardDesign`, the
 * same function the pass builder uses. A generic illustration of "a loyalty
 * card" would have been easier and would have taught the merchant nothing; the
 * point of putting it on the dashboard is that they recognise it as theirs and
 * notice when it is still the default.
 *
 * The copy changes on one fact from the server: a merchant who has never edited
 * the card is invited to design it, a merchant who has is invited to change it.
 * Asking someone to "get started" on something they finished last week is how a
 * dashboard stops being read.
 */
export function WalletCardCallout({
  variant = 'wide',
  className,
}: {
  /** `wide` puts the preview beside the copy; `compact` stacks it for a column. */
  variant?: 'wide' | 'compact'
  className?: string
}) {
  const { businessId, can } = useWorkspace()
  const { t } = useI18n()
  const [platform, setPlatform] = React.useState<'apple' | 'google'>('apple')

  const { data } = useApi<CardDesignResponse>(
    businessId && can('wallet:read')
      ? `/api/v1/wallet/design${query({ businessId })}`
      : null
  )

  // A merchant without wallet permission has no business being sent to a screen
  // that will refuse them.
  if (!can('wallet:read')) return null

  const resolved = data
    ? resolveCardDesign(data.design, data.brand, {
        goal: data.program.goal,
        isStampProgram: data.program.isStampProgram,
      })
    : null

  const previewData: CardPreviewData | null = data
    ? {
        organizationName: data.brand.name || t('common.appName'),
        programName: data.program.name ?? t('cardDesign.preview.defaultProgram'),
        memberName: t('cardDesign.preview.sampleCustomer'),
        memberSince: null,
        tierName: null,
        locationName: data.locationName,
        // Halfway through the goal: an empty card hides the progress rendering
        // and a finished one hides the "n to go" line.
        balance:
          data.program.goal && data.program.goal > 0
            ? Math.max(1, Math.floor(data.program.goal / 2))
            : 840,
        goal: data.program.goal,
        unitSingular: data.program.unitSingular ?? t('cardDesign.preview.defaultUnitSingular'),
        unitPlural: data.program.unitPlural ?? t('cardDesign.preview.defaultUnitPlural'),
        rewardName: data.program.rewardName,
      }
    : null

  const fresh = data ? !data.customised : false

  return (
    <section
      className={cn(
        'rounded-xl border bg-card p-5',
        fresh && 'border-primary/30 bg-linear-to-br from-primary/[0.06] via-card to-card',
        className
      )}
      aria-labelledby="wallet-card-callout-title"
    >
      <div
        className={cn(
          'gap-5',
          // `items-center` on the wide variant: the card is tall and the copy is
          // three lines, so aligning to the top leaves a block of empty panel
          // under the text. Centring puts the sentence beside the card it is
          // describing.
          variant === 'wide' ? 'flex flex-col sm:flex-row sm:items-center' : 'flex flex-col'
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Palette className="size-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 id="wallet-card-callout-title" className="text-base font-semibold">
                {t('walletCard.calloutTitle')}
              </h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {fresh ? t('walletCard.calloutFreshBody') : t('walletCard.calloutBody')}
              </p>
            </div>
          </div>

          {fresh && (
            <Badge variant="secondary" className="mt-3 gap-1.5">
              <Sparkles className="size-3" aria-hidden />
              {t('walletCard.calloutFreshBadge')}
            </Badge>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <Button asChild className="gap-2">
              <Link href={CARD_DESIGNER_HREF}>
                <Palette className="size-4" aria-hidden />
                {fresh ? t('walletCard.calloutFreshCta') : t('walletCard.calloutCta')}
              </Link>
            </Button>
            {!fresh && (
              <Button asChild variant="ghost" className="gap-1.5 text-xs">
                <Link href={`${CARD_DESIGNER_HREF}#templates`}>
                  {t('walletCard.calloutTemplates')}
                  <ArrowRight className="size-3" aria-hidden />
                </Link>
              </Button>
            )}
          </div>
        </div>

        {/* The card itself. Labelled a preview, with the platform switch right
            there — a merchant must never mistake this for an installed pass. */}
        <div
          className={cn(
            'shrink-0',
            variant === 'wide' ? 'w-full sm:w-[220px]' : 'w-full max-w-[240px] self-center'
          )}
        >
          <p className="mb-2 text-center text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {t('cardDesign.preview.title')}
          </p>
          <PlatformSwitch value={platform} onChange={setPlatform} size="sm" className="mb-3" />
          {resolved && previewData ? (
            <Link
              href={CARD_DESIGNER_HREF}
              aria-label={t(fresh ? 'walletCard.calloutFreshCta' : 'walletCard.calloutCta')}
              className="block rounded-[1.25rem] transition-transform hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <CardPreview platform={platform} design={resolved} data={previewData} />
            </Link>
          ) : (
            <Skeleton className="aspect-[0.62] w-full rounded-[1.25rem]" />
          )}
        </div>
      </div>
    </section>
  )
}
