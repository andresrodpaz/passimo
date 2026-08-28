'use client'

import * as React from 'react'
import {
  Camera,
  CameraOff,
  Check,
  CloudOff,
  Flashlight,
  FlashlightOff,
  Gift,
  Keyboard,
  Loader2,
  RefreshCw,
  ScanLine,
  Search,
  Star,
  Volume2,
  VolumeX,
  X,
  Zap,
} from 'lucide-react'
import confetti from 'canvas-confetti'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { apiPost, query, useApi } from '@/lib/client/api'
import { useQrScanner } from '@/lib/client/use-qr-scanner'
import {
  OfflineQueuedError,
  useCounterScan,
  type ScanOutcome,
} from '@/lib/client/use-counter-scan'
import { newIdempotencyKey } from '@/lib/client/idempotency'
import { useRelativeTime } from '@/lib/client/hooks'
import { useI18n } from '@/lib/i18n'
import { useFormatValue } from '@/components/metrics'
import { toastError } from '@/lib/client/api-errors'
import type { CustomerSummary } from '@/lib/scan/resolve'

/**
 * The counter scanner.
 *
 * The single most important screen in the product, and the one held in one hand
 * with someone waiting. Its rules:
 *
 *   - the camera opens once and stays open, customer after customer
 *   - a scan credits the visit with no confirming tap
 *   - the result appears over the live camera, so the next person can be scanned
 *     before the previous card has finished animating away
 *   - nothing here blocks: no camera, no signal, no phone — there is always a
 *     way to serve the person in front of you
 *
 * Used from the point of sale and from anywhere in the dashboard, so a merchant
 * is never more than one tap from serving a customer.
 */

type Feedback = {
  outcome: ScanOutcome
  at: number
  /** Bumped per scan so the card re-animates even for the same customer. */
  seq: number
}

