'use client'

import * as React from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  Download,
  Gift,
  Loader2,
  MapPin,
  Megaphone,
  ScanLine,
  Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { ThemeToggle } from '@/components/theme-toggle'
import { LanguageToggle } from '@/components/language-toggle'
import { BrandMark } from '@/components/brand-mark'
import { CardPreview, type CardPreviewData } from '@/components/wallet/card-preview'
import { PlatformSwitch } from '@/components/wallet/platform-switch'
import { LogoField } from '@/components/brand/logo-field'
import { WorkspaceProvider, useWorkspace } from '@/lib/client/workspace'
import { useApi, apiFetch, apiPatch, apiPost, query } from '@/lib/client/api'
import { useClientValue } from '@/lib/client/hooks'
import {
  BUSINESS_TYPES,
  CARD_PALETTES,
  findBusinessType,
  goalsFor,
  unitKeysFor,
  type BusinessType,
} from '@/lib/onboarding/presets'
import {
  DEFAULT_CARD_DESIGN,
  normalizeHex,
  resolveCardDesign,
  type CardDesign,
} from '@/lib/wallet/card-design'
import { applyCardTemplate, findCardTemplate } from '@/lib/wallet/card-templates'
import { placeholderBrandKit } from '@/lib/brand/kit'
import { toastError } from '@/lib/client/api-errors'
import { useI18n } from '@/lib/i18n'
import type { TranslationKey } from '@/lib/i18n'
import { PLAN_CURRENCY, PUBLIC_PLANS, type PlanId } from '@/lib/billing/plans'
import { cn } from '@/lib/utils'

/**
 * Onboarding.
 *
 * The rule this flow is built around: **a merchant should never be configuring,
 * always deciding.** Every screen therefore shows the consequence of the choice
 * next to the choice — pick "bakery" and the card, the program, the reward and
 * the first campaign appear; drag a colour and the card in the corner changes;
 * pick a goal and the stamps redraw. Nothing is described in prose that could be
 * shown instead.
 *
 * Five steps, two of which can be skipped:
 *
 *   1. **Your program** — the trade, and immediately what it implies. Required,
 *      but it is one click on a card that is already selected.
 *   2. **Your plan** — the only decision with money attached. Skippable: the
 *      trial is already running and a card form between a merchant and their
 *      first customer is the most expensive screen a loyalty product can have.
 *   3. **Your shop** — a card points somewhere and a geofence needs a centre.
 *      Skippable, because neither is needed to serve the person at the counter.
 *   4. **Your card** — the designer, cut to what matters on day one, previewing
 *      through the same renderer the real pass resolves through.
 *   5. **Ready** — the QR code, the card, and what is already running.
 *
 * On the previous version: it was three steps and correct about what to cut, but
 * every screen was a form. The card step offered six palette chips and drew the
 * result on a generic `LoyaltyCard` component that shares no code with a wallet
 * pass, so the one screen that sells the product previewed something the customer
 * never receives. That is fixed here — `CardPreview` and `resolveCardDesign` are
 * the same pieces `buildPassContent` uses.
 *
 * Feature gating goes through the same `has()` the rest of the dashboard uses.
 * There is no parallel permission path here, which matters because onboarding is
 * exactly where a shortcut would be tempting and invisible.
 */

type BusinessResponse = {
  business: {
    id: string
    name: string
    slug: string
    category: string | null
    city: string | null
    primary_color: string
    accent_color: string
    text_color: string
    logo_url: string | null
  }
  locations: Array<{
    id: string
    name: string
    address: string | null
    city: string | null
    lat: number | null
    lng: number | null
    is_default: boolean
  }>
}

type ProgramsResponse = {
  programs: Array<{ id: string; is_default: boolean; goal_amount: number | null }>
}

type BillingResponse = {
  effective_plan: PlanId
  billing_configured: boolean
  trial: { active: boolean; daysRemaining: number }
}

type OnboardingStateResponse = {
  lastStep: string | null
  completed: boolean
  facts: { locationCount: number }
}

export type Step = 'program' | 'plan' | 'shop' | 'card' | 'ready'

type StepMeta = { id: Step; labelKey: TranslationKey; optional: boolean }

/**
 * The wizard's shape, in one place.
 *
 * `optional` is load-bearing rather than cosmetic: it drives the "skip" control,
 * the badge in the progress rail, and the percentage, so a merchant can see at a
 * glance that two of the five are things they are allowed to postpone. A product
 * that hides which steps are optional makes every step feel mandatory, and the
 * ones that feel mandatory are where people stop.
 */
export const STEPS: readonly StepMeta[] = [
  { id: 'program', labelKey: 'onboarding.steps.program', optional: false },
  { id: 'plan', labelKey: 'onboarding.steps.plan', optional: true },
  { id: 'shop', labelKey: 'onboarding.steps.shop', optional: true },
  { id: 'card', labelKey: 'onboarding.steps.card', optional: false },
]

const STEP_ORDER: readonly Step[] = STEPS.map((step) => step.id)

