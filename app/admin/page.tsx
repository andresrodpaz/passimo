'use client'

import * as React from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  CreditCard,
  Eye,
  Loader2,
  ScanLine,
  Shield,
  TrendingUp,
  Users,
  Wallet,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
import { BrandMark } from '@/components/brand-mark'
import { ThemeToggle } from '@/components/theme-toggle'
import { LanguageToggle } from '@/components/language-toggle'
import { EmptyState, ErrorState, LoadingCards, LoadingRows } from '@/components/states'
import { apiPatch, apiPost, useApi, query } from '@/lib/client/api'
import { useI18n } from '@/lib/i18n'
import type { TranslationKey } from '@/lib/i18n'
import {
  LIMIT_LABEL_KEYS,
  PLAN_CURRENCY,
  PLAN_IDS,
  type LimitKey,
  type PlanId,
} from '@/lib/billing/plans'
import type { CapabilityReport } from '@/lib/env'
import type { ProviderStatus } from '@/lib/wallet/types'

/**
 * The platform admin console.
 *
 * Deliberately outside `/dashboard`: it has no workspace, no plan, and no tenant
 * scope, and rendering it inside the merchant shell would put a cross-tenant view
 * behind a provider whose entire job is to answer "which business am I looking at".
 *
 * Access is not enforced here. Every endpoint it calls begins with
 * `requirePlatformAdmin`, so a non-admin who guesses the URL gets an empty console
 * rather than data — the correct place for that check is the server, and duplicating
 * it in the client would create a second, weaker gate that someone would eventually
 * trust.
 *
 * Plans are visible and assignable but not *editable*: what a tier includes is code,
 * so changing it is a deploy. That is the right blast radius for a decision affecting
 * every merchant at once, and an admin screen that could rewrite the catalogue at
 * runtime would make the entitlement system unauditable.
 */

type Overview = {
  businesses: { total: number; active: number; trialing: number; lapsed: number }
  customersTotal: number
  scansLast30d: number
  walletPasses: number
  mrrCents: number
  planBreakdown: Array<{ plan: PlanId; label: string; count: number; mrrCents: number }>
  capabilities: CapabilityReport
  walletProviders: ProviderStatus[]
  plans: Array<{
    id: PlanId
    name: string
    taglineKey: TranslationKey
    monthlyPrice: number | null
    annualPrice: number | null
    purchasable: boolean
    features: string[]
    limits: Record<string, number | null>
  }>
}

type BusinessRow = {
  id: string
  name: string
  slug: string
  plan: PlanId
  planLabel: string
  subscriptionStatus: string | null
  trialEndsAt: string | null
  createdAt: string
  ownerEmail: string | null
  customerCount: number
  locationCount: number
}

type BusinessesResponse = { businesses: BusinessRow[]; total: number }

export default function AdminPage() {
  const { t } = useI18n()
  const { data, error, isLoading, mutate } = useApi<Overview>('/api/v1/admin/overview', {
    shouldRetryOnError: false,
  })

  return (
    <div className="min-h-screen bg-muted/20">
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur-lg">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <BrandMark />
            <div>
              <p className="flex items-center gap-1.5 text-sm font-semibold">
                <Shield className="size-3.5 text-primary" aria-hidden />
                {t('admin.title')}
              </p>
              <p className="text-xs text-muted-foreground">{t('admin.subtitle')}</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <Button variant="ghost" size="sm" asChild className="gap-1.5">
              <Link href="/dashboard">
                <ArrowLeft className="size-3.5" aria-hidden />
                <span className="hidden sm:inline">{t('dashboard.nav.overview')}</span>
              </Link>
            </Button>
            <LanguageToggle />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
        {isLoading && <LoadingCards count={4} />}

        {error && (
          <>
            {error.status === 403 || error.status === 401 ? (
              <EmptyState
                icon={Shield}
                title={t('errors.forbidden')}
                description={t('errors.forbiddenBody')}
                action={
                  <Button asChild variant="outline">
                    <Link href="/dashboard">{t('dashboard.nav.overview')}</Link>
                  </Button>
                }
              />
            ) : (
              <ErrorState error={error} onRetry={() => void mutate()} />
            )}
          </>
        )}

        {data && (
          <Tabs defaultValue="overview">
            <TabsList className="w-full justify-start overflow-x-auto">
              <TabsTrigger value="overview">{t('admin.tabs.overview')}</TabsTrigger>
              <TabsTrigger value="businesses">{t('admin.tabs.businesses')}</TabsTrigger>
              <TabsTrigger value="plans">{t('admin.tabs.plans')}</TabsTrigger>
              <TabsTrigger value="wallet">{t('admin.tabs.wallet')}</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="mt-6">
              <OverviewTab data={data} />
            </TabsContent>
            <TabsContent value="businesses" className="mt-6">
              <BusinessesTab />
            </TabsContent>
            <TabsContent value="plans" className="mt-6">
              <PlansTab data={data} />
            </TabsContent>
            <TabsContent value="wallet" className="mt-6">
              <WalletTab data={data} />
            </TabsContent>
          </Tabs>
        )}
      </main>
    </div>
  )
}