export function CounterScanner({
  businessId,
  canEarn,
  canRedeemGiftCards = false,
  onClose,
  className,
}: {
  businessId: string
  canEarn: boolean
  /** Gift cards are money; spending one needs its own permission. */
  canRedeemGiftCards?: boolean
  onClose?: () => void
  className?: string
}) {
  const { t } = useI18n()
  const counter = useCounterScan(businessId)
  const [feedback, setFeedback] = React.useState<Feedback | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<string | null>(null)
  const [amount, setAmount] = React.useState('')
  const [sound, setSound] = React.useState(false)
  const [manual, setManual] = React.useState(false)
  const [served, setServed] = React.useState(0)

  const seqRef = React.useRef(0)
  // Read inside the scan callback, which must not be re-created per keystroke or
  // the camera would restart every time the amount changes.
  const amountRef = React.useRef('')
  const busyRef = React.useRef(false)
  React.useEffect(() => {
    amountRef.current = amount
  }, [amount])

  const handleScan = React.useCallback(
    async (raw: string, meta?: { decodeMs: number }) => {
      // Reads arrive faster than requests complete; drop overlapping ones rather
      // than queueing, so a card waved twice cannot double-submit.
      if (busyRef.current) return
      busyRef.current = true
      setBusy(true)
      setError(null)
      setNotice(null)

      const parsed = parseAmount(amountRef.current)

      try {
        const outcome = canEarn
          ? await counter.checkIn(raw, { amount: parsed, decodeMs: meta?.decodeMs })
          : await counter.identify(raw)

        seqRef.current += 1
        setFeedback({ outcome, at: Date.now(), seq: seqRef.current })

        // The ticket belongs to the customer who just paid, never to the next
        // person in the queue.
        if (parsed != null) setAmount('')

        if (outcome.resolution.kind === 'customer' && outcome.checkin) {
          setServed((count) => count + 1)
          if (outcome.checkin.rewardUnlocked) celebrate()
        }
        if (outcome.queued) {
          setNotice(t('pos.queuedOffline'))
        }
      } catch (cause) {
        if (cause instanceof OfflineQueuedError) {
          setServed((count) => count + 1)
          setNotice(cause.message)
          setFeedback(null)
        } else {
          setError(toastError(cause, t, 'pos.scanFailed'))
        }
      } finally {
        busyRef.current = false
        setBusy(false)
      }
    },
    [canEarn, counter, t]
  )

  const scanner = useQrScanner({
    onResult: (value, meta) => void handleScan(value, meta),
    sound,
  })

  const cameraUnavailable = !scanner.supported || scanner.error !== null
  const showManual = manual || cameraUnavailable

  /**
   * Hold the camera exactly while it is on screen.
   *
   * Opened without asking, because making the merchant tap "start" first is a tap
   * that buys nothing. Released the moment they switch to searching by name — the
   * video element is gone at that point, and a camera running behind a search box
   * drains the battery and leaves the device's privacy indicator lit, which a
   * merchant reasonably reads as us watching their shop.
   *
   * Keyed on `manual` — the merchant's intent — rather than on `showManual`, which
   * also reflects a camera failure. Retrying on the failure signal would loop:
   * starting clears the error, which would make the camera look available again.
   * A failed camera therefore waits for `cameraAttempt` to be bumped explicitly.
   */
  const { start, stop, supported } = scanner
  const [cameraAttempt, setCameraAttempt] = React.useState(0)
  React.useEffect(() => {
    if (!supported || manual) return
    void start()
    return stop
  }, [supported, manual, cameraAttempt, start, stop])

  // Clear the result card so the viewport is not permanently covered. A new scan
  // replaces it immediately; this only handles the idle case.
  React.useEffect(() => {
    if (!feedback) return
    const timer = setTimeout(() => setFeedback(null), 6000)
    return () => clearTimeout(timer)
  }, [feedback])

  return (
    <div className={cn('flex h-full min-h-0 flex-col bg-background', className)}>
      <Header
        online={counter.online}
        pending={counter.pending}
        syncing={counter.syncing}
        served={served}
        sound={sound}
        onToggleSound={() => setSound((value) => !value)}
        torchOn={scanner.torchOn}
        canToggleTorch={scanner.canToggleTorch}
        onToggleTorch={() => void scanner.toggleTorch()}
        canSwitchCamera={scanner.canSwitchCamera}
        onSwitchCamera={() => void scanner.switchCamera()}
        onClose={onClose}
      />

      <div className="relative min-h-0 flex-1 overflow-y-auto">
        {showManual ? (
          <ManualPanel
            businessId={businessId}
            reason={cameraUnavailable ? scanner.error?.message ?? null : null}
            onPick={(customerId) => void handleScan(customerId)}
            onBackToCamera={
              // Only for the failure case — a denied permission is usually fixed
              // in the browser and then simply works. When the camera is healthy
              // the footer already carries the toggle, and two identical buttons
              // on one screen is a worse answer than one.
              cameraUnavailable && supported
                ? () => {
                    setManual(false)
                    setCameraAttempt((attempt) => attempt + 1)
                  }
                : undefined
            }
            retryLabel={t('pos.retryCamera')}
          />
        ) : (
          <Viewport
            videoRef={scanner.videoRef}
            status={scanner.status}
            busy={busy}
            onRetry={() => setCameraAttempt((attempt) => attempt + 1)}
          />
        )}

        {feedback && (
          <ResultCard
            key={feedback.seq}
            businessId={businessId}
            outcome={feedback.outcome}
            canEarn={canEarn}
            onDismiss={() => setFeedback(null)}
            onPickCustomer={(customerId) => void handleScan(customerId)}
            canRedeemGiftCards={canRedeemGiftCards}
          />
        )}
      </div>

      <Footer
        amount={amount}
        onAmountChange={setAmount}
        canEarn={canEarn}
        error={error}
        notice={notice}
        showManualToggle={!cameraUnavailable}
        manual={showManual}
        onToggleManual={() => setManual((value) => !value)}
        abandoned={counter.abandoned}
        onDismissAbandoned={counter.dismissAbandoned}
      />
    </div>
  )
}

// -----------------------------------------------------------------------------
// Chrome
// -----------------------------------------------------------------------------

