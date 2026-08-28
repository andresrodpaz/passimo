'use client'

import * as React from 'react'
import {
  ArrowRight,
  BadgeCheck,
  Bell,
  Gift,
  MapPin,
  RotateCcw,
  Sparkles,
  Store,
  TrendingUp,
  UserRound,
  Users,
  Wallet,
} from 'lucide-react'
import confetti from 'canvas-confetti'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'
import { CardPreview, type CardPreviewData } from '@/components/wallet/card-preview'
import { PlatformSwitch } from '@/components/wallet/platform-switch'
import {
  DEFAULT_CONFIG,
  DEMO_CUSTOMER,
  DEMO_PALETTES,
  DEMO_TRADES,
  INITIAL_STATE,
  demoCardDesign,
  findDemoTrade,
  pointsToNextReward,
  recordVisit,
  redeem,
  resetDemo,
  rewardReady,
  stampsToGo,
  type DemoState,
  type DemoTrade,
} from '@/lib/landing/demo'
import { resolveCardDesign } from '@/lib/wallet/card-design'
import { placeholderBrandKit } from '@/lib/brand/kit'

/**
 * The interactive product demo.
 *
 * The brief was explicit on two points, and they pull in the same direction:
 * *demonstrate the concept, not the hardware*, and *do not put a camera on the
 * landing page*. What was here before did the opposite — it opened on a
 * simulated QR viewport with a reticle and a scan line, which reads on a desktop
 * as either an irrelevance or a permission request, and which frames the product
 * as "scanning" when what a merchant pays for is the loop the scan starts.
 *
 * So this is the loop, driven by a button and nothing else:
 *
 *   a regular comes back → the balance moves → the reward unlocks
 *     → the card in their pocket updates → the merchant's numbers move
 *
 * Every panel shares one state object, so pressing *Record a visit* on the
 * counter moves the wallet card, the lock-screen alert and the dashboard
 * together. That coupling *is* the pitch: the thing a screenshot cannot show is
 * that these are one system.
 *
 * Requires nothing — no camera, no microphone, no location, no account, no
 * network. It runs on a ten-year-old laptop with JavaScript and nothing else.
 *
 * The real scanner is not gone; it is where it belongs. `/pos` and the dashboard
 * overlay open the device camera behind a login, on a phone that is at a
 * counter. That separation is deliberate and documented in `docs/PRODUCT.md`.
 *
 * All state is local. Nothing is fetched, nothing is written, and no number here
 * is presented as traction — there are no customer counts, no revenue figures
 * and no testimonials on this page.
 */

type Panel = 'counter' | 'wallet' | 'nearby' | 'dashboard'