// -----------------------------------------------------------------------------
// Overview
// -----------------------------------------------------------------------------

function OverviewTab({ data }: { data: Overview }) {
  const { t, formatNumber, formatCurrency } = useI18n()

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          icon={Building2}
          label={t('admin.metrics.businesses')}
          value={formatNumber(data.businesses.total)}
          hint={`${formatNumber(data.businesses.active)} ${t('admin.metrics.active')} · ${formatNumber(
            data.businesses.trialing
          )} ${t('admin.metrics.trialing')}`}
        />
        <Metric
          icon={TrendingUp}
          label={t('admin.metrics.mrr')}
          value={formatCurrency(data.mrrCents, { cents: true, currency: PLAN_CURRENCY })}
        />
        <Metric
          icon={Users}
          label={t('admin.metrics.customers')}
          value={formatNumber(data.customersTotal)}
        />
        <Metric
          icon={ScanLine}
          label={t('admin.metrics.scans')}
          value={formatNumber(data.scansLast30d)}
          hint={`${formatNumber(data.walletPasses)} ${t('admin.metrics.passes')}`}
        />
      </div>

      <section className="rounded-2xl border bg-card p-5">
        <h2 className="text-sm font-semibold">{t('admin.tabs.plans')}</h2>
        <ul className="mt-4 space-y-3">
          {data.planBreakdown.map((entry) => {
            const peak = Math.max(...data.planBreakdown.map((row) => row.count), 1)
            return (
              <li key={entry.plan}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span>{entry.label}</span>
                  <span className="shrink-0 tabular-nums">
                    {formatNumber(entry.count)}
                    {entry.mrrCents > 0 && (
                      <span className="ml-2 text-muted-foreground">
                        {formatCurrency(entry.mrrCents, { cents: true, currency: PLAN_CURRENCY })}
                      </span>
                    )}
                  </span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary/70"
                    style={{ width: `${(entry.count / peak) * 100}%` }}
                  />
                </div>
              </li>
            )
          })}
        </ul>
      </section>

      <CapabilitiesPanel capabilities={data.capabilities} />
    </div>
  )
}

