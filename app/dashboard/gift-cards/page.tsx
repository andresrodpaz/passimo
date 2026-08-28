'use client'

import * as React from 'react'
import {
  Ban,
  Check,
  Copy,
  CreditCard,
  ExternalLink,
  Gift,
  Loader2,
  Plus,
  Search,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useApi, apiPost, apiFetch, query } from '@/lib/client/api'
import { useWorkspace } from '@/lib/client/workspace'
import { AsyncBoundary, EmptyState } from '@/components/states'
import { MetricGrid, MetricTile, useFormatValue } from '@/components/metrics'
import { FeatureGate, UpgradePrompt } from '@/components/billing/upgrade'
import { useRelativeTime } from '@/lib/client/hooks'
import { newIdempotencyKey } from '@/lib/client/idempotency'
import { toastError } from '@/lib/client/api-errors'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'

type GiftCardRow = {
  id: string
  code: string
  status: 'active' | 'depleted' | 'expired' | 'void'
  initialValue: number
  remainingValue: number
  currency: string
  recipientEmail: string | null
  recipientName: string | null
  purchaserName: string | null
  source: string
  createdAt: string
  deliveredAt: string | null
  deliverAt: string | null
}

type Stats = {
  issued_count: number
  active_count: number
  issued_value: number
  outstanding_value: number
  redeemed_value: number
  issued_30d: number
  issued_value_30d: number
  breakage_value: number
}

type Response = {
  gift_cards: GiftCardRow[]
  stats: Stats
  pagination: { total: number; limit: number; offset: number }
}

const SUGGESTED = [10, 25, 50, 100]

/**
 * Gift cards.
 *
 * Led by the two numbers a merchant actually cares about: how much cash came in
 * and how much they still owe. Outstanding value is a liability, not revenue,
 * and showing it as one number stops the classic mistake of spending money that
 * is still a promise.
 */
export default function GiftCardsPage() {
  return (
    <FeatureGate
      feature="gift_cards"
      fallback={
        <div className="space-y-6">
          <Header />
          <GiftCardUpsell />
        </div>
      }
    >
      <GiftCardsView />
    </FeatureGate>
  )
}

function Header({ action }: { action?: React.ReactNode }) {
  const { t } = useI18n()
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">{t('giftCards.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('giftCards.subtitle')}</p>
      </div>
      {action}
    </header>
  )
}

function GiftCardUpsell() {
  const { business } = useWorkspace()
  const { t } = useI18n()

  const reasons = [
    { key: 'cash', title: t('giftCards.whyCashTitle'), body: t('giftCards.whyCashBody') },
    { key: 'new', title: t('giftCards.whyNewTitle'), body: t('giftCards.whyNewBody') },
    {
      key: 'breakage',
      title: t('giftCards.whyBreakageTitle'),
      body: t('giftCards.whyBreakageBody'),
    },
  ]

  return (
    <div className="space-y-4">
      <section className="rounded-xl border bg-card p-6">
        <h3 className="text-base font-semibold">{t('giftCards.why')}</h3>
        <ul className="mt-4 grid gap-3 sm:grid-cols-3">
          {reasons.map((item) => (
            <li key={item.key} className="rounded-lg border bg-muted/30 p-4">
              <p className="text-sm font-medium">{item.title}</p>
              <p className="mt-1 text-xs text-muted-foreground">{item.body}</p>
            </li>
          ))}
        </ul>
        {business?.slug && (
          <p className="mt-4 text-xs text-muted-foreground">
            {t('giftCards.shopWouldLiveAt', { path: `/gift/${business.slug}` })}
          </p>
        )}
      </section>
      <UpgradePrompt
        feature="gift_cards"
        title={t('giftCards.upsellTitle')}
        description={t('giftCards.upsellBody')}
      />
    </div>
  )
}

