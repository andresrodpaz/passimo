'use client'

import * as React from 'react'
import { useSearchParams } from 'next/navigation'
import {
  Megaphone,
  Plus,
  Sparkles,
  Loader2,
  Send,
  Users,
  Mail,
  MessageSquare,
  Smartphone,
  Wallet,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useApi, apiPost, query } from '@/lib/client/api'
import { useWorkspace } from '@/lib/client/workspace'
import { AsyncBoundary, EmptyState } from '@/components/states'
import { useFormatValue } from '@/components/metrics'
import { toastError } from '@/lib/client/api-errors'
import { useI18n } from '@/lib/i18n'
import type { TranslationKey } from '@/lib/i18n'
import { smsSegments } from '@/lib/messaging/template'

type Campaign = {
  id: string
  name: string
  type: string
  status: string
  channels: string[]
  scheduled_at: string | null
  reach_count: number
  sent_count: number
  opened_count: number
  clicked_count: number
  attributed_revenue: number
  estimated_cost: number
  open_rate: number
  click_rate: number
  roi: number | null
  generated_by_ai: boolean
  created_at: string
}

type Segment = { id: string; name: string; cached_count: number | null }

type GeneratedCampaign = {
  name: string
  goal: string
  channels: string[]
  audience_description: string
  suggested_segment_key: string | null
  subject: string | null
  email_body: string | null
  sms_body: string | null
  push_title: string | null
  push_body: string | null
  expected_impact: string
  reasoning: string
}

/**
 * Channel presentation.
 *
 * The icon is language-independent; the name is not. Keyed by the enum the API
 * stores, so an unrecognised channel still renders its own identifier.
 */
const CHANNEL_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  email: Mail,
  sms: MessageSquare,
  whatsapp: MessageSquare,
  push: Smartphone,
  wallet: Wallet,
}

/**
 * Campaign studio.
 *
 * Built around the reality that a shop owner does not want to write marketing
 * copy: describe the goal in a sentence, get a ready draft, see exactly who it
 * reaches and what it costs, send. Cost and reach are always on screen before
 * the send button, because a surprise €90 SMS bill loses a customer forever.
 */
export default function CampaignsPage() {
  return (
    <React.Suspense fallback={null}>
      <CampaignsScreen />
    </React.Suspense>
  )
}

function CampaignsScreen() {
  const searchParams = useSearchParams()
  const { businessId, can, capabilities } = useWorkspace()
  const { t } = useI18n()
  const [composerOpen, setComposerOpen] = React.useState(Boolean(searchParams.get('brief')))

  const { data, error, isLoading, mutate } = useApi<{ campaigns: Campaign[] }>(
    businessId ? `/api/v1/campaigns${query({ businessId, limit: 50 })}` : null
  )

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{t('campaigns.title')}</h2>
          <p className="text-sm text-muted-foreground">{t('campaigns.subtitle')}</p>
        </div>
        {can('campaigns:write') && (
          <Button size="sm" className="gap-2" onClick={() => setComposerOpen(true)}>
            <Plus className="size-4" />
            {t('campaigns.newCampaign')}
          </Button>
        )}
      </header>

      <AsyncBoundary
        data={data}
        error={error}
        isLoading={isLoading}
        onRetry={() => void mutate()}
        isEmpty={(value) => value.campaigns.length === 0}
        empty={
          <EmptyState
            icon={Megaphone}
            title={t('campaigns.empty')}
            description={
              capabilities?.ai ? t('campaigns.emptyBodyAi') : t('campaigns.emptyBody')
            }
            action={
              can('campaigns:write') ? (
                <Button size="sm" onClick={() => setComposerOpen(true)}>
                  {t('campaigns.emptyCta')}
                </Button>
              ) : undefined
            }
          />
        }
      >
        {(value) => (
          <div className="grid gap-4 md:grid-cols-2">
            {value.campaigns.map((campaign) => (
              <CampaignCard key={campaign.id} campaign={campaign} />
            ))}
          </div>
        )}
      </AsyncBoundary>

      <Composer
        open={composerOpen}
        initialBrief={searchParams.get('brief') ?? ''}
        onClose={() => setComposerOpen(false)}
        onSent={() => {
          setComposerOpen(false)
          void mutate()
        }}
      />
    </div>
  )
}

