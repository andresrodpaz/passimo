'use client'

import * as React from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  ExternalLink,
  Heart,
  Loader2,
  MessageSquareWarning,
  Share2,
  Star,
  TrendingUp,
  UserPlus,
  Users,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useApi, apiPost, query } from '@/lib/client/api'
import { useWorkspace } from '@/lib/client/workspace'
import { AsyncBoundary, EmptyState } from '@/components/states'
import { MetricGrid, MetricTile, useFormatValue } from '@/components/metrics'
import { useRelativeTime } from '@/lib/client/hooks'
import { toastError } from '@/lib/client/api-errors'
import { useI18n } from '@/lib/i18n'

type GrowthResponse = {
  referrals: {
    total: number
    pending: number
    qualified: number
    conversion_rate: number
    referred_customers: number
    referred_revenue: number
    referred_avg_visits: number
    advocates: number
  }
  advocates: Array<{
    customerId: string
    name: string | null
    email: string
    referralCode: string | null
    total: number
    qualified: number
    revenueGenerated: number
  }>
  program: {
    advocateReward: number
    friendReward: number
    unitPlural: string
    qualifyingEvents: number
    advocateRuleActive: boolean
    friendRuleActive: boolean
  }
  reputation: {
    nps: number | null
    responses: number
    promoters: number
    passives: number
    detractors: number
    unresolved: number
    review_prompted: number
    review_clicked: number
    review_click_rate: number
  }
  unresolved_feedback: Array<{
    id: string
    customerId: string | null
    customerName: string | null
    customerEmail: string | null
    score: number
    scaleMax: number
    comment: string | null
    respondedAt: string
  }>
  merchant_referral: {
    code: string
    url: string
    referred: Array<{ id: string; name: string; plan: string; joinedAt: string; converted: boolean }>
    creditEarned: number
    pendingCredit: number
  } | null
  assets: {
    join_url: string
    gift_url: string
    qr_url: string
    google_review_url: string | null
    instagram: string | null
  }
}

/**
 * Grow.
 *
 * Referrals, reputation and share assets on one screen because they are one
 * job: getting more customers out of the ones you already have. Three separate
 * screens would each be opened once.
 */
