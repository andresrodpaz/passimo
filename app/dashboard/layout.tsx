'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Users,
  Megaphone,
  Zap,
  Gift,
  BarChart3,
  Settings,
  Sparkles,
  ScanLine,
  ChevronsUpDown,
  LogOut,
  Menu,
  X,
  Check,
  CreditCard,
  Crown,
  Handshake,
  Lock,
  Palette,
  Rocket,
  Wallet,
  MapPin,
  Shield,
  Smartphone,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ThemeToggle } from '@/components/theme-toggle'
import { BrandMark } from '@/components/brand-mark'
import { WorkspaceProvider, useWorkspace } from '@/lib/client/workspace'
import { useApi, apiPost } from '@/lib/client/api'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { PLANS } from '@/lib/billing/plans'
import { DASHBOARD_NAV, activeNavEntry, type NavIconKey } from '@/lib/dashboard/navigation'
import { TrialBanner } from '@/components/billing/trial-banner'
import { ReactivationBanner } from '@/components/billing/upgrade'
import { NotificationBell } from '@/components/notification-bell'
import { ScanButton } from '@/components/scanner/scan-button'
import { LanguageToggle } from '@/components/language-toggle'
import { useI18n } from '@/lib/i18n'

/**
 * Icon per navigation entry.
 *
 * The structure of the sidebar lives in `lib/dashboard/navigation.ts`, which is
 * pure and therefore testable; only the pictures live here. A `Record` keyed on
 * the union means a new entry with no icon is a type error rather than a blank
 * square in the sidebar.
 */
