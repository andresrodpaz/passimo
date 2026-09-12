'use client'

import * as React from 'react'
import { useSearchParams } from 'next/navigation'
import {
  AlertTriangle,
  Check,
  CreditCard,
  Loader2,
  RefreshCw,
  Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { useApi, apiPost, query } from '@/lib/client/api'
import { useWorkspace } from '@/lib/client/workspace'
import { AsyncBoundary } from '@/components/states'
import { Meter } from '@/components/metrics'
import {
  LIMIT_LABEL_KEYS,
  PLAN_CURRENCY,
  PLANS,
  lowestPlanWithLimit,
  planRank,
  type LimitKey,
  type Plan,
  type PlanId,
} from '@/lib/billing/plans'
import { toastError } from '@/lib/client/api-errors'
import { useI18n } from '@/lib/i18n'
import type { TranslationKey } from '@/lib/i18n'
import { cn } from '@/lib/utils'

type CataloguePlan = {
  id: PlanId
  name: string
  tagline_key: TranslationKey
  monthly_price: number | null
  annual_price: number | null
  annual_saving: number
  highlight_keys: TranslationKey[]
  popular: boolean
  purchasable: boolean
}

type UsageRow = {
  key: LimitKey
  used: number
  allowed: number | null
  ratio: number
  exceeded: boolean
  approaching: boolean
}

type BillingResponse = {
  plan: PlanId
  effective_plan: PlanId
  trial: { active: boolean; endsAt: string | null; daysRemaining: number }
  subscription: {
    status: string | null
    interval: 'month' | 'year'
    currentPeriodEnd: string | null
    cancelAtPeriodEnd: boolean
    delinquent: boolean
  }
  referral_credit: number
  usage: UsageRow[]
  billing_configured: boolean
  /** Where a custom-plan enquiry goes, or null when no mailbox is configured. */
  sales_email: string | null
  catalogue: CataloguePlan[]
}

/**
 * Billing.
 *
 * Ordered by what the merchant came here to find out, in order of likelihood:
 * what am I paying, what am I using, and what would I get for more. Invoices,
 * cards and VAT details live in the Stripe portal — rebuilding those would mean
 * taking on PCI scope to reproduce a screen Stripe already does better.
 */
export default function BillingPage() {
  // `useSearchParams` opts the subtree out of prerendering, so the boundary is
  // required for the build to statically generate the shell around it.
  return (
    <React.Suspense fallback={null}>
      <BillingScreen />
    </React.Suspense>
  )
}

function BillingScreen() {
  const { businessId, can } = useWorkspace()
  const { t } = useI18n()
  const params = useSearchParams()
  const [interval, setInterval] = React.useState<'month' | 'year'>('month')
  const [busy, setBusy] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const key = businessId ? `/api/v1/billing${query({ businessId })}` : null
  const billing = useApi<BillingResponse>(key)

  const justPaid = params.get('checkout') === 'success'

  async function choosePlan(plan: PlanId) {
    if (!businessId) return
    setBusy(plan)
    setError(null)
    try {
      const response = await apiPost<{ url: string | null }>('/api/v1/billing/checkout', {
        businessId,
        plan,
        interval,
      })
      if (response.url) window.location.assign(response.url)
    } catch (cause) {
      setError(toastError(cause, t, 'billing.checkoutFailed'))
      setBusy(null)
    }
  }

  async function openPortal() {
    if (!businessId) return
    setBusy('portal')
    setError(null)
    try {
      const response = await apiPost<{ url: string }>('/api/v1/billing/portal', { businessId })
      window.location.assign(response.url)
    } catch (cause) {
      setError(toastError(cause, t, 'billing.portalFailed'))
      setBusy(null)
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-xl font-semibold tracking-tight">{t('billing.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('billing.subtitle')}</p>
      </header>

      {justPaid && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4"
        >
          <Check className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-500" />
          <div>
            <p className="text-sm font-medium">{t('billing.checkoutSuccess')}</p>
            <p className="text-sm text-muted-foreground">{t('billing.checkoutSuccessBody')}</p>
          </div>
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-xl bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      <AsyncBoundary
        data={billing.data}
        error={billing.error}
        isLoading={billing.isLoading}
        onRetry={() => void billing.mutate()}
      >
        {(data) => (
          <div className="space-y-6">
            <CurrentPlanCard
              data={data}
              canManage={can('billing:manage')}
              busy={busy === 'portal'}
              onOpenPortal={() => void openPortal()}
            />

            {/* What happens on a decline, said before it happens. The dunning
                sequence emails them too, but a merchant who reads this once
                never has to be surprised by the first email. */}
            <section className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-900 dark:text-amber-200">
              <div className="flex flex-wrap items-center gap-2">
                <RefreshCw className="size-4" />
                <span className="font-medium">{t('billing.dunningTitle')}</span>
              </div>
              <p className="mt-1 text-sm text-amber-900/80 dark:text-amber-200/80">
                {t('billing.dunningBody')}
              </p>
            </section>

            <UsageCard usage={data.usage} plan={data.effective_plan} />

            <PlanChangeCard data={data} />

            <section className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold">{t('billing.plans')}</h3>
                  <p className="text-sm text-muted-foreground">{t('billing.plansBody')}</p>
                </div>
                <div className="flex items-center gap-2.5">
                  <Label htmlFor="billing-interval" className="text-sm text-muted-foreground">
                    {t('billing.monthly')}
                  </Label>
                  <Switch
                    id="billing-interval"
                    checked={interval === 'year'}
                    onCheckedChange={(checked) => setInterval(checked ? 'year' : 'month')}
                  />
                  <Label htmlFor="billing-interval" className="text-sm">
                    {t('billing.yearly')}
                    <span className="ml-1.5 text-emerald-600 dark:text-emerald-500">
                      {t('billing.twoMonthsFree')}
                    </span>
                  </Label>
                </div>
              </div>

              {!data.billing_configured && (
                <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                  {t('billing.notConfigured')}
                </p>
              )}

              {/* Three tiers, three columns. No `xl` breakpoint needed — the
                  catalogue no longer has a fourth card to wrap. */}
              <div className="grid items-start gap-4 md:grid-cols-3">
                {data.catalogue.map((plan) => (
                  <PlanCard
                    key={plan.id}
                    plan={plan}
                    interval={interval}
                    current={plan.id === data.effective_plan}
                    canManage={can('billing:manage')}
                    busy={busy === plan.id}
                    onChoose={() => void choosePlan(plan.id)}
                  />
                ))}
              </div>
            </section>
          </div>
        )}
      </AsyncBoundary>
    </div>
  )
}

function CurrentPlanCard({
  data,
  canManage,
  busy,
  onOpenPortal,
}: {
  data: BillingResponse
  canManage: boolean
  busy: boolean
  onOpenPortal: () => void
}) {
  const { t, formatCurrency, formatDate } = useI18n()
  const plan = data.catalogue.find((candidate) => candidate.id === data.effective_plan)
  const renewal = data.subscription.currentPeriodEnd
    ? formatDate(data.subscription.currentPeriodEnd, {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : null

  return (
    <section className="rounded-xl border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold">{plan?.name ?? data.effective_plan}</h3>
            {data.trial.active && (
              <Badge variant="secondary">
                {t('billing.trialBadge', { count: data.trial.daysRemaining })}
              </Badge>
            )}
            {data.subscription.delinquent && (
              <Badge variant="destructive">{t('billing.paymentFailed')}</Badge>
            )}
            {data.subscription.cancelAtPeriodEnd && (
              <Badge variant="outline">
                {renewal ? t('billing.endsOn', { date: renewal }) : t('billing.endsAtPeriodEnd')}
              </Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {data.trial.active
              ? t('billing.trialBody', { plan: PLANS[data.effective_plan].name })
              : data.subscription.cancelAtPeriodEnd
                ? t('billing.cancellingBody')
                : data.subscription.delinquent
                  ? t('billing.delinquentBody')
                  : renewal
                    ? t('billing.renewsOn', { date: renewal })
                    : plan
                      ? t(plan.tagline_key)
                      : ''}
          </p>
          {data.referral_credit > 0 && (
            <p className="mt-2 text-sm text-emerald-600 dark:text-emerald-500">
              {t('billing.referralCredit', {
                amount: formatCurrency(data.referral_credit, { currency: PLAN_CURRENCY }),
              })}
            </p>
          )}
        </div>

        {canManage && data.billing_configured && (
          <Button variant="outline" className="gap-2" disabled={busy} onClick={onOpenPortal}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <CreditCard className="size-4" />}
            {t('billing.invoices')}
          </Button>
        )}
      </div>

      {data.subscription.delinquent && (
        <p className="mt-4 flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {t('billing.delinquentWarning')}
        </p>
      )}
    </section>
  )
}

/**
 * Live usage against every cap.
 *
 * Two things this screen has to do that a bar chart alone does not. Every row is
 * shown, unlimited ones included, so a merchant can see the whole shape of what
 * they bought rather than only the parts that happen to be countable. And a row
 * that is close to or over its cap names its own remedy inline: what they have
 * used, what the next plan allows, and what that plan costs — the three facts
 * that turn "you are at your limit" from a scolding into a decision.
 */
function UsageCard({ usage, plan }: { usage: UsageRow[]; plan: PlanId }) {
  const { t } = useI18n()

  return (
    <section className="rounded-xl border bg-card p-5">
      <h3 className="text-base font-semibold">{t('billing.usage')}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{t('billing.usageBody')}</p>
      <dl className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {usage.map((row) => (
          <UsageMeter key={row.key} row={row} plan={plan} />
        ))}
      </dl>
    </section>
  )
}

function UsageMeter({ row, plan }: { row: UsageRow; plan: PlanId }) {
  const { t, formatCurrency, formatNumber } = useI18n()

  const label = t(LIMIT_LABEL_KEYS[row.key])

  if (row.allowed === null) {
    return (
      <div>
        <dt className="flex items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">{label}</span>
          <span className="font-medium tabular-nums">{formatNumber(row.used)}</span>
        </dt>
        <dd className="mt-1.5 text-xs text-muted-foreground">
          {t('billing.usageUnlimitedRow')}
        </dd>
      </div>
    )
  }

  /*
   * `lowestPlanWithLimit` is the same resolver the 402 refusal uses, so the
   * remedy on this screen and the remedy in the API error are always the same
   * plan. Filtered to a genuine upgrade: on the largest plan it would otherwise
   * return the plan the merchant is already on and offer them their own tier.
   */
  const remedy = lowestPlanWithLimit(row.key, row.used + 1)
  const upgrade: Plan | null =
    remedy && planRank(remedy.id) > planRank(plan) ? remedy : null

  const nextAllowance = (candidate: Plan): string =>
    candidate.limits[row.key] === null
      ? t('billing.usageUnlimitedRow')
      : formatNumber(candidate.limits[row.key] as number)

  /*
   * A cap of zero is not "you have used it all" — it is a resource this plan does
   * not include, and the honest row says so and names what does include it.
   * Rendering a 0 / 0 progress bar instead was the specific contradiction that
   * showed a Starter merchant an empty "Proximity campaigns" meter beside a
   * screen answering "available from Growth".
   */
  if (row.allowed === 0) {
    return (
      <div>
        <dt className="flex items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">{label}</span>
          <span className="text-xs font-medium text-muted-foreground">
            {t('billing.usageNotIncluded')}
          </span>
        </dt>
        <dd className="mt-1.5 text-xs text-muted-foreground">
          {upgrade
            ? t('billing.usageNextPlan', {
                plan: upgrade.name,
                allowed: nextAllowance(upgrade),
                price: formatCurrency(upgrade.monthlyPrice ?? 0, { currency: PLAN_CURRENCY }),
              })
            : t('billing.usageTopPlan')}
        </dd>
      </div>
    )
  }

  const pressured = row.exceeded || row.approaching

  return (
    <div>
      <dt className="flex items-center justify-between gap-2 text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span
          className={cn(
            'font-medium tabular-nums',
            row.exceeded
              ? 'text-destructive'
              : row.approaching
                ? 'text-amber-600 dark:text-amber-500'
                : ''
          )}
        >
          {formatNumber(row.used)} / {formatNumber(row.allowed)}
        </span>
      </dt>
      <dd className="mt-1.5">
        <Meter
          value={Math.min(row.used, row.allowed)}
          max={row.allowed > 0 ? row.allowed : 1}
          tone={pressured ? 'warning' : 'default'}
        />
        {pressured && (
          <p className="mt-1.5 text-xs text-muted-foreground">
            {row.exceeded
              ? t('billing.usageAtLimit', {
                  allowed: formatNumber(row.allowed),
                  plan: PLANS[plan].name,
                })
              : t('billing.usageApproaching', { plan: PLANS[plan].name })}{' '}
            {upgrade ? (
              <span className="font-medium text-foreground">
                {t('billing.usageNextPlan', {
                  plan: upgrade.name,
                  allowed: nextAllowance(upgrade),
                  price: formatCurrency(upgrade.monthlyPrice ?? 0, { currency: PLAN_CURRENCY }),
                })}
              </span>
            ) : (
              t('billing.usageTopPlan')
            )}
          </p>
        )}
      </dd>
    </div>
  )
}

/**
 * What a plan change does, said before the merchant clicks.
 *
 * A downgrade is the moment a merchant is most afraid of this product, and the
 * fear is specific: *will I lose my customers?* The answer is no — reads are
 * never gated and nothing is deleted — but that only reassures someone who is
 * told it. So this lists, from live usage, exactly which of their existing rows
 * would sit above a smaller plan's cap, and states plainly that being over a cap
 * makes a resource read-only rather than gone.
 *
 * It renders only for a workspace that actually has something to lose, so a café
 * with one location and 40 customers never reads a paragraph about conflicts
 * that cannot happen to them.
 */
function PlanChangeCard({ data }: { data: BillingResponse }) {
  const { t, formatDate, formatNumber } = useI18n()

  const currentRank = planRank(data.effective_plan)
  const smaller = data.catalogue.filter((plan) => planRank(plan.id) < currentRank)
  if (smaller.length === 0) return null

  const nextDown = smaller[smaller.length - 1]!
  const definition = PLANS[nextDown.id]

  const conflicts = data.usage.flatMap((row) => {
    const allowed = definition.limits[row.key]
    if (allowed === null || row.used <= allowed) return []
    return [{ key: row.key, used: row.used, allowed }]
  })

  const renewal = data.subscription.currentPeriodEnd
    ? formatDate(data.subscription.currentPeriodEnd, {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : null

  return (
    <section className="grid gap-4 rounded-xl border bg-card p-5 md:grid-cols-2">
      <div>
        <h3 className="text-base font-semibold">{t('billing.downgradeTitle')}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{t('billing.downgradeBody')}</p>

        {conflicts.length > 0 ? (
          <>
            <p className="mt-3 text-sm font-medium">
              {t('billing.downgradeConflicts', { plan: nextDown.name })}
            </p>
            <ul className="mt-1.5 space-y-1">
              {conflicts.map((conflict) => (
                <li key={conflict.key} className="text-sm text-muted-foreground">
                  {t('billing.downgradeConflictRow', {
                    limit: t(LIMIT_LABEL_KEYS[conflict.key]),
                    used: formatNumber(conflict.used),
                    plan: nextDown.name,
                    allowed: formatNumber(conflict.allowed),
                  })}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-sm text-muted-foreground">
              {t('billing.downgradeReassurance')}
            </p>
          </>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            {t('billing.downgradeNoConflicts', { plan: nextDown.name })}
          </p>
        )}
      </div>

      <div className="md:border-l md:pl-5">
        <h3 className="text-base font-semibold">{t('billing.cancelTitle')}</h3>
        <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
          <li>{renewal ? t('billing.cancelAccess', { date: renewal }) : t('billing.cancelAccessNoDate')}</li>
          <li>{t('billing.cancelData')}</li>
          <li>{t('billing.cancelWallet')}</li>
          <li>{t('billing.cancelDashboard')}</li>
          <li>{t('billing.cancelReactivate')}</li>
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">{t('billing.cancelHow')}</p>
      </div>
    </section>
  )
}

function PlanCard({
  plan,
  interval,
  current,
  canManage,
  busy,
  onChoose,
}: {
  plan: CataloguePlan
  interval: 'month' | 'year'
  current: boolean
  canManage: boolean
  busy: boolean
  onChoose: () => void
}) {
  const { t, formatCurrency } = useI18n()
  const price = interval === 'year' ? plan.annual_price : plan.monthly_price

  return (
    <article
      className={cn(
        'relative flex flex-col rounded-xl border bg-card p-5',
        plan.popular && !current && 'border-primary/50 shadow-sm',
        current && 'border-primary ring-1 ring-primary'
      )}
    >
      {plan.popular && !current && (
        <Badge className="absolute -top-2.5 left-5 gap-1">
          <Sparkles className="size-3" />
          {t('billing.mostPopular')}
        </Badge>
      )}
      {current && (
        <Badge variant="secondary" className="absolute -top-2.5 left-5">
          {t('billing.yourPlan')}
        </Badge>
      )}

      <h4 className="text-base font-semibold">{plan.name}</h4>
      <p className="mt-0.5 min-h-10 text-sm text-muted-foreground">{t(plan.tagline_key)}</p>

      {/*
       * No "Custom / talk to us" branch any more. Every purchasable tier in the
       * three-plan catalogue has a real number, and a price of `null` is only
       * ever `lapsed`, which never reaches this component — the API filters the
       * catalogue to purchasable tiers. A branch for a state that cannot occur is
       * a branch nobody ever sees fail.
       */}
      <p className="mt-4 flex items-baseline gap-1">
        <span className="text-3xl font-semibold tracking-tight tabular-nums">
          {formatCurrency(price ?? 0, { currency: PLAN_CURRENCY })}
        </span>
        <span className="text-sm text-muted-foreground">
          {interval === 'year' ? t('common.perYear') : t('common.perMonth')}
        </span>
      </p>
      {interval === 'year' && plan.annual_saving > 0 && (
        <p className="text-xs text-emerald-600 dark:text-emerald-500">
          {t('billing.annualSaving', {
            amount: formatCurrency(plan.annual_saving, { currency: PLAN_CURRENCY }),
          })}
        </p>
      )}

      <ul className="mt-4 flex-1 space-y-2">
        {plan.highlight_keys.map((highlight) => (
          <li key={highlight} className="flex items-start gap-2 text-sm">
            <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            <span>{t(highlight)}</span>
          </li>
        ))}
      </ul>

      <div className="mt-5">
        {current ? (
          <Button variant="outline" className="w-full" disabled>
            {t('billing.currentPlan')}
          </Button>
        ) : plan.purchasable && canManage ? (
          <Button className="w-full gap-2" disabled={busy} onClick={onChoose}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            {t('billing.choosePlan', { plan: plan.name })}
          </Button>
        ) : (
          <Button variant="outline" className="w-full" disabled>
            {t('billing.unavailable')}
          </Button>
        )}
      </div>
    </article>
  )
}
