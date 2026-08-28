'use client'

import * as React from 'react'
import {
  Bell,
  CheckCircle2,
  Loader2,
  Pause,
  Play,
  Plus,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { EmptyState, ErrorState, LoadingRows } from '@/components/states'
import { apiDelete, apiPatch, apiPost, useApi, query } from '@/lib/client/api'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { GEOFENCE_TRIGGERS, type GeofenceTrigger } from '@/lib/wallet/types'

/**
 * Proximity campaigns.
 *
 * The interesting part is the preflight — *"would this send?"* — which runs the real
 * evaluator against a real customer and lists every reason it would not. Without it a
 * merchant configures a campaign, receives nothing, and has no way to distinguish "the
 * feature is broken" from "my own rule excluded everybody". That ambiguity is what
 * makes proximity marketing feel unreliable in every product that ships it without a
 * test button.
 *
 * The notification preview is live and rendered next to the fields, because the copy
 * *is* the campaign. Everything else is targeting.
 */

type Campaign = {
  id: string
  name: string
  kind: string
  status: 'draft' | 'scheduled' | 'active' | 'paused' | 'ended'
  description: string | null
  trigger: GeofenceTrigger
  radiusMeters: number | null
  startsOn: string | null
  endsOn: string | null
  weekdays: number[]
  startTime: string | null
  endTime: string | null
  allLocations: boolean
  locationIds: string[]
  segmentId: string | null
  minPoints: number | null
  minVisits: number | null
  minDaysSinceVisit: number | null
  maxDaysSinceVisit: number | null
  vipOnly: boolean
  eligibility: Record<string, unknown>
  title: string
  message: string
  emoji: string | null
  ctaLabel: string | null
  rewardDescription: string | null
  priority: number
  cooldownHours: number
  maxSendsPerCustomer: number | null
  stats: {
    sent: number
    impressions: number
    clicks: number
    visits: number
    redemptions: number
    revenueCents: number
  }
}

type CampaignsResponse = {
  campaigns: Campaign[]
  locations: Array<{ id: string; name: string; city: string | null; hasCoordinates: boolean }>
}

type PreflightResponse = {
  would_send: boolean
  blockers: Array<{ code: string; label: string }>
  notification: { title: string; message: string; emoji: string | null }
  customer: { id: string; first_name: string | null; points: number; visits: number }
}

const STATUS_TONE: Record<Campaign['status'], string> = {
  active: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  paused: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  draft: 'bg-muted text-muted-foreground',
  scheduled: 'bg-blue-500/15 text-blue-700 dark:text-blue-400',
  ended: 'bg-muted text-muted-foreground',
}

export function WalletCampaignsPanel({
  businessId,
  canWrite,
}: {
  businessId: string
  canWrite: boolean
}) {
  const { t, formatNumber, formatCurrency } = useI18n()
  const key = `/api/v1/wallet/campaigns${query({ businessId })}`
  const { data, error, isLoading, mutate } = useApi<CampaignsResponse>(key)

  const [editing, setEditing] = React.useState<Campaign | null>(null)
  const [creating, setCreating] = React.useState(false)
  const [busy, setBusy] = React.useState<string | null>(null)

  const campaigns = data?.campaigns ?? []
  const locations = data?.locations ?? []

  async function toggleStatus(campaign: Campaign) {
    setBusy(campaign.id)
    try {
      await apiPatch('/api/v1/wallet/campaigns', {
        businessId,
        id: campaign.id,
        status: campaign.status === 'active' ? 'paused' : 'active',
      })
      void mutate()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t('common.somethingWentWrong'))
    } finally {
      setBusy(null)
    }
  }

  async function archive(campaign: Campaign) {
    setBusy(campaign.id)
    try {
      await apiDelete('/api/v1/wallet/campaigns', { businessId, id: campaign.id })
      void mutate()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t('common.somethingWentWrong'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">{t('wallet.campaigns.title')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('wallet.campaigns.subtitle')}</p>
        </div>
        {canWrite && (
          <Button onClick={() => setCreating(true)} className="gap-2">
            <Plus className="size-4" aria-hidden />
            {t('wallet.campaigns.create')}
          </Button>
        )}
      </div>

      {isLoading && <LoadingRows rows={3} />}
      {error && <ErrorState error={error} onRetry={() => void mutate()} />}

      {!isLoading && !error && campaigns.length === 0 && (
        <EmptyState
          icon={Bell}
          title={t('wallet.campaigns.empty')}
          description={t('wallet.campaigns.emptyBody')}
          action={
            canWrite ? (
              <Button onClick={() => setCreating(true)} className="gap-2">
                <Plus className="size-4" aria-hidden />
                {t('wallet.campaigns.create')}
              </Button>
            ) : undefined
          }
        />
      )}

      {campaigns.length > 0 && (
        <ul className="space-y-3">
          {campaigns.map((campaign) => (
            <li key={campaign.id}>
              <article className="rounded-2xl border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="flex flex-wrap items-center gap-2 text-base font-semibold">
                      {campaign.emoji && <span aria-hidden>{campaign.emoji}</span>}
                      <span className="truncate">{campaign.name}</span>
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-[11px] font-medium',
                          STATUS_TONE[campaign.status]
                        )}
                      >
                        {t(`common.${campaign.status === 'active' ? 'active' : campaign.status === 'paused' ? 'paused' : 'draft'}` as 'common.active')}
                      </span>
                    </h3>
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                      {campaign.title} — {campaign.message}
                    </p>
                  </div>

                  {canWrite && (
                    <div className="flex shrink-0 gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => toggleStatus(campaign)}
                        disabled={busy === campaign.id}
                        className="gap-1.5"
                      >
                        {busy === campaign.id ? (
                          <Loader2 className="size-3.5 animate-spin" aria-hidden />
                        ) : campaign.status === 'active' ? (
                          <Pause className="size-3.5" aria-hidden />
                        ) : (
                          <Play className="size-3.5" aria-hidden />
                        )}
                        <span className="hidden sm:inline">
                          {campaign.status === 'active'
                            ? t('wallet.campaigns.pause')
                            : t('wallet.campaigns.activate')}
                        </span>
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setEditing(campaign)}>
                        {t('common.edit')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-9 text-muted-foreground"
                        onClick={() => archive(campaign)}
                        disabled={busy === campaign.id}
                        aria-label={t('wallet.campaigns.archive')}
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                      </Button>
                    </div>
                  )}
                </div>

                <dl className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-6">
                  {[
                    { label: t('wallet.campaigns.stats.sent'), value: campaign.stats.sent },
                    {
                      label: t('wallet.campaigns.stats.impressions'),
                      value: campaign.stats.impressions,
                    },
                    { label: t('wallet.campaigns.stats.clicks'), value: campaign.stats.clicks },
                    { label: t('wallet.campaigns.stats.visits'), value: campaign.stats.visits },
                    {
                      label: t('wallet.campaigns.stats.redemptions'),
                      value: campaign.stats.redemptions,
                    },
                  ].map((stat) => (
                    <div key={stat.label}>
                      <dt className="truncate text-[11px] text-muted-foreground">{stat.label}</dt>
                      <dd className="text-sm font-semibold tabular-nums">
                        {formatNumber(stat.value)}
                      </dd>
                    </div>
                  ))}
                  <div>
                    <dt className="truncate text-[11px] text-muted-foreground">
                      {t('wallet.campaigns.stats.revenue')}
                    </dt>
                    <dd className="text-sm font-semibold tabular-nums">
                      {campaign.stats.revenueCents > 0
                        ? formatCurrency(campaign.stats.revenueCents, { cents: true })
                        : '—'}
                    </dd>
                  </div>
                </dl>
              </article>
            </li>
          ))}
        </ul>
      )}

      <CampaignDialog
        /* Remount per campaign, so the form always opens on the right draft. */
        key={editing?.id ?? (creating ? 'new' : 'closed')}
        open={creating || editing !== null}
        businessId={businessId}
        campaign={editing}
        locations={locations}
        onClose={() => {
          setCreating(false)
          setEditing(null)
        }}
        onSaved={() => {
          setCreating(false)
          setEditing(null)
          void mutate()
        }}
      />
    </div>
  )
}