function Header({
  online,
  pending,
  syncing,
  served,
  sound,
  onToggleSound,
  torchOn,
  canToggleTorch,
  onToggleTorch,
  canSwitchCamera,
  onSwitchCamera,
  onClose,
}: {
  online: boolean
  pending: number
  syncing: boolean
  served: number
  sound: boolean
  onToggleSound: () => void
  torchOn: boolean
  canToggleTorch: boolean
  onToggleTorch: () => void
  canSwitchCamera: boolean
  onSwitchCamera: () => void
  onClose?: () => void
}) {
  const { t } = useI18n()
  return (
    <header className="flex shrink-0 items-center gap-1 border-b px-2 py-2">
      {onClose && (
        <Button variant="ghost" size="icon" onClick={onClose} aria-label={t('pos.closeScanner')}>
          <X className="size-5" />
        </Button>
      )}

      <div className="ml-1 min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm font-semibold">
          {t('pos.scan')}
          {served > 0 && (
            <span className="text-xs font-normal text-muted-foreground">
              {t('pos.served', { count: served })}
            </span>
          )}
        </p>
        {!online && (
          <p className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-500">
            <CloudOff className="size-3" />
            {t('pos.offline')}
          </p>
        )}
        {online && pending > 0 && (
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            {syncing ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
            {t('pos.syncing', { count: pending })}
          </p>
        )}
      </div>

      {canToggleTorch && (
        <Button
          variant={torchOn ? 'secondary' : 'ghost'}
          size="icon"
          onClick={onToggleTorch}
          aria-label={torchOn ? t('pos.torchOff') : t('pos.torchOn')}
          aria-pressed={torchOn}
        >
          {torchOn ? <Flashlight className="size-5" /> : <FlashlightOff className="size-5" />}
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        onClick={onToggleSound}
        aria-label={sound ? t('pos.soundOff') : t('pos.soundOn')}
        aria-pressed={sound}
      >
        {sound ? <Volume2 className="size-5" /> : <VolumeX className="size-5" />}
      </Button>
      {canSwitchCamera && (
        <Button variant="ghost" size="icon" onClick={onSwitchCamera} aria-label={t('pos.switchCamera')}>
          <RefreshCw className="size-5" />
        </Button>
      )}
    </header>
  )
}

function Viewport({
  videoRef,
  status,
  busy,
  onRetry,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>
  status: ReturnType<typeof useQrScanner>['status']
  busy: boolean
  onRetry: () => void
}) {
  const { t } = useI18n()
  return (
    <div className="relative h-full min-h-72 bg-black">
      <video
        ref={videoRef}
        className="size-full object-cover"
        playsInline
        muted
        autoPlay
        aria-label={t('pos.cameraPreview')}
      />

      {/* Framing guide. Purely decorative: the decoder reads the whole frame, so
          a customer who misses the box is still scanned. */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="relative aspect-square w-[62%] max-w-72">
          <span className="absolute left-0 top-0 size-8 rounded-tl-xl border-l-4 border-t-4 border-white/90" />
          <span className="absolute right-0 top-0 size-8 rounded-tr-xl border-r-4 border-t-4 border-white/90" />
          <span className="absolute bottom-0 left-0 size-8 rounded-bl-xl border-b-4 border-l-4 border-white/90" />
          <span className="absolute bottom-0 right-0 size-8 rounded-br-xl border-b-4 border-r-4 border-white/90" />
          {status === 'scanning' && (
            <span className="absolute inset-x-3 top-1/2 h-0.5 animate-pulse rounded bg-white/70" />
          )}
        </div>
      </div>

      {status === 'scanning' && (
        <p className="pointer-events-none absolute inset-x-0 bottom-4 text-center text-sm font-medium text-white drop-shadow">
          {busy ? t('pos.reading') : t('pos.pointCamera')}
        </p>
      )}

      {(status === 'starting' || status === 'suspended') && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 text-white">
          <Loader2 className="size-7 animate-spin" />
          <p className="text-sm">
            {status === 'suspended' ? t('pos.reconnecting') : t('pos.opening')}
          </p>
        </div>
      )}

      {status === 'idle' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 text-white">
          <ScanLine className="size-10" />
          <Button size="lg" className="gap-2" onClick={onRetry}>
            <Camera className="size-5" />
            {t('pos.retryCamera')}
          </Button>
        </div>
      )}
    </div>
  )
}

function Footer({
  amount,
  onAmountChange,
  canEarn,
  error,
  notice,
  showManualToggle,
  manual,
  onToggleManual,
  abandoned,
  onDismissAbandoned,
}: {
  amount: string
  onAmountChange: (value: string) => void
  canEarn: boolean
  error: string | null
  notice: string | null
  showManualToggle: boolean
  manual: boolean
  onToggleManual: () => void
  abandoned: ReturnType<typeof useCounterScan>['abandoned']
  onDismissAbandoned: () => void
}) {
  const { t } = useI18n()
  return (
    <div className="shrink-0 space-y-3 border-t p-3">
      {/* Announced politely so a screen-reader user hears the outcome without
          losing their place in the scanner. */}
      <div aria-live="polite" className="sr-only">
        {error ?? notice ?? ''}
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {notice && !error && (
        <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-500">
          {notice}
        </p>
      )}

      {abandoned.length > 0 && (
        <div className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <p className="font-medium">{t('pos.abandoned', { count: abandoned.length })}</p>
          <p className="mt-0.5 text-xs">
            {t('pos.abandonedBody', {
              names: abandoned
                .map((scan) => scan.customerLabel ?? t('pos.unknownCustomer'))
                .slice(0, 3)
                .join(', '),
            })}
          </p>
          <Button variant="ghost" size="sm" className="mt-1 h-7 px-2" onClick={onDismissAbandoned}>
            {t('common.dismiss')}
          </Button>
        </div>
      )}

      {canEarn && (
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1">
            <Label htmlFor="scan-amount" className="text-xs">
              {t('pos.ticketAmount')} ({t('common.optional').toLocaleLowerCase(t.tag)})
            </Label>
            <Input
              id="scan-amount"
              value={amount}
              onChange={(event) => onAmountChange(event.target.value.replace(/[^\d.,]/g, ''))}
              inputMode="decimal"
              placeholder="0.00"
              className="h-11 text-base"
              autoComplete="off"
            />
          </div>
          {amount && (
            <Button
              variant="ghost"
              className="h-11"
              onClick={() => onAmountChange('')}
              aria-label={t('pos.clearAmount')}
            >
              {t('common.clear')}
            </Button>
          )}
        </div>
      )}

      {canEarn && amount && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Zap className="size-3.5" />
          {t('pos.ticketNote', { amount })}
        </p>
      )}

      {showManualToggle && (
        <Button variant="outline" className="h-12 w-full gap-2" onClick={onToggleManual}>
          {manual ? (
            <>
              <Camera className="size-4" />
              {t('pos.backToCamera')}
            </>
          ) : (
            <>
              <Keyboard className="size-4" />
              {t('pos.searchInstead')}
            </>
          )}
        </Button>
      )}
    </div>
  )
}

// -----------------------------------------------------------------------------
// Result
// -----------------------------------------------------------------------------

function ResultCard({
  businessId,
  outcome,
  canEarn,
  onDismiss,
  onPickCustomer,
  canRedeemGiftCards,
}: {
  businessId: string
  outcome: ScanOutcome
  canEarn: boolean
  onDismiss: () => void
  onPickCustomer: (customerId: string) => void
  canRedeemGiftCards: boolean
}) {
  const { t } = useI18n()
  const { resolution } = outcome

  return (
    <div className="absolute inset-x-0 bottom-0 z-10 animate-in slide-in-from-bottom-4 duration-200">
      <div className="max-h-full overflow-y-auto rounded-t-2xl border-t bg-background shadow-2xl">
        <div className="flex items-start gap-2 p-4">
          <div className="min-w-0 flex-1">
            {resolution.kind === 'customer' && (
              <CustomerResult
                businessId={businessId}
                customer={resolution.customer}
                checkin={outcome.checkin}
                queued={outcome.queued}
                canEarn={canEarn}
              />
            )}
            {resolution.kind === 'reward_claim' && (
              <ClaimResult
                name={outcome.fulfilled?.rewardName ?? resolution.claim.name}
                customerName={resolution.customer.displayName}
                fulfilled={Boolean(outcome.fulfilled)}
              />
            )}
            {resolution.kind === 'gift_card' && (
              <GiftCardResult
                businessId={businessId}
                card={resolution.giftCard}
                canRedeem={canRedeemGiftCards}
              />
            )}
            {resolution.kind === 'referral' && (
              <ReferralResult advocate={resolution.advocate} code={resolution.code} />
            )}
            {resolution.kind === 'candidates' && (
              <CandidatesResult
                customers={resolution.customers}
                term={resolution.term}
                onPick={onPickCustomer}
              />
            )}
            {resolution.kind === 'join' && <JoinResult slug={resolution.businessSlug} />}
            {resolution.kind === 'unknown' && <UnknownResult hint={resolution.hint} />}
          </div>

          <Button variant="ghost" size="icon" onClick={onDismiss} aria-label={t('pos.dismissResult')}>
            <X className="size-4" />
          </Button>
        </div>

        <p className="border-t px-4 py-2 text-center text-xs text-muted-foreground">
          {t('pos.readyForNext')}
        </p>
      </div>
    </div>
  )
}

function CustomerResult({
  businessId,
  customer,
  checkin,
  queued,
  canEarn,
}: {
  businessId: string
  customer: Extract<ScanOutcome['resolution'], { kind: 'customer' }>['customer']
  checkin: ScanOutcome['checkin']
  queued: boolean
  canEarn: boolean
}) {
  const { t } = useI18n()
  const money = useMoney()
  const program = customer.programs[0]
  const award = checkin?.awards[0]
  const unlocked = checkin?.rewardUnlocked ?? program?.rewardAvailable ?? false

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span
          className={cn(
            'flex size-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white',
            unlocked ? 'bg-emerald-600' : 'bg-primary'
          )}
        >
          {unlocked ? <Gift className="size-5" /> : <Check className="size-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 truncate text-base font-semibold">
            {customer.displayName}
            {customer.isVip && <Star className="size-4 shrink-0 fill-amber-400 text-amber-400" />}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {checkin?.duplicate
              ? t('pos.duplicate')
              : award
                ? t('pos.awarded', {
                    amount: award.amount,
                    unit: award.amount === 1 ? award.unitSingular : award.unitPlural,
                  })
                : canEarn
                  ? t('pos.identified')
                  : t('pos.identifiedNoEarn')}
            {customer.tierName ? ` · ${customer.tierName}` : ''}
            {` · ${t('pos.visitsCount', { count: customer.visitCount })}`}
          </p>
        </div>
      </div>

      {program && (
        <Progress
          balance={award?.balance ?? program.balance}
          goal={award?.goalAmount ?? program.goal}
          unitPlural={program.unitPlural}
          unlocked={unlocked}
        />
      )}

      {customer.nextBestAction && (
        <p className="rounded-lg bg-muted px-3 py-2 text-sm">{customer.nextBestAction}</p>
      )}

      {queued && (
        <p className="text-xs text-amber-600 dark:text-amber-500">{t('pos.queuedBalance')}</p>
      )}

      {!queued && customer.claims.length > 0 && (
        <div className="rounded-lg border p-2.5">
          <p className="text-xs font-medium">{t('pos.waitingHandover')}</p>
          <ul className="mt-1.5 space-y-1">
            {customer.claims.map((claim) => (
              <li key={claim.redemptionId} className="flex items-center justify-between text-sm">
                <span className="truncate">{claim.name}</span>
                <code className="ml-2 shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs">
                  {claim.code}
                </code>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!queued && canEarn && (
        <RedeemRow
          businessId={businessId}
          customerId={customer.id}
          rewards={customer.rewards.filter((reward) => reward.affordable)}
        />
      )}

      {customer.giftCardBalance > 0 && (
        <p className="text-xs text-muted-foreground">
          {t('pos.giftCardBalance', {
            amount: money(customer.giftCardBalance, customer.giftCardCurrency),
          })}
        </p>
      )}

      {customer.partnerOffers.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {customer.partnerOffers[0]!.businessName
            ? t('pos.partnerOfferFrom', {
                title: customer.partnerOffers[0]!.title,
                business: customer.partnerOffers[0]!.businessName,
              })
            : t('pos.partnerOffer', { title: customer.partnerOffers[0]!.title })}
        </p>
      )}
    </div>
  )
}

function Progress({
  balance,
  goal,
  unitPlural,
  unlocked,
}: {
  balance: number
  goal: number | null
  unitPlural: string
  unlocked: boolean
}) {
  const { t } = useI18n()
  if (goal == null || goal <= 0) {
    return (
      <p className="text-2xl font-semibold tabular-nums">
        {balance}{' '}
        <span className="text-sm font-normal text-muted-foreground">{unitPlural}</span>
      </p>
    )
  }

  const percent = Math.min(100, Math.round((balance / goal) * 100))
  const remaining = Math.max(0, goal - balance)

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-sm font-medium">
          {unlocked ? t('pos.rewardReady') : t('pos.toGo', { count: remaining })}
        </span>
        <span className="text-sm tabular-nums text-muted-foreground">
          {balance} / {goal}
        </span>
      </div>
      <div
        className="h-3 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={balance}
        aria-valuemin={0}
        aria-valuemax={goal}
        aria-label={t('pos.progressLabel', { balance, goal, unit: unitPlural })}
      >
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-500',
            unlocked ? 'bg-emerald-500' : 'bg-primary'
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}

/** Redeeming in the same breath as the scan is what turns a stamp into a visit. */
function RedeemRow({
  businessId,
  customerId,
  rewards,
}: {
  businessId: string
  customerId: string
  rewards: Array<{ id: string; name: string; cost: number }>
}) {
  const { t } = useI18n()
  const [redeeming, setRedeeming] = React.useState<string | null>(null)
  const [redeemed, setRedeemed] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  if (rewards.length === 0) return null

  if (redeemed) {
    return (
      <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
        <Check className="mr-1 inline size-4" />
        {t('pos.redeemed', { name: redeemed })}
      </p>
    )
  }

  async function redeem(rewardId: string, name: string) {
    setRedeeming(rewardId)
    setError(null)
    try {
      await apiPost('/api/v1/loyalty/redeem', {
        businessId,
        customerId,
        rewardId,
        idempotencyKey: newIdempotencyKey(`redeem-${customerId}-${rewardId}`),
      })
      setRedeemed(name)
      celebrate()
    } catch (cause) {
      setError(toastError(cause, t, 'pos.redeemFailed'))
    } finally {
      setRedeeming(null)
    }
  }

  return (
    <div className="space-y-1.5">
      {error && <p className="text-xs text-destructive">{error}</p>}
      {rewards.slice(0, 3).map((reward) => (
        <Button
          key={reward.id}
          className="h-12 w-full justify-between gap-2"
          disabled={redeeming !== null}
          onClick={() => void redeem(reward.id, reward.name)}
        >
          <span className="flex items-center gap-2">
            <Gift className="size-4" />
            {t('pos.redeem', { name: reward.name })}
          </span>
          {redeeming === reward.id ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <span className="text-xs opacity-80">{reward.cost}</span>
          )}
        </Button>
      ))}
    </div>
  )
}

function ClaimResult({
  name,
  customerName,
  fulfilled,
}: {
  name: string
  customerName: string
  fulfilled: boolean
}) {
  const { t } = useI18n()
  return (
    <div className="flex items-center gap-3">
      <span className="flex size-11 items-center justify-center rounded-full bg-emerald-600 text-white">
        <Gift className="size-5" />
      </span>
      <div className="min-w-0">
        <p className="text-base font-semibold">
          {fulfilled ? t('pos.giveThem', { name }) : name}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {customerName}
          {fulfilled ? ` · ${t('pos.handedOver')}` : ''}
        </p>
      </div>
    </div>
  )
}

/**
 * Gift cards, settled where they are scanned.
 *
 * The balance is shown before anything can be spent, because "how much is on
 * this?" is asked far more often than "take it all" — and answering that
 * question must never be able to spend the card by accident.
 */
function GiftCardResult({
  businessId,
  card,
  canRedeem,
}: {
  businessId: string
  card: Extract<ScanOutcome['resolution'], { kind: 'gift_card' }>['giftCard']
  canRedeem: boolean
}) {
  const { t } = useI18n()
  const money = useMoney()
  const [amount, setAmount] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [result, setResult] = React.useState<{ taken: number; left: number } | null>(null)

  // One key per scanned card, so a double tap on café wifi spends once.
  const [idempotencyKey] = React.useState(() => newIdempotencyKey(`gc-${card.code}`))

  const take = parseAmount(amount) ?? card.remainingValue

  async function redeem() {
    setBusy(true)
    setError(null)
    try {
      const response = await apiPost<{ redeemedAmount: number; remainingValue: number }>(
        '/api/v1/gift-cards/redeem',
        {
          businessId,
          code: card.code,
          amount: parseAmount(amount),
          idempotencyKey,
        }
      )
      setResult({ taken: response.redeemedAmount, left: response.remainingValue })
      celebrate()
    } catch (cause) {
      setError(toastError(cause, t, 'pos.takeFailed'))
    } finally {
      setBusy(false)
    }
  }

  if (result) {
    return (
      <div className="space-y-1">
        <p className="text-base font-semibold">
          <Check className="mr-1 inline size-4 text-emerald-600" />
          {t('pos.taken', { amount: money(result.taken, card.currency) })}
        </p>
        <p className="text-sm text-muted-foreground">
          {result.left > 0
            ? t('pos.leftOnCard', { amount: money(result.left, card.currency) })
            : t('pos.cardEmpty')}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs text-muted-foreground">{t('pos.giftCardCode', { code: card.code })}</p>
        <p className="text-3xl font-semibold tabular-nums">
          {money(card.remainingValue, card.currency)}
        </p>
        {card.recipientName && (
          <p className="text-sm text-muted-foreground">
            {t('pos.giftCardFor', { name: card.recipientName })}
          </p>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {!card.redeemable ? (
        <Badge variant="destructive">{card.status}</Badge>
      ) : canRedeem ? (
        <>
          <div className="space-y-1">
            <Label htmlFor="gc-take" className="text-xs">
              {t('pos.amountToTake')}
            </Label>
            <Input
              id="gc-take"
              value={amount}
              onChange={(event) => setAmount(event.target.value.replace(/[^\d.,]/g, ''))}
              inputMode="decimal"
              placeholder={t('pos.wholeBalance', {
                amount: money(card.remainingValue, card.currency),
              })}
              className="h-12 text-base"
              autoComplete="off"
            />
          </div>
          <Button
            className="h-12 w-full gap-2"
            disabled={busy || take <= 0}
            onClick={() => void redeem()}
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            {t('pos.take', { amount: money(Math.min(take, card.remainingValue), card.currency) })}
          </Button>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">{t('pos.cannotTakePayment')}</p>
      )}
    </div>
  )
}

function ReferralResult({ advocate, code }: { advocate: CustomerSummary; code: string }) {
  const { t } = useI18n()
  return (
    <div className="space-y-1">
      <p className="text-base font-semibold">
        {t('pos.referralFrom', { name: advocate.displayName })}
      </p>
      <p className="text-sm text-muted-foreground">
        {t('pos.referralBody', { code, name: advocate.displayName })}
      </p>
    </div>
  )
}

/**
 * Picking a candidate routes back through the parent's scan handler rather than
 * calling the API here: one scan brain per scanner means one offline queue, one
 * sync loop, and one place where a check-in can happen.
 */
function CandidatesResult({
  customers,
  term,
  onPick,
}: {
  customers: CustomerSummary[]
  term: string
  onPick: (customerId: string) => void
}) {
  const { t } = useI18n()
  const [busy, setBusy] = React.useState<string | null>(null)

  function pick(customerId: string) {
    setBusy(customerId)
    onPick(customerId)
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{t('pos.whichOne', { term })}</p>
      <ul className="space-y-1.5">
        {customers.slice(0, 5).map((customer) => (
          <li key={customer.id}>
            <button
              onClick={() => pick(customer.id)}
              disabled={busy !== null}
              className="flex w-full items-center gap-3 rounded-lg border p-2.5 text-left transition-colors hover:border-primary/60 active:scale-[0.99] disabled:opacity-60"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                {customer.initials}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{customer.displayName}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {t('pos.visitsCount', { count: customer.visitCount })}
                  {customer.tierName ? ` · ${customer.tierName}` : ''}
                </span>
              </span>
              {busy === customer.id ? (
                <Loader2 className="size-4 shrink-0 animate-spin" />
              ) : customer.rewardAvailable ? (
                <Badge className="shrink-0 bg-emerald-600 hover:bg-emerald-600">
                  {t('pos.reward')}
                </Badge>
              ) : (
                <span className="shrink-0 text-sm font-semibold tabular-nums">
                  {customer.balance}
                  {customer.goal ? (
                    <span className="text-muted-foreground">/{customer.goal}</span>
                  ) : null}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function JoinResult({ slug }: { slug: string }) {
  const { t } = useI18n()
  return (
    <div className="space-y-1">
      <p className="text-base font-semibold">{t('pos.notAMember')}</p>
      <p className="text-sm text-muted-foreground">{t('pos.notAMemberBody', { slug })}</p>
    </div>
  )
}

function UnknownResult({ hint }: { hint: string }) {
  const { t } = useI18n()
  return (
    <div className="flex items-start gap-3">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-muted">
        <CameraOff className="size-5 text-muted-foreground" />
      </span>
      <div>
        <p className="text-sm font-semibold">{t('pos.notRecognised')}</p>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </div>
    </div>
  )
}

// -----------------------------------------------------------------------------
// Manual fallback
// -----------------------------------------------------------------------------

type Roster = { recent: CustomerSummary[]; vip: CustomerSummary[] }

/**
 * Everything that keeps the merchant working when the camera cannot.
 *
 * Recent visitors and regulars come first because they resolve most check-ins
 * with no typing at all — the person at the counter is nearly always someone who
 * has been here before.
 */
function ManualPanel({
  businessId,
  reason,
  onPick,
  onBackToCamera,
  retryLabel,
}: {
  businessId: string
  reason: string | null
  onPick: (value: string) => void
  onBackToCamera?: () => void
  retryLabel?: string
}) {
  const { t } = useI18n()
  const relative = useRelativeTime()
  const [term, setTerm] = React.useState('')
  const [tab, setTab] = React.useState<'recent' | 'vip'>('recent')

  // Debounced so typing an email does not fire eight requests. Setting state in
  // the timeout (rather than during the effect) is what keeps this a single
  // render per settled keystroke.
  const [settledTerm, setSettledTerm] = React.useState('')
  React.useEffect(() => {
    const timer = setTimeout(() => setSettledTerm(term.trim()), 250)
    return () => clearTimeout(timer)
  }, [term])

  const searching = term.trim().length >= 2 && term.trim() !== settledTerm
  const roster = useApi<Roster>(`/api/v1/counter/roster${query({ businessId })}`)
  const search = useApi<{ customers: CustomerSummary[] }>(
    settledTerm.length >= 2
      ? `/api/v1/customers/lookup${query({ businessId, q: settledTerm })}`
      : null
  )

  const matches = settledTerm.length >= 2 ? search.data?.customers ?? null : null
  const list: CustomerSummary[] =
    matches ?? (tab === 'recent' ? roster.data?.recent : roster.data?.vip) ?? []

  return (
    <div className="space-y-4 p-4">
      {reason && (
        <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-500">
          {reason}
        </p>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="manual-search">{t('pos.searchLabel')}</Label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="manual-search"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends the raw text straight to the resolver, so a typed
              // gift card or reward code works exactly like a scanned one.
              if (event.key === 'Enter' && term.trim().length >= 2) onPick(term.trim())
            }}
            placeholder={t('pos.searchPlaceholder')}
            className="h-12 pl-9 text-base"
            autoComplete="off"
            inputMode="search"
            autoFocus
          />
          {(searching || search.isLoading) && (
            <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          )}
        </div>
      </div>

      {!matches && (
        <div className="flex gap-1 rounded-lg bg-muted p-1">
          {(
            [
              { key: 'recent', labelKey: 'pos.tabRecent' },
              { key: 'vip', labelKey: 'pos.tabRegulars' },
            ] as const
          ).map((option) => (
            <button
              key={option.key}
              onClick={() => setTab(option.key)}
              aria-pressed={tab === option.key}
              className={cn(
                'flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                tab === option.key
                  ? 'bg-background shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {t(option.labelKey)}
            </button>
          ))}
        </div>
      )}

      {roster.isLoading && !matches ? (
        <div className="flex justify-center py-6">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : list.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {matches
            ? t('pos.noMatches')
            : tab === 'recent'
              ? t('pos.noRecent')
              : t('pos.noRegulars')}
        </p>
      ) : (
        <ul className="space-y-2">
          {list.map((customer) => (
            <li key={customer.id}>
              <button
                onClick={() => onPick(customer.id)}
                className="flex w-full items-center gap-3 rounded-xl border bg-card p-3 text-left transition-colors hover:border-primary/60 active:scale-[0.99]"
              >
                <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                  {customer.initials}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{customer.displayName}</span>
                    {customer.isVip && (
                      <Star className="size-3.5 shrink-0 fill-amber-400 text-amber-400" />
                    )}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {t('pos.visitsCount', { count: customer.visitCount })}
                    {customer.tierName ? ` · ${customer.tierName}` : ''}
                    {customer.lastVisit
                      ? ` · ${relative(customer.lastVisit, { short: true })}`
                      : ` · ${t('pos.neverVisited')}`}
                  </span>
                </span>
                {customer.rewardAvailable ? (
                  <Badge className="shrink-0 gap-1 bg-emerald-600 hover:bg-emerald-600">
                    <Gift className="size-3" />
                    {t('pos.reward')}
                  </Badge>
                ) : (
                  <span className="shrink-0 text-sm font-semibold tabular-nums">
                    {customer.balance}
                    {customer.goal ? (
                      <span className="text-muted-foreground">/{customer.goal}</span>
                    ) : null}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {onBackToCamera && (
        <Button variant="outline" className="h-12 w-full gap-2" onClick={onBackToCamera}>
          <Camera className="size-4" />
          {retryLabel ?? t('pos.backToCamera')}
        </Button>
      )}
    </div>
  )
}

// -----------------------------------------------------------------------------

function parseAmount(value: string): number | null {
  if (!value.trim()) return null
  const parsed = Number(value.replace(',', '.'))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

/**
 * Money at the counter, in the merchant's language.
 *
 * Was `Intl.NumberFormat(undefined, …)`, which resolves to the *browser's*
 * locale — so a Spanish shop running the till on an English tablet read
 * `€1,234.50` in an otherwise Spanish screen. The formatter now follows the
 * product's language, which is the one the merchant chose.
 */
function useMoney(): (value: number, currency: string | null) => string {
  const formatValue = useFormatValue()
  return React.useCallback(
    (value, currency) => formatValue(value, 'currency', currency ?? 'EUR'),
    [formatValue]
  )
}

/** The emotional payoff the whole product is built around. */
function celebrate(): void {
  void confetti({
    particleCount: 80,
    spread: 70,
    origin: { y: 0.6 },
    disableForReducedMotion: true,
  })
}