const NAV_ICONS: Record<NavIconKey, React.ComponentType<{ className?: string }>> = {
  overview: LayoutDashboard,
  pos: ScanLine,
  customers: Users,
  rewards: Gift,
  giftCards: CreditCard,
  memberships: Crown,
  walletCard: Palette,
  wallet: Smartphone,
  campaigns: Megaphone,
  automations: Zap,
  growth: Rocket,
  network: Handshake,
  analytics: BarChart3,
  insights: Sparkles,
  locations: MapPin,
  settings: Settings,
  billing: Wallet,
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceProvider>
      <Shell>{children}</Shell>
    </WorkspaceProvider>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { business, businesses, switchBusiness, user, loading, can, has, entitlements } =
    useWorkspace()
  const { t } = useI18n()
  // The drawer is keyed to the route it was opened on, so navigating closes it
  // without an effect — leaving it open over the new page is a classic mobile
  // annoyance, and syncing that with setState in an effect causes a cascading
  // render on every navigation.
  const [openedOn, setOpenedOn] = React.useState<string | null>(null)
  const mobileOpen = openedOn === pathname
  const setMobileOpen = React.useCallback(
    (open: boolean) => setOpenedOn(open ? pathname : null),
    [pathname]
  )

  const visibleGroups = React.useMemo(
    () =>
      DASHBOARD_NAV.map((group) => ({
        ...group,
        items: group.items.filter((item) => !item.permission || can(item.permission)),
      })).filter((group) => group.items.length > 0),
    [can]
  )

  async function signOut() {
    /*
     * The redirect happens whether or not the request succeeded. A session that
     * is already gone server-side still leaves a cookie in this browser, and the
     * one thing a merchant pressing "sign out" must always get is to stop being
     * signed in — a full navigation drops the client cache with it.
     */
    try {
      await apiPost('/api/v1/auth/logout', {})
    } finally {
      window.location.assign('/login')
    }
  }

  // Longest prefix wins, so standing in the card designer titles the page
  // "Card design" and not "Wallet & proximity".
  const currentItem = activeNavEntry(pathname)
  const currentLabel = currentItem ? t(currentItem.labelKey) : t('dashboard.nav.overview')

  return (
    <div className="min-h-screen bg-muted/20">
      {/* Mobile scrim */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-[264px] flex-col border-r bg-card transition-transform duration-200 lg:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex h-16 items-center justify-between border-b px-4">
          <Link href="/dashboard" className="flex items-center gap-2.5">
            <BrandMark />
            <span className="text-base font-semibold tracking-tight">{t('common.appName')}</span>
          </Link>
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setMobileOpen(false)}
            aria-label={t('nav.closeMenu')}
          >
            <X className="size-5" />
          </Button>
        </div>

        {/* Workspace switcher */}
        <div className="border-b p-3">
          {loading ? (
            <Skeleton className="h-11 w-full rounded-lg" />
          ) : businesses.length > 1 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex w-full items-center gap-2.5 rounded-lg border p-2.5 text-left transition-colors hover:bg-accent">
                  <BusinessAvatar name={business?.name ?? '?'} logo={business?.logo_url ?? null} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{business?.name}</span>
                    <span className="block truncate text-xs capitalize text-muted-foreground">
                      {business?.role}
                    </span>
                  </span>
                  <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-[240px]">
                <DropdownMenuLabel>{t('dashboard.nav.yourBusinesses')}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {businesses.map((candidate) => (
                  <DropdownMenuItem
                    key={candidate.id}
                    onSelect={() => switchBusiness(candidate.id)}
                    className="gap-2"
                  >
                    <BusinessAvatar name={candidate.name} logo={candidate.logo_url} size="sm" />
                    <span className="flex-1 truncate">{candidate.name}</span>
                    {candidate.id === business?.id && <Check className="size-4" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <div className="flex items-center gap-2.5 rounded-lg border p-2.5">
              <BusinessAvatar name={business?.name ?? '?'} logo={business?.logo_url ?? null} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {business?.name ?? t('common.loading')}
                </span>
                {/*
                  Read from entitlements, not from `business.plan`: a trialling
                  workspace is stored on the lapsed tier, so testing the raw plan
                  showed the merchant the literal id ("lapsed") instead of the
                  trial CTA. `PLANS[].name` is the same word on their invoice in
                  either language, which the old `capitalize` on an id was not.
                */}
                <span className="block truncate text-xs text-muted-foreground">
                  {entitlements?.trial.active
                    ? t('dashboard.trial.cta')
                    : entitlements
                      ? PLANS[entitlements.effective_plan].name
                      : ''}
                </span>
              </span>
            </div>
          )}
        </div>

        <nav
          className="flex-1 space-y-5 overflow-y-auto p-3"
          aria-label={t('dashboard.nav.overview')}
        >
          {visibleGroups.map((group) => (
            <div key={group.labelKey}>
              <p className="px-3 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {t(group.labelKey)}
              </p>
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const active = currentItem?.href === item.href
                  const locked = Boolean(item.feature) && !has(item.feature!)
                  const Icon = NAV_ICONS[item.iconKey]
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                          active
                            ? 'bg-primary/10 text-primary'
                            : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                        )}
                      >
                        <Icon className="size-[18px] shrink-0" />
                        <span className="flex-1">{t(item.labelKey)}</span>
                        {locked && (
                          <Lock
                            className="size-3.5 shrink-0 opacity-60"
                            aria-label={t('dashboard.nav.lockedHint')}
                          />
                        )}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t p-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex w-full items-center gap-2.5 rounded-lg p-2 text-left transition-colors hover:bg-accent">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold uppercase">
                  {(user?.email ?? '?').slice(0, 2)}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm">{user?.email ?? '—'}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[220px]">
              <DropdownMenuItem asChild>
                <Link href="/dashboard/settings">{t('dashboard.nav.settings')}</Link>
              </DropdownMenuItem>
              {/* Only rendered for platform staff; the endpoint refuses everyone else,
                  so a stray link here would be a dead end rather than a hole. */}
              <PlatformAdminLink />
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={signOut} className="gap-2 text-destructive">
                <LogOut className="size-4" />
                {t('dashboard.nav.signOut')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      <div className="lg:pl-[264px]">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur-lg sm:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label={t('nav.openMenu')}
          >
            <Menu className="size-5" />
          </Button>
          <h1 className="flex-1 truncate text-base font-semibold">{currentLabel}</h1>
          {/* The scanner opens over the current screen rather than navigating to
              it: serving a customer must never cost the merchant their place. */}
          <ScanButton />
          <NotificationBell />
          <LanguageToggle />
          <ThemeToggle />
        </header>

        <main className="p-4 sm:p-6">
          {/* Reactivation first: a lapsed workspace needs to know nothing was lost
              before it is told anything else. */}
          <ReactivationBanner />
          <TrialBanner />
          {children}
        </main>
      </div>
    </div>
  )
}

function BusinessAvatar({
  name,
  logo,
  size = 'md',
}: {
  name: string
  logo: string | null
  size?: 'sm' | 'md'
}) {
  const dimension = size === 'sm' ? 'size-6' : 'size-8'
  if (logo) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logo}
        alt=""
        className={cn(dimension, 'shrink-0 rounded-md object-cover')}
      />
    )
  }
  return (
    <span
      aria-hidden
      className={cn(
        dimension,
        'flex shrink-0 items-center justify-center rounded-md bg-primary/10 text-xs font-semibold uppercase text-primary'
      )}
    >
      {name.slice(0, 2)}
    </span>
  )
}

/**
 * The admin console entry, shown only to platform staff.
 *
 * Probed with a cheap request rather than threaded through `/me`: platform admin is a
 * different authorisation axis from tenant membership, and putting it on the workspace
 * payload would invite someone to gate on it as though it were a role. The endpoint
 * refuses non-admins regardless, so the worst case of a wrong answer here is a
 * missing menu item.
 */
function PlatformAdminLink() {
  const { t } = useI18n()
  const { data } = useApi<{ businesses: { total: number } }>('/api/v1/admin/overview', {
    shouldRetryOnError: false,
  })

  if (!data) return null

  return (
    <DropdownMenuItem asChild>
      <Link href="/admin" className="gap-2">
        <Shield className="size-4" />
        {t('dashboard.nav.admin')}
      </Link>
    </DropdownMenuItem>
  )
}
