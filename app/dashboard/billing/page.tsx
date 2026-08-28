'use client'

import * as React from 'react'
import { useSearchParams } from 'next/navigation'
import {
  AlertTriangle,
  ArrowUpRight,
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
import { LIMIT_LABEL_KEYS, PLAN_CURRENCY, type LimitKey, type PlanId } from '@/lib/billing/plans'
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

            <UsageCard usage={data.usage} />

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

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {data.catalogue.map((plan) => (
                  <PlanCard
                    key={plan.id}
                    plan={plan}
                    interval={interval}
                    current={plan.id === data.effective_plan}
                    canManage={can('billing:manage')}
                    busy={busy === plan.id}
                    salesEmail={data.sales_email}
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
              ? t('billing.trialBody')
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

function UsageCard({ usage }: { usage: UsageRow[] }) {
  const { t, formatNumber } = useI18n()
  const metered = usage.filter((row) => row.allowed !== null)

  if (metered.length === 0) {
    return (
      <section className="rounded-xl border bg-card p-5">
        <h3 className="text-base font-semibold">{t('billing.usage')}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{t('billing.usageUnlimited')}</p>
      </section>
    )
  }

  return (
    <section className="rounded-xl border bg-card p-5">
      <h3 className="text-base font-semibold">{t('billing.usage')}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{t('billing.usageBody')}</p>
      <dl className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {metered.map((row) => (
          <div key={row.key}>
            <dt className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{t(LIMIT_LABEL_KEYS[row.key])}</span>
              <span
                className={cn(
                  'tabular-nums font-medium',
                  row.exceeded
                    ? 'text-destructive'
                    : row.approaching
                      ? 'text-amber-600 dark:text-amber-500'
                      : ''
                )}
              >
                {formatNumber(row.used)} / {formatNumber(row.allowed ?? 0)}
              </span>
            </dt>
            <dd className="mt-1.5">
              <Meter
                value={Math.min(row.used, row.allowed ?? row.used)}
                max={row.allowed ?? 1}
                tone={row.exceeded || row.approaching ? 'warning' : 'default'}
              />
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function PlanCard({
  plan,
  interval,
  current,
  canManage,
  busy,
  salesEmail,
  onChoose,
}: {
  plan: CataloguePlan
  interval: 'month' | 'year'
  current: boolean
  canManage: boolean
  busy: boolean
  salesEmail: string | null
  onChoose: () => void
}) {
  const { t, formatCurrency } = useI18n()
  const price = interval === 'year' ? plan.annual_price : plan.monthly_price
  const custom = price === null

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

      <p className="mt-4 flex items-baseline gap-1">
        {custom ? (
          <span className="text-2xl font-semibold tracking-tight">{t('billing.custom')}</span>
        ) : (
          <>
            <span className="text-3xl font-semibold tracking-tight tabular-nums">
              {formatCurrency(price, { currency: PLAN_CURRENCY })}
            </span>
            <span className="text-sm text-muted-foreground">
              {interval === 'year' ? t('common.perYear') : t('common.perMonth')}
            </span>
          </>
        )}
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
        ) : custom && salesEmail ? (
          <Button asChild variant="outline" className="w-full gap-2">
            <a href={`mailto:${salesEmail}?subject=${encodeURIComponent(plan.name)}`}>
              {t('billing.talkToUs')}
              <ArrowUpRight className="size-4" />
            </a>
          </Button>
        ) : custom ? (
          /*
           * No mailbox configured, so there is nothing to link to. Saying so is
           * better than a dead `mailto:` — the merchant would compose a message,
           * send it, and never learn it went nowhere.
           */
          <Button variant="outline" className="w-full" disabled>
            {t('billing.contactUnavailable')}
          </Button>
        ) : plan.purchasable && canManage ? (
          <Button className="w-full gap-2" disabled={busy} onClick={onChoose}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            {t('billing.choosePlan', { plan: plan.name })}
          </Button>
        ) : (
          <Button variant="outline" className="w-full" disabled>
            {plan.monthly_price === 0 ? t('billing.included') : t('billing.unavailable')}
          </Button>
        )}
      </div>
    </article>
  )
}
