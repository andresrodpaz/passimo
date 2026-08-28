'use client'

import * as React from 'react'
import { BarChart3, Bell, Clock, MapPin, TrendingUp } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { EmptyState, ErrorState, LoadingCards } from '@/components/states'
import { useApi, query } from '@/lib/client/api'
import { useI18n } from '@/lib/i18n'
import type { ProximityAnalytics } from '@/lib/wallet/analytics'

/**
 * Proximity analytics.
 *
 * Answers the merchant's actual question — *is this bringing people in, and is it
 * worth what I pay?* — and refuses to flatter the answer:
 *
 *   * A rate with no denominator renders as "—", never as 0%. "0% conversion" reads
 *     as failure; "—" reads as "nothing sent yet", which is the truth on day one.
 *   * Revenue with no configured transaction amounts renders as "not measured",
 *     because "$0 returned" is a different and much worse claim than "we do not know".
 *   * The notification log includes *skipped* deliveries with their reasons. A quiet
 *     week with "48 skipped — card not in their wallet" is diagnosable; a quiet week
 *     with only successes shown is a mystery.
 */

type AnalyticsResponse = ProximityAnalytics & {
  notifications: Array<{
    id: string
    title: string
    status: string
    skipReason: string | null
    sentAt: string | null
    createdAt: string
  }>
}

const RANGES = [
  { days: 7, key: 'wallet.analytics.range7' },
  { days: 30, key: 'wallet.analytics.range30' },
  { days: 90, key: 'wallet.analytics.range90' },
] as const