/**
 * Has the merchant actually told us where their shop is?
 *
 * Not "does a location row exist". `passimo_provision_business` creates one at
 * signup — named after the business, with no address, no city and no
 * coordinates — so a row always exists from the first second of the account.
 *
 * That placeholder is why the location step was once dead code: the wizard
 * skipped it for every merchant who ever signed up, and nobody was asked where
 * they trade. The consequences are not cosmetic — a geofence with no centre never
 * fires, a wallet pass carries no location, and the customer card says nothing
 * about where to find the shop.
 *
 * A location counts as configured once it carries any of the three things the
 * step collects.
 */
export function hasConfiguredLocation(
  locations: Array<{ address: string | null; city: string | null; lat: number | null; lng: number | null }>
): boolean {
  return locations.some(
    (location) =>
      Boolean(location.address?.trim()) ||
      Boolean(location.city?.trim()) ||
      (location.lat !== null && location.lng !== null)
  )
}

/**
 * Where to drop a returning merchant.
 *
 * Onboarding is interruptible by definition — a café owner sets it up between
 * customers, and the phone rings. Restarting them at step one is both irritating
 * and dangerous: they re-enter a location that already exists, or sit through a
 * plan decision they already made.
 *
 * The rule is **derive from the account wherever the account knows**, and fall
 * back to the recorded cursor only for the steps that leave no trace:
 *
 *   * **card** — a location row exists, so everything before it is behind them.
 *     Derived, and cannot go stale.
 *   * **shop** — no location row, but the cursor says they moved past the plan
 *     screen. `setStep` writes that cursor the moment they continue, so it is a
 *     record of a decision, not a guess.
 *   * **plan / program** — no location and no cursor: they have barely started.
 *
 * The plan step is special because *passing* it writes nothing. Choosing the
 * trial is a click, not a purchase — deliberately, since a card form between a
 * merchant and their first customer is the most expensive screen a loyalty
 * product can have. So a live trial cannot stand in for "chose a plan": every new
 * signup has one, and treating that as consent would silently skip the only
 * screen where a merchant sees what things cost.
 *
 * A paid subscription *is* proof, and is honoured even without a cursor, so a
 * merchant who checked out and then lost their session is not asked again.
 *
 * The cursor is never allowed to jump a merchant *forward* past work that is not
 * done — a stored `card` with no location still lands on `shop`. That direction
 * is where a stale cursor does damage.
 *
 * `location` is accepted as a synonym for `shop`: cursors written by the previous
 * version of this wizard are still in the database, and a merchant who paused
 * mid-setup across the deploy must not be sent back to the start.
 */
export function resumeStep(input: {
  completed: boolean
  /** A real subscription — not a trial, which every new account has. */
  hasPaidPlan: boolean
  hasLocation: boolean
  lastStep: string | null
}): Step {
  if (input.completed) return 'ready'

  const cursor = input.lastStep === 'location' ? 'shop' : input.lastStep

  // A location proves every earlier step is behind them.
  if (input.hasLocation) return 'card'

  const passedPlanScreen =
    input.hasPaidPlan || cursor === 'shop' || cursor === 'card' || cursor === 'ready'
  if (passedPlanScreen) return 'shop'

  return cursor === 'plan' ? 'plan' : 'program'
}

/** How far along the merchant is, as a whole number. */
export function completionPercent(step: Step): number {
  if (step === 'ready') return 100
  const index = STEP_ORDER.indexOf(step)
  if (index < 0) return 0
  return Math.round((index / STEP_ORDER.length) * 100)
}

export default function OnboardingPage() {
  return (
    <WorkspaceProvider>
      <OnboardingFlow />
    </WorkspaceProvider>
  )
}

function OnboardingFlow() {
  const { businessId, loading, capabilities } = useWorkspace()

  const business = useApi<BusinessResponse>(businessId ? `/api/v1/businesses/${businessId}` : null)
  const programs = useApi<ProgramsResponse>(
    businessId ? `/api/v1/programs${query({ businessId })}` : null
  )
  const state = useApi<OnboardingStateResponse>(
    businessId ? `/api/v1/onboarding${query({ businessId })}` : null
  )
  const billing = useApi<BillingResponse>(
    businessId ? `/api/v1/billing${query({ businessId })}` : null
  )

  /*
   * Wait for the resume inputs before mounting the wizard. Rendering step one
   * and then jumping is worse than a moment of spinner: the merchant sees a
   * screen, reaches for it, and it moves.
   */
  if (loading || !businessId || !business.data || !state.data || !billing.data) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </main>
    )
  }

  const hasLocation = hasConfiguredLocation(business.data.locations ?? [])

  return (
    /* Keyed on the workspace so the wizard initialises its fields from loaded
       data instead of syncing props into state after the fact. */
    <SetupWizard
      key={businessId}
      businessId={businessId}
      loaded={business.data.business}
      hasLocation={hasLocation}
      uploadsEnabled={capabilities?.storage ?? false}
      /*
       * The placeholder provisioning created, if it is still empty. The shop
       * step fills it in rather than adding a second row — otherwise every
       * merchant ends up with one real shop and one blank one, and the
       * "add another location" checklist item is already ticked on day one.
       */
      placeholderLocationId={
        hasLocation
          ? null
          : ((business.data.locations ?? []).find((location) => location.is_default)?.id ?? null)
      }
      defaultProgramId={programs.data?.programs.find((program) => program.is_default)?.id ?? null}
      initialStep={resumeStep({
        completed: state.data.completed,
        /*
         * A subscription, not a trial: every new account has a trial, so
         * counting it would skip the plan screen for everyone.
         */
        hasPaidPlan: !billing.data.trial.active && billing.data.effective_plan !== 'lapsed',
        hasLocation,
        lastStep: state.data.lastStep,
      })}
      onReload={() => void business.mutate()}
    />
  )
}