export function ProductDemo({ className }: { className?: string }) {
  const { t } = useI18n()
  const [panel, setPanel] = React.useState<Panel>('counter')
  const [state, setState] = React.useState<DemoState>(INITIAL_STATE)
  const [busy, setBusy] = React.useState(false)

  // Customisation — the answer to "will it look like *my* business?"
  const [tradeKey, setTradeKey] = React.useState(DEMO_TRADES[0]!.key)
  const [palette, setPalette] = React.useState<{ background: string; accent: string } | null>(null)
  const [platform, setPlatform] = React.useState<'apple' | 'google'>('apple')

  const trade = React.useMemo(() => findDemoTrade(tradeKey), [tradeKey])
  const config = React.useMemo(() => ({ ...DEFAULT_CONFIG, goal: trade.goal }), [trade.goal])

  const ready = rewardReady(state, config)
  const remaining = stampsToGo(state, config)
  const pointsToGo = pointsToNextReward(state, config)

  // Reduced motion is honoured for the confetti, which is the one piece of this
  // that is pure decoration and the one most likely to make someone uncomfortable.
  const prefersReducedMotion = React.useRef(false)
  React.useEffect(() => {
    prefersReducedMotion.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }, [])

  /*
   * A short delay before the credit lands.
   *
   * Not theatre: the real transaction is a round trip, and a demo that credits
   * instantly sets an expectation the product cannot meet on a café's wifi. It
   * also gives the visitor a beat to look at the card, which is the object the
   * whole page is selling.
   */
  const visit = React.useCallback(() => {
    if (busy) return
    setBusy(true)
    setState((current) => ({ ...current, stage: 'visit' }))

    window.setTimeout(() => {
      setBusy(false)
      setState((current) => recordVisit(current, config))
    }, 650)
  }, [busy, config])

  React.useEffect(() => {
    if (state.stage !== 'rewardReady') return
    if (!prefersReducedMotion.current) {
      confetti({ particleCount: 90, spread: 70, origin: { y: 0.65 }, disableForReducedMotion: true })
    }
  }, [state.stage, state.revision])

  const claim = () => setState((current) => redeem(current, config))

  // --- The card ---------------------------------------------------------------

  const design = React.useMemo(() => demoCardDesign(trade, palette), [trade, palette])

  const resolved = React.useMemo(
    () =>
      resolveCardDesign(design, placeholderBrandKit(trade.organizationName), {
        goal: config.goal,
        isStampProgram: true,
      }),
    [design, trade.organizationName, config.goal]
  )

  const cardData: CardPreviewData = React.useMemo(
    () => ({
      organizationName: trade.organizationName,
      programName: t('landing.demo.programName', { business: trade.organizationName }),
      memberName: DEMO_CUSTOMER.name,
      memberSince: t(DEMO_CUSTOMER.memberSinceKey),
      tierName: t(state.visits >= 12 ? 'landing.demo.tiers.gold' : 'landing.demo.tiers.silver'),
      locationName: t('landing.demo.sampleLocation'),
      balance: state.stamps,
      goal: config.goal,
      unitSingular: t('onboarding.units.stamp'),
      unitPlural: t('onboarding.units.stamps'),
      rewardName: t(trade.rewardKey),
    }),
    [trade, state.stamps, state.visits, config.goal, t]
  )

  const panels: Array<{
    id: Panel
    label: string
    icon: React.ComponentType<{ className?: string }>
  }> = [
    { id: 'counter', label: t('landing.demo.tabCounter'), icon: Store },
    { id: 'wallet', label: t('landing.demo.tabWallet'), icon: Wallet },
    { id: 'nearby', label: t('landing.demo.tabNearby'), icon: MapPin },
    { id: 'dashboard', label: t('landing.demo.tabMerchant'), icon: TrendingUp },
  ]

  return (
    <div className={cn('w-full', className)}>
      {/* Panel switcher — a segmented control, so all four stay visible. A
          dropdown would hide the two panels that do the selling. */}
      <div
        role="tablist"
        aria-label={t('landing.demo.title')}
        className="mx-auto flex w-full max-w-2xl overflow-x-auto rounded-2xl border bg-card p-1.5 shadow-sm"
      >
        {panels.map((entry) => (
          <button
            key={entry.id}
            role="tab"
            type="button"
            aria-selected={panel === entry.id}
            onClick={() => setPanel(entry.id)}
            className={cn(
              'flex flex-1 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-3 py-2.5 text-sm font-medium transition-all',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              panel === entry.id
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground'
            )}
          >
            <entry.icon className="size-4 shrink-0" aria-hidden />
            <span className="hidden sm:inline">{entry.label}</span>
          </button>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <div className="order-2 min-h-[440px] rounded-3xl border bg-card p-5 shadow-lg sm:p-7 lg:order-1">
          {panel === 'counter' && (
            <CounterPanel
              state={state}
              busy={busy}
              goal={config.goal}
              remaining={remaining}
              pointsToGo={pointsToGo}
              ready={ready}
              onVisit={visit}
              onClaim={claim}
            />
          )}
          {panel === 'wallet' && (
            <WalletPanel
              design={resolved}
              data={cardData}
              trade={trade}
              paletteKey={palette}
              onTrade={(next) => {
                setTradeKey(next.key)
                // A trade carries its own palette; keeping the previous swatch
                // would make "Barber" render in espresso browns and read as the
                // choice not having registered.
                setPalette(null)
              }}
              onPalette={setPalette}
            />
          )}
          {panel === 'nearby' && <NearbyPanel trade={trade} ready={ready} />}
          {panel === 'dashboard' && <DashboardPanel state={state} />}
        </div>

        {/* The card is on every panel. It is the product, and the point of the
            demo is that everything else moves it. */}
        <aside className="order-1 flex flex-col items-center gap-4 lg:order-2 lg:sticky lg:top-24">
          <PlatformSwitch
            value={platform}
            onChange={setPlatform}
            className="w-full max-w-[340px]"
            size="sm"
          />

          <CardPreview
            platform={platform}
            design={resolved}
            data={cardData}
            animateKey={state.revision}
          />

          <div className="flex w-full max-w-[340px] flex-col gap-2">
            <Button onClick={visit} disabled={busy} className="w-full gap-2" size="lg">
              {busy ? (
                <>
                  <Sparkles className="size-4 animate-pulse" aria-hidden />
                  {t('landing.demo.recording')}
                </>
              ) : (
                <>
                  <UserRound className="size-4" aria-hidden />
                  {t('landing.demo.simulateVisit')}
                </>
              )}
            </Button>

            {ready && (
              <Button
                onClick={claim}
                variant="secondary"
                className="w-full gap-2 animate-in fade-in slide-in-from-bottom-2"
                size="lg"
              >
                <Gift className="size-4" aria-hidden />
                {t('landing.demo.redeem')}
              </Button>
            )}

            <div className="flex items-center justify-between px-1 pt-1">
              <p className="text-xs text-muted-foreground">{t('landing.demo.liveNote')}</p>
              <button
                type="button"
                onClick={() => setState(resetDemo())}
                className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <RotateCcw className="size-3" aria-hidden />
                {t('landing.demo.reset')}
              </button>
            </div>
          </div>
        </aside>
      </div>

      {/* Announced politely rather than shown as a toast, so the unlock is not
          lost to a screen reader. */}
      <div aria-live="polite" className="sr-only">
        {state.stage === 'rewardReady' ? t('landing.demo.rewardUnlocked') : ''}
      </div>

      {state.stage === 'rewardReady' && (
        <div className="mx-auto mt-6 flex max-w-2xl items-center gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 animate-in fade-in slide-in-from-bottom-2">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-orange-500 text-white">
            <Sparkles className="size-5" aria-hidden />
          </span>
          <div>
            <p className="text-sm font-semibold">{t('landing.demo.rewardUnlocked')}</p>
            <p className="text-sm text-muted-foreground">
              {t('landing.demo.rewardUnlockedBody', {
                name: DEMO_CUSTOMER.name,
                reward: t(trade.rewardKey),
              })}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

// -----------------------------------------------------------------------------
// Counter
// -----------------------------------------------------------------------------

/**
 * What a merchant sees when a regular walks in.
 *
 * A customer, their history, and one button. No camera, no viewport, no
 * hardware: the visitor is being shown *what happens*, not *what it is pointed
 * at*. The receipt strip below the button is where the mechanism is named — one
 * line, honest about the scan being the trigger, without making the scan the
 * subject.
 */
function CounterPanel({
  state,
  busy,
  goal,
  remaining,
  pointsToGo,
  ready,
  onVisit,
  onClaim,
}: {
  state: DemoState
  busy: boolean
  goal: number
  remaining: number
  pointsToGo: number
  ready: boolean
  onVisit: () => void
  onClaim: () => void
}) {
  const { t, formatNumber } = useI18n()

  return (
    <div>
      <PanelHeader
        icon={Store}
        title={t('landing.demo.tabCounter')}
        body={t('landing.demo.counterBody')}
      />

      {/* The customer card, as the counter shows it. */}
      <div className="mt-5 rounded-2xl border bg-muted/30 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-base font-semibold text-primary"
          >
            MG
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-base font-semibold">{DEMO_CUSTOMER.name}</p>
              <Badge variant="secondary" className="text-[10px]">
                {t(state.visits >= 12 ? 'landing.demo.tiers.gold' : 'landing.demo.tiers.silver')}
              </Badge>
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {t('landing.demo.memberSinceLine', { since: t(DEMO_CUSTOMER.memberSinceKey) })}
            </p>
          </div>
        </div>

        <dl className="mt-4 grid grid-cols-3 gap-3">
          <Figure label={t('landing.demo.merchantVisits')} value={formatNumber(state.visits)} />
          <Figure label={t('landing.demo.points')} value={formatNumber(state.points)} />
          <Figure
            label={t('landing.demo.nextReward')}
            value={
              ready
                ? t('landing.demo.readyNow')
                : t('landing.demo.pointsAway', { count: formatNumber(pointsToGo) })
            }
          />
        </dl>

        {/* The stamp card, drawn at counter size so the visitor can count it. */}
        <div className="mt-5">
          <div className="flex items-baseline justify-between">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t('onboarding.units.stamps')}
            </p>
            <p className="text-xs tabular-nums text-muted-foreground">
              {formatNumber(state.stamps)} / {formatNumber(goal)}
            </p>
          </div>
          <div
            className="mt-2 flex flex-wrap gap-2"
            role="img"
            aria-label={`${state.stamps} / ${goal}`}
          >
            {Array.from({ length: goal }).map((_, index) => (
              <span
                key={index}
                aria-hidden
                className={cn(
                  'size-7 rounded-full border-2 transition-all duration-300 motion-reduce:transition-none',
                  index < state.stamps
                    ? 'border-primary bg-primary'
                    : 'border-muted-foreground/30 bg-transparent'
                )}
              />
            ))}
          </div>
          {!ready && (
            <p className="mt-2 text-sm text-muted-foreground">
              {t('landing.demo.stampsToGo', { count: remaining })}
            </p>
          )}
        </div>
      </div>

      {/* What just happened, in the order it happened. This is the flow the
          brief asks the demo to make visible, and it is a list rather than an
          animation so it is readable on a phone and by a screen reader. */}
      <ol className="mt-5 space-y-2">
        <FlowRow
          icon={UserRound}
          active={state.stage !== 'idle'}
          label={t('landing.demo.flow.visit', { name: DEMO_CUSTOMER.name })}
        />
        <FlowRow
          icon={Sparkles}
          active={['credited', 'rewardReady', 'walletUpdated', 'analytics'].includes(state.stage)}
          label={t('landing.demo.flow.credited', { points: 120 })}
        />
        <FlowRow
          icon={Gift}
          active={ready}
          label={t('landing.demo.flow.reward')}
        />
        <FlowRow
          icon={Wallet}
          active={state.revision > 0}
          label={t('landing.demo.flow.wallet')}
        />
      </ol>

      <div className="mt-5 flex flex-wrap gap-2">
        <Button onClick={onVisit} disabled={busy} className="flex-1 gap-2">
          <UserRound className="size-4" aria-hidden />
          {busy ? t('landing.demo.recording') : t('landing.demo.simulateVisit')}
        </Button>
        {ready && (
          <Button onClick={onClaim} variant="secondary" className="flex-1 gap-2">
            <Gift className="size-4" aria-hidden />
            {t('landing.demo.redeem')}
          </Button>
        )}
      </div>

      <p className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
        <BadgeCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        {t('landing.demo.scannerNote')}
      </p>
    </div>
  )
}

// -----------------------------------------------------------------------------
// Wallet — the customisation panel
// -----------------------------------------------------------------------------

/**
 * "Will it look like my business?"
 *
 * The question every merchant asks about a white-label card, answered by letting
 * the visitor change it. The trade buttons and the swatches drive the same
 * `CardPreview` the merchant dashboard uses, through the same `resolveCardDesign`
 * a real pass resolves through — so what a prospect plays with here is the
 * product, not an illustration of it.
 */
function WalletPanel({
  design,
  data,
  trade,
  paletteKey,
  onTrade,
  onPalette,
}: {
  design: ReturnType<typeof resolveCardDesign>
  data: CardPreviewData
  trade: DemoTrade
  paletteKey: { background: string; accent: string } | null
  onTrade: (trade: DemoTrade) => void
  onPalette: (palette: { background: string; accent: string }) => void
}) {
  const { t } = useI18n()

  return (
    <div>
      <PanelHeader
        icon={Wallet}
        title={t('landing.demo.tabWallet')}
        body={t('landing.demo.walletBody')}
      />

      <div className="mt-5 space-y-5">
        <div>
          <p className="text-sm font-medium">{t('landing.demo.customiseTrade')}</p>
          <div
            role="radiogroup"
            aria-label={t('landing.demo.customiseTrade')}
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
                  onClick={() => onTrade(candidate)}
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
          <p className="text-sm font-medium">{t('landing.demo.customiseColour')}</p>
          <div
            role="radiogroup"
            aria-label={t('landing.demo.customiseColour')}
            className="mt-2 flex flex-wrap gap-2.5"
          >
            {DEMO_PALETTES.map((swatch) => {
              const selected =
                (paletteKey?.background ?? trade.background).toLowerCase() ===
                swatch.background.toLowerCase()
              return (
                <button
                  key={swatch.key}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={t(`settings.palette.${swatch.key}` as 'settings.palette.ink')}
                  onClick={() => onPalette({ background: swatch.background, accent: swatch.accent })}
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

      {/* Both wallets, side by side. They lay a pass out differently, and a
          merchant deciding what their customer will hold deserves to see the
          real difference rather than one card wearing two badges. */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {(['apple', 'google'] as const).map((entry) => (
          <div key={entry} className="rounded-2xl border bg-muted/30 p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t(entry === 'apple' ? 'wallet.preview.apple' : 'wallet.preview.google')}
            </p>
            <CardPreview
              platform={entry}
              design={design}
              data={data}
              className="max-w-full origin-top scale-[0.92]"
            />
          </div>
        ))}
      </div>

      <p className="mt-4 text-xs text-muted-foreground">{t('landing.demo.previewDisclaimer')}</p>
    </div>
  )
}

// -----------------------------------------------------------------------------
// Nearby
// -----------------------------------------------------------------------------

function NearbyPanel({ trade, ready }: { trade: DemoTrade; ready: boolean }) {
  const { t } = useI18n()
  const [distance, setDistance] = React.useState(320)
  const inside = distance <= 150

  return (
    <div>
      <PanelHeader
        icon={MapPin}
        title={t('landing.features.proximity.title')}
        body={t('landing.features.proximity.body')}
      />

      {/* A distance slider, because the point of geofencing is a threshold, and a
          threshold is best understood by crossing it yourself. */}
      <div className="mt-5 rounded-2xl border bg-muted/30 p-4">
        <label htmlFor="demo-distance" className="text-sm font-medium">
          {t('landing.demo.distanceLabel', { distance: t('common.metres', { value: distance }) })}
        </label>
        <input
          id="demo-distance"
          type="range"
          min={20}
          max={800}
          step={10}
          value={distance}
          onChange={(event) => setDistance(Number(event.target.value))}
          className="mt-3 w-full accent-primary"
        />
        <div className="mt-1 flex justify-between text-xs text-muted-foreground">
          <span>{t('common.metres', { value: 20 })}</span>
          <span>{t('common.metres', { value: 800 })}</span>
        </div>
      </div>

      {/* A phone lock screen, which is where this feature actually lands. */}
      <div className="mt-5 flex justify-center">
        <div className="w-full max-w-[300px] overflow-hidden rounded-[2rem] border-[6px] border-neutral-800 bg-gradient-to-b from-neutral-900 to-neutral-800 p-3 pt-6 shadow-2xl">
          <p className="text-center text-4xl font-light tabular-nums text-white/90">08:42</p>
          <p className="mt-0.5 text-center text-xs text-white/50">{t('landing.demo.lockScreen')}</p>

          <div className="mt-6 min-h-[104px]">
            {inside ? (
              <div className="rounded-2xl bg-white/95 p-3 shadow-lg backdrop-blur animate-in fade-in slide-in-from-bottom-3 dark:bg-neutral-700/95">
                <div className="flex items-start gap-2.5">
                  <span aria-hidden className="text-xl leading-none">
                    {trade.emoji}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold leading-snug">{trade.organizationName}</p>
                    <p className="mt-0.5 text-sm leading-snug text-muted-foreground">
                      {ready
                        ? t('landing.demo.nearbyReady', { reward: t(trade.rewardKey) })
                        : t('landing.demo.nearbyPassing', {
                            business: trade.organizationName,
                          })}
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-white/20 p-4 text-center">
                <p className="text-xs text-white/50">
                  {t('landing.demo.outsideRadius', {
                    distance: t('common.metres', { value: 150 }),
                  })}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-5 rounded-2xl border bg-card p-4">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Bell className="size-4 text-primary" aria-hidden />
          {t('landing.demo.campaignTitle')}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">{t('landing.demo.campaignBody')}</p>
      </div>
    </div>
  )
}

// -----------------------------------------------------------------------------
// Dashboard
// -----------------------------------------------------------------------------

function DashboardPanel({ state }: { state: DemoState }) {
  const { t, formatNumber, formatCurrency } = useI18n()

  // Derived from the demo state so the dashboard visibly responds to the visits
  // the visitor just recorded. Frozen numbers would give away that the whole
  // thing is a picture.
  const revenue = state.visits * 4.4 + state.redeemed * 3.2
  const bars = React.useMemo(() => {
    const base = [4, 7, 5, 9, 6, 11, 8]
    return base.map((value, index) =>
      index === base.length - 1 ? value + Math.min(8, state.visits - INITIAL_STATE.visits) : value
    )
  }, [state.visits])
  const peak = Math.max(...bars)

  return (
    <div>
      <PanelHeader
        icon={TrendingUp}
        title={t('landing.demo.tabMerchant')}
        body={t('landing.demo.merchantBody')}
      />

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label={t('landing.demo.merchantVisits')}
          value={formatNumber(state.visits)}
          icon={Users}
        />
        <Stat label={t('landing.demo.points')} value={formatNumber(state.points)} icon={Sparkles} />
        <Stat
          label={t('landing.demo.merchantRewards')}
          value={formatNumber(state.redeemed)}
          icon={Gift}
        />
        <Stat
          label={t('landing.demo.merchantRevenue')}
          value={formatCurrency(revenue)}
          icon={TrendingUp}
        />
      </div>

      <div className="mt-5 rounded-2xl border bg-card p-4">
        <div className="flex items-baseline justify-between">
          <p className="text-sm font-semibold">{t('landing.dashboardShowcase.analytics.title')}</p>
          <p className="text-xs text-muted-foreground">{t('wallet.analytics.range7')}</p>
        </div>
        <div
          className="mt-4 flex h-28 items-end gap-2"
          role="img"
          aria-label={t('landing.dashboardShowcase.analytics.body')}
        >
          {bars.map((value, index) => (
            <div key={index} className="flex flex-1 flex-col items-center gap-1.5">
              <div
                className="w-full rounded-t-md bg-gradient-to-t from-primary/50 to-primary transition-all duration-500 motion-reduce:transition-none"
                style={{ height: `${(value / peak) * 100}%` }}
              />
            </div>
          ))}
        </div>
      </div>

      <p className="mt-4 flex items-start gap-2 text-xs text-muted-foreground">
        <BadgeCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        {t('landing.demo.sampleDataNote')}
      </p>
    </div>
  )
}

// -----------------------------------------------------------------------------
// Shared bits
// -----------------------------------------------------------------------------

function PanelHeader({
  icon: Icon,
  title,
  body,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  body: string
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Icon className="size-5" aria-hidden />
      </span>
      <div>
        <h3 className="text-base font-semibold leading-tight">{title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{body}</p>
      </div>
    </div>
  )
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  )
}

function FlowRow({
  icon: Icon,
  active,
  label,
}: {
  icon: React.ComponentType<{ className?: string }>
  active: boolean
  label: string
}) {
  return (
    <li
      className={cn(
        'flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition-colors duration-300 motion-reduce:transition-none',
        active ? 'border-primary/40 bg-primary/5' : 'text-muted-foreground'
      )}
    >
      <span
        aria-hidden
        className={cn(
          'flex size-7 shrink-0 items-center justify-center rounded-lg',
          active ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'
        )}
      >
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">{label}</span>
      {active && <ArrowRight className="size-3.5 shrink-0 text-primary" aria-hidden />}
    </li>
  )
}

function Stat({
  label,
  value,
  icon: Icon,
}: {
  label: string
  value: string
  icon: React.ComponentType<{ className?: string }>
}) {
  return (
    <div className="rounded-xl border bg-muted/30 p-3">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5" aria-hidden />
        <span className="truncate">{label}</span>
      </p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
    </div>
  )
}
