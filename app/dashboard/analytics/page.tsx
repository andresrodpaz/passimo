'use client'

import * as React from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { BarChart3 } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useApi, query } from '@/lib/client/api'
import { useWorkspace } from '@/lib/client/workspace'
import { AsyncBoundary, EmptyState, LoadingCards } from '@/components/states'
import { MetricGrid, MetricTile, useFormatValue } from '@/components/metrics'
import { useI18n } from '@/lib/i18n'
import type { AnalyticsOverview } from '@/lib/domain/types'

type Cohort = {
  cohort: string
  size: number
  retention: Array<{ month: number; customers: number; rate: number }>
}

type AnalyticsResponse = AnalyticsOverview & { cohorts?: Cohort[] }

/**
 * Analytics.
 *
 * Built around the four questions a loyalty program has to answer: are people
 * coming back, are they worth more over time, which rewards work, and is the
 * program paying for itself. Cohort retention is the centrepiece because it is
 * the only view that separates "we acquired a lot" from "we kept them".
 */
export default function AnalyticsPage() {
  const { businessId } = useWorkspace()
  const { t, formatNumber } = useI18n()
  const formatValue = useFormatValue()
  const [days, setDays] = React.useState(30)

  const { data, error, isLoading, mutate } = useApi<AnalyticsResponse>(
    businessId
      ? `/api/v1/analytics/overview${query({ businessId, days, include: 'cohorts' })}`
      : null
  )

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{t('analytics.title')}</h2>
          <p className="text-sm text-muted-foreground">{t('analytics.subtitle')}</p>
        </div>
        <Select value={String(days)} onValueChange={(value) => setDays(Number(value))}>
          <SelectTrigger className="h-9 w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">{t('analytics.range7')}</SelectItem>
            <SelectItem value="30">{t('analytics.range30')}</SelectItem>
            <SelectItem value="90">{t('analytics.range90')}</SelectItem>
            <SelectItem value="365">{t('analytics.range365')}</SelectItem>
          </SelectContent>
        </Select>
      </header>

      <AsyncBoundary
        data={data}
        error={error}
        isLoading={isLoading}
        onRetry={() => void mutate()}
        loading={<LoadingCards />}
      >
        {(overview) => (
          <>
            <MetricGrid>
              <MetricTile
                label={t('analytics.repeatRate')}
                value={overview.customers.repeat_rate}
                format="percent"
                hint={t('analytics.repeatRateHint')}
              />
              <MetricTile
                label={t('analytics.retention')}
                value={overview.customers.retention_rate}
                format="percent"
                hint={t('analytics.retentionHint')}
              />
              <MetricTile
                label={t('analytics.churn')}
                value={overview.customers.churn_rate}
                format="percent"
                invertDelta
                hint={t('analytics.churnHint')}
              />
              <MetricTile
                label={t('analytics.clv')}
                value={overview.revenue.average_clv}
                format="currency"
                hint={t('analytics.clvHint')}
              />
            </MetricGrid>

            <MetricGrid>
              <MetricTile
                label={t('analytics.averageTicket')}
                value={overview.revenue.average_ticket}
                format="currency"
              />
              <MetricTile
                label={t('analytics.visits')}
                value={overview.engagement.visits}
                current={overview.engagement.visits}
                previous={overview.engagement.visits_previous}
              />
              <MetricTile
                label={t('analytics.rewardsClaimed')}
                value={overview.engagement.redemptions}
              />
              <MetricTile
                label={t('analytics.outstanding')}
                value={overview.engagement.balance_outstanding}
                hint={t('analytics.outstandingHint')}
              />
            </MetricGrid>

            <section className="rounded-xl border bg-card p-5">
              <h3 className="text-base font-semibold">{t('analytics.monthlyGrowth')}</h3>
              <p className="text-sm text-muted-foreground">{t('analytics.monthlyGrowthBody')}</p>
              {overview.growth.some((point) => point.customers > 0 || point.visits > 0) ? (
                <div className="mt-4 h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={overview.growth} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                      <XAxis
                        dataKey="month"
                        tick={{ fontSize: 11, fill: 'currentColor' }}
                        className="text-muted-foreground"
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: 'currentColor' }}
                        className="text-muted-foreground"
                        axisLine={false}
                        tickLine={false}
                        width={44}
                      />
                      <RechartsTooltip
                        contentStyle={{
                          background: 'var(--color-card)',
                          border: '1px solid var(--color-border)',
                          borderRadius: 10,
                          fontSize: 12,
                        }}
                      />
                      <Bar
                        dataKey="customers"
                        name={t('analytics.newMembers')}
                        fill="var(--color-primary)"
                        radius={[4, 4, 0, 0]}
                      />
                      <Bar
                        dataKey="visits"
                        name={t('analytics.visits')}
                        fill="var(--color-muted-foreground)"
                        radius={[4, 4, 0, 0]}
                        opacity={0.4}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <EmptyState
                  className="mt-4"
                  icon={BarChart3}
                  title={t('analytics.notEnoughHistory')}
                  description={t('analytics.notEnoughHistoryBody')}
                />
              )}
            </section>

            {overview.cohorts && overview.cohorts.length > 0 && (
              <CohortTable cohorts={overview.cohorts} />
            )}

            <div className="grid gap-6 lg:grid-cols-2">
              <section className="rounded-xl border bg-card p-5">
                <h3 className="text-base font-semibold">{t('analytics.topRewards')}</h3>
                {overview.top_rewards.length === 0 ? (
                  <p className="mt-3 text-sm text-muted-foreground">
                    {t('analytics.topRewardsEmpty')}
                  </p>
                ) : (
                  <ul className="mt-4 space-y-3">
                    {overview.top_rewards.map((reward) => {
                      const max = Math.max(...overview.top_rewards.map((item) => item.redemptions))
                      return (
                        <li key={reward.id}>
                          <div className="flex items-center justify-between text-sm">
                            <span className="truncate">{reward.name}</span>
                            <span className="tabular-nums text-muted-foreground">
                              {formatNumber(reward.redemptions)}
                            </span>
                          </div>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full bg-primary"
                              style={{ width: `${max ? (reward.redemptions / max) * 100 : 0}%` }}
                            />
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>

              <section className="rounded-xl border bg-card p-5">
                <h3 className="text-base font-semibold">{t('analytics.topCustomers')}</h3>
                {overview.top_customers.length === 0 ? (
                  <p className="mt-3 text-sm text-muted-foreground">
                    {t('analytics.topCustomersEmpty')}
                  </p>
                ) : (
                  <ul className="mt-4 divide-y">
                    {overview.top_customers.slice(0, 8).map((customer) => (
                      <li key={customer.id} className="flex items-center justify-between py-2 text-sm">
                        <span className="truncate">{customer.name || customer.email}</span>
                        <span className="shrink-0 tabular-nums">
                          {formatValue(Number(customer.lifetime_spend), 'currency')}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </>
        )}
      </AsyncBoundary>
    </div>
  )
}

/**
 * Cohort retention grid. Colour intensity encodes the rate so the shape of the
 * business is legible in one glance without reading a single number.
 */
function CohortTable({ cohorts }: { cohorts: Cohort[] }) {
  const { t, formatNumber, formatPercent } = useI18n()
  const months = Math.max(...cohorts.map((cohort) => cohort.retention.length))

  return (
    <section className="rounded-xl border bg-card p-5">
      <h3 className="text-base font-semibold">{t('analytics.cohorts')}</h3>
      <p className="text-sm text-muted-foreground">{t('analytics.cohortsBody')}</p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground">
              <th scope="col" className="pb-2 text-left font-medium">
                {t('analytics.cohortJoined')}
              </th>
              <th scope="col" className="pb-2 text-left font-medium">
                {t('analytics.cohortSize')}
              </th>
              {Array.from({ length: months }).map((_, index) => (
                <th key={index} scope="col" className="pb-2 text-center font-medium">
                  {t('analytics.cohortMonth', { index })}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cohorts.map((cohort) => (
              <tr key={cohort.cohort}>
                <th scope="row" className="py-1 pr-3 text-left font-normal">
                  {cohort.cohort}
                </th>
                <td className="py-1 pr-3 tabular-nums text-muted-foreground">
                  {formatNumber(cohort.size)}
                </td>
                {Array.from({ length: months }).map((_, index) => {
                  const cell = cohort.retention.find((entry) => entry.month === index)
                  const rate = cell?.rate ?? 0
                  return (
                    <td key={index} className="p-0.5">
                      <div
                        className="rounded-md py-1.5 text-center text-xs tabular-nums"
                        style={{
                          backgroundColor:
                            rate > 0
                              ? `color-mix(in oklab, var(--color-primary) ${Math.min(100, rate)}%, transparent)`
                              : 'transparent',
                          color: rate > 55 ? 'var(--color-primary-foreground)' : undefined,
                        }}
                      >
                        {rate > 0 ? formatPercent(rate / 100, 0) : '—'}
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
