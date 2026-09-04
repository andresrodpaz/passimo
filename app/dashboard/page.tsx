'use client'

import * as React from 'react'
import Link from 'next/link'
import {
  Users,
  Repeat,
  Euro,
  HeartPulse,
  Sparkles,
  ArrowRight,
  ScanLine,
  UserPlus,
  Gift,
  TrendingDown,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useApi, query } from '@/lib/client/api'
import { useWorkspace } from '@/lib/client/workspace'
import { MetricGrid, MetricTile, useFormatValue } from '@/components/metrics'
import { AsyncBoundary, EmptyState, LoadingCards } from '@/components/states'
import { FirstStepsChecklist } from '@/components/onboarding/first-steps'
import { WalletCardCallout } from '@/components/wallet/card-callout'
import { useI18n } from '@/lib/i18n'
import type { TranslationKey } from '@/lib/i18n'
import type { AnalyticsOverview } from '@/lib/domain/types'

/**
 * Overview.
 *
 * Answers, in order: is the business growing, who needs attention today, and
 * what should I do about it. The old version showed hardcoded sample numbers.
 */
export default function DashboardOverview() {
  const { businessId, loading: workspaceLoading } = useWorkspace()

  const { data, error, isLoading, mutate } = useApi<AnalyticsOverview>(
    businessId ? `/api/v1/analytics/overview${query({ businessId, days: 30 })}` : null
  )

  if (workspaceLoading || (!businessId && !error)) return <LoadingCards />

  return (
    <div className="space-y-6">
      {/* Everything onboarding deliberately stopped asking for. Above the
          metrics because a merchant on day one has no metrics to read. */}
      <FirstStepsChecklist />

      <AsyncBoundary
        data={data}
        error={error}
        isLoading={isLoading}
        onRetry={() => void mutate()}
        loading={<LoadingCards />}
      >
        {(overview) => (
          <>
            <Metrics overview={overview} />

            <div className="grid gap-6 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <GrowthChart overview={overview} />
              </div>
              <div className="space-y-6">
                {/*
                  The card the merchant's customers carry, on the screen the
                  merchant opens most, with the way into the designer under it.
                  This is the answer to "where do I click to customise my card?"
                  for someone who has read nothing and been told nothing.
                */}
                <WalletCardCallout variant="compact" />
                <NextBestActions overview={overview} />
                <InsightPreview businessId={businessId!} />
              </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <TopCustomers overview={overview} />
              <ProgramHealth overview={overview} />
            </div>
          </>
        )}
      </AsyncBoundary>
    </div>
  )
}

function Metrics({ overview }: { overview: AnalyticsOverview }) {
  const { t } = useI18n()
  return (
    <MetricGrid>
      <MetricTile
        label={t('overview.members')}
        value={overview.customers.total}
        current={overview.customers.new}
        previous={overview.customers.new_previous}
        icon={Users}
        hint={t('overview.membersHint')}
      />
      <MetricTile
        label={t('overview.repeatRate')}
        value={overview.customers.repeat_rate}
        format="percent"
        icon={Repeat}
        hint={t('overview.repeatRateHint')}
      />
      <MetricTile
        label={t('overview.revenue30')}
        value={overview.revenue.period}
        current={overview.revenue.period}
        previous={overview.revenue.previous}
        format="currency"
        icon={Euro}
        hint={t('overview.revenue30Hint')}
      />
      <MetricTile
        label={t('overview.atRisk')}
        value={overview.customers.lapsed}
        icon={HeartPulse}
        invertDelta
        hint={t('overview.atRiskHint')}
      />
    </MetricGrid>
  )
}

