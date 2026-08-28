'use client'

import * as React from 'react'
import Link from 'next/link'
import { Lock, Sparkles, TrendingUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { useWorkspace } from '@/lib/client/workspace'
import { useI18n } from '@/lib/i18n'
import {
  ENTRY_PLAN,
  FEATURE_LABEL_KEYS,
  LIMIT_LABEL_KEYS,
  PLAN_CURRENCY,
  lowestPlanWith,
  lowestPlanWithLimit,
  type Feature,
  type LimitKey,
  type Plan,
} from '@/lib/billing/plans'

/**
 * The paywall, as one component.
 *
 * Every locked surface in the product renders this, so the upgrade experience is
 * identical everywhere and a merchant learns it once. Four rules:
 *
 *  1. **Show the value, not the lock.** The headline is what they would gain, not
 *     what they are missing. "Sell gift cards" beats "Feature unavailable".
 *  2. **Name the price.** A paywall that hides the number makes people leave to find
 *     it, and most do not come back.
 *  3. **One button.** We already know the cheapest plan that unlocks this, so the
 *     merchant never has to compare a matrix to answer "which one do I need".
 *  4. **A cap and a missing feature read differently.** "You have 1 of 1 locations"
 *     is a different sentence from "Geofencing is on Growth", and collapsing them
 *     into one generic paywall is how a merchant ends up unable to tell whether they
 *     need a bigger plan or a different one.
 */

export function FeatureGate({
  feature,
  children,
  fallback,
}: {
  feature: Feature
  children: React.ReactNode
  fallback?: React.ReactNode
}) {
  const { has } = useWorkspace()
  if (has(feature)) return <>{children}</>
  return <>{fallback ?? <UpgradePrompt feature={feature} />}</>
}

type UpgradePromptProps =
  | {
      feature: Feature
      limit?: never
      used?: never
      allowed?: never
      title?: string
      description?: string
      className?: string
    }
  | {
      feature?: never
      limit: LimitKey
      used: number
      allowed?: number
      title?: string
      description?: string
      className?: string
    }

export function UpgradePrompt(props: UpgradePromptProps) {
  const { title, description, className } = props
  const { can, entitlements } = useWorkspace()
  const { t, formatCurrency, formatNumber } = useI18n()

  const lapsed = Boolean(entitlements && entitlements.effective_plan === 'lapsed')

  const required: Plan | null = lapsed
    ? ENTRY_PLAN
    : props.feature
      ? lowestPlanWith(props.feature)
      : lowestPlanWithLimit(props.limit, (props.used ?? 0) + 1)

  const headline =
    title ??
    (lapsed
      ? t('dashboard.lapsed.title')
      : props.feature
        ? t(FEATURE_LABEL_KEYS[props.feature])
        : t(LIMIT_LABEL_KEYS[props.limit]))

  const body =
    description ??
    (lapsed
      ? t('dashboard.lapsed.body')
      : props.feature
        ? (required ? t(required.taglineKey) : t('common.upgradeToUse', { plan: ENTRY_PLAN.name }))
        : /*
           * A cap message states the actual numbers. "You have used your locations"
           * leaves the merchant guessing what the limit even was.
           */
          `${formatNumber(props.used ?? 0)}${
            props.allowed !== undefined ? ` / ${formatNumber(props.allowed)}` : ''
          }`)

  return (
    <section
      className={cn(
        'relative overflow-hidden rounded-2xl border border-primary/25 bg-linear-to-br from-primary/[0.07] via-card to-card p-8 text-center',
        className
      )}
    >
      <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10">
        <Sparkles className="size-6 text-primary" aria-hidden />
      </div>

      <h3 className="mt-4 text-lg font-semibold tracking-tight">{headline}</h3>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">{body}</p>

      {required && required.monthlyPrice !== null && (
        <p className="mt-4 text-sm">
          <span className="font-semibold">{required.name}</span>
          <span className="text-muted-foreground">
            {' — '}
            {formatCurrency(required.monthlyPrice, { currency: PLAN_CURRENCY })}
            {t('common.perMonth')}
          </span>
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        {can('billing:manage') ? (
          <Button asChild className="gap-2">
            <Link href="/dashboard/billing">
              <TrendingUp className="size-4" aria-hidden />
              {required
                ? t('common.upgradeToUse', { plan: required.name })
                : t('dashboard.trial.cta')}
            </Link>
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">{t('errors.forbiddenBody')}</p>
        )}
      </div>
    </section>
  )
}

/**
 * Inline lock for a single control inside an otherwise available screen — a button, a
 * toggle, a menu item. Keeps the affordance visible (so merchants discover what the
 * product can do) while making the gate obvious.
 */
export function LockedBadge({ feature }: { feature: Feature }) {
  const { t } = useI18n()
  const required = lowestPlanWith(feature)

  return (
    <Badge variant="outline" className="gap-1 border-primary/30 text-primary">
      <Lock className="size-3" aria-hidden />
      {required?.name ?? t('common.upgradeRequired')}
    </Badge>
  )
}

/**
 * The reactivation wall for a lapsed workspace.
 *
 * Distinct from the paywall above, because the message is different in the way that
 * matters most: nothing has been lost. A merchant whose trial ran out is one click
 * from working again, and the screen has to say so before it asks for money.
 */
export function ReactivationBanner() {
  const { entitlements, can } = useWorkspace()
  const { t, formatCurrency } = useI18n()

  if (!entitlements || entitlements.effective_plan !== 'lapsed') return null

  const price = formatCurrency(ENTRY_PLAN.monthlyPrice ?? 5, { currency: PLAN_CURRENCY })

  return (
    <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 sm:flex-row sm:items-center">
      <div className="flex-1">
        <p className="text-sm font-semibold">{t('dashboard.lapsed.title')}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{t('dashboard.lapsed.body')}</p>
      </div>
      {can('billing:manage') && (
        <Button asChild className="shrink-0">
          <Link href="/dashboard/billing">{t('dashboard.lapsed.cta', { price })}</Link>
        </Button>
      )}
    </div>
  )
}
