'use client'

import * as React from 'react'
import Link from 'next/link'
import { Check, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'
import {
  PLAN_CURRENCY,
  PUBLIC_PLANS,
  annualSaving,
  priceFor,
  type Plan,
} from '@/lib/billing/plans'

/**
 * The pricing table.
 *
 * Renders from `lib/billing/plans.ts` — the same definition the API enforces — so
 * the site can never advertise a feature the product refuses to deliver. That is
 * the classic way a pricing page drifts a release behind reality, and the reason
 * this is generated rather than written.
 *
 * The free tier is gone, which changes the shape of the page: with no zero-price
 * column there is no "start free" default, so the entry tier has to carry the
 * argument itself. Hence the price comparison in the header — $5 against two
 * coffees is the comparison a café owner actually makes.
 *
 * Limits are rendered from `plan.limits` rather than from the highlight copy, so
 * a cap change lands on the marketing page automatically.
 */
export function PricingTable({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n()
  const [interval, setInterval] = React.useState<'month' | 'year'>('month')

  return (
    <div>
      {/* Billing interval. A segmented control rather than a switch: "monthly" and
          "yearly" are two options, and a switch makes one of them the off state. */}
      <div className="flex justify-center">
        <div
          role="radiogroup"
          aria-label={t('landing.pricing.monthly')}
          className="inline-flex items-center rounded-full border bg-card p-1 shadow-sm"
        >
          {(['month', 'year'] as const).map((candidate) => (
            <button
              key={candidate}
              type="button"
              role="radio"
              aria-checked={interval === candidate}
              onClick={() => setInterval(candidate)}
              className={cn(
                'rounded-full px-4 py-1.5 text-sm font-medium transition-all',
                interval === candidate
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {candidate === 'month' ? t('landing.pricing.monthly') : t('landing.pricing.yearly')}
            </button>
          ))}
        </div>
      </div>

      {interval === 'year' && (
        <p className="mt-3 text-center text-sm font-medium text-emerald-600 dark:text-emerald-400">
          <Sparkles className="mr-1 inline size-3.5" aria-hidden />
          {t('landing.pricing.yearlyNote')}
        </p>
      )}

      <div
        className={cn(
          'mt-10 grid gap-6',
          compact ? 'md:grid-cols-2 xl:grid-cols-4' : 'md:grid-cols-2 lg:grid-cols-4'
        )}
      >
        {PUBLIC_PLANS.map((plan, index) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            previous={index > 0 ? PUBLIC_PLANS[index - 1] : null}
            interval={interval}
          />
        ))}
      </div>

      <p className="mt-8 text-center text-sm text-muted-foreground">
        {t('landing.pricing.trialNote')}
      </p>
    </div>
  )
}

function PlanCard({
  plan,
  previous,
  interval,
}: {
  plan: Plan
  previous: Plan | null
  interval: 'month' | 'year'
}) {
  const { t, formatCurrency, formatNumber } = useI18n()

  const price = priceFor(plan, interval)
  // The headline number is always *per month*, even on the yearly toggle. Showing
  // "$50/year" next to "$19/month" makes the cheaper option look dearer, which is
  // the opposite of what the toggle is for.
  const monthlyEquivalent =
    interval === 'year' && plan.annualPrice !== null ? plan.annualPrice / 12 : plan.monthlyPrice

  const saving = annualSaving(plan)

  return (
    <div
      className={cn(
        'relative flex flex-col rounded-3xl border bg-card p-6 transition-all duration-300',
        plan.popular
          ? 'border-primary/50 shadow-xl shadow-primary/10 md:-translate-y-2'
          : 'hover:-translate-y-1 hover:shadow-lg'
      )}
    >
      {plan.popular && (
        <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 shadow-lg">
          {t('landing.pricing.popular')}
        </Badge>
      )}

      <header>
        <h3 className="text-lg font-semibold">{plan.name}</h3>
        <p className="mt-1 min-h-10 text-sm text-muted-foreground">{t(plan.taglineKey)}</p>
      </header>

      <div className="mt-5 flex items-baseline gap-1">
        <span className="text-4xl font-bold tracking-tight tabular-nums">
          {monthlyEquivalent === null
            ? '—'
            : formatCurrency(monthlyEquivalent, { currency: PLAN_CURRENCY })}
        </span>
        <span className="text-sm text-muted-foreground">{t('landing.pricing.perMonth')}</span>
      </div>

      {interval === 'year' && price !== null && (
        <p className="mt-1 text-xs text-muted-foreground">
          {formatCurrency(price, { currency: PLAN_CURRENCY })} {t('landing.pricing.billedYearly')}
          {saving > 0 && (
            <span className="ml-1 font-medium text-emerald-600 dark:text-emerald-400">
              · {formatCurrency(saving, { currency: PLAN_CURRENCY })}
            </span>
          )}
        </p>
      )}

      {/* The two limits a merchant checks before anything else. Read from the
          catalogue, so a cap change lands here without an edit. */}
      <dl className="mt-5 grid grid-cols-2 gap-3 rounded-2xl border bg-muted/30 p-3">
        <div>
          <dt className="text-xs text-muted-foreground">
            {t('landing.pricing.customersLabel')}
          </dt>
          <dd className="text-sm font-semibold tabular-nums">
            {plan.limits.customers === null
              ? t('landing.pricing.limitCustomersUnlimited')
              : formatNumber(plan.limits.customers)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">
            {t('landing.pricing.locationsLabel')}
          </dt>
          <dd className="text-sm font-semibold tabular-nums">
            {plan.limits.locations === null
              ? t('landing.pricing.limitLocationsUnlimited')
              : formatNumber(plan.limits.locations)}
          </dd>
        </div>
      </dl>

      <ul className="mt-5 flex-1 space-y-2.5">
        {previous && (
          <li className="text-sm font-medium">
            {t('landing.pricing.includesEverything', { plan: previous.name })}
          </li>
        )}
        {plan.highlightKeys.map((highlight) => (
          <li key={highlight} className="flex items-start gap-2.5">
            <Check
              className={cn(
                'mt-0.5 size-4 shrink-0',
                plan.popular ? 'text-primary' : 'text-emerald-500'
              )}
              aria-hidden
            />
            <span className="text-sm text-muted-foreground">{t(highlight)}</span>
          </li>
        ))}
      </ul>

      <Button
        asChild
        variant={plan.popular ? 'default' : 'outline'}
        size="lg"
        className="mt-6 w-full"
      >
        <Link href={`/signup?plan=${plan.id}`}>{t('landing.pricing.cta')}</Link>
      </Button>
    </div>
  )
}
