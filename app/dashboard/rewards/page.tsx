'use client'

import * as React from 'react'
import { Gift, Plus, Loader2, Sparkles, AlertTriangle, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useApi, apiPost, apiPatch, query } from '@/lib/client/api'
import { useWorkspace } from '@/lib/client/workspace'
import { AsyncBoundary, EmptyState } from '@/components/states'
import { Meter } from '@/components/metrics'
import { useI18n } from '@/lib/i18n'
import { toastError } from '@/lib/client/api-errors'

type Reward = {
  id: string
  name: string
  description: string | null
  cost: number
  type: string
  is_active: boolean
  stock: number | null
  redeemed_count: number
  auto_grant_trigger: string | null
  never_redeemed: boolean
  valid_days: number
}

type Program = {
  id: string
  name: string
  type: string
  unit_plural: string
  goal_amount: number | null
  members: number
  outstanding_balance: number
  is_default: boolean
}

type Optimization = {
  verdict: 'too_easy' | 'well_balanced' | 'too_hard'
  summary: string
  recommendations: Array<{ change: string; rationale: string; expected_effect: string }>
}

/**
 * Rewards and program configuration.
 *
 * Combined on purpose: the reward and the effort required to earn it are one
 * decision, and splitting them across two screens is how merchants end up with
 * a 20-stamp card nobody finishes.
 */
