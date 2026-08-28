'use client'

import * as React from 'react'
import { Zap, Loader2, Cake, HeartPulse, Gift, Star, Clock, MessageSquareWarning } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { useApi, apiPatch, query } from '@/lib/client/api'
import { useWorkspace } from '@/lib/client/workspace'
import { AsyncBoundary, EmptyState } from '@/components/states'
import { useFormatValue } from '@/components/metrics'
import { useI18n } from '@/lib/i18n'
import type { TranslationKey } from '@/lib/i18n'

type Automation = {
  id: string
  name: string
  description: string | null
  trigger: string
  is_active: boolean
  delay_minutes: number
  cooldown_days: number
  enrolled_count: number
  completed_count: number
  attributed_revenue: number
  last_30_days: { completed: number; skipped: number }
}

/**
 * Trigger presentation.
 *
 * The icon lives here and the words live in the dictionary, because the icon is
 * the same in every language and the label is not. Keyed by the `trigger` enum
 * the API stores, so an unknown trigger degrades to the raw value rather than a
 * blank row.
 */
const TRIGGER_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  customer_joined: Star,
  birthday: Cake,
  anniversary: Cake,
  inactivity: HeartPulse,
  reward_unlocked: Gift,
  reward_redeemed: Gift,
  balance_expiring: Clock,
  tier_upgraded: Star,
  nps_promoter: Star,
  nps_detractor: MessageSquareWarning,
  visit_recorded: Zap,
  purchase_recorded: Zap,
  referral_qualified: Star,
  membership_renewal: Clock,
}

/**
 * Automations.
 *
 * The compounding part of the product: switched on once, earning money every
 * week with no further effort. Presented as simple on/off cards with real
 * results attached, because a merchant will not maintain a workflow builder.
 */
export default function AutomationsPage() {
  const { businessId, can } = useWorkspace()
  const { t, formatNumber } = useI18n()
  const formatValue = useFormatValue()
  const [pending, setPending] = React.useState<string | null>(null)

  const { data, error, isLoading, mutate } = useApi<{ automations: Automation[] }>(
    businessId ? `/api/v1/automations${query({ businessId })}` : null
  )

  async function toggle(automation: Automation, next: boolean) {
    if (!businessId) return
    setPending(automation.id)
    // Optimistic: the switch must feel instant, and the request is trivial.
    await mutate(
      async (current) => {
        await apiPatch('/api/v1/automations', {
          businessId,
          id: automation.id,
          isActive: next,
        })
        return current
          ? {
              automations: current.automations.map((item) =>
                item.id === automation.id ? { ...item, is_active: next } : item
              ),
            }
          : current
      },
      {
        optimisticData: (current) =>
          current
            ? {
                automations: current.automations.map((item) =>
                  item.id === automation.id ? { ...item, is_active: next } : item
                ),
              }
            : { automations: [] },
        rollbackOnError: true,
        revalidate: false,
      }
    ).finally(() => setPending(null))
  }

  const active = (data?.automations ?? []).filter((automation) => automation.is_active).length

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-xl font-semibold tracking-tight">{t('automations.title')}</h2>
        <p className="text-sm text-muted-foreground">
          {active > 0
            ? t('automations.subtitleActive', { count: active })
            : t('automations.subtitleIdle')}
        </p>
      </header>

      <AsyncBoundary
        data={data}
        error={error}
        isLoading={isLoading}
        onRetry={() => void mutate()}
        isEmpty={(value) => value.automations.length === 0}
        empty={
          <EmptyState
            icon={Zap}
            title={t('automations.empty')}
            description={t('automations.emptyBody')}
          />
        }
      >
        {(value) => (
          <div className="grid gap-4 md:grid-cols-2">
            {value.automations.map((automation) => {
              const Icon = TRIGGER_ICONS[automation.trigger] ?? Zap
              const triggerKey = `automations.triggers.${automation.trigger}` as TranslationKey
              const triggerLabel = t(triggerKey)
              return (
                <article
                  key={automation.id}
                  className={`rounded-xl border bg-card p-4 transition-colors ${
                    automation.is_active ? 'border-primary/30' : ''
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${
                        automation.is_active
                          ? 'bg-primary/10 text-primary'
                          : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      <Icon className="size-4" />
                    </span>

                    <div className="min-w-0 flex-1">
                      <h3 className="font-medium leading-tight">{automation.name}</h3>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {/* An unknown trigger renders its own identifier rather
                            than a dotted key nobody can read. */}
                        {triggerLabel === triggerKey ? automation.trigger : triggerLabel}
                      </p>
                      {automation.description && (
                        <p className="mt-2 text-sm text-muted-foreground">
                          {automation.description}
                        </p>
                      )}
                    </div>

                    {can('automations:write') ? (
                      <div className="shrink-0">
                        {pending === automation.id ? (
                          <Loader2 className="size-5 animate-spin text-muted-foreground" />
                        ) : (
                          <Switch
                            checked={automation.is_active}
                            onCheckedChange={(next) => void toggle(automation, next)}
                            aria-label={t('automations.toggleLabel', { name: automation.name })}
                          />
                        )}
                      </div>
                    ) : (
                      <Badge variant={automation.is_active ? 'secondary' : 'outline'}>
                        {automation.is_active ? t('common.enabled') : t('common.disabled')}
                      </Badge>
                    )}
                  </div>

                  <dl className="mt-4 grid grid-cols-3 gap-3 border-t pt-3 text-center">
                    <div>
                      <dt className="text-[11px] text-muted-foreground">
                        {t('automations.sent30')}
                      </dt>
                      <dd className="text-sm font-semibold tabular-nums">
                        {formatNumber(automation.last_30_days.completed)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-muted-foreground">
                        {t('automations.allTime')}
                      </dt>
                      <dd className="text-sm font-semibold tabular-nums">
                        {formatNumber(automation.completed_count)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-muted-foreground">
                        {t('automations.revenue')}
                      </dt>
                      <dd className="text-sm font-semibold tabular-nums">
                        {formatValue(automation.attributed_revenue, 'currency')}
                      </dd>
                    </div>
                  </dl>

                  {automation.last_30_days.skipped > 0 && (
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      {t('automations.skipped', { count: automation.last_30_days.skipped })}
                    </p>
                  )}
                </article>
              )
            })}
          </div>
        )}
      </AsyncBoundary>
    </div>
  )
}
