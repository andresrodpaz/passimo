'use client'

import * as React from 'react'
import Link from 'next/link'
import {
  Search,
  Download,
  Upload,
  UserPlus,
  Star,
  Filter,
  Users,
  Gift,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useApi, query } from '@/lib/client/api'
import { useWorkspace } from '@/lib/client/workspace'
import { AsyncBoundary, EmptyState, LoadingRows } from '@/components/states'
import { useNow, useRelativeTime } from '@/lib/client/hooks'
import { useFormatValue } from '@/components/metrics'
import { isPlaceholderEmail } from '@/lib/customers/placeholder-email'
import { useI18n } from '@/lib/i18n'
import type { CustomerListItem } from '@/lib/customers/service'

type ListResponse = {
  customers: CustomerListItem[]
  pagination: { total: number; limit: number; offset: number; has_more: boolean }
}

type SegmentSummary = {
  id: string
  name: string
  cached_count: number | null
  is_system: boolean
}

const PAGE_SIZE = 50

/**
 * Customers.
 *
 * Real data, server-side search and pagination, saved segments, and the
 * operations merchants actually asked competitors for: import, export, VIP,
 * tags and churn visibility.
 */
export default function CustomersPage() {
  const { businessId, can } = useWorkspace()
  const { t, formatNumber } = useI18n()
  const [term, setTerm] = React.useState('')
  const [debounced, setDebounced] = React.useState('')
  const [segmentId, setSegmentId] = React.useState<string>('')
  const [sort, setSort] = React.useState<'recent' | 'spend' | 'visits' | 'churn' | 'name'>('recent')
  const [page, setPage] = React.useState(0)

  React.useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(term)
      setPage(0)
    }, 300)
    return () => clearTimeout(timer)
  }, [term])

  const { data: segmentData } = useApi<{ segments: SegmentSummary[] }>(
    businessId ? `/api/v1/segments${query({ businessId })}` : null
  )

  const listKey = businessId
    ? `/api/v1/customers${query({
        businessId,
        q: debounced,
        segmentId: segmentId || undefined,
        sort,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      })}`
    : null

  const { data, error, isLoading, mutate } = useApi<ListResponse>(listKey, {
    keepPreviousData: true,
  })

  const total = data?.pagination.total ?? 0

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{t('customers.title')}</h2>
          <p className="text-sm text-muted-foreground">
            {total > 0
              ? t('customers.subtitleCount', { count: total })
              : t('customers.subtitleDefault')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {can('customers:export') && businessId && (
            <Button asChild variant="outline" size="sm" className="gap-2">
              <a
                href={`/api/v1/customers/export${query({ businessId, segmentId: segmentId || undefined })}`}
              >
                <Download className="size-4" />
                {t('customers.export')}
              </a>
            </Button>
          )}
          {can('customers:import') && (
            <Button asChild variant="outline" size="sm" className="gap-2">
              <Link href="/dashboard/customers/import">
                <Upload className="size-4" />
                {t('customers.import')}
              </Link>
            </Button>
          )}
          {can('customers:write') && (
            <Button asChild size="sm" className="gap-2">
              <Link href="/pos">
                <UserPlus className="size-4" />
                {t('customers.addCustomer')}
              </Link>
            </Button>
          )}
        </div>
      </header>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder={t('customers.searchPlaceholder')}
            className="h-10 pl-9"
            aria-label={t('customers.searchLabel')}
          />
        </div>

        <Select
          value={segmentId || 'all'}
          onValueChange={(value) => {
            setSegmentId(value === 'all' ? '' : value)
            setPage(0)
          }}
        >
          <SelectTrigger className="h-10 w-full sm:w-[200px]" aria-label={t('customers.filterLabel')}>
            <Filter className="mr-1 size-3.5" />
            <SelectValue placeholder={t('customers.allCustomers')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('customers.allCustomers')}</SelectItem>
            {(segmentData?.segments ?? []).map((segment) => (
              <SelectItem key={segment.id} value={segment.id}>
                {segment.name}
                {segment.cached_count !== null ? ` (${formatNumber(segment.cached_count)})` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={sort} onValueChange={(value) => setSort(value as typeof sort)}>
          <SelectTrigger className="h-10 w-full sm:w-[170px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="recent">{t('customers.sort.recent')}</SelectItem>
            <SelectItem value="spend">{t('customers.sort.spend')}</SelectItem>
            <SelectItem value="visits">{t('customers.sort.visits')}</SelectItem>
            <SelectItem value="churn">{t('customers.sort.churn')}</SelectItem>
            <SelectItem value="name">{t('customers.sort.name')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <AsyncBoundary
        data={data}
        error={error}
        isLoading={isLoading}
        onRetry={() => void mutate()}
        loading={<LoadingRows rows={8} />}
        isEmpty={(value) => value.customers.length === 0}
        empty={
          debounced || segmentId ? (
            <EmptyState
              icon={Search}
              title={t('customers.noMatches')}
              description={t('customers.noMatchesBody')}
              action={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setTerm('')
                    setSegmentId('')
                  }}
                >
                  {t('customers.clearFilters')}
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={Users}
              title={t('customers.empty')}
              description={t('customers.emptyBody')}
              action={
                <Button asChild size="sm">
                  <Link href="/pos">{t('customers.emptyCta')}</Link>
                </Button>
              }
            />
          )
        }
      >
        {(value) => (
          <>
            <div className="overflow-hidden rounded-xl border bg-card">
              {/* Table on desktop, cards on mobile — a 7-column table is
                  unusable on a phone, and merchants check this on a phone. */}
              <table className="hidden w-full text-sm md:table">
                <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-4 py-2.5 font-medium">
                      {t('customers.columns.customer')}
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-medium">
                      {t('customers.columns.balance')}
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-medium">
                      {t('customers.columns.visits')}
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-medium">
                      {t('customers.columns.spend')}
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-medium">
                      {t('customers.columns.lastVisit')}
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-medium">
                      {t('customers.columns.status')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {value.customers.map((customer) => (
                    <CustomerRow key={customer.id} customer={customer} />
                  ))}
                </tbody>
              </table>

              <ul className="divide-y md:hidden">
                {value.customers.map((customer) => (
                  <li key={customer.id}>
                    <CustomerCard customer={customer} />
                  </li>
                ))}
              </ul>
            </div>

            {(value.pagination.has_more || page > 0) && (
              <nav
                className="flex items-center justify-between"
                aria-label={t('customers.paginationLabel')}
              >
                <p className="text-xs text-muted-foreground">
                  {t('customers.pagination', {
                    from: page * PAGE_SIZE + 1,
                    to: page * PAGE_SIZE + value.customers.length,
                    total: value.pagination.total,
                  })}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === 0}
                    onClick={() => setPage((current) => Math.max(0, current - 1))}
                  >
                    {t('common.previous')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!value.pagination.has_more}
                    onClick={() => setPage((current) => current + 1)}
                  >
                    {t('common.next')}
                  </Button>
                </div>
              </nav>
            )}
          </>
        )}
      </AsyncBoundary>
    </div>
  )
}

function CustomerRow({ customer }: { customer: CustomerListItem }) {
  const { t } = useI18n()
  const formatValue = useFormatValue()
  const relative = useRelativeTime()

  return (
    <tr className="transition-colors hover:bg-muted/40">
      <td className="px-4 py-2.5">
        <Link
          href={`/dashboard/customers/${customer.id}`}
          className="flex items-center gap-2 font-medium hover:underline"
        >
          {customer.isVip && <Star className="size-3.5 shrink-0 fill-amber-400 text-amber-400" />}
          <span className="truncate">{customer.name || customer.email.split('@')[0]}</span>
        </Link>
        <span className="block truncate text-xs text-muted-foreground">
          {isPlaceholderEmail(customer.email) ? (customer.phone ?? '—') : customer.email}
        </span>
      </td>
      <td className="px-4 py-2.5 tabular-nums">
        {customer.rewardAvailable ? (
          <Badge className="gap-1 bg-emerald-600 hover:bg-emerald-600">
            <Gift className="size-3" />
            {t('customers.rewardReady')}
          </Badge>
        ) : (
          <>
            {customer.primaryBalance}
            {customer.primaryGoal ? (
              <span className="text-muted-foreground">/{customer.primaryGoal}</span>
            ) : null}
          </>
        )}
      </td>
      <td className="px-4 py-2.5 tabular-nums">{customer.visitCount}</td>
      <td className="px-4 py-2.5 tabular-nums">{formatValue(customer.lifetimeSpend, 'currency')}</td>
      <td className="px-4 py-2.5 text-muted-foreground">{relative(customer.lastVisit)}</td>
      <td className="px-4 py-2.5">
        <StatusBadge customer={customer} />
      </td>
    </tr>
  )
}

function CustomerCard({ customer }: { customer: CustomerListItem }) {
  const { t } = useI18n()
  const formatValue = useFormatValue()
  const relative = useRelativeTime()

  return (
    <Link
      href={`/dashboard/customers/${customer.id}`}
      className="flex items-center gap-3 p-3.5 active:bg-muted/50"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold uppercase text-primary">
        {(customer.name ?? customer.email).slice(0, 2)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          {customer.isVip && <Star className="size-3 shrink-0 fill-amber-400 text-amber-400" />}
          <span className="truncate text-sm font-medium">
            {customer.name || customer.email.split('@')[0]}
          </span>
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {t('customers.mobileSummary', {
            visits: t('overview.visitsCount', { count: customer.visitCount }),
            spend: formatValue(customer.lifetimeSpend, 'currency'),
            when: relative(customer.lastVisit, { short: true }),
          })}
        </span>
      </span>
      {customer.rewardAvailable ? (
        <Gift className="size-4 shrink-0 text-emerald-600" />
      ) : (
        <span className="shrink-0 text-sm tabular-nums">{customer.primaryBalance}</span>
      )}
    </Link>
  )
}

function StatusBadge({ customer }: { customer: CustomerListItem }) {
  const { t } = useI18n()
  const now = useNow()
  const risk = customer.churnRisk ?? 0
  const daysSince =
    customer.lastVisit && now > 0
      ? Math.floor((now - new Date(customer.lastVisit).getTime()) / 86_400_000)
      : null

  if (daysSince === null) return <Badge variant="outline">{t('customers.statusNeverVisited')}</Badge>
  if (daysSince <= 30) return <Badge variant="secondary">{t('customers.statusActive')}</Badge>
  if (risk >= 0.6 || daysSince > 90)
    return <Badge variant="destructive">{t('customers.statusLost')}</Badge>
  return (
    <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-500">
      {t('customers.statusAtRisk')}
    </Badge>
  )
}
