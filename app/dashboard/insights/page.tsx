'use client'

import * as React from 'react'
import Link from 'next/link'
import { Sparkles, Loader2, X, ArrowRight, TrendingUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useApi, apiPost, apiPatch, query } from '@/lib/client/api'
import { useWorkspace } from '@/lib/client/workspace'
import { AsyncBoundary, EmptyState } from '@/components/states'
import { useFormatValue } from '@/components/metrics'
import { useI18n } from '@/lib/i18n'
import type { TranslationKey } from '@/lib/i18n'

type Insight = {
  id: string
  kind: string
  title: string
  body: string
  severity: 'info' | 'opportunity' | 'warning' | 'critical'
  estimated_impact: number | null
  confidence: number
  action: { type: string; label: string; payload?: Record<string, unknown> } | null
  generated_at: string
}

const SEVERITY_STYLE: Record<Insight['severity'], string> = {
  critical: 'border-destructive/40 bg-destructive/5',
  warning: 'border-amber-500/40 bg-amber-500/5',
  opportunity: 'border-emerald-500/40 bg-emerald-500/5',
  info: '',
}

/**
 * AI insights.
 *
 * Not a chatbot: a prioritised list of specific, quantified things worth doing,
 * each with a one-click route to doing it. A merchant with ten minutes should
 * be able to act on the top item and close the laptop.
 */
export default function InsightsPage() {
  const { businessId, capabilities, can } = useWorkspace()
  const { t, formatDate, formatPercent } = useI18n()
  const formatValue = useFormatValue()
  const [generating, setGenerating] = React.useState(false)

  const { data, error, isLoading, mutate } = useApi<{ insights: Insight[] }>(
    businessId ? `/api/v1/insights${query({ businessId, status: 'new' })}` : null
  )

  async function generate() {
    if (!businessId) return
    setGenerating(true)
    try {
      await apiPost('/api/v1/ai', { action: 'insights', businessId })
      await mutate()
    } finally {
      setGenerating(false)
    }
  }

  async function dismiss(id: string) {
    if (!businessId) return
    await apiPatch('/api/v1/insights', { businessId, id, status: 'dismissed' })
    await mutate()
  }

  if (!capabilities?.ai) {
    return (
      <EmptyState
        icon={Sparkles}
        title={t('insights.notConfigured')}
        description={t('insights.notConfiguredBody')}
      />
    )
  }

  const totalImpact = (data?.insights ?? []).reduce(
    (sum, insight) => sum + (insight.estimated_impact ?? 0),
    0
  )

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{t('insights.title')}</h2>
          <p className="text-sm text-muted-foreground">
            {totalImpact > 0
              ? t('insights.subtitleImpact', { amount: formatValue(totalImpact, 'currency') })
              : t('insights.subtitle')}
          </p>
        </div>
        {can('ai:use') && (
          <Button size="sm" className="gap-2" onClick={() => void generate()} disabled={generating}>
            {generating ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            {t('insights.refresh')}
          </Button>
        )}
      </header>

      <AsyncBoundary
        data={data}
        error={error}
        isLoading={isLoading}
        onRetry={() => void mutate()}
        isEmpty={(value) => value.insights.length === 0}
        empty={
          <EmptyState
            icon={Sparkles}
            title={t('insights.empty')}
            description={t('insights.emptyBody')}
            action={
              can('ai:use') ? (
                <Button size="sm" onClick={() => void generate()} disabled={generating}>
                  {generating ? t('insights.generating') : t('insights.generate')}
                </Button>
              ) : undefined
            }
          />
        }
      >
        {(value) => (
          <ul className="space-y-4">
            {value.insights.map((insight) => {
              const kindKey = `insights.kinds.${insight.kind}` as TranslationKey
              const kindLabel = t(kindKey)
              return (
                <li
                  key={insight.id}
                  className={`rounded-xl border p-5 ${SEVERITY_STYLE[insight.severity]}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          variant={insight.severity === 'critical' ? 'destructive' : 'secondary'}
                        >
                          {t(`insights.severity.${insight.severity}` as 'insights.severity.info')}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {/* A kind we have no copy for is shown as the model
                              produced it, never as a dotted dictionary key. */}
                          {kindLabel === kindKey ? insight.kind.replace(/_/g, ' ') : kindLabel}
                        </span>
                        {insight.estimated_impact !== null && insight.estimated_impact > 0 && (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-500">
                            <TrendingUp className="size-3" />
                            {t('insights.potential', {
                              amount: formatValue(insight.estimated_impact, 'currency'),
                            })}
                          </span>
                        )}
                      </div>

                      <h3 className="mt-2 text-base font-semibold leading-snug">{insight.title}</h3>
                      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                        {insight.body}
                      </p>

                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        {insight.action && insight.action.type !== 'none' && (
                          <Button asChild size="sm" className="gap-1.5">
                            <Link href={actionHref(insight)}>
                              {insight.action.label}
                              <ArrowRight className="size-3.5" />
                            </Link>
                          </Button>
                        )}
                        <span className="text-[11px] text-muted-foreground">
                          {t('insights.confidence', {
                            percent: formatPercent(insight.confidence, 0),
                            date: formatDate(insight.generated_at),
                          })}
                        </span>
                      </div>
                    </div>

                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0"
                      onClick={() => void dismiss(insight.id)}
                      aria-label={t('insights.dismiss')}
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </AsyncBoundary>
    </div>
  )
}

/** Routes an insight's suggested action to the screen that performs it. */
function actionHref(insight: Insight): string {
  switch (insight.action?.type) {
    case 'create_campaign':
      return `/dashboard/campaigns?brief=${encodeURIComponent(insight.title)}`
    case 'create_segment':
      return '/dashboard/customers'
    case 'adjust_rule':
      return '/dashboard/rewards'
    case 'contact_customers':
      return '/dashboard/campaigns'
    default:
      return '/dashboard'
  }
}
