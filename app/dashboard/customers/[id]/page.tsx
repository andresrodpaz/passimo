'use client'

import * as React from 'react'
import { use } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  Star,
  Gift,
  Sparkles,
  Loader2,
  Plus,
  Mail,
  Phone,
  Cake,
  ShieldCheck,
  ShieldOff,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { useApi, apiPost, apiPatch, apiFetch, query } from '@/lib/client/api'
import { useWorkspace } from '@/lib/client/workspace'
import { AsyncBoundary } from '@/components/states'
import { Meter, useFormatValue } from '@/components/metrics'
import { toastError } from '@/lib/client/api-errors'
import { isPlaceholderEmail } from '@/lib/customers/placeholder-email'
import { useI18n } from '@/lib/i18n'
import type { TranslationKey } from '@/lib/i18n'
import type { CustomerListItem } from '@/lib/customers/service'

type Profile = {
  customer: CustomerListItem
  activity: Array<{
    id: string
    type: string
    amount: number | null
    source: string
    occurred_at: string
    metadata: Record<string, unknown>
  }>
  ledger: Array<{
    id: string
    entry_type: string
    amount: number
    balance_after: number
    reason: string | null
    created_at: string
  }>
  redemptions: Array<{
    id: string
    code: string
    status: string
    created_at: string
    rewards: { name: string } | null
  }>
  notes: Array<{ id: string; body: string; author_name: string | null; created_at: string }>
  messages: Array<{
    id: string
    channel: string
    subject: string | null
    status: string
    sent_at: string | null
    skip_reason: string | null
  }>
  memberships: Array<{
    id: string
    status: string
    current_period_end: string | null
    cancel_at_period_end: boolean
    periods_billed: number
    lifetime_value: number
    membership_plans: {
      id: string
      name: string
      price: number
      currency: string
      interval: string
      earn_multiplier: number
    } | null
  }>
  loyalty: {
    programs: Array<{
      programId: string
      programName: string
      unitPlural: string
      balance: number
      goalAmount: number | null
      rewardAvailable: boolean
      tier: { name: string } | null
    }>
    availableRewards: Array<{ id: string; name: string; cost: number; affordable: boolean }>
  }
}

/**
 * Customer profile.
 *
 * Everything staff need before they say hello, and everything a manager needs
 * to decide what to do about this person — history, value, consent state and a
 * one-tap path to rewarding them.
 */
export default function CustomerProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { businessId, can } = useWorkspace()
  const { t } = useI18n()

  const { data, error, isLoading, mutate } = useApi<Profile>(
    businessId ? `/api/v1/customers/${id}${query({ businessId })}` : null
  )

  return (
    <div className="space-y-5">
      <Button asChild variant="ghost" size="sm" className="-ml-2 gap-1.5">
        <Link href="/dashboard/customers">
          <ArrowLeft className="size-4" />
          {t('customers.profile.back')}
        </Link>
      </Button>

      <AsyncBoundary data={data} error={error} isLoading={isLoading} onRetry={() => void mutate()}>
        {(profile) => (
          <div className="grid gap-5 lg:grid-cols-3">
            <div className="space-y-5 lg:col-span-2">
              <Header profile={profile} businessId={businessId!} onChange={() => void mutate()} />
              <AiSummary businessId={businessId!} customerId={id} />
              <Timeline profile={profile} />
            </div>

            <div className="space-y-5">
              <LoyaltyPanel profile={profile} />
              <MembershipPanel
                profile={profile}
                businessId={businessId!}
                customerId={id}
                editable={can('customers:write')}
                onChange={() => void mutate()}
              />
              <ConsentPanel
                profile={profile}
                businessId={businessId!}
                editable={can('customers:write')}
                onChange={() => void mutate()}
              />
              <NotesPanel
                profile={profile}
                businessId={businessId!}
                customerId={id}
                editable={can('customers:write')}
                onChange={() => void mutate()}
              />
            </div>
          </div>
        )}
      </AsyncBoundary>
    </div>
  )
}