export default function GrowthPage() {
  const { businessId } = useWorkspace()
  const { t, formatNumber } = useI18n()
  const formatValue = useFormatValue()
  const key = businessId ? `/api/v1/growth${query({ businessId, days: 90 })}` : null
  const growth = useApi<GrowthResponse>(key)

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-xl font-semibold tracking-tight">{t('growth.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('growth.subtitle')}</p>
      </header>

      <AsyncBoundary
        data={growth.data}
        error={growth.error}
        isLoading={growth.isLoading}
        onRetry={() => void growth.mutate()}
      >
        {(data) => (
          <>
            <MetricGrid>
              <MetricTile
                label={t('growth.referredCustomers')}
                value={formatNumber(data.referrals.referred_customers)}
                icon={UserPlus}
                hint={t('growth.referredCustomersHint')}
              />
              <MetricTile
                label={t('growth.referredRevenue')}
                value={formatValue(data.referrals.referred_revenue, 'currency')}
                icon={TrendingUp}
                hint={t('growth.referredRevenueHint')}
              />
              <MetricTile
                label={t('growth.nps')}
                value={data.reputation.nps === null ? '—' : formatNumber(data.reputation.nps)}
                icon={Heart}
                hint={t('growth.npsHint')}
              />
              <MetricTile
                label={t('growth.needsAttention')}
                value={formatNumber(data.reputation.unresolved)}
                icon={MessageSquareWarning}
                invertDelta
                hint={t('growth.needsAttentionHint')}
              />
            </MetricGrid>

            <Tabs defaultValue={data.reputation.unresolved > 0 ? 'reviews' : 'referrals'}>
              <TabsList>
                <TabsTrigger value="referrals">{t('growth.tabReferrals')}</TabsTrigger>
                <TabsTrigger value="reviews">
                  {t('growth.tabReviews')}
                  {data.reputation.unresolved > 0 && (
                    <span className="ml-1.5 rounded-full bg-destructive px-1.5 text-[10px] font-semibold text-destructive-foreground">
                      {formatNumber(data.reputation.unresolved)}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="share">{t('growth.tabShare')}</TabsTrigger>
                <TabsTrigger value="partners">{t('growth.tabPartners')}</TabsTrigger>
              </TabsList>

              <TabsContent value="referrals" className="mt-4 space-y-4">
                <ReferralProgramCard
                  businessId={businessId}
                  program={data.program}
                  onSaved={() => void growth.mutate()}
                />
                <AdvocatesCard advocates={data.advocates} stats={data.referrals} />
              </TabsContent>

              <TabsContent value="reviews" className="mt-4 space-y-4">
                <ReviewFunnelCard reputation={data.reputation} assets={data.assets} />
                <UnresolvedFeedback
                  businessId={businessId}
                  entries={data.unresolved_feedback}
                  onResolved={() => void growth.mutate()}
                />
              </TabsContent>

              <TabsContent value="share" className="mt-4">
                <ShareAssets assets={data.assets} />
              </TabsContent>

              <TabsContent value="partners" className="mt-4">
                <MerchantReferral summary={data.merchant_referral} />
              </TabsContent>
            </Tabs>
          </>
        )}
      </AsyncBoundary>
    </div>
  )
}

function ReferralProgramCard({
  businessId,
  program,
  onSaved,
}: {
  businessId: string | null
  program: GrowthResponse['program']
  onSaved: () => void
}) {
  const { can } = useWorkspace()
  const { t } = useI18n()
  const [advocate, setAdvocate] = React.useState(String(program.advocateReward))
  const [friend, setFriend] = React.useState(String(program.friendReward))
  const [active, setActive] = React.useState(program.advocateRuleActive || program.friendRuleActive)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [saved, setSaved] = React.useState(false)

  async function save() {
    if (!businessId) return
    setBusy(true)
    setError(null)
    try {
      await apiPost('/api/v1/growth', {
        action: 'update_referral_program',
        businessId,
        advocateReward: Number(advocate) || 0,
        friendReward: Number(friend) || 0,
        isActive: active,
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      onSaved()
    } catch (cause) {
      setError(toastError(cause, t, 'common.couldNotSave'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-xl border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold">{t('growth.programTitle')}</h3>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">{t('growth.programBody')}</p>
        </div>
        {can('programs:write') && (
          <Switch
            checked={active}
            onCheckedChange={setActive}
            aria-label={t('growth.programToggleLabel')}
          />
        )}
      </div>

      {error && (
        <div role="alert" className="mt-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="advocate-reward">{t('growth.advocateGets')}</Label>
          <div className="flex items-center gap-2">
            <Input
              id="advocate-reward"
              type="number"
              min={0}
              value={advocate}
              onChange={(event) => setAdvocate(event.target.value)}
              className="h-11"
              disabled={!can('programs:write')}
            />
            <span className="shrink-0 text-sm text-muted-foreground">{program.unitPlural}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {t('growth.advocateGetsHint', { count: program.qualifyingEvents })}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="friend-reward">{t('growth.friendGets')}</Label>
          <div className="flex items-center gap-2">
            <Input
              id="friend-reward"
              type="number"
              min={0}
              value={friend}
              onChange={(event) => setFriend(event.target.value)}
              className="h-11"
              disabled={!can('programs:write')}
            />
            <span className="shrink-0 text-sm text-muted-foreground">{program.unitPlural}</span>
          </div>
          <p className="text-xs text-muted-foreground">{t('growth.friendGetsHint')}</p>
        </div>
      </div>

      {can('programs:write') && (
        <Button className="mt-5 gap-2" disabled={busy} onClick={() => void save()}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          {saved ? <Check className="size-4" /> : null}
          {saved ? t('common.saved') : t('growth.saveRewards')}
        </Button>
      )}
    </section>
  )
}

function AdvocatesCard({
  advocates,
  stats,
}: {
  advocates: GrowthResponse['advocates']
  stats: GrowthResponse['referrals']
}) {
  const { t, formatNumber, formatPercent } = useI18n()
  const formatValue = useFormatValue()

  if (advocates.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title={t('growth.noReferrals')}
        description={t('growth.noReferralsBody')}
      />
    )
  }

  return (
    <section className="rounded-xl border bg-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b p-5">
        <h3 className="text-base font-semibold">{t('growth.advocates')}</h3>
        <p className="text-sm text-muted-foreground">
          {t('growth.advocatesSummary', {
            qualified: formatNumber(stats.qualified),
            total: formatNumber(stats.total),
            rate: formatPercent(stats.conversion_rate / 100, 0),
          })}
        </p>
      </div>
      <ul className="divide-y">
        {advocates.map((advocate, index) => (
          <li key={advocate.customerId} className="flex items-center gap-3 p-4">
            <span
              aria-hidden
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold"
            >
              {index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <Link
                href={`/dashboard/customers/${advocate.customerId}`}
                className="block truncate font-medium hover:underline"
              >
                {advocate.name ?? advocate.email}
              </Link>
              <p className="truncate text-xs text-muted-foreground">
                {t('growth.advocateConverted', {
                  qualified: formatNumber(advocate.qualified),
                  total: formatNumber(advocate.total),
                })}
              </p>
            </div>
            <div className="text-right">
              <p className="font-medium tabular-nums">
                {formatValue(advocate.revenueGenerated, 'currency')}
              </p>
              <p className="text-xs text-muted-foreground">{t('growth.broughtIn')}</p>
            </div>
          </li>
        ))}
      </ul>
      <p className="border-t p-4 text-xs text-muted-foreground">{t('growth.advocatesNote')}</p>
    </section>
  )
}

function ReviewFunnelCard({
  reputation,
  assets,
}: {
  reputation: GrowthResponse['reputation']
  assets: GrowthResponse['assets']
}) {
  const { t, formatNumber, formatPercent } = useI18n()
  const total = reputation.responses || 1

  const cells = [
    {
      key: 'promoters',
      label: t('growth.promoters'),
      value: formatNumber(reputation.promoters),
      tone: 'text-emerald-600 dark:text-emerald-500',
    },
    {
      key: 'passives',
      label: t('growth.passives'),
      value: formatNumber(reputation.passives),
      tone: 'text-muted-foreground',
    },
    {
      key: 'detractors',
      label: t('growth.detractors'),
      value: formatNumber(reputation.detractors),
      tone: 'text-red-600 dark:text-red-400',
    },
    {
      key: 'clicked',
      label: t('growth.clickedThrough'),
      value: formatPercent(reputation.review_click_rate / 100, 0),
      tone: '',
    },
  ]

  return (
    <section className="rounded-xl border bg-card p-5">
      <h3 className="text-base font-semibold">{t('growth.reviewLoop')}</h3>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t('growth.reviewLoopBody')}</p>

      <dl className="mt-5 grid gap-4 sm:grid-cols-4">
        {cells.map((item) => (
          <div key={item.key}>
            <dt className="text-xs text-muted-foreground">{item.label}</dt>
            <dd className={`text-xl font-semibold tabular-nums ${item.tone}`}>{item.value}</dd>
          </div>
        ))}
      </dl>

      <div
        className="mt-5 h-2 overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={t('growth.distributionLabel')}
      >
        <div className="flex h-full">
          <div
            className="bg-emerald-500"
            style={{ width: `${(reputation.promoters / total) * 100}%` }}
          />
          <div
            className="bg-muted-foreground/30"
            style={{ width: `${(reputation.passives / total) * 100}%` }}
          />
          <div
            className="bg-red-500"
            style={{ width: `${(reputation.detractors / total) * 100}%` }}
          />
        </div>
      </div>

      {!assets.google_review_url && (
        <p className="mt-4 flex items-start gap-2 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-500">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            {t('growth.noReviewLink')}{' '}
            <Link href="/dashboard/settings" className="font-medium underline">
              {t('growth.addItInSettings')}
            </Link>
          </span>
        </p>
      )}
    </section>
  )
}

function UnresolvedFeedback({
  businessId,
  entries,
  onResolved,
}: {
  businessId: string | null
  entries: GrowthResponse['unresolved_feedback']
  onResolved: () => void
}) {
  const { t } = useI18n()
  const relative = useRelativeTime()
  const [open, setOpen] = React.useState<string | null>(null)
  const [note, setNote] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  async function resolve(id: string) {
    if (!businessId || !note.trim()) return
    setBusy(true)
    try {
      await apiPost('/api/v1/growth', {
        action: 'resolve_feedback',
        businessId,
        feedbackId: id,
        note: note.trim(),
      })
      setOpen(null)
      setNote('')
      onResolved()
    } finally {
      setBusy(false)
    }
  }

  if (entries.length === 0) {
    return (
      <EmptyState
        icon={Star}
        title={t('growth.nothingToFix')}
        description={t('growth.nothingToFixBody')}
      />
    )
  }

  return (
    <section className="rounded-xl border border-destructive/30 bg-card">
      <div className="border-b p-5">
        <h3 className="text-base font-semibold">{t('growth.unresolved')}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{t('growth.unresolvedBody')}</p>
      </div>
      <ul className="divide-y">
        {entries.map((entry) => (
          <li key={entry.id} className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Badge variant="destructive">
                    {entry.score}/{entry.scaleMax}
                  </Badge>
                  {entry.customerId ? (
                    <Link
                      href={`/dashboard/customers/${entry.customerId}`}
                      className="font-medium hover:underline"
                    >
                      {entry.customerName ?? entry.customerEmail ?? t('growth.aCustomer')}
                    </Link>
                  ) : (
                    <span className="font-medium">{t('common.anonymous')}</span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {relative(entry.respondedAt, { short: true })}
                  </span>
                </div>
                {entry.comment && (
                  <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                    &ldquo;{entry.comment}&rdquo;
                  </p>
                )}
              </div>
              <Button
                variant={open === entry.id ? 'secondary' : 'outline'}
                size="sm"
                onClick={() => setOpen(open === entry.id ? null : entry.id)}
              >
                {open === entry.id ? t('common.cancel') : t('growth.markHandled')}
              </Button>
            </div>

            {open === entry.id && (
              <div className="mt-3 space-y-2">
                <Label htmlFor={`note-${entry.id}`} className="text-xs">
                  {t('growth.resolutionLabel')}
                </Label>
                <Textarea
                  id={`note-${entry.id}`}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder={t('growth.resolutionPlaceholder')}
                  rows={2}
                />
                <Button
                  size="sm"
                  className="gap-2"
                  disabled={busy || !note.trim()}
                  onClick={() => void resolve(entry.id)}
                >
                  {busy && <Loader2 className="size-4 animate-spin" />}
                  {t('common.save')}
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

function ShareAssets({ assets }: { assets: GrowthResponse['assets'] }) {
  const { t } = useI18n()
  const [copied, setCopied] = React.useState<string | null>(null)

  async function copy(label: string, value: string) {
    await navigator.clipboard.writeText(value)
    setCopied(label)
    setTimeout(() => setCopied(null), 2000)
  }

  const links = [
    { key: 'join', label: t('growth.joinLink'), value: assets.join_url, note: t('growth.joinLinkNote') },
    { key: 'gift', label: t('growth.giftLink'), value: assets.gift_url, note: t('growth.giftLinkNote') },
  ]

  return (
    <div className="space-y-4">
      <section className="rounded-xl border bg-card p-5">
        <h3 className="text-base font-semibold">{t('growth.yourLinks')}</h3>
        <ul className="mt-4 space-y-3">
          {links.map((link) => (
            <li key={link.key} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{link.label}</p>
                <p className="truncate text-xs text-muted-foreground">{link.value}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{link.note}</p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => void copy(link.key, link.value)}
                >
                  {copied === link.key ? <Check className="size-4" /> : <Copy className="size-4" />}
                  {t('common.copy')}
                </Button>
                <Button asChild variant="ghost" size="icon" className="size-9">
                  <a
                    href={link.value}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={t('growth.openLink', { label: link.label })}
                  >
                    <ExternalLink className="size-4" />
                  </a>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border bg-card p-5">
        <h3 className="text-base font-semibold">{t('growth.counterQr')}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{t('growth.counterQrBody')}</p>
        <div className="mt-4 flex flex-wrap items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/v1/public/qr?data=${encodeURIComponent(assets.join_url)}&size=200`}
            alt={t('growth.qrAlt')}
            className="size-32 rounded-lg border bg-white p-2"
          />
          <Button asChild variant="outline" className="gap-2">
            <a href={assets.qr_url} download>
              <Download className="size-4" />
              {t('common.downloadForPrint')}
            </a>
          </Button>
        </div>
      </section>

      <section className="rounded-xl border bg-card p-5">
        <h3 className="flex items-center gap-2 text-base font-semibold">
          <Share2 className="size-4" />
          {t('growth.whatToSay')}
        </h3>
        <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
          {(['growth.say1', 'growth.say2', 'growth.say3', 'growth.say4'] as const).map((key) => (
            <li key={key}>· {t(key)}</li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function MerchantReferral({ summary }: { summary: GrowthResponse['merchant_referral'] }) {
  const { t, formatNumber } = useI18n()
  const formatValue = useFormatValue()
  const [copied, setCopied] = React.useState(false)

  if (!summary) {
    return (
      <EmptyState
        icon={Users}
        title={t('growth.partnersUnavailable')}
        description={t('growth.partnersUnavailableBody')}
      />
    )
  }

  async function copy() {
    await navigator.clipboard.writeText(summary!.url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl border bg-card p-5">
        <h3 className="text-base font-semibold">{t('growth.referBusiness')}</h3>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          {t('growth.referBusinessBody', { credit: formatValue(50, 'currency') })}
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <code className="flex-1 truncate rounded-lg border bg-muted/50 px-3 py-2.5 text-sm">
            {summary.url}
          </code>
          <Button className="gap-2" onClick={() => void copy()}>
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied ? t('common.copied') : t('growth.copyLink')}
          </Button>
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">{t('growth.businessesReferred')}</dt>
            <dd className="text-xl font-semibold tabular-nums">
              {formatNumber(summary.referred.length)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t('growth.creditEarned')}</dt>
            <dd className="text-xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-500">
              {formatValue(summary.creditEarned, 'currency')}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t('growth.stillOnTrial')}</dt>
            <dd className="text-xl font-semibold tabular-nums">
              {formatNumber(summary.referred.filter((row) => !row.converted).length)}
            </dd>
          </div>
        </dl>
      </section>

      {summary.referred.length > 0 && (
        <section className="rounded-xl border bg-card">
          <h3 className="border-b p-5 text-base font-semibold">{t('growth.whoYouSent')}</h3>
          <ul className="divide-y">
            {summary.referred.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3 p-4">
                <span className="min-w-0 truncate font-medium">{row.name}</span>
                {row.converted ? (
                  <Badge variant="secondary">{row.plan}</Badge>
                ) : (
                  <Badge variant="outline">{t('growth.trialling')}</Badge>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