function GrowthChart({ overview }: { overview: AnalyticsOverview }) {
  const { t } = useI18n()
  const formatValue = useFormatValue()
  const [metric, setMetric] = React.useState<'visits' | 'revenue'>('visits')
  const hasData = overview.daily.some((point) => point.visits > 0 || point.revenue > 0)

  const label = (option: 'visits' | 'revenue') =>
    option === 'revenue' ? t('overview.tabRevenue') : t('overview.tabVisits')

  return (
    <section className="rounded-xl border bg-card p-5">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{t('overview.activity')}</h2>
          <p className="text-sm text-muted-foreground">{t('overview.last30Days')}</p>
        </div>
        <div className="flex rounded-lg border p-0.5" role="tablist">
          {(['visits', 'revenue'] as const).map((option) => (
            <button
              key={option}
              role="tab"
              aria-selected={metric === option}
              onClick={() => setMetric(option)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                metric === option
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {label(option)}
            </button>
          ))}
        </div>
      </header>

      {hasData ? (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={overview.daily} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <defs>
                <linearGradient id="activityFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={(value: string) => value.slice(5)}
                tick={{ fontSize: 11, fill: 'currentColor' }}
                className="text-muted-foreground"
                axisLine={false}
                tickLine={false}
                minTickGap={24}
              />
              <YAxis
                tick={{ fontSize: 11, fill: 'currentColor' }}
                className="text-muted-foreground"
                axisLine={false}
                tickLine={false}
                width={48}
              />
              <RechartsTooltip
                contentStyle={{
                  background: 'var(--color-card)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 10,
                  fontSize: 12,
                }}
                formatter={(value: number) => [
                  metric === 'revenue' ? formatValue(value, 'currency') : value,
                  label(metric),
                ]}
              />
              <Area
                type="monotone"
                dataKey={metric}
                stroke="var(--color-primary)"
                strokeWidth={2}
                fill="url(#activityFill)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <EmptyState
          icon={ScanLine}
          title={t('overview.noActivity')}
          description={t('overview.noActivityBody')}
          action={
            <Button asChild size="sm">
              <Link href="/pos">{t('overview.openPos')}</Link>
            </Button>
          }
        />
      )}
    </section>
  )
}

/**
 * The most valuable panel on the page: turns metrics into the two or three
 * things worth doing right now, each one click from being done.
 */
function NextBestActions({ overview }: { overview: AnalyticsOverview }) {
  const { t, formatPercent } = useI18n()

  const actions: Array<{
    key: string
    icon: React.ComponentType<{ className?: string }>
    title: string
    detail: string
    href: string
    cta: string
    tone: 'default' | 'warning'
  }> = []

  if (overview.customers.lapsed > 0) {
    actions.push({
      key: 'lapsed',
      icon: TrendingDown,
      title: t('overview.actions.lapsedTitle', { count: overview.customers.lapsed }),
      detail: t('overview.actions.lapsedBody'),
      href: '/dashboard/campaigns?template=winback',
      cta: t('overview.actions.lapsedCta'),
      tone: 'warning',
    })
  }

  if (overview.customers.total === 0) {
    actions.push({
      key: 'first-member',
      icon: UserPlus,
      title: t('overview.actions.firstMemberTitle'),
      detail: t('overview.actions.firstMemberBody'),
      href: '/dashboard/settings?tab=signup',
      cta: t('overview.actions.firstMemberCta'),
      tone: 'default',
    })
  } else if (overview.customers.repeat_rate < 30) {
    actions.push({
      key: 'repeat',
      icon: Repeat,
      title: t('overview.actions.repeatTitle', {
        rate: formatPercent(overview.customers.repeat_rate / 100, 0),
      }),
      detail: t('overview.actions.repeatBody'),
      href: '/dashboard/rewards',
      cta: t('overview.actions.repeatCta'),
      tone: 'default',
    })
  }

  if (overview.nps.responses === 0) {
    actions.push({
      key: 'feedback',
      icon: HeartPulse,
      title: t('overview.actions.feedbackTitle'),
      detail: t('overview.actions.feedbackBody'),
      href: '/dashboard/settings?tab=surveys',
      cta: t('overview.actions.feedbackCta'),
      tone: 'default',
    })
  }

  if (actions.length === 0) {
    actions.push({
      key: 'healthy',
      icon: Gift,
      title: t('overview.actions.healthyTitle'),
      detail: t('overview.actions.healthyBody'),
      href: '/dashboard/campaigns',
      cta: t('overview.actions.healthyCta'),
      tone: 'default',
    })
  }

  return (
    <section className="rounded-xl border bg-card p-5">
      <h2 className="text-base font-semibold">{t('overview.doThisNext')}</h2>
      <ul className="mt-4 space-y-3">
        {actions.slice(0, 3).map((action) => (
          <li
            key={action.key}
            className={`rounded-lg border p-3 ${
              action.tone === 'warning' ? 'border-amber-500/40 bg-amber-500/5' : ''
            }`}
          >
            <div className="flex items-start gap-3">
              <action.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium leading-snug">{action.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{action.detail}</p>
                <Button asChild variant="link" size="sm" className="mt-1 h-auto gap-1 p-0 text-xs">
                  <Link href={action.href}>
                    {action.cta}
                    <ArrowRight className="size-3" />
                  </Link>
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

function InsightPreview({ businessId }: { businessId: string }) {
  const { capabilities } = useWorkspace()
  const { t } = useI18n()
  const { data } = useApi<{ insights: Array<{ id: string; title: string; severity: string }> }>(
    capabilities?.ai ? `/api/v1/insights${query({ businessId, limit: 3 })}` : null
  )

  if (!capabilities?.ai) return null
  const insights = data?.insights ?? []
  if (insights.length === 0) return null

  return (
    <section className="rounded-xl border bg-card p-5">
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-primary" />
        <h2 className="text-base font-semibold">{t('overview.aiSpotted')}</h2>
      </div>
      <ul className="mt-3 space-y-2">
        {insights.slice(0, 3).map((insight) => (
          <li key={insight.id} className="flex items-start gap-2 text-sm">
            <Badge
              variant={insight.severity === 'critical' ? 'destructive' : 'secondary'}
              className="mt-0.5 shrink-0 text-[10px]"
            >
              {t(`insights.severity.${insight.severity}` as TranslationKey)}
            </Badge>
            <span className="leading-snug">{insight.title}</span>
          </li>
        ))}
      </ul>
      <Button asChild variant="link" size="sm" className="mt-2 h-auto gap-1 p-0 text-xs">
        <Link href="/dashboard/insights">
          {t('overview.seeAllInsights')}
          <ArrowRight className="size-3" />
        </Link>
      </Button>
    </section>
  )
}

function TopCustomers({ overview }: { overview: AnalyticsOverview }) {
  const { t } = useI18n()
  const formatValue = useFormatValue()

  return (
    <section className="rounded-xl border bg-card p-5">
      <header className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold">{t('overview.bestCustomers')}</h2>
        <Button asChild variant="ghost" size="sm" className="gap-1 text-xs">
          <Link href="/dashboard/customers?sort=spend">
            {t('common.seeAll')}
            <ArrowRight className="size-3" />
          </Link>
        </Button>
      </header>

      {overview.top_customers.length === 0 ? (
        <EmptyState
          icon={Users}
          title={t('overview.noMembers')}
          description={t('overview.noMembersBody')}
        />
      ) : (
        <ul className="divide-y">
          {overview.top_customers.slice(0, 6).map((customer, index) => (
            <li key={customer.id} className="flex items-center gap-3 py-2.5">
              <span className="w-4 text-xs tabular-nums text-muted-foreground">{index + 1}</span>
              <Link
                href={`/dashboard/customers/${customer.id}`}
                className="min-w-0 flex-1 truncate text-sm font-medium hover:underline"
              >
                {customer.name || customer.email}
              </Link>
              {customer.is_vip && (
                <Badge variant="secondary" className="text-[10px]">
                  VIP
                </Badge>
              )}
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {t('overview.visitsCount', { count: customer.visit_count })}
              </span>
              <span className="w-20 shrink-0 text-right text-sm font-medium tabular-nums">
                {formatValue(Number(customer.lifetime_spend), 'currency')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function ProgramHealth({ overview }: { overview: AnalyticsOverview }) {
  const { t, formatNumber, formatPercent } = useI18n()
  const formatValue = useFormatValue()

  const rows = [
    {
      label: t('overview.health.retention'),
      value: formatPercent(overview.customers.retention_rate / 100, 0),
      hint: t('overview.health.retentionHint'),
    },
    {
      label: t('overview.health.churn'),
      value: formatPercent(overview.customers.churn_rate / 100, 0),
      hint: t('overview.health.churnHint'),
    },
    {
      label: t('overview.health.averageTicket'),
      value: formatValue(overview.revenue.average_ticket, 'currency'),
      hint: t('overview.health.averageTicketHint'),
    },
    {
      label: t('overview.health.customerValue'),
      value: formatValue(overview.revenue.average_clv, 'currency'),
      hint: t('overview.health.customerValueHint'),
    },
    {
      label: t('overview.health.rewardsClaimed'),
      value: formatNumber(overview.engagement.redemptions),
      hint: t('overview.health.rewardsClaimedHint'),
    },
    {
      label: t('overview.health.outstanding'),
      value: formatNumber(overview.engagement.balance_outstanding),
      hint: t('overview.health.outstandingHint'),
    },
    {
      label: t('overview.health.nps'),
      value: overview.nps.score === null ? '—' : formatNumber(overview.nps.score),
      hint:
        overview.nps.responses > 0
          ? t('overview.health.npsResponses', { count: overview.nps.responses })
          : t('overview.health.npsNone'),
    },
  ]

  return (
    <section className="rounded-xl border bg-card p-5">
      <h2 className="mb-4 text-base font-semibold">{t('overview.programHealth')}</h2>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
        {rows.map((row) => (
          <div key={row.label}>
            <dt className="text-xs text-muted-foreground">{row.label}</dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums">{row.value}</dd>
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{row.hint}</p>
          </div>
        ))}
      </dl>
    </section>
  )
}