function Header({
  profile,
  businessId,
  onChange,
}: {
  profile: Profile
  businessId: string
  onChange: () => void
}) {
  const { can } = useWorkspace()
  const { t, formatDate, formatNumber, formatPercent } = useI18n()
  const formatValue = useFormatValue()
  const customer = profile.customer
  const [busy, setBusy] = React.useState(false)

  async function toggleVip() {
    setBusy(true)
    try {
      await apiPatch(`/api/v1/customers/${customer.id}`, {
        businessId,
        isVip: !customer.isVip,
      })
      onChange()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-xl border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-base font-semibold uppercase text-primary">
            {(customer.name ?? customer.email).slice(0, 2)}
          </span>
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              {customer.name || customer.email.split('@')[0]}
              {customer.isVip && <Star className="size-4 fill-amber-400 text-amber-400" />}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t('customers.profile.memberSince', { date: formatDate(customer.createdAt) })}
            </p>
          </div>
        </div>

        {can('customers:write') && (
          <Button variant="outline" size="sm" onClick={() => void toggleVip()} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Star className="size-4" />}
            {customer.isVip ? t('customers.profile.removeVip') : t('customers.profile.markVip')}
          </Button>
        )}
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted-foreground">{t('customers.profile.visits')}</dt>
          <dd className="text-lg font-semibold tabular-nums">
            {formatNumber(customer.visitCount)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t('customers.profile.totalSpend')}</dt>
          <dd className="text-lg font-semibold tabular-nums">
            {formatValue(customer.lifetimeSpend, 'currency')}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t('customers.profile.averageTicket')}</dt>
          <dd className="text-lg font-semibold tabular-nums">
            {formatValue(customer.averageTicket, 'currency')}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t('customers.profile.churnRisk')}</dt>
          <dd
            className={`text-lg font-semibold tabular-nums ${
              (customer.churnRisk ?? 0) > 0.6 ? 'text-destructive' : ''
            }`}
          >
            {customer.churnRisk === null ? '—' : formatPercent(customer.churnRisk, 0)}
          </dd>
        </div>
      </dl>

      <div className="mt-4 flex flex-wrap gap-3 border-t pt-4 text-sm text-muted-foreground">
        {!isPlaceholderEmail(customer.email) && (
          <span className="inline-flex items-center gap-1.5">
            <Mail className="size-3.5" />
            {customer.email}
          </span>
        )}
        {customer.phone && (
          <span className="inline-flex items-center gap-1.5">
            <Phone className="size-3.5" />
            {customer.phone}
          </span>
        )}
        {customer.birthday && (
          <span className="inline-flex items-center gap-1.5">
            <Cake className="size-3.5" />
            {formatDate(customer.birthday, { day: 'numeric', month: 'long' })}
          </span>
        )}
      </div>

      {customer.tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {customer.tags.map((tag) => (
            <Badge key={tag.id} variant="secondary" style={{ borderColor: tag.color }}>
              {tag.name}
            </Badge>
          ))}
        </div>
      )}
    </section>
  )
}

