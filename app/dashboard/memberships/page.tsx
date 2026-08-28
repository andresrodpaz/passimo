'use client'

import * as React from 'react'
import Link from 'next/link'
import {
  Archive,
  BadgeEuro,
  Crown,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  TrendingUp,
  Users,
} from 'lucide-react'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useApi, apiPost, apiFetch, query } from '@/lib/client/api'
import { useWorkspace } from '@/lib/client/workspace'
import { AsyncBoundary, EmptyState } from '@/components/states'
import { MetricGrid, MetricTile, useFormatValue } from '@/components/metrics'
import { FeatureGate, UpgradePrompt } from '@/components/billing/upgrade'
import { toastError } from '@/lib/client/api-errors'
import { useI18n } from '@/lib/i18n'
import { displayName } from '@/lib/domain/types'

type Plan = {
  id: string
  name: string
  description: string | null
  price: number
  currency: string
  interval: 'month' | 'year'
  includedBalance: number
  earnMultiplier: number
  perks: string[]
  trialDays: number
  maxMembers: number | null
  memberCount: number
  isActive: boolean
  isPublic: boolean
}

type Stats = {
  active_members: number
  cancelled_members: number
  mrr: number
  lifetime_revenue: number
  churn_rate: number
  renewing_30d: number
}

type Member = {
  id: string
  customer_id: string
  status: string
  started_at: string
  current_period_end: string | null
  cancel_at_period_end: boolean
  periods_billed: number
  lifetime_value: number
  customers: {
    id: string
    name: string | null
    first_name: string | null
    last_name: string | null
    email: string
  } | null
  membership_plans: { name: string; price: number; currency: string; interval: string } | null
}

type Response = {
  plans: Plan[]
  stats: Stats
  members?: Member[]
  member_total?: number
}

/**
 * Memberships.
 *
 * The screen is built around MRR rather than member count, because "€1,240 a
 * month before anyone walks in" is the sentence that makes a café owner
 * understand what they have just built. Member count is a vanity number by
 * comparison — ten members at €49 beats ninety at €4.
 */
export default function MembershipsPage() {
  return (
    <FeatureGate
      feature="memberships"
      fallback={
        <div className="space-y-6">
          <Header />
          <MembershipUpsell />
        </div>
      }
    >
      <MembershipsView />
    </FeatureGate>
  )
}

function Header({ action }: { action?: React.ReactNode }) {
  const { t } = useI18n()
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">{t('memberships.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('memberships.subtitle')}</p>
      </div>
      {action}
    </header>
  )
}

function MembershipUpsell() {
  const { t } = useI18n()

  const reasons = [
    {
      key: 'predictable',
      title: t('memberships.predictableTitle'),
      body: t('memberships.predictableBody'),
    },
    {
      key: 'frequency',
      title: t('memberships.frequencyTitle'),
      body: t('memberships.frequencyBody'),
    },
    { key: 'price', title: t('memberships.priceTitle'), body: t('memberships.priceBody') },
  ]

  return (
    <div className="space-y-4">
      <section className="rounded-xl border bg-card p-6">
        <h3 className="text-base font-semibold">{t('memberships.whatItDoes')}</h3>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          {t('memberships.whatItDoesBody')}
        </p>
        <dl className="mt-5 grid gap-3 sm:grid-cols-3">
          {reasons.map((item) => (
            <div key={item.key} className="rounded-lg border bg-muted/30 p-4">
              <dt className="text-sm font-medium">{item.title}</dt>
              <dd className="mt-1 text-xs text-muted-foreground">{item.body}</dd>
            </div>
          ))}
        </dl>
      </section>
      <UpgradePrompt
        feature="memberships"
        title={t('memberships.upsellTitle')}
        description={t('memberships.upsellBody')}
      />
    </div>
  )
}