// -----------------------------------------------------------------------------
// Editor
// -----------------------------------------------------------------------------

type CampaignDraft = {
  name: string
  trigger: GeofenceTrigger
  radiusMeters: string
  startsOn: string
  endsOn: string
  weekdays: number[]
  startTime: string
  endTime: string
  allLocations: boolean
  locationIds: string[]
  minPoints: string
  minVisits: string
  minDaysSinceVisit: string
  maxDaysSinceVisit: string
  vipOnly: boolean
  birthdayOnly: boolean
  requiresReward: boolean
  title: string
  message: string
  emoji: string
  ctaLabel: string
  rewardDescription: string
  priority: string
  cooldownHours: string
  maxSendsPerCustomer: string
  status: Campaign['status']
}

const ALL_WEEKDAYS = [1, 2, 3, 4, 5, 6, 0]

function emptyDraft(): CampaignDraft {
  return {
    name: '',
    trigger: 'entry',
    radiusMeters: '',
    startsOn: '',
    endsOn: '',
    weekdays: [...ALL_WEEKDAYS],
    startTime: '',
    endTime: '',
    allLocations: true,
    locationIds: [],
    minPoints: '',
    minVisits: '',
    minDaysSinceVisit: '',
    maxDaysSinceVisit: '',
    vipOnly: false,
    birthdayOnly: false,
    requiresReward: false,
    title: '',
    message: '',
    emoji: '',
    ctaLabel: '',
    rewardDescription: '',
    priority: '10',
    cooldownHours: '24',
    maxSendsPerCustomer: '',
    status: 'paused',
  }
}