function CampaignCard({ campaign }: { campaign: Campaign }) {
  const { t, formatNumber, formatPercent } = useI18n()
  const formatValue = useFormatValue()

  return (
    <article className="rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-medium">{campaign.name}</h3>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {campaign.channels.map((channel) => {
              const Icon = CHANNEL_ICONS[channel] ?? Mail
              const key = `campaigns.channels.${channel}` as TranslationKey
              const label = t(key)
              return (
                <span key={channel} className="inline-flex items-center gap-1">
                  <Icon className="size-3" />
                  {label === key ? channel : label}
                </span>
              )
            })}
            {campaign.generated_by_ai && (
              <span className="inline-flex items-center gap-1">
                <Sparkles className="size-3" />
                {t('campaigns.aiTag')}
              </span>
            )}
          </p>
        </div>
        <StatusBadge status={campaign.status} />
      </div>

      {campaign.sent_count > 0 ? (
        <dl className="mt-4 grid grid-cols-4 gap-2 border-t pt-3 text-center">
          <div>
            <dt className="text-[11px] text-muted-foreground">{t('campaigns.stats.sent')}</dt>
            <dd className="text-sm font-semibold tabular-nums">
              {formatNumber(campaign.sent_count)}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted-foreground">{t('campaigns.stats.opened')}</dt>
            <dd className="text-sm font-semibold tabular-nums">
              {formatPercent(campaign.open_rate / 100, 0)}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted-foreground">{t('campaigns.stats.revenue')}</dt>
            <dd className="text-sm font-semibold tabular-nums">
              {formatValue(campaign.attributed_revenue, 'currency')}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted-foreground">{t('campaigns.stats.roi')}</dt>
            <dd
              className={`text-sm font-semibold tabular-nums ${
                (campaign.roi ?? 0) > 0 ? 'text-emerald-600' : ''
              }`}
            >
              {campaign.roi === null ? '—' : formatPercent(campaign.roi, 0)}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="mt-4 border-t pt-3 text-xs text-muted-foreground">
          {campaign.reach_count > 0
            ? t('campaigns.willReach', {
                count: campaign.reach_count,
                cost: formatValue(campaign.estimated_cost, 'currency'),
              })
            : t('campaigns.draftNoAudience')}
        </p>
      )}
    </article>
  )
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useI18n()
  const variants: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
    completed: 'secondary',
    sending: 'default',
    scheduled: 'outline',
    draft: 'outline',
    failed: 'destructive',
    cancelled: 'outline',
  }
  const key = `campaigns.status.${status}` as TranslationKey
  const label = t(key)
  return (
    <Badge variant={variants[status] ?? 'outline'} className="shrink-0">
      {label === key ? status : label}
    </Badge>
  )
}

// -----------------------------------------------------------------------------
// Composer
// -----------------------------------------------------------------------------