export default function RewardsPage() {
  const { businessId, can, capabilities } = useWorkspace()
  const { t, formatNumber } = useI18n()
  const [editing, setEditing] = React.useState<Reward | 'new' | null>(null)
  const [optimizing, setOptimizing] = React.useState(false)
  const [optimization, setOptimization] = React.useState<Optimization | null>(null)

  const rewardsKey = businessId
    ? `/api/v1/rewards${query({ businessId, includeInactive: 'true' })}`
    : null
  const programsKey = businessId ? `/api/v1/programs${query({ businessId })}` : null

  const rewards = useApi<{ rewards: Reward[] }>(rewardsKey)
  const programs = useApi<{ programs: Program[] }>(programsKey)

  const defaultProgram = programs.data?.programs.find((program) => program.is_default)
  const unitPlural = defaultProgram?.unit_plural ?? t('rewards.defaultUnit')

  async function runOptimizer() {
    if (!businessId) return
    setOptimizing(true)
    try {
      const response = await apiPost<{ optimization: Optimization }>('/api/v1/ai', {
        action: 'optimize_program',
        businessId,
      })
      setOptimization(response.optimization)
    } finally {
      setOptimizing(false)
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{t('rewards.title')}</h2>
          <p className="text-sm text-muted-foreground">{t('rewards.subtitle')}</p>
        </div>
        {can('programs:write') && (
          <Button size="sm" className="gap-2" onClick={() => setEditing('new')}>
            <Plus className="size-4" />
            {t('rewards.newReward')}
          </Button>
        )}
      </header>

      {defaultProgram && (
        <section className="rounded-xl border bg-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 className="text-base font-semibold">{defaultProgram.name}</h3>
              <p className="text-sm text-muted-foreground">
                {defaultProgram.goal_amount
                  ? t('rewards.goalLine', {
                      goal: defaultProgram.goal_amount,
                      unit: defaultProgram.unit_plural,
                    })
                  : t('rewards.openEnded', { unit: defaultProgram.unit_plural })}
              </p>
            </div>
            {capabilities?.ai && can('ai:use') && (
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => void runOptimizer()}
                disabled={optimizing}
              >
                {optimizing ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Sparkles className="size-4" />
                )}
                {t('rewards.optimise')}
              </Button>
            )}
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">{t('rewards.members')}</dt>
              <dd className="text-lg font-semibold tabular-nums">
                {formatNumber(defaultProgram.members)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t('rewards.outstanding')}</dt>
              <dd className="text-lg font-semibold tabular-nums">
                {formatNumber(Math.round(defaultProgram.outstanding_balance))}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t('rewards.activeRewards')}</dt>
              <dd className="text-lg font-semibold tabular-nums">
                {formatNumber(
                  (rewards.data?.rewards ?? []).filter((reward) => reward.is_active).length
                )}
              </dd>
            </div>
          </dl>

          {optimization && (
            <div className="mt-5 rounded-lg border bg-muted/40 p-4">
              <div className="flex items-center gap-2">
                <Badge
                  variant={optimization.verdict === 'well_balanced' ? 'secondary' : 'destructive'}
                >
                  {t(`rewards.verdict.${optimization.verdict}` as 'rewards.verdict.too_easy')}
                </Badge>
                <span className="text-sm font-medium">{t('rewards.aiAssessment')}</span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{optimization.summary}</p>
              <ul className="mt-3 space-y-2">
                {optimization.recommendations.map((recommendation) => (
                  <li key={recommendation.change} className="text-sm">
                    <p className="font-medium">{recommendation.change}</p>
                    <p className="text-xs text-muted-foreground">{recommendation.rationale}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <AsyncBoundary
        data={rewards.data}
        error={rewards.error}
        isLoading={rewards.isLoading}
        onRetry={() => void rewards.mutate()}
        isEmpty={(value) => value.rewards.length === 0}
        empty={
          <EmptyState
            icon={Gift}
            title={t('rewards.empty')}
            description={t('rewards.emptyBody')}
            action={
              can('programs:write') ? (
                <Button size="sm" onClick={() => setEditing('new')}>
                  {t('rewards.emptyCta')}
                </Button>
              ) : undefined
            }
          />
        }
      >
        {(value) => (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {value.rewards.map((reward) => (
              <article
                key={reward.id}
                className={`rounded-xl border bg-card p-4 ${reward.is_active ? '' : 'opacity-60'}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate font-medium">{reward.name}</h3>
                    {reward.description && (
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                        {reward.description}
                      </p>
                    )}
                  </div>
                  {can('programs:write') && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0"
                      onClick={() => setEditing(reward)}
                      aria-label={t('rewards.editLabel', { name: reward.name })}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                  )}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {reward.auto_grant_trigger ? (
                    <Badge variant="secondary">
                      {t('rewards.auto', { trigger: reward.auto_grant_trigger })}
                    </Badge>
                  ) : (
                    <Badge variant="outline">
                      {t('rewards.costLabel', { cost: reward.cost, unit: unitPlural })}
                    </Badge>
                  )}
                  {!reward.is_active && <Badge variant="outline">{t('common.paused')}</Badge>}
                  {reward.stock !== null && (
                    <Badge variant={reward.stock > 0 ? 'outline' : 'destructive'}>
                      {t('rewards.stockLeft', { count: reward.stock })}
                    </Badge>
                  )}
                </div>

                <p className="mt-3 text-xs text-muted-foreground">
                  {reward.redeemed_count > 0
                    ? t('rewards.claimed', { count: reward.redeemed_count })
                    : t('rewards.neverClaimed')}
                </p>

                {reward.never_redeemed && reward.is_active && !reward.auto_grant_trigger && (
                  <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-500">
                    <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                    {t('rewards.nobodyClaimed')}
                  </p>
                )}
              </article>
            ))}
          </div>
        )}
      </AsyncBoundary>

      <Sheet open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          {editing !== null && (
            /* Keyed so opening a different reward remounts the form with fresh
               initial state instead of syncing props into state in an effect. */
            <RewardForm
              key={editing === 'new' ? 'new' : editing.id}
              businessId={businessId}
              programId={defaultProgram?.id ?? null}
              unitPlural={unitPlural}
              goal={defaultProgram?.goal_amount ?? null}
              reward={editing}
              onSaved={() => {
                setEditing(null)
                void rewards.mutate()
              }}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}

function RewardForm({
  businessId,
  programId,
  unitPlural,
  goal,
  reward,
  onSaved,
}: {
  businessId: string | null
  programId: string | null
  unitPlural: string
  goal: number | null
  reward: Reward | 'new'
  onSaved: () => void
}) {
  const { t } = useI18n()
  const isNew = reward === 'new'
  const existing = reward !== 'new' ? reward : null

  const [name, setName] = React.useState(existing?.name ?? '')
  const [description, setDescription] = React.useState(existing?.description ?? '')
  const [cost, setCost] = React.useState(String(existing?.cost ?? goal ?? 10))
  const [active, setActive] = React.useState(existing?.is_active ?? true)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function save() {
    if (!businessId) return
    setBusy(true)
    setError(null)
    try {
      const payload = {
        businessId,
        programId,
        name: name.trim(),
        description: description.trim() || null,
        cost: Number(cost) || 0,
        isActive: active,
      }
      if (isNew) await apiPost('/api/v1/rewards', payload)
      else await apiPatch('/api/v1/rewards', { ...payload, id: existing!.id })
      onSaved()
    } catch (cause) {
      setError(toastError(cause, t, 'common.couldNotSave'))
    } finally {
      setBusy(false)
    }
  }

  const costNumber = Number(cost) || 0

  return (
    <>
      <SheetHeader>
        <SheetTitle>{isNew ? t('rewards.newReward') : t('rewards.editReward')}</SheetTitle>
        <SheetDescription>{t('rewards.formSubtitle')}</SheetDescription>
      </SheetHeader>

      <div className="mt-6 space-y-4 px-4 pb-8">
        {error && (
          <div role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="reward-name">{t('rewards.name')}</Label>
          <Input
            id="reward-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('rewards.namePlaceholder')}
            className="h-11"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="reward-description">
            {t('rewards.description')} ({t('common.optional').toLocaleLowerCase(t.tag)})
          </Label>
          <Textarea
            id="reward-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={t('rewards.descriptionPlaceholder')}
            rows={2}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="reward-cost">{t('rewards.cost', { unit: unitPlural })}</Label>
          <Input
            id="reward-cost"
            type="number"
            min={0}
            value={cost}
            onChange={(event) => setCost(event.target.value)}
            className="h-11"
          />
          <p className="text-xs text-muted-foreground">
            {t('rewards.costHint', {
              cost: costNumber,
              unit: unitPlural,
              weeks: costNumber > 0 ? Math.ceil(costNumber) : 0,
            })}
          </p>
          {goal ? <Meter value={Math.min(costNumber, goal)} max={goal} className="pt-1" /> : null}
        </div>

        <div className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <Label htmlFor="reward-active">{t('rewards.availableLabel')}</Label>
            <p className="text-xs text-muted-foreground">{t('rewards.availableHint')}</p>
          </div>
          <Switch id="reward-active" checked={active} onCheckedChange={setActive} />
        </div>

        <Button
          className="h-11 w-full gap-2"
          disabled={busy || !name.trim()}
          onClick={() => void save()}
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          {isNew ? t('rewards.createCta') : t('common.saveChanges')}
        </Button>
      </div>
    </>
  )
}