function CapabilitiesPanel({ capabilities }: { capabilities: CapabilityReport }) {
  const { t } = useI18n()

  return (
    <section className="rounded-2xl border bg-card p-5">
      <h2 className="text-sm font-semibold">{t('admin.capabilities.title')}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t('admin.capabilities.subtitle')}</p>

      <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {Object.entries(capabilities).map(([name, configured]) => (
          <li
            key={name}
            className="flex items-center gap-2 rounded-xl bg-muted/40 px-3 py-2 text-sm"
          >
            {configured ? (
              <CheckCircle2
                className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                aria-hidden
              />
            ) : (
              <XCircle className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            )}
            <span className="flex-1 font-mono text-xs">{name}</span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {configured
                ? t('admin.capabilities.configured')
                : t('admin.capabilities.missing')}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

// -----------------------------------------------------------------------------
// Businesses
// -----------------------------------------------------------------------------

function BusinessesTab() {
  const { t, formatNumber, formatDate } = useI18n()
  const [search, setSearch] = React.useState('')
  const [debounced, setDebounced] = React.useState('')
  const [planChange, setPlanChange] = React.useState<BusinessRow | null>(null)
  const [impersonating, setImpersonating] = React.useState<BusinessRow | null>(null)

  // Debounced so typing a name is one request, not one per keystroke against a
  // cross-tenant `ilike` — the most expensive query in the console.
  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(search), 300)
    return () => window.clearTimeout(timer)
  }, [search])

  const { data, error, isLoading, mutate } = useApi<BusinessesResponse>(
    `/api/v1/admin/businesses${query({ q: debounced })}`,
    { shouldRetryOnError: false }
  )

  const businesses = data?.businesses ?? []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('admin.businesses.search')}
          className="max-w-xs"
          aria-label={t('admin.businesses.search')}
        />
        {data && (
          <p className="text-sm text-muted-foreground">
            {formatNumber(data.total)} {t('admin.metrics.businesses')}
          </p>
        )}
      </div>

      {isLoading && <LoadingRows rows={5} />}
      {error && <ErrorState error={error} onRetry={() => void mutate()} />}

      {!isLoading && !error && businesses.length === 0 && (
        <EmptyState icon={Building2} title={t('admin.businesses.empty')} />
      )}

      {businesses.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border bg-card">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th scope="col" className="p-3 font-medium">
                  {t('admin.metrics.businesses')}
                </th>
                <th scope="col" className="p-3 font-medium">
                  {t('admin.businesses.plan')}
                </th>
                <th scope="col" className="p-3 text-right font-medium">
                  {t('admin.businesses.customers')}
                </th>
                <th scope="col" className="p-3 text-right font-medium">
                  {t('admin.businesses.locations')}
                </th>
                <th scope="col" className="p-3 font-medium">
                  {t('admin.businesses.created')}
                </th>
                <th scope="col" className="p-3 text-right font-medium">
                  {t('admin.businesses.actions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {businesses.map((business) => (
                <tr key={business.id} className="border-b last:border-0">
                  <th scope="row" className="p-3 text-left">
                    <span className="block font-medium">{business.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {business.ownerEmail ?? business.slug}
                    </span>
                  </th>
                  <td className="p-3">
                    <Badge
                      variant={business.plan === 'lapsed' ? 'outline' : 'secondary'}
                      className="text-xs"
                    >
                      {business.planLabel}
                    </Badge>
                    {business.subscriptionStatus && (
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        {business.subscriptionStatus}
                      </span>
                    )}
                  </td>
                  <td className="p-3 text-right tabular-nums">
                    {formatNumber(business.customerCount)}
                  </td>
                  <td className="p-3 text-right tabular-nums">
                    {formatNumber(business.locationCount)}
                  </td>
                  <td className="p-3 text-xs text-muted-foreground">
                    {formatDate(business.createdAt)}
                  </td>
                  <td className="p-3">
                    <div className="flex justify-end gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPlanChange(business)}
                        className="gap-1.5"
                      >
                        <CreditCard className="size-3.5" aria-hidden />
                        <span className="hidden lg:inline">
                          {t('admin.businesses.changePlan')}
                        </span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setImpersonating(business)}
                        className="gap-1.5"
                      >
                        <Eye className="size-3.5" aria-hidden />
                        <span className="hidden lg:inline">
                          {t('admin.businesses.impersonate')}
                        </span>
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <PlanChangeDialog
        key={planChange?.id ?? 'closed'}
        business={planChange}
        onClose={() => setPlanChange(null)}
        onSaved={() => {
          setPlanChange(null)
          void mutate()
        }}
      />

      <ImpersonateDialog
        key={impersonating?.id ?? 'closed-impersonate'}
        business={impersonating}
        onClose={() => setImpersonating(null)}
      />
    </div>
  )
}

function PlanChangeDialog({
  business,
  onClose,
  onSaved,
}: {
  business: BusinessRow | null
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useI18n()
  const [plan, setPlan] = React.useState<PlanId>(business?.plan ?? 'starter')
  const [reason, setReason] = React.useState('')
  const [saving, setSaving] = React.useState(false)

  async function submit() {
    if (!business || reason.trim().length < 4) return
    setSaving(true)
    try {
      await apiPatch('/api/v1/admin/businesses', {
        businessId: business.id,
        plan,
        reason: reason.trim(),
      })
      toast.success(t('common.saved'))
      onSaved()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t('common.somethingWentWrong'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={business !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('admin.planChange.title')}</DialogTitle>
          <DialogDescription>{t('admin.planChange.body')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="admin-plan">{t('admin.planChange.plan')}</Label>
            <Select value={plan} onValueChange={(value) => setPlan(value as PlanId)}>
              <SelectTrigger id="admin-plan">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PLAN_IDS.map((id) => (
                  <SelectItem key={id} value={id}>
                    {id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="admin-reason">{t('admin.planChange.reason')}</Label>
            <Textarea
              id="admin-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={t('admin.planChange.reasonPlaceholder')}
              rows={3}
              required
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit} disabled={saving || reason.trim().length < 4} className="gap-2">
            {saving && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t('admin.planChange.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ImpersonateDialog({
  business,
  onClose,
}: {
  business: BusinessRow | null
  onClose: () => void
}) {
  const { t } = useI18n()
  const [reason, setReason] = React.useState('')
  const [starting, setStarting] = React.useState(false)

  async function start() {
    if (!business || reason.trim().length < 8) return
    setStarting(true)
    try {
      await apiPost('/api/v1/admin/impersonate', {
        businessId: business.id,
        reason: reason.trim(),
      })
      // A full navigation, not a router push: the impersonation cookie has to be
      // present on the server render of the dashboard, and a client-side transition
      // would reuse the RSC payload fetched before it was set.
      window.location.href = '/dashboard'
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t('common.somethingWentWrong'))
      setStarting(false)
    }
  }

  return (
    <Dialog open={business !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('admin.impersonate.title')}</DialogTitle>
          <DialogDescription>{t('admin.impersonate.body')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="impersonate-reason">{t('admin.impersonate.reason')}</Label>
          <Textarea
            id="impersonate-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={t('admin.impersonate.reasonPlaceholder')}
            rows={3}
            required
          />
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={start} disabled={starting || reason.trim().length < 8} className="gap-2">
            {starting && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t('admin.impersonate.start')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// -----------------------------------------------------------------------------
// Plans and wallet
// -----------------------------------------------------------------------------

function PlansTab({ data }: { data: Overview }) {
  const { t, formatCurrency, formatNumber } = useI18n()

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {/* Stated plainly: the catalogue is code, so this screen reads it rather than
            writing it. An admin who expects to edit a price here should learn that
            from the screen, not from a support conversation. */}
        {t('admin.tabs.plans')} — {t('common.preview')}
      </p>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data.plans.map((plan) => (
          <article key={plan.id} className="rounded-2xl border bg-card p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold">{plan.name}</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">{plan.id}</p>
              </div>
              <Badge variant={plan.purchasable ? 'secondary' : 'outline'} className="shrink-0">
                {plan.purchasable ? t('common.active') : t('common.inactive')}
              </Badge>
            </div>

            <p className="mt-3 text-sm tabular-nums">
              {plan.monthlyPrice === null
                ? '—'
                : `${formatCurrency(plan.monthlyPrice, { currency: PLAN_CURRENCY })}${t(
                    'common.perMonth'
                  )}`}
            </p>

            <dl className="mt-4 space-y-1 text-xs">
              {Object.entries(plan.limits).map(([key, value]) => (
                <div key={key} className="flex justify-between gap-3">
                  <dt className="truncate text-muted-foreground">
                    {t(LIMIT_LABEL_KEYS[key as LimitKey])}
                  </dt>
                  <dd className="shrink-0 tabular-nums">
                    {value === null ? '∞' : formatNumber(value)}
                  </dd>
                </div>
              ))}
            </dl>

            <p className="mt-3 text-xs text-muted-foreground">
              {formatNumber(plan.features.length)} · {plan.features.slice(0, 4).join(', ')}
            </p>
          </article>
        ))}
      </div>
    </div>
  )
}

function WalletTab({ data }: { data: Overview }) {
  const { t } = useI18n()

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {data.walletProviders.map((provider) => (
          <article key={provider.id} className="rounded-2xl border bg-card p-5">
            <div className="flex items-start justify-between gap-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <Wallet className="size-4 text-muted-foreground" aria-hidden />
                {provider.label}
              </h3>
              <Badge
                variant={provider.configured ? 'secondary' : 'outline'}
                className="shrink-0"
              >
                {provider.configured
                  ? t('wallet.providers.configured')
                  : t('wallet.providers.notConfigured')}
              </Badge>
            </div>

            {provider.missing.length > 0 && (
              <p className="mt-3 break-words font-mono text-xs text-muted-foreground">
                {t('wallet.providers.missing', { vars: provider.missing.join(', ') })}
              </p>
            )}

            <p className="mt-3 text-xs text-muted-foreground">
              {provider.pushConfigured
                ? t('wallet.providers.pushReady')
                : t('wallet.providers.pushMissing')}
            </p>
          </article>
        ))}
      </div>

      <CapabilitiesPanel capabilities={data.capabilities} />
    </div>
  )
}

function Metric({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="rounded-2xl border bg-card p-4">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">{label}</span>
      </p>
      <p className="mt-1.5 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-1 truncate text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}