function Composer({
  open,
  initialBrief,
  onClose,
  onSent,
}: {
  open: boolean
  initialBrief: string
  onClose: () => void
  onSent: () => void
}) {
  const { businessId, capabilities, can } = useWorkspace()
  const { t, formatNumber } = useI18n()
  const formatValue = useFormatValue()

  const [brief, setBrief] = React.useState(initialBrief)
  const [generating, setGenerating] = React.useState(false)
  const [name, setName] = React.useState('')
  const [channels, setChannels] = React.useState<string[]>(['email'])
  const [segmentId, setSegmentId] = React.useState('')
  const [subject, setSubject] = React.useState('')
  const [body, setBody] = React.useState('')
  const [smsBody, setSmsBody] = React.useState('')
  const [reasoning, setReasoning] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const { data: segmentData } = useApi<{ segments: Segment[] }>(
    businessId && open ? `/api/v1/segments${query({ businessId })}` : null
  )

  const selectedSegment = segmentData?.segments.find((segment) => segment.id === segmentId)
  const reach = selectedSegment?.cached_count ?? null

  const estimatedCost = React.useMemo(() => {
    if (reach === null) return null
    const unit: Record<string, number> = { email: 0.0004, sms: 0.045, whatsapp: 0.035 }
    return channels.reduce((total, channel) => total + (unit[channel] ?? 0) * reach, 0)
  }, [channels, reach])

  const sms = smsSegments(smsBody)

  async function generate() {
    if (!businessId || !brief.trim()) return
    setGenerating(true)
    setError(null)
    try {
      const response = await apiPost<{ campaign: GeneratedCampaign }>('/api/v1/ai', {
        action: 'campaign',
        businessId,
        brief: brief.trim(),
      })
      const generated = response.campaign
      setName(generated.name)
      setChannels(generated.channels.length ? generated.channels : ['email'])
      setSubject(generated.subject ?? '')
      setBody(generated.email_body ?? '')
      setSmsBody(generated.sms_body ?? '')
      setReasoning(`${generated.expected_impact} — ${generated.reasoning}`)

      // Map the AI's suggested audience onto a real saved segment.
      const suggested = segmentData?.segments.find((segment) =>
        segment.name
          .toLowerCase()
          .includes((generated.suggested_segment_key ?? '').replace(/_/g, ' '))
      )
      if (suggested) setSegmentId(suggested.id)
    } catch (cause) {
      setError(toastError(cause, t, 'campaigns.generateFailed'))
    } finally {
      setGenerating(false)
    }
  }

  async function saveAndSend(sendNow: boolean) {
    if (!businessId) return
    setBusy(true)
    setError(null)
    try {
      const created = await apiPost<{ campaign_id: string; estimated_reach: number }>(
        '/api/v1/campaigns',
        {
          businessId,
          name: name.trim() || t('campaigns.untitled'),
          channels,
          segmentId: segmentId || null,
          subject: subject.trim() || null,
          bodyText: body.trim() || null,
          smsBody: smsBody.trim() || null,
          status: 'draft',
          generatedByAi: Boolean(reasoning),
          aiPrompt: brief.trim() || null,
        }
      )

      if (sendNow) {
        await apiPost(`/api/v1/campaigns/${created.campaign_id}/send`, { businessId })
      }
      onSent()
    } catch (cause) {
      setError(toastError(cause, t, 'campaigns.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{t('campaigns.newCampaign')}</SheetTitle>
          <SheetDescription>{t('campaigns.composerSubtitle')}</SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-5 px-4 pb-10">
          {error && (
            <div role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {capabilities?.ai && can('ai:use') && (
            <div className="rounded-xl border bg-muted/30 p-4">
              <Label htmlFor="brief" className="flex items-center gap-2 text-sm">
                <Sparkles className="size-4 text-primary" />
                {t('campaigns.briefLabel')}
              </Label>
              <Textarea
                id="brief"
                value={brief}
                onChange={(event) => setBrief(event.target.value)}
                rows={2}
                className="mt-2 bg-background"
                placeholder={t('campaigns.briefPlaceholder')}
              />
              <Button
                size="sm"
                className="mt-2 gap-2"
                onClick={() => void generate()}
                disabled={generating || !brief.trim()}
              >
                {generating ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Sparkles className="size-4" />
                )}
                {t('campaigns.generate')}
              </Button>
              {reasoning && (
                <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">{reasoning}</p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="campaign-name">{t('campaigns.name')}</Label>
            <Input
              id="campaign-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="h-11"
              placeholder={t('campaigns.namePlaceholder')}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="campaign-segment">{t('campaigns.audience')}</Label>
            <Select
              value={segmentId || 'none'}
              onValueChange={(value) => setSegmentId(value === 'none' ? '' : value)}
            >
              <SelectTrigger id="campaign-segment" className="h-11">
                <SelectValue placeholder={t('campaigns.audiencePlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t('campaigns.everyone')}</SelectItem>
                {(segmentData?.segments ?? []).map((segment) => (
                  <SelectItem key={segment.id} value={segment.id}>
                    {segment.cached_count !== null
                      ? t('campaigns.segmentCount', {
                          name: segment.name,
                          count: segment.cached_count,
                        })
                      : segment.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {reach !== null && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Users className="size-3.5" />
                {estimatedCost !== null && estimatedCost > 0
                  ? t('campaigns.reachWithCost', {
                      count: reach,
                      cost: formatValue(estimatedCost, 'currency'),
                    })
                  : t('campaigns.reach', { count: reach })}
              </p>
            )}
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t('campaigns.channelsLabel')}</legend>
            <div className="flex flex-wrap gap-2">
              {(['email', 'sms', 'whatsapp', 'push', 'wallet'] as const).map((channel) => {
                // Wallet pushes ride on whichever wallet platform is configured.
                const capabilityKey =
                  channel === 'push' ? 'webPush' : channel === 'wallet' ? 'appleWallet' : channel
                const available = capabilities?.[capabilityKey] ?? false
                const selected = channels.includes(channel)
                const Icon = CHANNEL_ICONS[channel] ?? Mail
                const label = t(`campaigns.channels.${channel}` as TranslationKey)
                return (
                  <button
                    key={channel}
                    type="button"
                    disabled={!available}
                    aria-pressed={selected}
                    onClick={() =>
                      setChannels((current) =>
                        current.includes(channel)
                          ? current.filter((item) => item !== channel)
                          : [...current, channel]
                      )
                    }
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                      selected ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent'
                    }`}
                    title={
                      available ? undefined : t('campaigns.channelUnavailable', { channel: label })
                    }
                  >
                    <Icon className="size-3.5" />
                    {label}
                  </button>
                )
              })}
            </div>
          </fieldset>

          {channels.includes('email') && (
            <div className="space-y-3 rounded-xl border p-4">
              <p className="text-sm font-medium">{t('campaigns.emailSection')}</p>
              <div className="space-y-2">
                <Label htmlFor="campaign-subject">{t('campaigns.subject')}</Label>
                <Input
                  id="campaign-subject"
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                  className="h-11"
                  maxLength={200}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="campaign-body">{t('campaigns.body')}</Label>
                <Textarea
                  id="campaign-body"
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  rows={6}
                />
                <p className="text-xs text-muted-foreground">
                  {t('campaigns.personalisation', {
                    tokens: '{{customer_first_name}}, {{business_name}}',
                  })}
                </p>
              </div>
            </div>
          )}

          {channels.includes('sms') && (
            <div className="space-y-2 rounded-xl border p-4">
              <Label htmlFor="campaign-sms">{t('campaigns.smsSection')}</Label>
              <Textarea
                id="campaign-sms"
                value={smsBody}
                onChange={(event) => setSmsBody(event.target.value)}
                rows={3}
              />
              <p className="text-xs text-muted-foreground">
                {t('campaigns.smsCount', {
                  characters: formatNumber(sms.characters),
                  count: sms.segments,
                })}
                {sms.unicode ? ` · ${t('campaigns.smsUnicode')}` : ''}
              </p>
            </div>
          )}

          <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row">
            <Button
              variant="outline"
              className="h-11 flex-1"
              disabled={busy}
              onClick={() => void saveAndSend(false)}
            >
              {t('campaigns.saveDraft')}
            </Button>
            {can('campaigns:send') && (
              <Button
                className="h-11 flex-1 gap-2"
                disabled={busy || channels.length === 0}
                onClick={() => void saveAndSend(true)}
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                {t('campaigns.sendNow')}
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
