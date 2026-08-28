'use client'

import * as React from 'react'
import { ArrowDown, ArrowUp, Minus, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useI18n } from '@/lib/i18n'
import { LOCALE_TAGS, type Locale } from '@/lib/i18n/locales'

/**
 * Metric tiles.
 *
 * Three rules encoded here, because they are the difference between a dashboard
 * that gets read and one that gets ignored:
 *   1. A number without a comparison is not information — every tile carries a
 *      period-over-period delta.
 *   2. Direction is not always good. `invertDelta` marks metrics (churn, lapsed
 *      customers) where "up" is bad, so colour never misleads.
 *   3. A number is a sentence in a language. `formatValue` takes the locale
 *      explicitly rather than passing `undefined` to `Intl`, which resolves to
 *      the *browser's* language — so a Spanish merchant on an English laptop
 *      used to read `€1,234.50` in a product that had otherwise switched
 *      language around it.
 */

export type MetricTileProps = {
  label: string
  value: string | number
  previous?: number | null
  current?: number | null
  format?: 'number' | 'currency' | 'percent'
  currency?: string
  icon?: LucideIcon
  hint?: string
  invertDelta?: boolean
  className?: string
}

export function formatValue(
  value: number,
  format: MetricTileProps['format'] = 'number',
  currency = 'EUR',
  locale: Locale = 'en'
): string {
  const tag = LOCALE_TAGS[locale]
  if (format === 'currency') {
    return new Intl.NumberFormat(tag, {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
      maximumFractionDigits: value >= 1000 ? 0 : 2,
    }).format(value)
  }
  if (format === 'percent') {
    return new Intl.NumberFormat(tag, {
      style: 'percent',
      maximumFractionDigits: 1,
    }).format(value / 100)
  }
  return new Intl.NumberFormat(tag, { maximumFractionDigits: 1 }).format(value)
}

/**
 * The bound formatter every screen should use.
 *
 * `formatValue` keeps an explicit locale parameter so it stays a pure function
 * (and testable without React); this is the one-liner that saves every caller
 * from remembering to pass it.
 */
export function useFormatValue(): (
  value: number,
  format?: MetricTileProps['format'],
  currency?: string
) => string {
  const { locale } = useI18n()
  return React.useCallback(
    (value, format = 'number', currency = 'EUR') => formatValue(value, format, currency, locale),
    [locale]
  )
}

function deltaPercent(current: number, previous: number): number | null {
  // A jump from zero is infinite, not "+100%" — show it as new instead.
  if (previous === 0) return current === 0 ? 0 : null
  return ((current - previous) / previous) * 100
}

export function MetricTile({
  label,
  value,
  previous,
  current,
  format = 'number',
  currency = 'EUR',
  icon: Icon,
  hint,
  invertDelta = false,
  className,
}: MetricTileProps) {
  const { t, locale, formatPercent } = useI18n()
  const delta =
    current !== undefined && current !== null && previous !== undefined && previous !== null
      ? deltaPercent(current, previous)
      : undefined

  const improving = delta === undefined || delta === null ? null : invertDelta ? delta < 0 : delta > 0
  const flat = delta !== undefined && delta !== null && Math.abs(delta) < 0.5

  const body = (
    <div className={cn('rounded-xl border bg-card p-5 transition-shadow hover:shadow-sm', className)}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" />}
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">
        {typeof value === 'number' ? formatValue(value, format, currency, locale) : value}
      </p>
      {delta !== undefined && (
        <p className="mt-1.5 flex items-center gap-1 text-xs">
          {delta === null ? (
            <span className="text-muted-foreground">{t('metrics.newThisPeriod')}</span>
          ) : (
            <>
              <span
                className={cn(
                  'inline-flex items-center gap-0.5 font-medium',
                  flat
                    ? 'text-muted-foreground'
                    : improving
                      ? 'text-emerald-600 dark:text-emerald-500'
                      : 'text-red-600 dark:text-red-400'
                )}
              >
                {flat ? (
                  <Minus className="size-3" />
                ) : delta > 0 ? (
                  <ArrowUp className="size-3" />
                ) : (
                  <ArrowDown className="size-3" />
                )}
                {formatPercent(Math.abs(delta) / 100)}
              </span>
              <span className="text-muted-foreground">{t('metrics.vsPreviousPeriod')}</span>
            </>
          )}
        </p>
      )}
    </div>
  )

  if (!hint) return body

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="cursor-help">{body}</div>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{hint}</TooltipContent>
    </Tooltip>
  )
}

export function MetricGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{children}</div>
}

/** Inline progress meter used for goals, tiers and campaign delivery. */
export function Meter({
  value,
  max,
  label,
  className,
  tone = 'default',
}: {
  value: number
  max: number
  label?: string
  className?: string
  tone?: 'default' | 'success' | 'warning'
}) {
  const { t, formatNumber } = useI18n()
  const percent = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  const tones = {
    default: 'bg-primary',
    success: 'bg-emerald-500',
    warning: 'bg-amber-500',
  }
  return (
    <div className={className}>
      {label && (
        <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
          <span>{label}</span>
          <span className="tabular-nums">
            {formatNumber(value)} / {formatNumber(max)}
          </span>
        </div>
      )}
      <div
        className="h-2 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={label ?? t('metrics.progress')}
      >
        <div
          className={cn('h-full rounded-full transition-[width] duration-500', tones[tone])}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}