function GiftCardsView() {
  const { businessId, business, can } = useWorkspace()
  const { t, formatNumber } = useI18n()
  const formatValue = useFormatValue()
  const relative = useRelativeTime()
  const [status, setStatus] = React.useState<string>('all')
  const [search, setSearch] = React.useState('')
  const [debounced, setDebounced] = React.useState('')
  const [issuing, setIssuing] = React.useState(false)
  const [copied, setCopied] = React.useState<string | null>(null)

  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(search), 300)
    return () => clearTimeout(timer)
  }, [search])

  const key = businessId
    ? `/api/v1/gift-cards${query({ businessId, status, search: debounced, limit: 50 })}`
    : null
  const cards = useApi<Response>(key)

  const shopUrl =
    typeof window !== 'undefined' && business?.slug
      ? `${window.location.origin}/gift/${business.slug}`
      : ''

  async function copyShopLink() {
    if (!shopUrl) return
    await navigator.clipboard.writeText(shopUrl)
    setCopied('shop')
    setTimeout(() => setCopied(null), 2000)
  }

  async function voidCard(id: string) {
    if (!businessId) return
    await apiFetch(`/api/v1/gift-cards/${id}`, {
      method: 'DELETE',
      body: JSON.stringify({ businessId }),
    })
    void cards.mutate()
  }

  return (
    <div className="space-y-6">
      <Header
        action={
          can('programs:write') && (
            <div className="flex flex-wrap gap-2">
              {shopUrl && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => void copyShopLink()}
                >
                  {copied === 'shop' ? <Check className="size-4" /> : <Copy className="size-4" />}
                  {t('giftCards.copyShopLink')}
                </Button>
              )}
              <Button size="sm" className="gap-2" onClick={() => setIssuing(true)}>
                <Plus className="size-4" />
                {t('giftCards.issueCard')}
              </Button>
            </div>
          )
        }
      />

      {cards.data && (
        <MetricGrid>
          <MetricTile
            label={t('giftCards.sold30')}
            value={formatValue(cards.data.stats.issued_value_30d, 'currency')}
            icon={CreditCard}
            hint={t('giftCards.sold30Hint')}
          />
          <MetricTile
            label={t('giftCards.outstanding')}
            value={formatValue(cards.data.stats.outstanding_value, 'currency')}
            icon={Gift}
            hint={t('giftCards.outstandingHint')}
          />
          <MetricTile
            label={t('giftCards.redeemed')}
            value={formatValue(cards.data.stats.redeemed_value, 'currency')}
            hint={t('giftCards.redeemedHint')}
          />
          <MetricTile
            label={t('giftCards.activeCards')}
            value={formatNumber(cards.data.stats.active_count)}
            hint={t('giftCards.activeCardsHint')}
          />
        </MetricGrid>
      )}

      {shopUrl && (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">{t('giftCards.onlineShop')}</p>
            <p className="truncate text-xs text-muted-foreground">{shopUrl}</p>
          </div>
          <Button asChild variant="outline" size="sm" className="gap-2">
            <a href={shopUrl} target="_blank" rel="noreferrer">
              {t('common.open')}
              <ExternalLink className="size-3.5" />
            </a>
          </Button>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('giftCards.searchPlaceholder')}
            className="h-10 pl-9"
            aria-label={t('giftCards.searchLabel')}
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-10 w-[150px]" aria-label={t('common.status')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('giftCards.filter.all')}</SelectItem>
            <SelectItem value="active">{t('giftCards.filter.active')}</SelectItem>
            <SelectItem value="depleted">{t('giftCards.filter.depleted')}</SelectItem>
            <SelectItem value="expired">{t('giftCards.filter.expired')}</SelectItem>
            <SelectItem value="void">{t('giftCards.filter.void')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <AsyncBoundary
        data={cards.data}
        error={cards.error}
        isLoading={cards.isLoading}
        onRetry={() => void cards.mutate()}
        isEmpty={(value) => value.gift_cards.length === 0}
        empty={
          <EmptyState
            icon={Gift}
            title={debounced ? t('giftCards.noMatches') : t('giftCards.empty')}
            description={debounced ? t('giftCards.noMatchesBody') : t('giftCards.emptyBody')}
            action={
              can('programs:write') && !debounced ? (
                <Button size="sm" onClick={() => setIssuing(true)}>
                  {t('giftCards.emptyCta')}
                </Button>
              ) : undefined
            }
          />
        }
      >
        {(value) => (
          <div className="overflow-hidden rounded-xl border">
            <table className="w-full text-sm">
              <caption className="sr-only">{t('giftCards.tableCaption')}</caption>
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    {t('giftCards.columns.code')}
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    {t('giftCards.columns.recipient')}
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">
                    {t('giftCards.columns.balance')}
                  </th>
                  <th scope="col" className="hidden px-4 py-2.5 font-medium sm:table-cell">
                    {t('giftCards.columns.issued')}
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    {t('giftCards.columns.status')}
                  </th>
                  <th scope="col" className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {value.gift_cards.map((card) => (
                  <tr key={card.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3 font-mono text-xs uppercase">{card.code}</td>
                    <td className="px-4 py-3">
                      <span className="block truncate">{card.recipientName ?? '—'}</span>
                      {card.recipientEmail && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {card.recipientEmail}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <span className="font-medium">
                        {formatValue(card.remainingValue, 'currency', card.currency)}
                      </span>
                      {card.remainingValue !== card.initialValue && (
                        <span className="block text-xs text-muted-foreground">
                          {t('giftCards.ofTotal', {
                            amount: formatValue(card.initialValue, 'currency', card.currency),
                          })}
                        </span>
                      )}
                    </td>
                    <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">
                      {relative(card.createdAt, { short: true })}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge card={card} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      {can('programs:write') && card.status === 'active' && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={() => void voidCard(card.id)}
                          aria-label={t('giftCards.cancelCard', { code: card.code })}
                          title={t('giftCards.cancelCardTitle')}
                        >
                          <Ban className="size-3.5" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AsyncBoundary>

      <Sheet open={issuing} onOpenChange={setIssuing}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          {issuing && (
            <IssueForm
              businessId={businessId}
              onIssued={() => {
                setIssuing(false)
                void cards.mutate()
              }}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}

function StatusBadge({ card }: { card: GiftCardRow }) {
  const { t } = useI18n()

  if (card.status === 'active' && card.deliverAt && !card.deliveredAt) {
    return <Badge variant="outline">{t('giftCards.scheduled')}</Badge>
  }

  const map = {
    active: { label: t('giftCards.filter.active'), variant: 'secondary' as const },
    depleted: { label: t('giftCards.filter.depleted'), variant: 'outline' as const },
    expired: { label: t('giftCards.filter.expired'), variant: 'outline' as const },
    void: { label: t('giftCards.filter.void'), variant: 'destructive' as const },
  }
  const entry = map[card.status]
  return <Badge variant={entry.variant}>{entry.label}</Badge>
}

function IssueForm({ businessId, onIssued }: { businessId: string | null; onIssued: () => void }) {
  const { t } = useI18n()
  const formatValue = useFormatValue()
  const [amount, setAmount] = React.useState('25')
  const [recipientName, setRecipientName] = React.useState('')
  const [recipientEmail, setRecipientEmail] = React.useState('')
  const [message, setMessage] = React.useState('')
  const [emailIt, setEmailIt] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [issued, setIssued] = React.useState<{ code: string } | null>(null)

  // A fresh key per mount: tapping "Issue" twice on a slow connection must not
  // create two cards, and the counter is exactly where that happens.
  const [idempotencyKey] = React.useState(() => newIdempotencyKey('giftcard'))

  async function submit() {
    if (!businessId) return
    setBusy(true)
    setError(null)
    try {
      const result = await apiPost<{ code: string }>('/api/v1/gift-cards', {
        businessId,
        amount: Number(amount),
        recipientName: recipientName.trim() || null,
        recipientEmail: emailIt && recipientEmail.trim() ? recipientEmail.trim() : null,
        message: message.trim() || null,
        skipDelivery: !emailIt,
        idempotencyKey,
      })
      setIssued(result)
    } catch (cause) {
      setError(toastError(cause, t, 'giftCards.issueFailed'))
    } finally {
      setBusy(false)
    }
  }

  if (issued) {
    return (
      <>
        <SheetHeader>
          <SheetTitle>{t('giftCards.issued')}</SheetTitle>
          <SheetDescription>
            {emailIt && recipientEmail
              ? t('giftCards.issuedOnItsWay', { email: recipientEmail })
              : t('giftCards.issuedWriteCode')}
          </SheetDescription>
        </SheetHeader>
        <div className="mt-8 px-4">
          <p className="rounded-xl border-2 border-dashed p-6 text-center font-mono text-2xl font-semibold uppercase tracking-widest">
            {issued.code}
          </p>
          <Button className="mt-6 h-11 w-full" onClick={onIssued}>
            {t('common.done')}
          </Button>
        </div>
      </>
    )
  }

  const value = Number(amount) || 0

  return (
    <>
      <SheetHeader>
        <SheetTitle>{t('giftCards.issueTitle')}</SheetTitle>
        <SheetDescription>{t('giftCards.issueSubtitle')}</SheetDescription>
      </SheetHeader>

      <div className="mt-6 space-y-5 px-4 pb-8">
        {error && (
          <div role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t('giftCards.amount')}</legend>
          <div className="flex flex-wrap gap-2">
            {SUGGESTED.map((suggestion) => (
              <Button
                key={suggestion}
                type="button"
                variant={value === suggestion ? 'default' : 'outline'}
                size="sm"
                onClick={() => setAmount(String(suggestion))}
              >
                {formatValue(suggestion, 'currency')}
              </Button>
            ))}
          </div>
          <Input
            type="number"
            min={1}
            max={10000}
            step="0.01"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className="h-11"
            aria-label={t('giftCards.amountLabel')}
          />
        </fieldset>

        <div className="space-y-2">
          <Label htmlFor="gc-name">
            {t('giftCards.recipientName')} ({t('common.optional').toLocaleLowerCase(t.tag)})
          </Label>
          <Input
            id="gc-name"
            value={recipientName}
            onChange={(event) => setRecipientName(event.target.value)}
            placeholder={t('giftCards.recipientNamePlaceholder')}
            className="h-11"
          />
        </div>

        <div className="flex items-center justify-between rounded-lg border p-3">
          <div className="pr-3">
            <Label htmlFor="gc-email-toggle">{t('giftCards.emailIt')}</Label>
            <p className="text-xs text-muted-foreground">{t('giftCards.emailItHint')}</p>
          </div>
          <Switch id="gc-email-toggle" checked={emailIt} onCheckedChange={setEmailIt} />
        </div>

        <div className={cn('space-y-4', !emailIt && 'pointer-events-none opacity-50')}>
          <div className="space-y-2">
            <Label htmlFor="gc-email">{t('giftCards.recipientEmail')}</Label>
            <Input
              id="gc-email"
              type="email"
              value={recipientEmail}
              onChange={(event) => setRecipientEmail(event.target.value)}
              placeholder="maria@example.com"
              className="h-11"
              disabled={!emailIt}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="gc-message">
              {t('giftCards.message')} ({t('common.optional').toLocaleLowerCase(t.tag)})
            </Label>
            <Textarea
              id="gc-message"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder={t('giftCards.messagePlaceholder')}
              rows={2}
              disabled={!emailIt}
            />
          </div>
        </div>

        <Button
          className="h-11 w-full gap-2"
          disabled={busy || value <= 0 || (emailIt && !recipientEmail.trim())}
          onClick={() => void submit()}
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          {t('giftCards.issueAmountCta', { amount: formatValue(value, 'currency') })}
        </Button>
      </div>
    </>
  )
}