function draftFrom(campaign: Campaign): CampaignDraft {
  const str = (value: number | null) => (value === null ? '' : String(value))
  return {
    name: campaign.name,
    trigger: campaign.trigger,
    radiusMeters: str(campaign.radiusMeters),
    startsOn: campaign.startsOn ?? '',
    endsOn: campaign.endsOn ?? '',
    weekdays: campaign.weekdays,
    startTime: campaign.startTime?.slice(0, 5) ?? '',
    endTime: campaign.endTime?.slice(0, 5) ?? '',
    allLocations: campaign.allLocations,
    locationIds: campaign.locationIds,
    minPoints: str(campaign.minPoints),
    minVisits: str(campaign.minVisits),
    minDaysSinceVisit: str(campaign.minDaysSinceVisit),
    maxDaysSinceVisit: str(campaign.maxDaysSinceVisit),
    vipOnly: campaign.vipOnly,
    birthdayOnly: campaign.eligibility?.birthday_only === true,
    requiresReward: campaign.eligibility?.requires_claimable_reward === true,
    title: campaign.title,
    message: campaign.message,
    emoji: campaign.emoji ?? '',
    ctaLabel: campaign.ctaLabel ?? '',
    rewardDescription: campaign.rewardDescription ?? '',
    priority: String(campaign.priority),
    cooldownHours: String(campaign.cooldownHours),
    maxSendsPerCustomer: str(campaign.maxSendsPerCustomer),
    status: campaign.status,
  }
}