function SetupWizard({
  businessId,
  loaded,
  hasLocation,
  uploadsEnabled,
  placeholderLocationId,
  defaultProgramId,
  initialStep,
  onReload,
}: {
  businessId: string
  loaded: BusinessResponse['business']
  hasLocation: boolean
  uploadsEnabled: boolean
  placeholderLocationId: string | null
  defaultProgramId: string | null
  initialStep: Step
  onReload: () => void
}) {
  const router = useRouter()
  const origin = useClientValue(() => window.location.origin, '')
  const { t } = useI18n()

  const [step, setStepState] = React.useState<Step>(initialStep)

  /*
   * Every step change is recorded. This is the cursor `resumeStep` falls back to
   * for the screens that write nothing, and the answer to "where do merchants
   * stop?" for whoever improves this flow next.
   *
   * Fire-and-forget: a merchant's setup must never wait on it, and the worst a
   * failed write costs them is seeing one screen again.
   */
  const setStep = React.useCallback(
    (next: Step) => {
      setStepState(next)
      if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
      void apiPatch('/api/v1/onboarding', { businessId, lastStep: next }).catch(() => undefined)
    },
    [businessId]
  )

  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [copied, setCopied] = React.useState(false)

  // --- The program the merchant is building -----------------------------------

  const [typeKey, setTypeKey] = React.useState(() => findBusinessType(loaded.category).key)
  const businessType = React.useMemo(() => findBusinessType(typeKey), [typeKey])

  const [goal, setGoal] = React.useState(businessType.goal)
  const [reward, setReward] = React.useState(() => t(businessType.rewardKey))
  const [logoUrl, setLogoUrl] = React.useState(loaded.logo_url)

  const [design, setDesign] = React.useState<CardDesign>(() =>
    seedDesign(loaded.category, loaded.primary_color, loaded.accent_color)
  )

  /**
   * Switching trade re-seeds everything the merchant has not touched.
   *
   * A tracked "dirty" flag per field would be more precise and much worse: the
   * whole point of the first screen is that choosing a trade *visibly rebuilds
   * the program*, and a card that keeps the café's browns after someone picks
   * "gym" reads as the choice not having registered. This is the one place a
   * selection is allowed to overwrite, and it happens before anything is saved.
   */
  const chooseType = React.useCallback(
    (next: BusinessType) => {
      setTypeKey(next.key)
      setGoal(next.goal)
      setReward(t(next.rewardKey))
      setDesign(seedDesign(next.key, next.primary, next.accent))
      void apiPatch(`/api/v1/businesses/${businessId}`, { category: next.key }).catch(
        () => undefined
      )
    },
    [businessId, t]
  )

  const brand = React.useMemo(() => {
    const kit = placeholderBrandKit(loaded.name)
    return { ...kit, logoUrl, primaryColor: kit.primaryColor, textColor: kit.textColor }
  }, [loaded.name, logoUrl])

  const resolved = React.useMemo(
    () =>
      resolveCardDesign(design, brand, {
        goal,
        isStampProgram: businessType.loyalty === 'stamps',
      }),
    [design, brand, goal, businessType.loyalty]
  )

  const units = unitKeysFor(businessType.loyalty)

  const previewData: CardPreviewData = React.useMemo(
    () => ({
      organizationName: loaded.name,
      programName: t('onboarding.program.programName', { business: loaded.name }),
      memberName: t('settings.previewMember'),
      memberSince: null,
      tierName: null,
      locationName: loaded.city,
      // Part way through, because that is the state a customer is in almost
      // always — an empty card hides the progress rendering being chosen and a
      // finished one hides the "n to go" line.
      balance: Math.max(1, Math.floor(goal / 2)),
      goal,
      unitSingular: t(units.singular),
      unitPlural: t(units.plural),
      rewardName: reward || t(businessType.rewardKey),
    }),
    [loaded.name, loaded.city, goal, reward, units, businessType.rewardKey, t]
  )

  const joinUrl = origin && loaded.slug ? `${origin}/join/${loaded.slug}` : ''

  // --- Writes ------------------------------------------------------------------

  async function uploadLogo(file: File): Promise<string> {
    const form = new FormData()
    form.append('file', file)
    const result = await apiFetch<{ logoUrl: string }>(
      `/api/v1/brand/logo${query({ businessId })}`,
      { method: 'POST', body: form }
    )
    setLogoUrl(result.logoUrl)
    onReload()
    return result.logoUrl
  }

  async function saveLocation(values: { name: string; address: string; city: string }) {
    setSaving(true)
    setError(null)
    try {
      const payload = {
        businessId,
        name: values.name.trim(),
        address: values.address.trim() || null,
        city: values.city.trim() || null,
        isDefault: true,
      }

      if (placeholderLocationId) {
        await apiPatch('/api/v1/locations', { ...payload, id: placeholderLocationId })
      } else {
        await apiPost('/api/v1/locations', payload)
      }
      // The city is also part of the business record, which the partner
      // directory and the review funnel both read.
      if (values.city.trim()) {
        await apiPatch(`/api/v1/businesses/${businessId}`, { city: values.city.trim() })
      }
      setStep('card')
    } catch (cause) {
      setError(toastError(cause, t, 'onboarding.location.createFailed'))
    } finally {
      setSaving(false)
    }
  }

  async function activateCard() {
    setSaving(true)
    setError(null)
    try {
      await Promise.all([
        /*
         * The brand kit gets the colours, and the card design gets the layout.
         * Writing both is what makes the preview on this screen the card the
         * customer receives — the previous version wrote three hex values onto
         * `businesses` and nothing at all about layout, so every merchant
         * shipped the platform default card no matter what they chose here.
         */
        apiPatch('/api/v1/brand', {
          businessId,
          primaryColor: design.backgroundColor ?? loaded.primary_color,
          accentColor: design.accentColor ?? loaded.accent_color,
        }),
        apiPatch('/api/v1/wallet/design', { businessId, ...design }),
        defaultProgramId
          ? apiPatch('/api/v1/programs', {
              businessId,
              id: defaultProgramId,
              type: businessType.loyalty,
              unitSingular: t(units.singular),
              unitPlural: t(units.plural),
              goalAmount: goal,
              rewardDescription: reward,
            })
          : Promise.resolve(),
        apiPost('/api/v1/rewards', {
          businessId,
          programId: defaultProgramId,
          name: reward,
          cost: goal,
          // A reward that already exists is a re-run of this step, not a
          // failure — the merchant went back and changed a colour.
        }).catch(() => undefined),
      ])
      await apiPatch(`/api/v1/businesses/${businessId}`, { onboardingCompleted: true })
      await apiPatch('/api/v1/onboarding', {
        businessId,
        lastStep: 'ready',
        completed: true,
      }).catch(() => undefined)
      setStep('ready')
    } catch (cause) {
      setError(toastError(cause, t, 'onboarding.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  // --- Render ------------------------------------------------------------------

  const card = (
    <OnboardingCardPreview design={resolved} data={previewData} />
  )

  return (
    <main className="min-h-screen bg-muted/20">
      <header className="border-b bg-background">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4">
          <Link href="/dashboard" className="flex items-center gap-2.5">
            <BrandMark />
            <span className="font-semibold">{t('common.appName')}</span>
          </Link>
          <div className="flex items-center gap-1">
            <LanguageToggle />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-4 py-8">
        {step !== 'ready' && <ProgressRail step={step} />}

        {error && (
          <div
            role="alert"
            className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
          >
            {error}
          </div>
        )}

        {step === 'program' && (
          <ProgramStep
            businessName={loaded.name}
            type={businessType}
            goal={goal}
            reward={reward}
            card={card}
            onChooseType={chooseType}
            onContinue={() => setStep('plan')}
          />
        )}

        {step === 'plan' && (
          <PlanStep
            businessId={businessId}
            businessName={loaded.name}
            onContinue={() => setStep(hasLocation ? 'card' : 'shop')}
            onBack={() => setStep('program')}
          />
        )}

        {step === 'shop' && (
          <LocationStep
            defaultName={loaded.name}
            defaultCity={loaded.city ?? ''}
            saving={saving}
            onBack={() => setStep('plan')}
            onSkip={() => setStep('card')}
            onSubmit={saveLocation}
          />
        )}

        {step === 'card' && (
          <CardStep
            type={businessType}
            design={design}
            goal={goal}
            reward={reward}
            logoUrl={logoUrl}
            uploadsEnabled={uploadsEnabled}
            saving={saving}
            card={card}
            onDesign={setDesign}
            onGoal={setGoal}
            onReward={setReward}
            onUploadLogo={uploadLogo}
            onLogo={setLogoUrl}
            onBack={() => setStep(hasLocation ? 'plan' : 'shop')}
            onSubmit={() => void activateCard()}
          />
        )}

        {step === 'ready' && (
          <ReadyStep
            joinUrl={joinUrl}
            copied={copied}
            card={card}
            reward={reward}
            onCopy={() => {
              void navigator.clipboard.writeText(joinUrl)
              setCopied(true)
              setTimeout(() => setCopied(false), 2000)
            }}
            onScan={() => router.push('/pos')}
            onDashboard={() => router.push('/dashboard')}
          />
        )}
      </div>
    </main>
  )
}

/**
 * A card design seeded from a trade.
 *
 * The template carries layout as well as colour — a café gets a stamp grid and
 * no tier row, a gym gets the tier and no stamps — which is the difference
 * between a palette picker and a design system. The merchant's chosen colours
 * are then laid on top, because those are the part they are most likely to have
 * an opinion about on day one.
 */
function seedDesign(category: string | null, primary: string, accent: string): CardDesign {
  const template = findCardTemplate(findBusinessType(category).cardTemplate)
  const base = template
    ? applyCardTemplate(DEFAULT_CARD_DESIGN, template)
    : { ...DEFAULT_CARD_DESIGN }

  return {
    ...base,
    backgroundColor: normalizeHex(primary) ?? base.backgroundColor,
    accentColor: normalizeHex(accent) ?? base.accentColor,
  }
}

// -----------------------------------------------------------------------------
// Progress
// -----------------------------------------------------------------------------

/**
 * The progress rail.
 *
 * Shows completed, current, remaining, which are optional, and a percentage —
 * all four, because "step 2 of 5" answers a different question from "80%", and a
 * merchant halfway through wants both. The optional badge is the one that
 * changes behaviour: it is the difference between "three screens to go" and
 * "one screen to go and two I can skip".
 */
function ProgressRail({ step }: { step: Step }) {
  const { t, formatNumber } = useI18n()
  const currentIndex = STEP_ORDER.indexOf(step)
  const percent = completionPercent(step)

  return (
    <section className="mb-8" aria-label={t('onboarding.progressLabel')}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium">{t('onboarding.progressTitle')}</p>
        <p className="text-sm tabular-nums text-muted-foreground">
          {t('onboarding.progressPercent', { percent: formatNumber(percent) })}
        </p>
      </div>

      <div
        className="h-2 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t('onboarding.progressLabel')}
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out motion-reduce:transition-none"
          style={{ width: `${percent}%` }}
        />
      </div>

      <ol className="mt-4 grid gap-2 sm:grid-cols-4">
        {STEPS.map((meta, index) => {
          const done = currentIndex > index
          const active = step === meta.id
          return (
            <li
              key={meta.id}
              aria-current={active ? 'step' : undefined}
              className={cn(
                'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors',
                active ? 'border-primary bg-primary/5 font-medium' : 'bg-background/60',
                done && 'text-muted-foreground'
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold',
                  done
                    ? 'bg-emerald-500 text-white'
                    : active
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground'
                )}
              >
                {done ? <Check className="size-3" /> : index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate">{t(meta.labelKey)}</span>
              {meta.optional && (
                <Badge variant="outline" className="shrink-0 text-[10px] font-normal">
                  {t('common.optional')}
                </Badge>
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}

/**
 * The card, with its platform switch.
 *
 * Extracted because it appears on three of the five screens and has to be the
 * same object each time — a card that changes shape between steps reads as three
 * different products.
 */
function OnboardingCardPreview({
  design,
  data,
}: {
  design: ReturnType<typeof resolveCardDesign>
  data: CardPreviewData
}) {
  const [platform, setPlatform] = React.useState<'apple' | 'google'>('apple')
  const { t } = useI18n()

  return (
    <div className="w-full max-w-[340px]">
      <PlatformSwitch value={platform} onChange={setPlatform} className="mb-4" size="sm" />
      <CardPreview platform={platform} design={design} data={data} />
      <p className="mt-3 text-center text-[11px] leading-relaxed text-muted-foreground">
        {t('cardDesign.preview.disclaimer')}
      </p>
    </div>
  )
}

// -----------------------------------------------------------------------------
// Step 1 — Your program
// -----------------------------------------------------------------------------

/**
 * The first screen, and the one that has to earn the next four.
 *
 * It leads with the *answer* — "here is your program" — rather than with the
 * question, because the trade was already collected at signup and the merchant's
 * reaction we want is recognition, not input. The trade picker is present and
 * one click away, phrased as a correction rather than a question, so someone who
 * mis-tapped at signup is not stuck.
 */
function ProgramStep({
  businessName,
  type,
  goal,
  reward,
  card,
  onChooseType,
  onContinue,
}: {
  businessName: string
  type: BusinessType
  goal: number
  reward: string
  card: React.ReactNode
  onChooseType: (type: BusinessType) => void
  onContinue: () => void
}) {
  const { t, formatNumber } = useI18n()

  const rows = [
    {
      icon: Sparkles,
      label: t('onboarding.program.rowProgram'),
      value:
        type.loyalty === 'stamps'
          ? t('onboarding.program.stampsSummary', { goal: formatNumber(goal) })
          : t('onboarding.program.pointsSummary', { goal: formatNumber(goal) }),
    },
    { icon: Gift, label: t('onboarding.program.rowReward'), value: reward },
    { icon: Megaphone, label: t('onboarding.program.rowCampaign'), value: t(type.campaignKey) },
  ]

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
      <section className="rounded-xl border bg-card p-6">
        <h1 className="text-xl font-semibold tracking-tight">
          {t('onboarding.program.title', { businessName })}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('onboarding.program.subtitle')}</p>

        <ul className="mt-6 space-y-3">
          {rows.map((row) => (
            <li key={row.label} className="flex items-start gap-3 rounded-lg border bg-muted/30 p-3">
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <row.icon className="size-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">
                  {row.label}
                </p>
                <p className="mt-0.5 text-sm font-medium">{row.value}</p>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-6">
          <p className="text-sm font-medium">{t('onboarding.program.notYourTrade')}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('onboarding.program.notYourTradeHint')}
          </p>

          <div
            role="radiogroup"
            aria-label={t('auth.signup.categoryLabel')}
            className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3"
          >
            {BUSINESS_TYPES.map((candidate) => {
              const selected = candidate.key === type.key
              return (
                <button
                  key={candidate.key}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => onChooseType(candidate)}
                  className={cn(
                    'flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm transition-all',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                    selected
                      ? 'border-primary bg-primary/5 ring-2 ring-primary/25'
                      : 'hover:border-foreground/30 hover:bg-accent'
                  )}
                >
                  <span aria-hidden className="text-lg leading-none">
                    {candidate.emoji}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{t(candidate.labelKey)}</span>
                  {selected && <Check className="size-4 shrink-0 text-primary" aria-hidden />}
                </button>
              )
            })}
          </div>
        </div>

        <Button className="mt-6 h-11 w-full gap-2 sm:w-auto" onClick={onContinue}>
          {t('onboarding.program.continue')}
          <ArrowRight className="size-4" aria-hidden />
        </Button>
      </section>

      <aside className="flex justify-center lg:sticky lg:top-6">{card}</aside>
    </div>
  )
}

// -----------------------------------------------------------------------------
// Step 2 — Plan
// -----------------------------------------------------------------------------

/**
 * The plan step.
 *
 * Checkout is offered but never required: the trial is already running, and a
 * card form between a merchant and their first customer is the single most
 * expensive screen a loyalty product can have. On a deployment with no Stripe
 * credentials the step says so plainly and continues, rather than showing four
 * buttons that would all fail.
 */
function PlanStep({
  businessId,
  businessName,
  onContinue,
  onBack,
}: {
  businessId: string
  businessName: string
  onContinue: () => void
  onBack: () => void
}) {
  const { t, formatCurrency } = useI18n()
  const [busy, setBusy] = React.useState<PlanId | null>(null)
  const billing = useApi<BillingResponse>(`/api/v1/billing${query({ businessId })}`)

  const recommended: PlanId = 'growth'

  async function choose(plan: PlanId) {
    setBusy(plan)
    try {
      const response = await apiPost<{ url: string | null }>('/api/v1/billing/checkout', {
        businessId,
        plan,
        interval: 'month',
      })
      if (response.url) {
        window.location.assign(response.url)
        return
      }
      onContinue()
    } catch {
      // Checkout is optional here by design, so a failure continues the setup
      // instead of trapping the merchant on a payment screen.
      onContinue()
    } finally {
      setBusy(null)
    }
  }

  const configured = billing.data?.billing_configured ?? false

  return (
    <section className="rounded-xl border bg-card p-6">
      <h1 className="text-xl font-semibold tracking-tight">
        {t('onboarding.plan.title', { businessName })}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">{t('onboarding.plan.subtitle')}</p>

      {billing.data && !configured && (
        <p className="mt-4 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          {t('onboarding.plan.notConfigured')}
        </p>
      )}

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {PUBLIC_PLANS.map((plan) => (
          <article
            key={plan.id}
            className={`flex flex-col rounded-xl border p-4 ${
              plan.id === recommended ? 'border-primary/60 shadow-sm' : ''
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <h2 className="font-semibold">{plan.name}</h2>
              {plan.id === recommended && (
                <Badge variant="secondary" className="shrink-0">
                  {t('onboarding.plan.recommended')}
                </Badge>
              )}
            </div>
            <p className="mt-1 flex-1 text-xs text-muted-foreground">{t(plan.taglineKey)}</p>
            <p className="mt-3 text-lg font-semibold tabular-nums">
              {plan.monthlyPrice === null
                ? '—'
                : formatCurrency(plan.monthlyPrice, { currency: PLAN_CURRENCY })}
              <span className="text-xs font-normal text-muted-foreground">
                {t('common.perMonth')}
              </span>
            </p>
            <Button
              variant={plan.id === recommended ? 'default' : 'outline'}
              size="sm"
              className="mt-3 gap-2"
              disabled={!configured || busy !== null}
              onClick={() => void choose(plan.id)}
            >
              {busy === plan.id && <Loader2 className="size-4 animate-spin" />}
              {t('onboarding.plan.choose', { plan: plan.name })}
            </Button>
          </article>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3 border-t pt-5">
        <Button variant="outline" className="h-11 gap-2" onClick={onBack}>
          <ArrowLeft className="size-4" aria-hidden />
          {t('common.back')}
        </Button>
        <Button className="h-11 gap-2" onClick={onContinue}>
          {t('onboarding.plan.continueTrial')}
          <ArrowRight className="size-4" aria-hidden />
        </Button>
        <p className="text-xs text-muted-foreground">{t('onboarding.plan.continueTrialHint')}</p>
      </div>
    </section>
  )
}

// -----------------------------------------------------------------------------
// Step 3 — First location
// -----------------------------------------------------------------------------

function LocationStep({
  defaultName,
  defaultCity,
  saving,
  onBack,
  onSkip,
  onSubmit,
}: {
  defaultName: string
  defaultCity: string
  saving: boolean
  onBack: () => void
  onSkip: () => void
  onSubmit: (values: { name: string; address: string; city: string }) => void
}) {
  const { t } = useI18n()
  const [name, setName] = React.useState(defaultName)
  const [address, setAddress] = React.useState('')
  const [city, setCity] = React.useState(defaultCity)

  return (
    <section className="rounded-xl border bg-card p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{t('onboarding.location.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('onboarding.location.subtitle')}</p>
        </div>
        <Badge variant="outline" className="shrink-0">
          {t('common.optional')}
        </Badge>
      </div>

      <div className="mt-6 space-y-4">
        <div className="space-y-2">
          <Label htmlFor="location-name">{t('locations.fields.name')}</Label>
          <Input
            id="location-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="h-11"
            placeholder={t('locations.fields.namePlaceholder')}
            autoFocus
          />
          <p className="text-xs text-muted-foreground">{t('onboarding.location.nameHint')}</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="location-address">{t('locations.fields.address')}</Label>
            <Input
              id="location-address"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              className="h-11"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="location-city">{t('locations.fields.city')}</Label>
            <Input
              id="location-city"
              value={city}
              onChange={(event) => setCity(event.target.value)}
              className="h-11"
            />
          </div>
        </div>

        <p className="text-xs text-muted-foreground">{t('onboarding.location.addressHint')}</p>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <Button variant="outline" className="h-11 gap-2" onClick={onBack}>
          <ArrowLeft className="size-4" aria-hidden />
          {t('common.back')}
        </Button>
        <Button
          className="h-11 flex-1 gap-2"
          disabled={saving || !name.trim()}
          onClick={() => onSubmit({ name, address, city })}
        >
          {saving && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {t('common.next')}
          <ArrowRight className="size-4" aria-hidden />
        </Button>
      </div>

      {/* Skipping is a first-class outcome, stated as such. A merchant who cannot
          see a way past a screen they are not ready for closes the tab. */}
      <button
        type="button"
        onClick={onSkip}
        className="mt-4 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        {t('onboarding.location.skip')}
      </button>
    </section>
  )
}

// -----------------------------------------------------------------------------
// Step 4 — The card
// -----------------------------------------------------------------------------

function CardStep({
  type,
  design,
  goal,
  reward,
  logoUrl,
  uploadsEnabled,
  saving,
  card,
  onDesign,
  onGoal,
  onReward,
  onUploadLogo,
  onLogo,
  onBack,
  onSubmit,
}: {
  type: BusinessType
  design: CardDesign
  goal: number
  reward: string
  logoUrl: string | null
  uploadsEnabled: boolean
  saving: boolean
  card: React.ReactNode
  onDesign: (design: CardDesign) => void
  onGoal: (goal: number) => void
  onReward: (reward: string) => void
  onUploadLogo: (file: File) => Promise<string>
  onLogo: (url: string | null) => void
  onBack: () => void
  onSubmit: () => void
}) {
  const { t, formatNumber } = useI18n()
  const goals = goalsFor(type.loyalty)
  const isStamps = type.loyalty === 'stamps'

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
      <section className="rounded-xl border bg-card p-6">
        <h1 className="text-xl font-semibold tracking-tight">{t('onboarding.card.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('onboarding.card.subtitle')}</p>

        <div className="mt-6 space-y-6">
          <div>
            <Label className="text-sm">{t('onboarding.card.colours')}</Label>
            <div className="mt-2 flex flex-wrap gap-2">
              {CARD_PALETTES.map((palette) => {
                const active = design.backgroundColor === palette.primary
                return (
                  <button
                    key={palette.key}
                    type="button"
                    onClick={() =>
                      onDesign({
                        ...design,
                        backgroundColor: palette.primary,
                        accentColor: palette.accent,
                      })
                    }
                    aria-pressed={active}
                    className={cn(
                      'flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs transition-colors hover:bg-accent',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      active && 'border-primary ring-2 ring-primary/25'
                    )}
                  >
                    <span
                      aria-hidden
                      className="size-4 rounded-full border"
                      style={{ background: palette.primary }}
                    />
                    {t(palette.labelKey)}
                  </button>
                )
              })}
            </div>
          </div>

          <LogoField
            value={logoUrl}
            uploadsEnabled={uploadsEnabled}
            previewBackground={design.backgroundColor ?? undefined}
            onUpload={onUploadLogo}
            onChange={onLogo}
          />

          <div className="space-y-2">
            <Label htmlFor="reward">{t('onboarding.card.reward')}</Label>
            <Input
              id="reward"
              value={reward}
              onChange={(event) => onReward(event.target.value)}
              className="h-11"
              placeholder={t('onboarding.card.rewardPlaceholder')}
            />
          </div>

          <div>
            <Label className="text-sm">
              {isStamps ? t('onboarding.card.goal') : t('onboarding.card.goalPoints')}
            </Label>
            <div className="mt-2 flex gap-2">
              {goals.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={goal === option}
                  onClick={() => onGoal(option)}
                  className={cn(
                    'h-10 flex-1 rounded-lg border text-sm font-medium tabular-nums transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    goal === option
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'hover:bg-accent'
                  )}
                >
                  {formatNumber(option)}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {isStamps
                ? t('onboarding.card.goalHint', { goal: formatNumber(goal) })
                : t('onboarding.card.goalPointsHint', { goal: formatNumber(goal) })}
            </p>
          </div>

          <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
            {t('onboarding.card.moreLater')}
          </p>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <Button variant="outline" className="h-11 gap-2" onClick={onBack}>
            <ArrowLeft className="size-4" aria-hidden />
            {t('common.back')}
          </Button>
          <Button
            className="h-11 flex-1 gap-2"
            disabled={saving || !reward.trim()}
            onClick={onSubmit}
          >
            {saving && <Loader2 className="size-4 animate-spin" aria-hidden />}
            <Check className="size-4" aria-hidden />
            {t('onboarding.card.activate')}
          </Button>
        </div>
      </section>

      <aside className="flex justify-center lg:sticky lg:top-6">{card}</aside>
    </div>
  )
}

// -----------------------------------------------------------------------------
// Done
// -----------------------------------------------------------------------------

function ReadyStep({
  joinUrl,
  copied,
  card,
  reward,
  onCopy,
  onScan,
  onDashboard,
}: {
  joinUrl: string
  copied: boolean
  card: React.ReactNode
  reward: string
  onCopy: () => void
  onScan: () => void
  onDashboard: () => void
}) {
  const { t } = useI18n()

  return (
    <div className="space-y-6">
      <section className="rounded-xl border bg-card p-6 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-emerald-500 text-white">
          <Check className="size-6" aria-hidden />
        </div>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">
          {t('onboarding.ready.title')}
        </h1>
        <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">
          {t('onboarding.ready.subtitle')}
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)] lg:items-start">
        {/* What the customer ends up holding, and what goes on the counter —
            side by side, because those two objects are the whole product. */}
        <aside className="flex justify-center">{card}</aside>

        <div className="space-y-6">
          {joinUrl && (
            <section className="rounded-xl border bg-card p-5">
              <h2 className="text-base font-semibold">{t('onboarding.ready.qrTitle')}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t('onboarding.ready.qrBody')}</p>

              <div className="mt-4 flex flex-col items-center gap-4 sm:flex-row sm:items-start">
                <Image
                  src={`/api/v1/public/qr?data=${encodeURIComponent(joinUrl)}&size=512`}
                  alt={t('onboarding.ready.qrAlt')}
                  width={168}
                  height={168}
                  unoptimized
                  className="shrink-0 rounded-lg border bg-white p-3"
                />

                <div className="w-full min-w-0 space-y-3">
                  <div className="flex gap-2">
                    <Input readOnly value={joinUrl} className="font-mono text-xs" />
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label={t('common.copy')}
                      onClick={onCopy}
                    >
                      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                    </Button>
                  </div>

                  <Button asChild variant="outline" size="sm" className="gap-2">
                    <a
                      href={`/api/v1/public/qr?data=${encodeURIComponent(joinUrl)}&size=1024&download=1`}
                      download="passimo-qr.png"
                    >
                      <Download className="size-4" aria-hidden />
                      {t('common.downloadForPrint')}
                    </a>
                  </Button>
                </div>
              </div>
            </section>
          )}

          <section className="rounded-xl border bg-card p-5">
            <h2 className="text-base font-semibold">{t('onboarding.ready.running')}</h2>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              <li className="flex items-start gap-2">
                <Gift className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
                {t('onboarding.ready.bullets.reward', { reward })}
              </li>
              {(
                [
                  'onboarding.ready.bullets.welcome',
                  'onboarding.ready.bullets.birthday',
                  'onboarding.ready.bullets.winback',
                  'onboarding.ready.bullets.rewardReady',
                ] as const
              ).map((key) => (
                <li key={key} className="flex items-start gap-2">
                  <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
                  {t(key)}
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-xl border bg-card p-5">
            <h2 className="text-base font-semibold">{t('onboarding.ready.nextTitle')}</h2>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              <li className="flex items-start gap-2">
                <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden />
                {t('onboarding.ready.next.location')}
              </li>
              <li className="flex items-start gap-2">
                <Megaphone className="mt-0.5 size-4 shrink-0" aria-hidden />
                {t('onboarding.ready.next.campaigns')}
              </li>
              <li className="flex items-start gap-2">
                <Sparkles className="mt-0.5 size-4 shrink-0" aria-hidden />
                {t('onboarding.ready.next.design')}
              </li>
            </ul>
          </section>

          <div className="flex flex-wrap gap-2">
            <Button className="h-11 gap-2" onClick={onScan}>
              <ScanLine className="size-4" aria-hidden />
              {t('onboarding.ready.openScanner')}
            </Button>
            <Button variant="outline" className="h-11 gap-2" onClick={onDashboard}>
              {t('onboarding.ready.goToDashboard')}
              <ArrowRight className="size-4" aria-hidden />
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">{t('onboarding.ready.laterNote')}</p>
        </div>
      </div>
    </div>
  )
}