function MembershipsView() {
  const { businessId, can } = useWorkspace()
  const { t, formatNumber } = useI18n()
  const formatValue = useFormatValue()
  const [editing, setEditing] = React.useState<Plan | 'new' | null>(null)

  const key = businessId
    ? `/api/v1/memberships${query({ businessId, includeInactive: 'true', withMembers: 'true' })}`
    : null
  const data = useApi<Response>(key)

  async function archivePlan(planId: string) {
    if (!businessId) return
    await apiFetch('/api/v1/memberships', {
      method: 'DELETE',
      body: JSON.stringify({ businessId, planId }),
    })
    void data.mutate()
  }

  return (
    <div className="space-y-6">
      <Header
        action={
          can('programs:write') && (
            <Button size="sm" className="gap-2" onClick={() => setEditing('new')}>
              <Plus className="size-4" />
              {t('memberships.newMembership')}
            </Button>
          )
        }
      />

      {data.data && (
        <MetricGrid>
          <MetricTile
            label={t('memberships.mrr')}
            value={formatValue(data.data.stats.mrr, 'currency')}
            icon={TrendingUp}
            hint={t('memberships.mrrHint')}
          />
          <MetricTile
            label={t('memberships.activeMembers')}
            value={formatNumber(data.data.stats.active_members)}
            icon={Users}
          />
          <MetricTile
            label={t('memberships.renewing30')}
            value={formatNumber(data.data.stats.renewing_30d)}
            icon={RefreshCw}
            hint={t('memberships.renewing30Hint')}
          />
          <MetricTile
            label={t('memberships.lifetimeRevenue')}
            value={formatValue(data.data.stats.lifetime_revenue, 'currency')}
            icon={BadgeEuro}
            hint={t('memberships.lifetimeRevenueHint')}
          />
        </MetricGrid>
      )}

      <Tabs defaultValue="plans">
        <TabsList>
          <TabsTrigger value="plans">{t('memberships.tabPlans')}</TabsTrigger>
          <TabsTrigger value="members">
            {t('memberships.tabMembers')}
            {data.data?.member_total ? ` (${formatNumber(data.data.member_total)})` : ''}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="plans" className="mt-4">
          <AsyncBoundary
            data={data.data}
            error={data.error}
            isLoading={data.isLoading}
            onRetry={() => void data.mutate()}
            isEmpty={(value) => value.plans.length === 0}
            empty={
              <EmptyState
                icon={Crown}
                title={t('memberships.empty')}
                description={t('memberships.emptyBody')}
                action={
                  can('programs:write') ? (
                    <Button size="sm" onClick={() => setEditing('new')}>
                      {t('memberships.emptyCta')}
                    </Button>
                  ) : undefined
                }
              />
            }
          >
            {(value) => (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {value.plans.map((plan) => (
                  <PlanCard
                    key={plan.id}
                    plan={plan}
                    canEdit={can('programs:write')}
                    onEdit={() => setEditing(plan)}
                    onArchive={() => void archivePlan(plan.id)}
                  />
                ))}
              </div>
            )}
          </AsyncBoundary>
        </TabsContent>

        <TabsContent value="members" className="mt-4">
          <AsyncBoundary
            data={data.data}
            error={data.error}
            isLoading={data.isLoading}
            onRetry={() => void data.mutate()}
            isEmpty={(value) => (value.members ?? []).length === 0}
            empty={
              <EmptyState
                icon={Users}
                title={t('memberships.noMembers')}
                description={t('memberships.noMembersBody')}
              />
            }
          >
            {(value) => <MemberTable members={value.members ?? []} />}
          </AsyncBoundary>
        </TabsContent>
      </Tabs>

      <Sheet open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          {editing !== null && (
            <PlanForm
              key={editing === 'new' ? 'new' : editing.id}
              businessId={businessId}
              plan={editing}
              onSaved={() => {
                setEditing(null)
                void data.mutate()
              }}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}

function PlanCard({
  plan,
  canEdit,
  onEdit,
  onArchive,
}: {
  plan: Plan
  canEdit: boolean
  onEdit: () => void
  onArchive: () => void
}) {
  const { t, formatNumber } = useI18n()
  const formatValue = useFormatValue()
  const monthly = plan.interval === 'year' ? plan.price / 12 : plan.price

  return (
    <article className={`rounded-xl border bg-card p-5 ${plan.isActive ? '' : 'opacity-60'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate font-medium">{plan.name}</h3>
          <p className="mt-0.5 flex items-baseline gap-1">
            <span className="text-2xl font-semibold tabular-nums">
              {formatValue(plan.price, 'currency', plan.currency)}
            </span>
            <span className="text-xs text-muted-foreground">
              {plan.interval === 'year' ? t('memberships.perYear') : t('memberships.perMonth')}
            </span>
          </p>
        </div>
        {canEdit && (
          <div className="flex shrink-0 gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={onEdit}
              aria-label={t('memberships.editLabel', { name: plan.name })}
            >
              <Pencil className="size-3.5" />
            </Button>
            {plan.isActive && (
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={onArchive}
                aria-label={t('memberships.archiveLabel', { name: plan.name })}
                title={t('memberships.archivePlan')}
              >
                <Archive className="size-3.5" />
              </Button>
            )}
          </div>
        )}
      </div>

      {plan.description && (
        <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{plan.description}</p>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5">
        {!plan.isActive && <Badge variant="outline">{t('common.archived')}</Badge>}
        {plan.earnMultiplier > 1 && (
          <Badge variant="secondary">
            {t('memberships.multiplier', { value: plan.earnMultiplier })}
          </Badge>
        )}
        {plan.includedBalance > 0 && (
          <Badge variant="secondary">
            {t('memberships.includedBalance', { count: plan.includedBalance })}
          </Badge>
        )}
        {plan.trialDays > 0 && (
          <Badge variant="outline">{t('memberships.trialDays', { count: plan.trialDays })}</Badge>
        )}
        {!plan.isPublic && <Badge variant="outline">{t('memberships.inviteOnly')}</Badge>}
      </div>

      {plan.perks.length > 0 && (
        <ul className="mt-3 space-y-1">
          {plan.perks.slice(0, 3).map((perk) => (
            <li key={perk} className="text-xs text-muted-foreground">
              · {perk}
            </li>
          ))}
        </ul>
      )}

      <dl className="mt-4 flex items-center justify-between border-t pt-3 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">{t('memberships.members')}</dt>
          <dd className="font-semibold tabular-nums">
            {formatNumber(plan.memberCount)}
            {plan.maxMembers ? ` / ${formatNumber(plan.maxMembers)}` : ''}
          </dd>
        </div>
        <div className="text-right">
          <dt className="text-xs text-muted-foreground">{t('memberships.contributing')}</dt>
          <dd className="font-semibold tabular-nums">
            {formatValue(monthly * plan.memberCount, 'currency', plan.currency)}
            {t('memberships.perMonthShort')}
          </dd>
        </div>
      </dl>
    </article>
  )
}

function MemberTable({ members }: { members: Member[] }) {
  const { t, formatDate } = useI18n()
  const formatValue = useFormatValue()

  return (
    <div className="overflow-hidden rounded-xl border">
      <table className="w-full text-sm">
        <caption className="sr-only">{t('memberships.tableCaption')}</caption>
        <thead className="bg-muted/50 text-left">
          <tr>
            <th scope="col" className="px-4 py-2.5 font-medium">
              {t('memberships.columns.member')}
            </th>
            <th scope="col" className="hidden px-4 py-2.5 font-medium sm:table-cell">
              {t('memberships.columns.plan')}
            </th>
            <th scope="col" className="px-4 py-2.5 font-medium">
              {t('memberships.columns.status')}
            </th>
            <th scope="col" className="hidden px-4 py-2.5 font-medium md:table-cell">
              {t('memberships.columns.renews')}
            </th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">
              {t('memberships.columns.paidSoFar')}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {members.map((member) => (
            <tr key={member.id} className="hover:bg-muted/30">
              <td className="px-4 py-3">
                {member.customers ? (
                  <Link
                    href={`/dashboard/customers/${member.customers.id}`}
                    className="font-medium hover:underline"
                  >
                    {displayName(member.customers)}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">{t('memberships.removedCustomer')}</span>
                )}
                {member.customers?.email && (
                  <span className="block truncate text-xs text-muted-foreground">
                    {member.customers.email}
                  </span>
                )}
              </td>
              <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">
                {member.membership_plans?.name ?? '—'}
              </td>
              <td className="px-4 py-3">
                {member.cancel_at_period_end && member.status === 'active' ? (
                  <Badge variant="outline">{t('memberships.ending')}</Badge>
                ) : member.status === 'active' ? (
                  <Badge variant="secondary">{t('memberships.active')}</Badge>
                ) : (
                  <Badge variant="outline">{member.status}</Badge>
                )}
              </td>
              <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">
                {member.current_period_end
                  ? formatDate(member.current_period_end, { day: 'numeric', month: 'short' })
                  : '—'}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                {formatValue(
                  member.lifetime_value,
                  'currency',
                  member.membership_plans?.currency ?? 'EUR'
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PlanForm({
  businessId,
  plan,
  onSaved,
}: {
  businessId: string | null
  plan: Plan | 'new'
  onSaved: () => void
}) {
  const { t } = useI18n()
  const formatValue = useFormatValue()
  const isNew = plan === 'new'
  const existing = plan !== 'new' ? plan : null

  const [name, setName] = React.useState(existing?.name ?? '')
  const [description, setDescription] = React.useState(existing?.description ?? '')
  const [price, setPrice] = React.useState(String(existing?.price ?? 19))
  const [interval, setInterval] = React.useState<'month' | 'year'>(existing?.interval ?? 'month')
  const [includedBalance, setIncludedBalance] = React.useState(
    String(existing?.includedBalance ?? 0)
  )
  const [multiplier, setMultiplier] = React.useState(String(existing?.earnMultiplier ?? 2))
  const [perks, setPerks] = React.useState((existing?.perks ?? []).join('\n'))
  const [maxMembers, setMaxMembers] = React.useState(
    existing?.maxMembers ? String(existing.maxMembers) : ''
  )
  const [isActive, setIsActive] = React.useState(existing?.isActive ?? true)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function save() {
    if (!businessId) return
    setBusy(true)
    setError(null)
    try {
      await apiPost('/api/v1/memberships', {
        businessId,
        id: existing?.id ?? null,
        name: name.trim(),
        description: description.trim() || null,
        price: Number(price) || 0,
        interval,
        includedBalance: Number(includedBalance) || 0,
        earnMultiplier: Number(multiplier) || 1,
        perks: perks
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .slice(0, 10),
        maxMembers: maxMembers ? Number(maxMembers) : null,
        isActive,
      })
      onSaved()
    } catch (cause) {
      setError(toastError(cause, t, 'common.couldNotSave'))
    } finally {
      setBusy(false)
    }
  }

  const monthly = interval === 'year' ? (Number(price) || 0) / 12 : Number(price) || 0

  return (
    <>
      <SheetHeader>
        <SheetTitle>
          {isNew ? t('memberships.newMembership') : t('memberships.editMembership')}
        </SheetTitle>
        <SheetDescription>{t('memberships.formSubtitle')}</SheetDescription>
      </SheetHeader>

      <div className="mt-6 space-y-5 px-4 pb-8">
        {error && (
          <div role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="plan-name">{t('memberships.name')}</Label>
          <Input
            id="plan-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('memberships.namePlaceholder')}
            className="h-11"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="plan-description">{t('memberships.description')}</Label>
          <Textarea
            id="plan-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={t('memberships.descriptionPlaceholder')}
            rows={2}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="plan-price">{t('memberships.price')}</Label>
            <Input
              id="plan-price"
              type="number"
              min={0}
              step="0.01"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              className="h-11"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="plan-interval">{t('memberships.billed')}</Label>
            <select
              id="plan-interval"
              value={interval}
              onChange={(event) => setInterval(event.target.value as 'month' | 'year')}
              className="h-11 w-full rounded-md border bg-background px-3 text-sm"
            >
              <option value="month">{t('memberships.monthly')}</option>
              <option value="year">{t('memberships.yearly')}</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="plan-balance">{t('memberships.pointsEachPeriod')}</Label>
            <Input
              id="plan-balance"
              type="number"
              min={0}
              value={includedBalance}
              onChange={(event) => setIncludedBalance(event.target.value)}
              className="h-11"
            />
            <p className="text-xs text-muted-foreground">
              {t('memberships.pointsEachPeriodHint')}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="plan-multiplier">{t('memberships.earnMultiplier')}</Label>
            <Input
              id="plan-multiplier"
              type="number"
              min={1}
              max={10}
              step="0.5"
              value={multiplier}
              onChange={(event) => setMultiplier(event.target.value)}
              className="h-11"
            />
            <p className="text-xs text-muted-foreground">{t('memberships.earnMultiplierHint')}</p>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="plan-perks">{t('memberships.perks')}</Label>
          <Textarea
            id="plan-perks"
            value={perks}
            onChange={(event) => setPerks(event.target.value)}
            placeholder={t('memberships.perksPlaceholder')}
            rows={4}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="plan-max">
            {t('memberships.memberCap')} ({t('common.optional').toLocaleLowerCase(t.tag)})
          </Label>
          <Input
            id="plan-max"
            type="number"
            min={1}
            value={maxMembers}
            onChange={(event) => setMaxMembers(event.target.value)}
            placeholder={t('memberships.memberCapPlaceholder')}
            className="h-11"
          />
          <p className="text-xs text-muted-foreground">{t('memberships.memberCapHint')}</p>
        </div>

        <div className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <Label htmlFor="plan-active">{t('memberships.acceptingMembers')}</Label>
            <p className="text-xs text-muted-foreground">{t('memberships.acceptingMembersHint')}</p>
          </div>
          <Switch id="plan-active" checked={isActive} onCheckedChange={setIsActive} />
        </div>

        {monthly > 0 && (
          <p className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
            {t('memberships.projection', {
              monthly: formatValue(monthly, 'currency'),
              total: formatValue(monthly * 50, 'currency'),
            })}
          </p>
        )}

        <Button
          className="h-11 w-full gap-2"
          disabled={busy || !name.trim()}
          onClick={() => void save()}
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          {isNew ? t('memberships.createCta') : t('common.saveChanges')}
        </Button>
      </div>
    </>
  )
}