const numberOrNull = (value: string) => {
  const trimmed = value.trim()
  if (trimmed === '') return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

function draftToPayload(draft: CampaignDraft): Record<string, unknown> {
  return {
    name: draft.name.trim(),
    status: draft.status,
    trigger: draft.trigger,
    radiusMeters: numberOrNull(draft.radiusMeters),
    startsOn: draft.startsOn || null,
    endsOn: draft.endsOn || null,
    weekdays: draft.weekdays,
    startTime: draft.startTime || null,
    endTime: draft.endTime || null,
    allLocations: draft.allLocations,
    locationIds: draft.allLocations ? [] : draft.locationIds,
    minPoints: numberOrNull(draft.minPoints),
    minVisits: numberOrNull(draft.minVisits),
    minDaysSinceVisit: numberOrNull(draft.minDaysSinceVisit),
    maxDaysSinceVisit: numberOrNull(draft.maxDaysSinceVisit),
    vipOnly: draft.vipOnly,
    eligibility: {
      ...(draft.birthdayOnly ? { birthday_only: true } : {}),
      ...(draft.requiresReward ? { requires_claimable_reward: true } : {}),
    },
    title: draft.title.trim(),
    message: draft.message.trim(),
    emoji: draft.emoji.trim() || null,
    ctaLabel: draft.ctaLabel.trim() || null,
    rewardDescription: draft.rewardDescription.trim() || null,
    priority: Number(draft.priority) || 0,
    cooldownHours: Number(draft.cooldownHours) || 0,
    maxSendsPerCustomer: numberOrNull(draft.maxSendsPerCustomer),
  }
}

const TOKENS = '{first_name} {points} {store} {reward} {distance}'

function CampaignDialog({
  open,
  businessId,
  campaign,
  locations,
  onClose,
  onSaved,
}: {
  open: boolean
  businessId: string
  campaign: Campaign | null
  locations: CampaignsResponse['locations']
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useI18n()
  const [draft, setDraft] = React.useState<CampaignDraft>(() =>
    campaign ? draftFrom(campaign) : emptyDraft()
  )
  const [saving, setSaving] = React.useState(false)
  const [preflight, setPreflight] = React.useState<PreflightResponse | null>(null)
  const [testing, setTesting] = React.useState(false)

  const set = <K extends keyof CampaignDraft>(key: K, value: CampaignDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }))

  const valid = draft.name.trim() && draft.title.trim() && draft.message.trim()

  async function save() {
    if (!valid) return
    setSaving(true)
    try {
      const payload = { businessId, ...draftToPayload(draft) }
      if (campaign) {
        await apiPatch('/api/v1/wallet/campaigns', { ...payload, id: campaign.id })
      } else {
        await apiPost('/api/v1/wallet/campaigns', payload)
      }
      toast.success(t('common.saved'))
      onSaved()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t('common.somethingWentWrong'))
    } finally {
      setSaving(false)
    }
  }

  async function test() {
    if (!campaign) return
    setTesting(true)
    try {
      setPreflight(
        await apiPost<PreflightResponse>('/api/v1/wallet/preview', {
          businessId,
          campaignId: campaign.id,
          trigger: draft.trigger,
        })
      )
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t('wallet.campaigns.preflight.noCustomer'))
    } finally {
      setTesting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {campaign ? t('wallet.campaigns.edit') : t('wallet.campaigns.create')}
          </DialogTitle>
          <DialogDescription>{t('wallet.campaigns.subtitle')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Message first: the copy is the campaign, the rest is targeting. */}
          <Section title={t('wallet.campaigns.sectionMessage')}>
            <div className="grid gap-4 lg:grid-cols-[1fr_260px] lg:items-start">
              <div className="space-y-3">
                <Row label={t('wallet.campaigns.name')} id="c-name">
                  <Input
                    id="c-name"
                    value={draft.name}
                    maxLength={120}
                    onChange={(event) => set('name', event.target.value)}
                  />
                </Row>

                <div className="grid gap-3 sm:grid-cols-[80px_1fr]">
                  <Row label={t('wallet.campaigns.emoji')} id="c-emoji">
                    <Input
                      id="c-emoji"
                      value={draft.emoji}
                      maxLength={8}
                      onChange={(event) => set('emoji', event.target.value)}
                    />
                  </Row>
                  <Row label={t('wallet.campaigns.messageTitle')} id="c-title">
                    <Input
                      id="c-title"
                      value={draft.title}
                      maxLength={60}
                      onChange={(event) => set('title', event.target.value)}
                    />
                  </Row>
                </div>

                <Row label={t('wallet.campaigns.messageBody')} id="c-message">
                  <Textarea
                    id="c-message"
                    value={draft.message}
                    maxLength={300}
                    rows={3}
                    onChange={(event) => set('message', event.target.value)}
                  />
                </Row>

                <p className="text-xs text-muted-foreground">
                  {t('wallet.campaigns.tokens', { tokens: TOKENS })}
                </p>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Row label={t('wallet.campaigns.ctaLabel')} id="c-cta">
                    <Input
                      id="c-cta"
                      value={draft.ctaLabel}
                      maxLength={40}
                      onChange={(event) => set('ctaLabel', event.target.value)}
                    />
                  </Row>
                  <Row label={t('wallet.campaigns.rewardDescription')} id="c-reward">
                    <Input
                      id="c-reward"
                      value={draft.rewardDescription}
                      maxLength={200}
                      onChange={(event) => set('rewardDescription', event.target.value)}
                    />
                  </Row>
                </div>
              </div>

              {/* Live lock-screen preview */}
              <div className="rounded-2xl border bg-muted/40 p-3">
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  {t('wallet.preview.lockScreen')}
                </p>
                <div className="mt-2.5 rounded-xl bg-background p-3 shadow-sm">
                  <div className="flex items-start gap-2">
                    {draft.emoji && (
                      <span aria-hidden className="text-lg leading-none">
                        {draft.emoji}
                      </span>
                    )}
                    <div className="min-w-0">
                      <p className="break-words text-sm font-semibold leading-snug">
                        {draft.title || t('wallet.campaigns.messageTitle')}
                      </p>
                      <p className="mt-0.5 break-words text-sm leading-snug text-muted-foreground">
                        {draft.message || t('wallet.campaigns.messageBody')}
                      </p>
                    </div>
                  </div>
                  {draft.ctaLabel && (
                    <p className="mt-2.5 text-xs font-medium text-primary">{draft.ctaLabel}</p>
                  )}
                </div>
              </div>
            </div>
          </Section>

          <Separator />

          <Section title={t('wallet.campaigns.sectionTrigger')}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Row label={t('wallet.campaigns.trigger')} id="c-trigger">
                <Select
                  value={draft.trigger}
                  onValueChange={(value) => set('trigger', value as GeofenceTrigger)}
                >
                  <SelectTrigger id="c-trigger">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {GEOFENCE_TRIGGERS.map((trigger) => (
                      <SelectItem key={trigger} value={trigger}>
                        {t(`wallet.campaigns.triggers.${trigger}` as 'wallet.campaigns.triggers.entry')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Row>

              <Row
                label={t('wallet.campaigns.radius')}
                id="c-radius"
                help={t('wallet.campaigns.radiusHelp')}
              >
                <Input
                  id="c-radius"
                  inputMode="numeric"
                  value={draft.radiusMeters}
                  onChange={(event) => set('radiusMeters', event.target.value)}
                />
              </Row>
            </div>
          </Section>

          <Section title={t('wallet.campaigns.sectionSchedule')}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Row label={t('wallet.campaigns.startsOn')} id="c-starts">
                <Input
                  id="c-starts"
                  type="date"
                  value={draft.startsOn}
                  onChange={(event) => set('startsOn', event.target.value)}
                />
              </Row>
              <Row label={t('wallet.campaigns.endsOn')} id="c-ends">
                <Input
                  id="c-ends"
                  type="date"
                  value={draft.endsOn}
                  onChange={(event) => set('endsOn', event.target.value)}
                />
              </Row>
              <Row label={t('wallet.campaigns.startTime')} id="c-start-time" help={t('wallet.campaigns.timeHelp')}>
                <Input
                  id="c-start-time"
                  type="time"
                  value={draft.startTime}
                  onChange={(event) => set('startTime', event.target.value)}
                />
              </Row>
              <Row label={t('wallet.campaigns.endTime')} id="c-end-time">
                <Input
                  id="c-end-time"
                  type="time"
                  value={draft.endTime}
                  onChange={(event) => set('endTime', event.target.value)}
                />
              </Row>
            </div>

            <fieldset>
              <legend className="mb-2 text-sm">{t('wallet.campaigns.weekdays')}</legend>
              <div className="flex flex-wrap gap-1.5">
                {ALL_WEEKDAYS.map((day) => {
                  const selected = draft.weekdays.includes(day)
                  const key = (['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const)[day]
                  return (
                    <button
                      key={day}
                      type="button"
                      aria-pressed={selected}
                      onClick={() =>
                        set(
                          'weekdays',
                          selected
                            ? draft.weekdays.filter((entry) => entry !== day)
                            : [...draft.weekdays, day]
                        )
                      }
                      className={cn(
                        'rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors',
                        selected
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:bg-accent'
                      )}
                    >
                      {t(`locations.hours.daysShort.${key}` as 'locations.hours.daysShort.mon')}
                    </button>
                  )
                })}
              </div>
            </fieldset>
          </Section>

          <Separator />

          <Section title={t('wallet.campaigns.sectionAudience')}>
            <div className="flex items-center justify-between rounded-xl border p-3.5">
              <Label htmlFor="c-all-locations" className="cursor-pointer text-sm font-normal">
                {t('wallet.campaigns.allLocations')}
              </Label>
              <Switch
                id="c-all-locations"
                checked={draft.allLocations}
                onCheckedChange={(checked) => set('allLocations', checked)}
              />
            </div>

            {!draft.allLocations && (
              <fieldset className="rounded-xl border p-3.5">
                <legend className="px-1 text-sm">{t('wallet.campaigns.pickLocations')}</legend>
                <div className="mt-1 space-y-1.5">
                  {locations.map((location) => (
                    <label key={location.id} className="flex items-center gap-2.5 text-sm">
                      <input
                        type="checkbox"
                        checked={draft.locationIds.includes(location.id)}
                        onChange={(event) =>
                          set(
                            'locationIds',
                            event.target.checked
                              ? [...draft.locationIds, location.id]
                              : draft.locationIds.filter((id) => id !== location.id)
                          )
                        }
                        className="size-4 rounded border-input"
                      />
                      <span>{location.name}</span>
                      {!location.hasCoordinates && (
                        <Badge variant="outline" className="text-[10px]">
                          {t('locations.geofence.noCoordinates')}
                        </Badge>
                      )}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <Row label={t('wallet.campaigns.minPoints')} id="c-min-points">
                <Input
                  id="c-min-points"
                  inputMode="numeric"
                  value={draft.minPoints}
                  onChange={(event) => set('minPoints', event.target.value)}
                />
              </Row>
              <Row label={t('wallet.campaigns.minVisits')} id="c-min-visits">
                <Input
                  id="c-min-visits"
                  inputMode="numeric"
                  value={draft.minVisits}
                  onChange={(event) => set('minVisits', event.target.value)}
                />
              </Row>
              <Row label={t('wallet.campaigns.minDaysSinceVisit')} id="c-min-days">
                <Input
                  id="c-min-days"
                  inputMode="numeric"
                  value={draft.minDaysSinceVisit}
                  onChange={(event) => set('minDaysSinceVisit', event.target.value)}
                />
              </Row>
              <Row label={t('wallet.campaigns.maxDaysSinceVisit')} id="c-max-days">
                <Input
                  id="c-max-days"
                  inputMode="numeric"
                  value={draft.maxDaysSinceVisit}
                  onChange={(event) => set('maxDaysSinceVisit', event.target.value)}
                />
              </Row>
            </div>

            <div className="space-y-2.5">
              <CheckRow
                id="c-vip"
                label={t('wallet.campaigns.vipOnly')}
                checked={draft.vipOnly}
                onChange={(checked) => set('vipOnly', checked)}
              />
              <CheckRow
                id="c-birthday"
                label={t('wallet.campaigns.birthdayOnly')}
                checked={draft.birthdayOnly}
                onChange={(checked) => set('birthdayOnly', checked)}
              />
              <CheckRow
                id="c-reward-ready"
                label={t('wallet.campaigns.requiresReward')}
                checked={draft.requiresReward}
                onChange={(checked) => set('requiresReward', checked)}
              />
            </div>
          </Section>

          <Separator />

          <Section title={t('wallet.campaigns.sectionDelivery')}>
            <div className="grid gap-3 sm:grid-cols-3">
              <Row
                label={t('wallet.campaigns.priority')}
                id="c-priority"
                help={t('wallet.campaigns.priorityHelp')}
              >
                <Input
                  id="c-priority"
                  inputMode="numeric"
                  value={draft.priority}
                  onChange={(event) => set('priority', event.target.value)}
                />
              </Row>
              <Row label={t('wallet.campaigns.cooldownHours')} id="c-cooldown">
                <Input
                  id="c-cooldown"
                  inputMode="numeric"
                  value={draft.cooldownHours}
                  onChange={(event) => set('cooldownHours', event.target.value)}
                />
              </Row>
              <Row label={t('wallet.campaigns.maxSends')} id="c-max-sends">
                <Input
                  id="c-max-sends"
                  inputMode="numeric"
                  value={draft.maxSendsPerCustomer}
                  onChange={(event) => set('maxSendsPerCustomer', event.target.value)}
                />
              </Row>
            </div>
          </Section>

          {/* Preflight */}
          {campaign && (
            <div className="rounded-2xl border p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm font-semibold">{t('wallet.campaigns.testIt')}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={test}
                  disabled={testing}
                  className="gap-2"
                >
                  {testing && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                  {t('wallet.campaigns.testIt')}
                </Button>
              </div>

              {preflight && (
                <Alert
                  variant={preflight.would_send ? 'default' : 'destructive'}
                  className="mt-3"
                >
                  {preflight.would_send ? (
                    <CheckCircle2 className="size-4" aria-hidden />
                  ) : (
                    <TriangleAlert className="size-4" aria-hidden />
                  )}
                  <AlertTitle>
                    {preflight.would_send
                      ? t('wallet.campaigns.preflight.wouldSend')
                      : t('wallet.campaigns.preflight.wouldNotSend')}
                  </AlertTitle>
                  <AlertDescription>
                    <p className="text-xs">
                      {t('wallet.campaigns.preflight.testedAgainst', {
                        name: preflight.customer.first_name ?? preflight.customer.id.slice(0, 8),
                      })}
                    </p>
                    {preflight.blockers.length > 0 && (
                      <ul className="mt-2 list-inside list-disc space-y-0.5 text-xs">
                        {preflight.blockers.map((blocker) => (
                          <li key={blocker.code}>{blocker.label}</li>
                        ))}
                      </ul>
                    )}
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={save} disabled={saving || !valid} className="gap-2">
            {saving && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {saving ? t('common.saving') : t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  )
}

function Row({
  label,
  id,
  help,
  children,
}: {
  label: string
  id: string
  help?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-sm">
        {label}
      </Label>
      {children}
      {help && <p className="text-xs text-muted-foreground">{help}</p>}
    </div>
  )
}

function CheckRow({
  id,
  label,
  checked,
  onChange,
}: {
  id: string
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label htmlFor={id} className="flex items-center gap-2.5 text-sm">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-4 rounded border-input"
      />
      {label}
    </label>
  )
}
