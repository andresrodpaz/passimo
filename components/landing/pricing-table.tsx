'use client'

import * as React from 'react'
import Link from 'next/link'
import { Check, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'
import type { TranslationKey } from '@/lib/i18n'
import {
  ENTRY_PLAN,
  PLAN_CURRENCY,
  PUBLIC_PLANS,
  annualSaving,
  annualSavingPercent,
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
 * Three decisions shape the layout, all of them about the first four seconds:
 *
 *  1. **The number comes first.** Three cards, three prices, one sentence each.
 *     On a phone the Starter card is the first thing under the section heading —
 *     no interval toggle above it stealing the fold, no comparison table to
 *     scroll past. A visitor who cannot find the entry price does not hunt for
 *     it; they close the tab.
 *
 *  2. **The shared floor is stated once, not thirty times.** Everything every
 *     plan includes lives in one strip under the cards, so the cards themselves
 *     only have to carry what makes them different. This is what replaced the
 *     forty-row comparison matrix: a merchant does not need a grid to understand
 *     "same product, bigger numbers".
 *
 *  3. **The ROI block shows its arithmetic.** It is an example with the inputs
 *     visible and the word "example" in the heading, because the honest version
 *     of "this pays for itself" is a sum the reader can check — not a testimonial
 *     we do not have.
 */
export function PricingTable({ compact = false }: { compact?: boolean }) {
  const { t, formatCurrency } = useI18n()
  const [interval, setInterval] = React.useState<'month' | 'year'>('month')

  const entryPrice = formatCurrency(ENTRY_PLAN.monthlyPrice ?? 0, { currency: PLAN_CURRENCY })
  // Derived from the catalogue, so the badge cannot disagree with what Stripe
  // charges. Every tier is priced at ten months, so any of them answers.
  const savingPercent = annualSavingPercent(ENTRY_PLAN)

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
          {t('landing.pricing.yearlyNote', { percent: savingPercent })}
        </p>
      )}

      {/*
       * One column on a phone, three from `md`. Three tiers fit a laptop
       * comfortably, which is what makes the horizontal-scroll problem of the
       * old four-column grid disappear rather than get patched.
       */}
      <div
        className={cn(
          'mt-10 grid items-start gap-6',
          compact ? 'md:grid-cols-3' : 'md:grid-cols-3'
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

      <EveryPlanStrip />
      {!compact && <ValueExample entryPrice={entryPrice} />}
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
  // "$290/year" next to "$59/month" makes the cheaper option look dearer, which
  // is the opposite of what the toggle is for.
  const monthlyEquivalent =
    interval === 'year' && plan.annualPrice !== null ? plan.annualPrice / 12 : plan.monthlyPrice

  const saving = annualSaving(plan)

  return (
    <div
      className={cn(
        'relative flex h-full flex-col rounded-3xl border bg-card p-6 transition-all duration-300',
        plan.popular
          ? 'border-primary/50 shadow-xl shadow-primary/10 md:-translate-y-2'
          : 'hover:-translate-y-1 hover:shadow-lg'
      )}
    >
      {plan.popular && (
        <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap shadow-lg">
          {t('landing.pricing.popular')}
        </Badge>
      )}

      <header>
        <h3 className="text-lg font-semibold">{plan.name}</h3>
        <p className="mt-1 text-sm text-muted-foreground md:min-h-10">{t(plan.taglineKey)}</p>
      </header>

      <div className="mt-5 flex flex-wrap items-baseline gap-x-1.5">
        <span className="text-5xl font-bold tracking-tight tabular-nums md:text-4xl">
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

      {/*
       * The four numbers a merchant checks before reading anything else, read
       * from `plan.limits` so a cap change lands on the marketing page without
       * an edit. Two columns rather than four so nothing wraps on a 360px phone.
       */}
      <dl className="mt-5 grid grid-cols-2 gap-3 rounded-2xl border bg-muted/30 p-3">
        <LimitCell
          label={t('landing.pricing.customersLabel')}
          value={plan.limits.customers}
          unlimited={t('landing.pricing.unlimited')}
          format={formatNumber}
        />
        <LimitCell
          label={t('landing.pricing.locationsLabel')}
          value={plan.limits.locations}
          unlimited={t('landing.pricing.unlimited')}
          format={formatNumber}
        />
        <LimitCell
          label={t('landing.pricing.teamLabel')}
          value={plan.limits.team_members}
          unlimited={t('landing.pricing.unlimited')}
          format={formatNumber}
        />
        <LimitCell
          label={t('landing.pricing.aiLabel')}
          value={plan.limits.ai_actions_per_month}
          unlimited={t('landing.pricing.unlimited')}
          suffix={t('landing.pricing.perMonthShort')}
          format={formatNumber}
        />
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

function LimitCell({
  label,
  value,
  unlimited,
  suffix,
  format,
}: {
  label: string
  value: number | null
  unlimited: string
  suffix?: string
  format: (value: number) => string
}) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-semibold tabular-nums">
        {value === null ? (
          unlimited
        ) : (
          <>
            {format(value)}
            {suffix && <span className="font-normal text-muted-foreground">{suffix}</span>}
          </>
        )}
      </dd>
    </div>
  )
}

/**
 * Everything in every plan, said once.
 *
 * The cards above list only differences. Without this strip a visitor reading
 * the Starter column would reasonably conclude that the wallet card designer or
 * the scanner is a paid extra — which is the misreading that makes a $29 entry
 * tier look like a trial rather than a product.
 */
const EVERY_PLAN_KEYS: readonly TranslationKey[] = [
  'landing.pricing.everyPlan.wallet',
  'landing.pricing.everyPlan.designer',
  'landing.pricing.everyPlan.brand',
  'landing.pricing.everyPlan.scanner',
  'landing.pricing.everyPlan.loyalty',
  'landing.pricing.everyPlan.customers',
  'landing.pricing.everyPlan.campaigns',
  'landing.pricing.everyPlan.ai',
  'landing.pricing.everyPlan.proximity',
  'landing.pricing.everyPlan.support',
]

function EveryPlanStrip() {
  const { t } = useI18n()

  return (
    <section className="mt-12 rounded-3xl border bg-card p-6 sm:p-8">
      <h3 className="text-base font-semibold">{t('landing.pricing.everyPlanTitle')}</h3>
      <ul className="mt-4 grid gap-x-6 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {EVERY_PLAN_KEYS.map((key) => (
          <li key={key} className="flex items-start gap-2.5">
            <Check className="mt-0.5 size-4 shrink-0 text-emerald-500" aria-hidden />
            <span className="text-sm text-muted-foreground">{t(key)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * The value example.
 *
 * Deliberately not a calculator with sliders. A slider invites the visitor to
 * dial in a number that makes the product look good, and a figure they chose
 * themselves persuades nobody. One worked sum with modest inputs, the arithmetic
 * shown, and the word "example" before the numbers.
 *
 * The inputs are fixed here rather than in the dictionary because they are
 * *arithmetic*, not copy: the recovered figure has to equal ticket × visits in
 * both languages, and a translator editing "12" to "15" would silently make the
 * sentence false.
 */
const ROI_TICKET = 12
const ROI_VISITS = 8

function ValueExample({ entryPrice }: { entryPrice: string }) {
  const { t, formatCurrency, formatNumber } = useI18n()

  const ticket = formatCurrency(ROI_TICKET, { currency: PLAN_CURRENCY })
  const recovered = formatCurrency(ROI_TICKET * ROI_VISITS, { currency: PLAN_CURRENCY })

  return (
    <section className="mt-6 rounded-3xl border bg-muted/30 p-6 sm:p-8">
      <h3 className="text-base font-semibold">{t('landing.pricing.roiTitle')}</h3>

      <dl className="mt-4 grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border bg-card p-4">
          <dt className="text-xs text-muted-foreground">{t('landing.pricing.roiTicketLabel')}</dt>
          <dd className="mt-0.5 text-2xl font-semibold tabular-nums">{ticket}</dd>
        </div>
        <div className="rounded-2xl border bg-card p-4">
          <dt className="text-xs text-muted-foreground">{t('landing.pricing.roiVisitsLabel')}</dt>
          <dd className="mt-0.5 text-2xl font-semibold tabular-nums">
            {formatNumber(ROI_VISITS)}
          </dd>
        </div>
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4">
          <dt className="text-xs text-muted-foreground">
            {t('landing.pricing.roiRecoveredLabel')}
          </dt>
          <dd className="mt-0.5 text-2xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
            {recovered}
          </dd>
        </div>
      </dl>

      <p className="mt-4 text-sm text-muted-foreground">
        {t('landing.pricing.roiBody', {
          ticket,
          visits: formatNumber(ROI_VISITS),
          recovered,
          price: entryPrice,
        })}
      </p>
      <p className="mt-2 text-xs text-muted-foreground/80">
        {t('landing.pricing.roiDisclaimer')}
      </p>
    </section>
  )
}

/**
 * The pricing FAQ.
 *
 * Four questions, answered in the same words the billing screen and the API
 * refusals use. Exported separately so the landing page can place it outside the
 * pricing card grid, where a `<details>` list does not compete with the prices.
 */
export function PricingFaq() {
  const { t } = useI18n()

  const entries: Array<{ q: TranslationKey; a: TranslationKey }> = [
    { q: 'landing.pricing.faq.freeQ', a: 'landing.pricing.faq.freeA' },
    { q: 'landing.pricing.faq.switchQ', a: 'landing.pricing.faq.switchA' },
    { q: 'landing.pricing.faq.cancelQ', a: 'landing.pricing.faq.cancelA' },
    { q: 'landing.pricing.faq.limitQ', a: 'landing.pricing.faq.limitA' },
  ]

  return (
    <section className="mx-auto mt-6 max-w-3xl">
      <h3 className="text-base font-semibold">{t('landing.pricing.faqTitle')}</h3>
      <div className="mt-4 divide-y rounded-3xl border bg-card">
        {entries.map((entry) => (
          <details key={entry.q} className="group px-5 py-4">
            <summary className="cursor-pointer list-none text-sm font-medium marker:hidden">
              {t(entry.q)}
            </summary>
            <p className="mt-2 text-sm text-muted-foreground">{t(entry.a)}</p>
          </details>
        ))}
      </div>
    </section>
  )
}