export function WalletAnalyticsPanel({ businessId }: { businessId: string }) {
  const { t, formatNumber, formatPercent, formatCurrency, formatRelative } = useI18n()
  const [days, setDays] = React.useState(30)

  const { data, error, isLoading, mutate } = useApi<AnalyticsResponse>(
    `/api/v1/wallet/analytics${query({ businessId, days })}`
  )

  const funnel = data?.funnel
  const rates = data?.rates

  const nothingYet =
    funnel &&
    funnel.notificationsSent === 0 &&
    funnel.suggestions === 0 &&
    funnel.geofenceEntries === 0

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">{t('wallet.analytics.title')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('wallet.analytics.subtitle')}</p>
        </div>

        <div
          role="radiogroup"
          aria-label={t('wallet.analytics.range30')}
          className="inline-flex rounded-full border bg-card p-1"
        >
          {RANGES.map((range) => (
            <button
              key={range.days}
              type="button"
              role="radio"
              aria-checked={days === range.days}
              onClick={() => setDays(range.days)}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                days === range.days
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {t(range.key)}
            </button>
          ))}
        </div>
      </div>

      {isLoading && <LoadingCards count={4} />}
      {error && <ErrorState error={error} onRetry={() => void mutate()} />}

      {nothingYet && (
        <EmptyState
          icon={BarChart3}
          title={t('wallet.analytics.empty')}
          description={t('wallet.analytics.emptyBody')}
        />
      )}

      {data && funnel && rates && !nothingYet && (
        <>
          {/* Headline rates first: they are what the merchant came for. */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric
              icon={Bell}
              label={t('wallet.analytics.notificationsSent')}
              value={formatNumber(funnel.notificationsSent)}
            />
            <Metric
              icon={MapPin}
              label={t('wallet.analytics.conversion')}
              value={rates.conversion === null ? '—' : formatPercent(rates.conversion)}
              hint={`${formatNumber(funnel.storeVisits)} ${t('wallet.analytics.storeVisits')}`}
            />
            <Metric
              icon={TrendingUp}
              label={t('wallet.analytics.revenue')}
              value={
                funnel.revenueCents > 0
                  ? formatCurrency(funnel.revenueCents, { cents: true })
                  : t('wallet.analytics.noRevenue')
              }
              hint={
                rates.revenuePerNotificationCents
                  ? `${formatCurrency(rates.revenuePerNotificationCents, { cents: true })} ${t(
                      'wallet.analytics.revenuePerSend'
                    )}`
                  : undefined
              }
            />
            <Metric
              icon={Clock}
              label={t('wallet.analytics.avgVisitDelay')}
              value={
                funnel.averageVisitDelayMinutes === null
                  ? '—'
                  : t('common.minutes', { count: Math.round(funnel.averageVisitDelayMinutes) })
              }
              hint={t('wallet.analytics.avgVisitDelayHelp')}
            />
          </div>

          {/* The funnel, as a labelled bar set rather than a chart library: five
              stages with wildly different magnitudes read better as proportions of
              the first than as a plotted series. */}
          <section className="rounded-2xl border bg-card p-5">
            <h3 className="text-sm font-semibold">{t('wallet.analytics.funnel')}</h3>
            <ul className="mt-4 space-y-3">
              {[
                { label: t('wallet.analytics.geofenceEntries'), value: funnel.geofenceEntries },
                { label: t('wallet.analytics.suggestions'), value: funnel.suggestions },
                { label: t('wallet.analytics.notificationsSent'), value: funnel.notificationsSent },
                { label: t('wallet.analytics.clicks'), value: funnel.clicks + funnel.walletOpens },
                { label: t('wallet.analytics.storeVisits'), value: funnel.storeVisits },
                { label: t('wallet.analytics.redemptions'), value: funnel.redemptions },
              ].map((stage, index, all) => {
                const peak = Math.max(...all.map((entry) => entry.value), 1)
                return (
                  <li key={stage.label}>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="truncate">{stage.label}</span>
                      <span className="shrink-0 font-semibold tabular-nums">
                        {formatNumber(stage.value)}
                      </span>
                    </div>
                    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary/70 transition-all duration-500"
                        style={{ width: `${(stage.value / peak) * 100}%` }}
                      />
                    </div>
                  </li>
                )
              })}
            </ul>

            <dl className="mt-5 grid grid-cols-2 gap-4 border-t pt-4 sm:grid-cols-4">
              <SmallStat
                label={t('wallet.analytics.passesInstalled')}
                value={formatNumber(funnel.passesInstalled)}
              />
              <SmallStat
                label={t('wallet.analytics.passesRemoved')}
                value={formatNumber(funnel.passesRemoved)}
              />
              <SmallStat
                label={t('wallet.analytics.uniqueCustomers')}
                value={formatNumber(funnel.uniqueCustomers)}
              />
              <SmallStat
                label={t('wallet.analytics.redemptionRate')}
                value={rates.redemption === null ? '—' : formatPercent(rates.redemption)}
              />
            </dl>
          </section>

          {/* By campaign */}
          {data.campaigns.length > 0 && (
            <section className="overflow-hidden rounded-2xl border bg-card">
              <h3 className="border-b p-4 text-sm font-semibold">
                {t('wallet.analytics.byCampaign')}
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th scope="col" className="p-3 font-medium">
                        {t('wallet.campaigns.name')}
                      </th>
                      <th scope="col" className="p-3 text-right font-medium">
                        {t('wallet.campaigns.stats.sent')}
                      </th>
                      <th scope="col" className="p-3 text-right font-medium">
                        {t('wallet.campaigns.stats.clicks')}
                      </th>
                      <th scope="col" className="p-3 text-right font-medium">
                        {t('wallet.campaigns.stats.visits')}
                      </th>
                      <th scope="col" className="p-3 text-right font-medium">
                        {t('wallet.campaigns.stats.conversion')}
                      </th>
                      <th scope="col" className="p-3 text-right font-medium">
                        {t('wallet.campaigns.stats.revenue')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.campaigns.map((campaign) => (
                      <tr key={campaign.campaignId} className="border-b last:border-0">
                        <th scope="row" className="p-3 text-left font-medium">
                          {campaign.name}
                        </th>
                        <td className="p-3 text-right tabular-nums">
                          {formatNumber(campaign.sent)}
                        </td>
                        <td className="p-3 text-right tabular-nums">
                          {formatNumber(campaign.clicks)}
                        </td>
                        <td className="p-3 text-right tabular-nums">
                          {formatNumber(campaign.visits)}
                        </td>
                        <td className="p-3 text-right tabular-nums">
                          {campaign.conversion === null ? '—' : formatPercent(campaign.conversion)}
                        </td>
                        <td className="p-3 text-right tabular-nums">
                          {campaign.revenueCents > 0
                            ? formatCurrency(campaign.revenueCents, { cents: true })
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* By location */}
          {data.locations.length > 0 && (
            <section className="rounded-2xl border bg-card p-5">
              <h3 className="text-sm font-semibold">{t('wallet.analytics.byLocation')}</h3>
              <ul className="mt-3 space-y-2">
                {data.locations.map((location) => (
                  <li
                    key={location.locationId}
                    className="flex flex-wrap items-center gap-3 rounded-xl bg-muted/40 p-3"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {location.name}
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {formatNumber(location.entries)} {t('wallet.analytics.geofenceEntries')}
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {formatNumber(location.visits)} {t('wallet.analytics.storeVisits')}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Delivery log, successes and skips alike. */}
          {data.notifications.length > 0 && (
            <section className="rounded-2xl border bg-card p-5">
              <h3 className="text-sm font-semibold">
                {t('wallet.analytics.recentNotifications')}
              </h3>
              <ul className="mt-3 divide-y">
                {data.notifications.map((notification) => (
                  <li key={notification.id} className="flex items-center gap-3 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{notification.title}</span>
                      <span className="block text-xs text-muted-foreground">
                        {formatRelative(notification.sentAt ?? notification.createdAt)}
                      </span>
                    </span>
                    <Badge
                      variant={notification.status === 'sent' ? 'secondary' : 'outline'}
                      className="shrink-0 text-[11px]"
                    >
                      {notification.status === 'sent'
                        ? t('wallet.campaigns.stats.sent')
                        : (skipLabel(notification.skipReason, t) ?? t('wallet.analytics.notSent'))}
                    </Badge>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  )
}

/**
 * Maps a stored skip reason to merchant-facing copy.
 *
 * Returns `null` for an unrecognised reason rather than the raw enum: a future server
 * version writing a new reason should degrade to "not sent", not print
 * `wallet_not_configured` at somebody.
 */
function skipLabel(
  reason: string | null,
  t: (key: 'wallet.analytics.skipReasons.no_pass_installed') => string
): string | null {
  if (!reason) return null
  const known = [
    'no_pass_installed',
    'wallet_not_configured',
    'quiet_hours',
    'daily_cap',
    'too_soon',
  ] as const
  if (!known.includes(reason as (typeof known)[number])) return null
  return t(`wallet.analytics.skipReasons.${reason}` as 'wallet.analytics.skipReasons.no_pass_installed')
}

function Metric({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="rounded-2xl border bg-card p-4">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">{label}</span>
      </p>
      <p className="mt-1.5 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function SmallStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="truncate text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold tabular-nums">{value}</dd>
    </div>
  )
}