function AiSummary({ businessId, customerId }: { businessId: string; customerId: string }) {
  const { capabilities, can } = useWorkspace()
  const { t } = useI18n()
  const [summary, setSummary] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  if (!capabilities?.ai || !can('ai:use')) return null

  async function load() {
    setBusy(true)
    try {
      const response = await apiPost<{ summary: string }>('/api/v1/ai', {
        action: 'customer_summary',
        businessId,
        customerId,
      })
      setSummary(response.summary || t('customers.profile.summaryEmpty'))
    } catch {
      setSummary(t('customers.profile.summaryFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-xl border bg-card p-4">
      {summary ? (
        <p className="text-sm leading-relaxed">{summary}</p>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          className="gap-2"
          onClick={() => void load()}
          disabled={busy}
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          {t('customers.profile.summarise')}
        </Button>
      )}
    </section>
  )
}

function LoyaltyPanel({ profile }: { profile: Profile }) {
  const { t, formatNumber } = useI18n()

  return (
    <section className="rounded-xl border bg-card p-5">
      <h3 className="text-base font-semibold">{t('customers.profile.loyalty')}</h3>
      <div className="mt-4 space-y-4">
        {profile.loyalty.programs.map((program) => (
          <div key={program.programId}>
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{program.programName}</span>
              {program.tier && <Badge variant="secondary">{program.tier.name}</Badge>}
            </div>
            {program.goalAmount ? (
              <Meter
                className="mt-2"
                value={program.balance}
                max={program.goalAmount}
                tone={program.rewardAvailable ? 'success' : 'default'}
                label={`${formatNumber(program.balance)} ${program.unitPlural}`}
              />
            ) : (
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {formatNumber(program.balance)}{' '}
                <span className="text-sm font-normal text-muted-foreground">
                  {program.unitPlural}
                </span>
              </p>
            )}
          </div>
        ))}
      </div>

      {profile.redemptions.length > 0 && (
        <div className="mt-5 border-t pt-4">
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('customers.profile.rewards')}
          </h4>
          <ul className="mt-2 space-y-1.5">
            {profile.redemptions.slice(0, 5).map((redemption) => (
              <li key={redemption.id} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-1.5 truncate">
                  <Gift className="size-3.5 shrink-0 text-muted-foreground" />
                  {redemption.rewards?.name ?? t('customers.profile.rewardFallback')}
                </span>
                <Badge
                  variant={redemption.status === 'claimed' ? 'default' : 'outline'}
                  className="shrink-0"
                >
                  {redemption.status}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

/**
 * Paid memberships.
 *
 * Placed directly under Loyalty because "this person pays you every month" is
 * the most important thing anyone can know before serving them, and because
 * signing a regular up is a decision made while looking at their history — not
 * on a separate screen they would have to go find.
 */
function MembershipPanel({
  profile,
  businessId,
  customerId,
  editable,
  onChange,
}: {
  profile: Profile
  businessId: string
  customerId: string
  editable: boolean
  onChange: () => void
}) {
  const { has } = useWorkspace()
  const { t, formatDate } = useI18n()
  const formatValue = useFormatValue()
  const [enrolling, setEnrolling] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const plans = useApi<{
    plans: Array<{ id: string; name: string; price: number; currency: string; interval: string }>
  }>(has('memberships') && enrolling ? `/api/v1/memberships${query({ businessId })}` : null)

  const active = profile.memberships.filter((membership) => membership.status === 'active')

  if (!has('memberships')) return null

  async function enrol(planId: string) {
    setBusy(true)
    setError(null)
    try {
      await apiPost('/api/v1/memberships/members', {
        businessId,
        customerId,
        planId,
        source: 'manual',
      })
      setEnrolling(false)
      onChange()
    } catch (cause) {
      setError(toastError(cause, t, 'customers.profile.couldNotEnrol'))
    } finally {
      setBusy(false)
    }
  }

  async function cancel(membershipId: string) {
    setBusy(true)
    setError(null)
    try {
      await apiFetch('/api/v1/memberships/members', {
        method: 'DELETE',
        body: JSON.stringify({ businessId, membershipId, immediately: false }),
      })
      onChange()
    } catch (cause) {
      setError(toastError(cause, t, 'customers.profile.couldNotCancel'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-xl border bg-card p-5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base font-semibold">{t('customers.profile.membership')}</h3>
        {editable && active.length === 0 && !enrolling && (
          <Button variant="outline" size="sm" onClick={() => setEnrolling(true)}>
            {t('customers.profile.signUp')}
          </Button>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-destructive/10 p-2.5 text-sm text-destructive">
          {error}
        </p>
      )}

      {active.length > 0 ? (
        <ul className="mt-4 space-y-3">
          {active.map((membership) => (
            <li key={membership.id} className="rounded-lg border p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {membership.membership_plans?.name ??
                      t('customers.profile.membershipFallback')}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t('customers.profile.periodsPaid', {
                      count: membership.periods_billed,
                      amount: formatValue(
                        membership.lifetime_value,
                        'currency',
                        membership.membership_plans?.currency ?? 'EUR'
                      ),
                    })}
                  </p>
                </div>
                {membership.cancel_at_period_end ? (
                  <Badge variant="outline">{t('customers.profile.ending')}</Badge>
                ) : (
                  <Badge variant="secondary">{t('customers.profile.active')}</Badge>
                )}
              </div>
              {membership.current_period_end && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {membership.cancel_at_period_end
                    ? t('customers.profile.endsOn', {
                        date: formatDate(membership.current_period_end, {
                          day: 'numeric',
                          month: 'long',
                        }),
                      })
                    : t('customers.profile.renewsOn', {
                        date: formatDate(membership.current_period_end, {
                          day: 'numeric',
                          month: 'long',
                        }),
                      })}
                </p>
              )}
              {editable && !membership.cancel_at_period_end && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2 h-8 px-2 text-xs"
                  disabled={busy}
                  onClick={() => void cancel(membership.id)}
                >
                  {t('customers.profile.cancelAtPeriodEnd')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : enrolling ? (
        <div className="mt-4 space-y-2">
          {(plans.data?.plans ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {plans.isLoading
                ? t('customers.profile.loadingPlans')
                : t('customers.profile.noPlans')}{' '}
              <Link href="/dashboard/memberships" className="underline">
                {t('customers.profile.createOne')}
              </Link>
            </p>
          ) : (
            (plans.data?.plans ?? []).map((plan) => (
              <button
                key={plan.id}
                disabled={busy}
                onClick={() => void enrol(plan.id)}
                className="flex w-full items-center justify-between rounded-lg border p-3 text-left text-sm transition-colors hover:border-primary/50 disabled:opacity-60"
              >
                <span className="font-medium">{plan.name}</span>
                <span className="tabular-nums text-muted-foreground">
                  {formatValue(plan.price, 'currency', plan.currency)}
                  {plan.interval === 'year' ? t('common.perYear') : t('common.perMonth')}
                </span>
              </button>
            ))
          )}
          <Button variant="ghost" size="sm" className="w-full" onClick={() => setEnrolling(false)}>
            {t('common.cancel')}
          </Button>
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">{t('customers.profile.notAMember')}</p>
      )}
    </section>
  )
}

function ConsentPanel({
  profile,
  businessId,
  editable,
  onChange,
}: {
  profile: Profile
  businessId: string
  editable: boolean
  onChange: () => void
}) {
  const { t, formatDate } = useI18n()
  const consents = profile.customer.consents
  const [busy, setBusy] = React.useState<string | null>(null)

  async function toggle(channel: 'email' | 'sms' | 'whatsapp' | 'marketing', value: boolean) {
    setBusy(channel)
    try {
      await apiPatch(`/api/v1/customers/${profile.customer.id}`, {
        businessId,
        consents: { [channel]: value },
      })
      onChange()
    } finally {
      setBusy(null)
    }
  }

  const rows: Array<{
    key: 'email' | 'sms' | 'whatsapp' | 'marketing'
    label: string
    value: boolean
  }> = [
    { key: 'email', label: t('customers.profile.consentEmail'), value: consents.email },
    { key: 'sms', label: t('customers.profile.consentSms'), value: consents.sms },
    { key: 'whatsapp', label: t('customers.profile.consentWhatsapp'), value: consents.whatsapp },
    {
      key: 'marketing',
      label: t('customers.profile.consentMarketing'),
      value: consents.marketing,
    },
  ]

  return (
    <section className="rounded-xl border bg-card p-5">
      <h3 className="flex items-center gap-2 text-base font-semibold">
        {consents.marketing ? (
          <ShieldCheck className="size-4 text-emerald-600" />
        ) : (
          <ShieldOff className="size-4 text-muted-foreground" />
        )}
        {t('customers.profile.consent')}
      </h3>
      <ul className="mt-4 space-y-3">
        {rows.map((row) => (
          <li key={row.key} className="flex items-center justify-between">
            <span className="text-sm">{row.label}</span>
            {busy === row.key ? (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            ) : (
              <Switch
                checked={row.value}
                disabled={!editable}
                onCheckedChange={(value) => void toggle(row.key, value)}
                aria-label={t('customers.profile.consentLabel', { channel: row.label })}
              />
            )}
          </li>
        ))}
      </ul>
      {consents.updatedAt && (
        <p className="mt-4 border-t pt-3 text-[11px] text-muted-foreground">
          {consents.source
            ? t('customers.profile.consentUpdatedVia', {
                date: formatDate(consents.updatedAt),
                source: consents.source,
              })
            : t('customers.profile.consentUpdated', { date: formatDate(consents.updatedAt) })}
        </p>
      )}
    </section>
  )
}

function NotesPanel({
  profile,
  businessId,
  customerId,
  editable,
  onChange,
}: {
  profile: Profile
  businessId: string
  customerId: string
  editable: boolean
  onChange: () => void
}) {
  const { t, formatDate } = useI18n()
  const [body, setBody] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function add() {
    if (!body.trim()) return
    setBusy(true)
    setError(null)
    try {
      await apiPost(`/api/v1/customers/${customerId}/notes`, { businessId, body: body.trim() })
      setBody('')
      onChange()
    } catch (cause) {
      setError(toastError(cause, t, 'customers.profile.noteFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-xl border bg-card p-5">
      <h3 className="text-base font-semibold">{t('customers.profile.notes')}</h3>
      {editable && (
        <div className="mt-3 space-y-2">
          <Textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={2}
            placeholder={t('customers.profile.notePlaceholder')}
            aria-label={t('customers.profile.noteLabel')}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button
            size="sm"
            className="gap-1.5"
            disabled={busy || !body.trim()}
            onClick={() => void add()}
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            {t('customers.profile.addNote')}
          </Button>
        </div>
      )}

      {profile.notes.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{t('customers.profile.notesEmpty')}</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {profile.notes.map((note) => (
            <li key={note.id} className="rounded-lg bg-muted/50 p-3">
              <p className="text-sm">{note.body}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {note.author_name ?? t('customers.profile.staff')} · {formatDate(note.created_at)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Timeline({ profile }: { profile: Profile }) {
  const { t, formatDate } = useI18n()
  const formatValue = useFormatValue()

  const entries = React.useMemo(() => {
    const describe = (type: string): string => {
      const key = `customers.profile.activity.${type}` as TranslationKey
      const label = t(key)
      return label === key ? type.replace(/_/g, ' ') : label
    }

    const activity = profile.activity.map((event) => ({
      id: `a-${event.id}`,
      at: event.occurred_at,
      title: describe(event.type),
      detail:
        event.amount !== null
          ? formatValue(Number(event.amount), 'currency')
          : t('customers.profile.via', { source: event.source }),
    }))
    const messages = profile.messages.map((message) => ({
      id: `m-${message.id}`,
      at: message.sent_at ?? new Date().toISOString(),
      title: `${message.channel} · ${message.subject ?? t('customers.profile.messageFallback')}`,
      detail:
        message.status === 'skipped'
          ? t('customers.profile.skipped', { reason: message.skip_reason ?? '—' })
          : message.status,
    }))
    return [...activity, ...messages]
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 30)
  }, [profile, t, formatValue])

  return (
    <section className="rounded-xl border bg-card p-5">
      <h3 className="text-base font-semibold">{t('customers.profile.history')}</h3>
      {entries.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{t('customers.profile.historyEmpty')}</p>
      ) : (
        <ol className="mt-4 space-y-0">
          {entries.map((entry, index) => (
            <li key={entry.id} className="relative flex gap-3 pb-4 last:pb-0">
              <div className="flex flex-col items-center">
                <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />
                {index < entries.length - 1 && <span className="w-px flex-1 bg-border" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{entry.title}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDate(entry.at, {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}{' '}
                  · {entry.detail}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
