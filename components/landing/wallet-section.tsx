'use client'

import * as React from 'react'
import { Bell, Palette, RefreshCw, Smartphone } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'
import { CardPreview, type CardPreviewData } from '@/components/wallet/card-preview'
import {
  DEMO_CUSTOMER,
  DEMO_PALETTES,
  DEMO_TRADES,
  demoCardDesign,
  findDemoTrade,
} from '@/lib/landing/demo'
import { resolveCardDesign } from '@/lib/wallet/card-design'
import { placeholderBrandKit } from '@/lib/brand/kit'
import type { TranslationKey } from '@/lib/i18n/dictionaries/en'

/**
 * The wallet section.
 *
 * The card is the product, so this is the section the page is built around
 * rather than a feature tile among six. It answers the two questions a merchant
 * actually has about a white-label loyalty card, in the order they ask them:
 *
 *   1. *What does my customer end up holding?* — both passes, side by side, laid
 *      out the way each wallet genuinely lays them out. Apple paints the whole
 *      pass in the brand colour and stacks labelled fields; Google paints a
 *      brand-coloured header on a neutral sheet and keeps its own chrome. Showing
 *      one card with two badges — which is what this page used to do — makes the
 *      difference invisible and the preview a lie.
 *   2. *Will it look like my business?* — answered by letting them change it.
 *      The trade and colour controls drive the same `CardPreview` the merchant
 *      dashboard uses, through the same `resolveCardDesign` a real pass resolves
 *      through, from templates the designer genuinely offers.
 *
 * Nothing here requires a camera, an account or a network round trip.
 */

const CAPABILITIES: ReadonlyArray<{
  icon: React.ComponentType<{ className?: string }>
  titleKey: TranslationKey
  bodyKey: TranslationKey
}> = [
  {
    icon: Smartphone,
    titleKey: 'landing.wallet.noApp',
    bodyKey: 'landing.wallet.noAppBody',
  },
  {
    icon: RefreshCw,
    titleKey: 'landing.wallet.live',
    bodyKey: 'landing.wallet.liveBody',
  },
  {
    icon: Bell,
    titleKey: 'landing.wallet.notify',
    bodyKey: 'landing.wallet.notifyBody',
  },
  {
    icon: Palette,
    titleKey: 'landing.wallet.yours',
    bodyKey: 'landing.wallet.yoursBody',
  },
]

export function WalletSection() {
  const { t } = useI18n()
  const [tradeKey, setTradeKey] = React.useState(DEMO_TRADES[0]!.key)
  const [palette, setPalette] = React.useState<{ background: string; accent: string } | null>(null)

  const trade = React.useMemo(() => findDemoTrade(tradeKey), [tradeKey])

  const design = React.useMemo(
    () =>
      resolveCardDesign(
        demoCardDesign(trade, palette),
        placeholderBrandKit(trade.organizationName),
        { goal: trade.goal, isStampProgram: true }
      ),
    [trade, palette]
  )

  const data: CardPreviewData = React.useMemo(
    () => ({
      organizationName: trade.organizationName,
      programName: t('landing.demo.programName', { business: trade.organizationName }),
      memberName: DEMO_CUSTOMER.name,
      memberSince: t(DEMO_CUSTOMER.memberSinceKey),
      tierName: t('landing.demo.tiers.silver'),
      locationName: t('landing.demo.sampleLocation'),
      balance: Math.max(1, trade.goal - 2),
      goal: trade.goal,
      unitSingular: t('onboarding.units.stamp'),
      unitPlural: t('onboarding.units.stamps'),
      rewardName: t(trade.rewardKey),
    }),
    [trade, t]
  )

  return (
    <section id="wallet" className="scroll-mt-20 border-t bg-muted/30 px-4 py-20">
      <div className="mx-auto max-w-6xl">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-balance text-3xl font-bold tracking-tight md:text-4xl">
            {t('landing.wallet.title')}
          </h2>
          <p className="mt-4 text-pretty text-muted-foreground">{t('landing.wallet.subtitle')}</p>
        </div>

        {/* The controls sit above the cards on every viewport. On a phone the
            cards stack and are tall, so controls placed beside them would be
            below the fold — and a customisation demo nobody scrolls to is a
            customisation demo that does not exist. */}
        <div className="mx-auto mt-10 max-w-3xl rounded-2xl border bg-background p-4 sm:p-5">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <div>
              <p className="text-sm font-medium">{t('landing.wallet.pickTrade')}</p>
              <div
                role="radiogroup"
                aria-label={t('landing.wallet.pickTrade')}
                className="mt-2 flex flex-wrap gap-2"
              >
                {DEMO_TRADES.map((candidate) => {
                  const selected = candidate.key === trade.key
                  return (
                    <button
                      key={candidate.key}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => {
                        setTradeKey(candidate.key)
                        setPalette(null)
                      }}
                      className={cn(
                        'flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-all',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        selected
                          ? 'border-primary bg-primary/5 ring-2 ring-primary/25'
                          : 'hover:border-foreground/30 hover:bg-accent'
                      )}
                    >
                      <span aria-hidden>{candidate.emoji}</span>
                      {t(candidate.labelKey)}
                    </button>
                  )
                })}
              </div>
            </div>

            <div>
              <p className="text-sm font-medium">{t('landing.wallet.pickColour')}</p>
              <div
                role="radiogroup"
                aria-label={t('landing.wallet.pickColour')}
                className="mt-2 flex flex-wrap gap-2.5"
              >
                {DEMO_PALETTES.map((swatch) => {
                  const selected =
                    (palette?.background ?? trade.background).toLowerCase() ===
                    swatch.background.toLowerCase()
                  return (
                    <button
                      key={swatch.key}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      aria-label={t(`settings.palette.${swatch.key}` as 'settings.palette.ink')}
                      onClick={() =>
                        setPalette({ background: swatch.background, accent: swatch.accent })
                      }
                      className={cn(
                        'size-9 rounded-full ring-offset-2 ring-offset-background transition-all',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        selected ? 'ring-2 ring-primary' : 'ring-1 ring-black/15 hover:scale-105'
                      )}
                      style={{
                        background: `linear-gradient(135deg, ${swatch.background} 60%, ${swatch.accent} 60%)`,
                      }}
                    />
                  )
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-10 grid items-start gap-8 lg:grid-cols-2">
          {(['apple', 'google'] as const).map((platform) => (
            <figure key={platform} className="flex flex-col items-center">
              <figcaption className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                {t(platform === 'apple' ? 'wallet.preview.apple' : 'wallet.preview.google')}
              </figcaption>
              <CardPreview platform={platform} design={design} data={data} />
            </figure>
          ))}
        </div>

        {/*
          Said plainly, in the middle of the most persuasive section on the page.
          These are previews of a design, rendered by us; they are not generated
          by Apple's or Google's SDK and must never be presented as though they
          were. A prospect who later discovers that would discount every other
          claim here, including the true ones.
        */}
        <p className="mx-auto mt-6 max-w-xl text-center text-xs text-muted-foreground">
          {t('landing.wallet.previewNote')}
        </p>

        <ul className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {CAPABILITIES.map((capability) => (
            <li key={capability.titleKey} className="rounded-2xl border bg-background p-5">
              <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <capability.icon className="size-5" aria-hidden />
              </span>
              <h3 className="mt-3.5 text-sm font-semibold">{t(capability.titleKey)}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                {t(capability.bodyKey)}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
