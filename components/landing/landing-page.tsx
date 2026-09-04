'use client'

import * as React from 'react'
import Link from 'next/link'
import {
  ArrowRight,
  BarChart3,
  Bell,
  Check,
  ChevronRight,
  Gift,
  MapPin,
  Megaphone,
  Menu,
  Minus,
  Play,
  QrCode,
  ScanLine,
  Smartphone,
  Sparkles,
  Store,
  Users,
  Wallet,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ThemeToggle } from '@/components/theme-toggle'
import { LanguageToggle, LanguageLinks } from '@/components/language-toggle'
import { BrandMark } from '@/components/brand-mark'
import { ProductDemo } from '@/components/landing/product-demo'
import { PricingTable } from '@/components/landing/pricing-table'
import { WalletSection } from '@/components/landing/wallet-section'
import { CardPreview, type CardPreviewData } from '@/components/wallet/card-preview'
import { useI18n } from '@/lib/i18n'
import { DEMO_CUSTOMER, DEMO_TRADES, demoCardDesign } from '@/lib/landing/demo'
import { resolveCardDesign } from '@/lib/wallet/card-design'
import { placeholderBrandKit } from '@/lib/brand/kit'
import { ENTRY_PLAN, PLAN_CURRENCY } from '@/lib/billing/plans'
import { cn } from '@/lib/utils'

/**
 * The landing page.
 *
 * The rewrite was driven by one instruction above all the design ones: **never
 * fabricate credibility.** What was here claimed 2,400 businesses, 89,000 stamps and
 * 156,000 customers, and carried three testimonials from people who do not exist.
 * The product has not launched. Those numbers were not optimistic, they were false,
 * and a prospect who discovers one invented figure discounts every other claim on
 * the page — including the true ones.
 *
 * So the social-proof section is gone, and what replaces it is the strongest honest
 * position available: *we are pre-launch, here is exactly who this is for, and early
 * adopters get founder pricing.* Scarcity and specificity, which are more persuasive
 * than borrowed authority anyway, and defensible.
 *
 * Everything else that persuades has to come from the product itself, which is why
 * the demo is the largest section on the page rather than a footnote under the hero.
 */

export type LandingPageProps = {
  /**
   * The host this deployment answers on, resolved server-side from
   * `NEXT_PUBLIC_APP_URL`. Shown in the mock browser chrome above the product
   * showcase — hardcoding `passimo.app` there would put an unpurchased domain on
   * the marketing page as though it were live.
   */
  siteHost: string
  /**
   * Where a prospect can write to a human, or `null` when no mailbox is
   * configured. The footer omits the link entirely in that case: a `mailto:`
   * nobody reads is worse than no contact link, because the sender believes they
   * have made contact.
   */
  contactEmail: string | null
}

export function LandingPage({ siteHost, contactEmail }: LandingPageProps) {
  const { formatCurrency } = useI18n()
  const entryPrice = formatCurrency(ENTRY_PLAN.monthlyPrice ?? 5, { currency: PLAN_CURRENCY })

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main>
        <Hero entryPrice={entryPrice} />
        <TrustBand />
        <DemoSection />
        <WalletSection />
        <Features />
        <HowItWorks />
        <DashboardShowcase siteHost={siteHost} />
        <Comparison entryPrice={entryPrice} />
        <Pricing />
        <FinalCta />
      </main>
      <SiteFooter contactEmail={contactEmail} />
    </div>
  )
}

// -----------------------------------------------------------------------------
// Chrome
// -----------------------------------------------------------------------------

const SECTIONS = [
  { href: '#demo', key: 'nav.demo' },
  { href: '#wallet', key: 'nav.wallet' },
  { href: '#features', key: 'nav.features' },
  { href: '#how', key: 'nav.howItWorks' },
  { href: '#compare', key: 'nav.compare' },
  { href: '#pricing', key: 'nav.pricing' },
] as const

function SiteHeader() {
  const { t } = useI18n()
  const [open, setOpen] = React.useState(false)

  return (
    <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
        <Link href="/" className="flex shrink-0 items-center gap-2.5">
          <BrandMark />
          <span className="text-lg font-bold tracking-tight">{t('common.appName')}</span>
        </Link>

        <nav className="hidden items-center gap-6 lg:flex" aria-label={t('nav.features')}>
          {SECTIONS.map((section) => (
            <Link
              key={section.href}
              href={section.href}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {t(section.key)}
            </Link>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-1.5">
          <LanguageToggle />
          <ThemeToggle />
          <Button variant="ghost" size="sm" asChild className="hidden sm:inline-flex">
            <Link href="/login">{t('nav.login')}</Link>
          </Button>
          <Button size="sm" asChild className="hidden sm:inline-flex">
            <Link href="/signup">{t('nav.getStarted')}</Link>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setOpen((value) => !value)}
            aria-label={open ? t('nav.closeMenu') : t('nav.openMenu')}
            aria-expanded={open}
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </Button>
        </div>
      </div>

      {open && (
        <div className="border-t bg-background lg:hidden">
          <nav className="mx-auto max-w-6xl px-4 py-3" aria-label={t('nav.features')}>
            <ul className="space-y-1">
              {SECTIONS.map((section) => (
                <li key={section.href}>
                  <Link
                    href={section.href}
                    onClick={() => setOpen(false)}
                    className="block rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    {t(section.key)}
                  </Link>
                </li>
              ))}
            </ul>
            <div className="mt-3 grid grid-cols-2 gap-2 border-t pt-3">
              <Button variant="outline" asChild>
                <Link href="/login">{t('nav.login')}</Link>
              </Button>
              <Button asChild>
                <Link href="/signup">{t('nav.getStarted')}</Link>
              </Button>
            </div>
          </nav>
        </div>
      )}
    </header>
  )
}

// -----------------------------------------------------------------------------
// Hero
// -----------------------------------------------------------------------------

/**
 * The card in the hero.
 *
 * Rendered through `CardPreview` and `resolveCardDesign` — the same pieces the
 * pass builder uses — from a template a merchant is genuinely offered. The
 * previous hero used a bespoke marketing component that drew one card and put an
 * "Apple Wallet" or "Google Wallet" badge on it, so the two platforms looked
 * identical and neither looked like itself. It also carried three hardcoded
 * English sentences, which meant the Spanish landing page opened on a card that
 * said "Free flat white".
 */
const HERO_TRADE = DEMO_TRADES[0]!

function HeroCard() {
  const { t } = useI18n()

  const design = React.useMemo(
    () =>
      resolveCardDesign(
        demoCardDesign(HERO_TRADE),
        placeholderBrandKit(HERO_TRADE.organizationName),
        { goal: HERO_TRADE.goal, isStampProgram: true }
      ),
    []
  )

  const data: CardPreviewData = React.useMemo(
    () => ({
      organizationName: HERO_TRADE.organizationName,
      programName: t('landing.demo.programName', { business: HERO_TRADE.organizationName }),
      memberName: DEMO_CUSTOMER.name,
      memberSince: t(DEMO_CUSTOMER.memberSinceKey),
      tierName: t('landing.demo.tiers.gold'),
      locationName: t('landing.demo.sampleLocation'),
      // One short of the goal: the state that makes a customer come back, and
      // the one that makes the card readable at a glance.
      balance: HERO_TRADE.goal - 1,
      goal: HERO_TRADE.goal,
      unitSingular: t('onboarding.units.stamp'),
      unitPlural: t('onboarding.units.stamps'),
      rewardName: t(HERO_TRADE.rewardKey),
    }),
    [t]
  )

  return <CardPreview platform="apple" design={design} data={data} />
}

function Hero({ entryPrice }: { entryPrice: string }) {
  const { t } = useI18n()

  return (
    <section className="relative overflow-hidden px-4 pb-16 pt-14 md:pb-24 md:pt-20">
      {/* Background: two slow-drifting gradient blooms and a masked hairline grid.
          Both are CSS — an animated canvas here would cost every visitor a main-thread
          budget for decoration, and it is the first thing they load. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="animate-aurora absolute -top-40 left-1/2 size-[42rem] -translate-x-1/2 rounded-full bg-primary/20 blur-[100px]" />
        <div className="animate-float-slow absolute -right-32 top-32 size-[28rem] rounded-full bg-amber-500/15 blur-[90px]" />
        <div className="absolute inset-0 text-foreground bg-grid-fade opacity-40" />
      </div>

      <div className="mx-auto max-w-6xl">
        <div className="grid items-center gap-14 lg:grid-cols-[1.05fr_1fr] lg:gap-10">
          <div className="text-center lg:text-left">
            <Badge
              variant="secondary"
              className="mb-6 gap-2 rounded-full border px-3.5 py-1.5 text-xs font-medium"
            >
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full rounded-full bg-emerald-500 opacity-75 motion-safe:animate-ping" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
              </span>
              {t('landing.hero.badge')}
              <ChevronRight className="size-3 opacity-60" aria-hidden />
            </Badge>

            <h1 className="text-balance text-4xl font-bold tracking-tight md:text-5xl lg:text-6xl">
              {t('landing.hero.titleLead')}{' '}
              <span className="bg-gradient-to-br from-amber-500 via-orange-500 to-rose-500 bg-clip-text text-transparent">
                {t('landing.hero.titleAccent')}
              </span>
            </h1>

            <p className="mx-auto mt-6 max-w-xl text-pretty text-lg leading-relaxed text-muted-foreground lg:mx-0">
              {t('landing.hero.subtitle')}
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center lg:justify-start">
              <Button size="lg" asChild className="gap-2">
                <Link href="/signup">
                  {t('landing.hero.ctaPrimary')}
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild className="gap-2">
                <Link href="#demo">
                  <Play className="size-4" aria-hidden />
                  {t('landing.hero.ctaSecondary')}
                </Link>
              </Button>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-3 text-sm text-muted-foreground lg:justify-start">
              <span className="inline-flex items-center gap-2 rounded-full border bg-background/70 px-3 py-1.5">
                <Check className="size-3.5 text-emerald-600" aria-hidden />
                {t('landing.hero.noCard', { price: entryPrice })}
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border bg-background/70 px-3 py-1.5">
                <Sparkles className="size-3.5 text-amber-500" aria-hidden />
                {t('landing.hero.founderPricing')}
              </span>
            </div>
          </div>

          {/* The card, layered with the lock-screen notification it produces. Those
              two things together are the entire product thesis, so they are the hero
              image rather than a screenshot of a dashboard. */}
          <div className="relative flex justify-center lg:justify-end">
            <div className="relative">
              <div className="animate-float-slow">
                <HeroCard />
              </div>

              <div className="absolute -bottom-8 -left-6 w-[260px] rounded-2xl border bg-card/95 p-3 shadow-2xl backdrop-blur sm:-left-12">
                <div className="flex items-start gap-2.5">
                  <span aria-hidden className="text-xl leading-none">
                    {HERO_TRADE.emoji}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold leading-snug">
                      {HERO_TRADE.organizationName}
                    </p>
                    <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                      {t('landing.demo.nearbyReady', { reward: t(HERO_TRADE.rewardKey) })}
                    </p>
                  </div>
                </div>
                <p className="mt-2 flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <MapPin className="size-3" aria-hidden />
                  {t('common.metres', { value: 120 })}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

// -----------------------------------------------------------------------------
// Trust — honest, pre-launch
// -----------------------------------------------------------------------------

const SEGMENTS = [
  { key: 'landing.trust.segments.cafe', icon: Store },
  { key: 'landing.trust.segments.restaurant', icon: Store },
  { key: 'landing.trust.segments.retail', icon: Store },
  { key: 'landing.trust.segments.salon', icon: Store },
  { key: 'landing.trust.segments.gym', icon: Store },
  { key: 'landing.trust.segments.bakery', icon: Store },
] as const

function TrustBand() {
  const { t } = useI18n()

  return (
    <section className="border-y bg-muted/30 px-4 py-14">
      <div className="mx-auto max-w-6xl">
        <div className="grid gap-8 lg:grid-cols-[1fr_1.1fr] lg:items-center">
          <div>
            <Badge variant="outline" className="mb-4 rounded-full">
              {t('landing.trust.launching')}
            </Badge>
            <h2 className="text-2xl font-bold tracking-tight md:text-3xl">
              {t('landing.trust.title')}
            </h2>
            <p className="mt-3 text-muted-foreground">{t('landing.trust.subtitle')}</p>
            <div className="mt-6 grid gap-3 rounded-2xl border bg-background/70 p-4 text-sm text-muted-foreground sm:grid-cols-3">
              <div>
                <p className="font-semibold text-foreground">{t('landing.trust.launchInOneSession')}</p>
                <p className="mt-1">{t('landing.trust.launchInOneSessionBody')}</p>
              </div>
              <div>
                <p className="font-semibold text-foreground">{t('landing.trust.noAppRequired')}</p>
                <p className="mt-1">{t('landing.trust.noAppRequiredBody')}</p>
              </div>
              <div>
                <p className="font-semibold text-foreground">{t('landing.trust.builtForDailyUse')}</p>
                <p className="mt-1">{t('landing.trust.builtForDailyUseBody')}</p>
              </div>
            </div>
          </div>

          {/* No logo wall, no testimonials, no counters. Nothing here is a claim we
              cannot stand behind — it states who the product is for, which is a fact,
              and what early adopters get, which is an offer. */}
          <div className="rounded-3xl border bg-card p-6 shadow-sm">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="size-4 text-primary" aria-hidden />
              {t('landing.trust.earlyAccess')}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {t('landing.trust.earlyAccessBody')}
            </p>

            <p className="mt-5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t('landing.trust.builtFor')}
            </p>
            <ul className="mt-2.5 flex flex-wrap gap-2">
              {SEGMENTS.map((segment) => (
                <li key={segment.key}>
                  <span className="inline-flex items-center gap-1.5 rounded-full border bg-background px-3 py-1.5 text-xs font-medium">
                    <segment.icon className="size-3.5 text-muted-foreground" aria-hidden />
                    {t(segment.key)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  )
}

// -----------------------------------------------------------------------------
// Demo
// -----------------------------------------------------------------------------

function DemoSection() {
  const { t } = useI18n()

  return (
    <section id="demo" className="scroll-mt-20 px-4 py-20">
      <div className="mx-auto max-w-6xl">
        <SectionHeading title={t('landing.demo.title')} subtitle={t('landing.demo.subtitle')} />
        <div className="mt-12">
          <ProductDemo />
        </div>

        {/*
          The demo's own exit.

          Somebody who has just changed the trade, changed the colour and
          watched the card follow has understood the one thing the page is
          selling. Making them scroll back to the hero to act on it is the
          cheapest conversion this section can lose — and the copy names the
          next step rather than the product, because "create your loyalty
          program" is what they now want to do.
        */}
        <div className="mt-10 flex flex-col items-center gap-3">
          <Button asChild size="lg" className="h-12 gap-2 px-7 text-base">
            <Link href="/signup">
              {t('landing.demo.ctaPrimary')}
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </Button>
          <p className="text-xs text-muted-foreground">{t('landing.demo.ctaNote')}</p>
        </div>
      </div>
    </section>
  )
}

// -----------------------------------------------------------------------------
// Features
// -----------------------------------------------------------------------------

const FEATURES = [
  { key: 'wallet', icon: Wallet },
  { key: 'proximity', icon: MapPin },
  { key: 'scanner', icon: ScanLine },
  { key: 'campaigns', icon: Megaphone },
  { key: 'analytics', icon: BarChart3 },
  { key: 'multiLocation', icon: Store },
] as const

function Features() {
  const { t } = useI18n()

  return (
    <section id="features" className="scroll-mt-20 border-t bg-muted/30 px-4 py-20">
      <div className="mx-auto max-w-6xl">
        <SectionHeading
          title={t('landing.features.title')}
          subtitle={t('landing.features.subtitle')}
        />

        <div className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <article
              key={feature.key}
              className="group relative overflow-hidden rounded-3xl border bg-card p-6 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl"
            >
              <div
                aria-hidden
                className="absolute inset-x-0 -top-24 h-24 bg-gradient-to-b from-primary/20 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100"
              />
              <span className="relative flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary transition-all duration-300 group-hover:bg-primary group-hover:text-primary-foreground">
                <feature.icon className="size-6" aria-hidden />
              </span>
              <h3 className="relative mt-4 text-lg font-semibold">
                {t(`landing.features.${feature.key}.title` as 'landing.features.wallet.title')}
              </h3>
              <p className="relative mt-2 text-sm leading-relaxed text-muted-foreground">
                {t(`landing.features.${feature.key}.body` as 'landing.features.wallet.body')}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}

// -----------------------------------------------------------------------------
// How it works
// -----------------------------------------------------------------------------

const STEPS = [
  { key: 'step1', icon: QrCode },
  { key: 'step2', icon: Smartphone },
  { key: 'step3', icon: ScanLine },
] as const

function HowItWorks() {
  const { t } = useI18n()

  return (
    <section id="how" className="scroll-mt-20 px-4 py-20">
      <div className="mx-auto max-w-5xl">
        <SectionHeading
          title={t('landing.howItWorks.title')}
          subtitle={t('landing.howItWorks.subtitle')}
        />

        <ol className="relative mt-14 grid gap-8 md:grid-cols-3">
          {/* The connecting line, drawn once behind the three steps rather than as a
              border on each — a per-card border leaves a gap at every join. */}
          <div
            aria-hidden
            className="absolute left-0 right-0 top-7 hidden h-px bg-gradient-to-r from-transparent via-border to-transparent md:block"
          />

          {STEPS.map((step, index) => (
            <li key={step.key} className="relative text-center">
              <span className="relative z-10 mx-auto flex size-14 items-center justify-center rounded-2xl border bg-card shadow-sm">
                <step.icon className="size-6 text-primary" aria-hidden />
              </span>
              <span className="mt-4 inline-block rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-bold text-primary tabular-nums">
                {index + 1}
              </span>
              <h3 className="mt-2 text-base font-semibold">
                {t(`landing.howItWorks.${step.key}.title` as 'landing.howItWorks.step1.title')}
              </h3>
              <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">
                {t(`landing.howItWorks.${step.key}.body` as 'landing.howItWorks.step1.body')}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

// -----------------------------------------------------------------------------
// Dashboard showcase
// -----------------------------------------------------------------------------

const SHOWCASE = [
  { key: 'customers', icon: Users },
  { key: 'campaigns', icon: Megaphone },
  { key: 'analytics', icon: BarChart3 },
  { key: 'scanner', icon: ScanLine },
  { key: 'wallet', icon: Bell },
  { key: 'rewards', icon: Gift },
] as const

function DashboardShowcase({ siteHost }: { siteHost: string }) {
  const { t } = useI18n()

  return (
    <section className="border-t bg-muted/30 px-4 py-20">
      <div className="mx-auto max-w-6xl">
        <SectionHeading
          title={t('landing.dashboardShowcase.title')}
          subtitle={t('landing.dashboardShowcase.subtitle')}
        />

        {/* A stylised browser frame. Deliberately drawn rather than screenshotted:
            a screenshot goes stale the first time the dashboard changes, and a
            landing page showing last quarter's UI is worse than an abstraction. */}
        <div className="mt-14 overflow-hidden rounded-3xl border bg-card shadow-2xl">
          <div className="flex items-center gap-2 border-b bg-muted/50 px-4 py-3">
            <span className="flex gap-1.5" aria-hidden>
              <span className="size-2.5 rounded-full bg-red-400/70" />
              <span className="size-2.5 rounded-full bg-amber-400/70" />
              <span className="size-2.5 rounded-full bg-emerald-400/70" />
            </span>
            <span className="ml-2 hidden rounded-md bg-background px-2.5 py-1 text-xs text-muted-foreground sm:block">
              {siteHost}/dashboard
            </span>
          </div>

          <div className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-3">
            {SHOWCASE.map((item) => (
              <article key={item.key} className="bg-card p-6">
                <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <item.icon className="size-5" aria-hidden />
                </span>
                <h3 className="mt-3.5 text-sm font-semibold">
                  {t(
                    `landing.dashboardShowcase.${item.key}.title` as 'landing.dashboardShowcase.customers.title'
                  )}
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  {t(
                    `landing.dashboardShowcase.${item.key}.body` as 'landing.dashboardShowcase.customers.body'
                  )}
                </p>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

// -----------------------------------------------------------------------------
// Comparison
// -----------------------------------------------------------------------------

/**
 * The comparison table.
 *
 * `null` means "not applicable / not a claim", which is different from `false`. The
 * enterprise column genuinely does know who your customers are — pretending
 * otherwise would be the same dishonesty as an invented testimonial, just aimed at a
 * competitor instead of ourselves. The table wins on cost and time-to-live, which is
 * true, and says so.
 */
type ComparisonRow = {
  labelKey: string
  us: boolean | string
  paper: boolean | string
  app: boolean | string
  enterprise: boolean | string
  /** True when a tick is the bad outcome (e.g. "needs hardware"). */
  inverted?: boolean
}

function Comparison({ entryPrice }: { entryPrice: string }) {
  const { t } = useI18n()

  const rows: ComparisonRow[] = [
    {
      labelKey: 'landing.compare.rows.cost',
      us: t('landing.compare.rows.costUs', { price: entryPrice }),
      paper: t('landing.compare.rows.costPaper'),
      app: t('landing.compare.rows.costApp', { price: '$29' }),
      enterprise: t('landing.compare.rows.costEnterprise'),
    },
    {
      labelKey: 'landing.compare.rows.setup',
      us: t('landing.compare.rows.setupUs'),
      paper: t('landing.compare.rows.setupPaper'),
      app: t('landing.compare.rows.setupApp'),
      enterprise: t('landing.compare.rows.setupEnterprise'),
    },
    {
      labelKey: 'landing.compare.rows.install',
      us: false,
      paper: false,
      app: true,
      enterprise: true,
      inverted: true,
    },
    {
      labelKey: 'landing.compare.rows.knowsCustomers',
      us: true,
      paper: false,
      app: true,
      enterprise: true,
    },
    {
      labelKey: 'landing.compare.rows.proximity',
      us: true,
      paper: false,
      app: false,
      enterprise: true,
    },
    {
      labelKey: 'landing.compare.rows.hardware',
      us: false,
      paper: false,
      app: false,
      enterprise: true,
      inverted: true,
    },
    {
      labelKey: 'landing.compare.rows.lost',
      us: false,
      paper: true,
      app: false,
      enterprise: false,
      inverted: true,
    },
  ]

  const columns = [
    { key: 'us', labelKey: 'landing.compare.us', highlight: true },
    { key: 'paper', labelKey: 'landing.compare.paper', highlight: false },
    { key: 'app', labelKey: 'landing.compare.genericApp', highlight: false },
    { key: 'enterprise', labelKey: 'landing.compare.enterprise', highlight: false },
  ] as const

  return (
    <section id="compare" className="scroll-mt-20 px-4 py-20">
      <div className="mx-auto max-w-5xl">
        <SectionHeading
          title={t('landing.compare.title')}
          subtitle={t('landing.compare.subtitle')}
        />

        {/*
          Scrolls inside its own container on a phone. A comparison table that makes
          the page scroll sideways is the most common mobile bug on a landing page.

          `relative` is load-bearing, not decoration. Tailwind's `sr-only` is
          `position: absolute`, and this table holds 22 of them (the empty corner
          header, and a screen-reader label on every cell). Without a positioned
          ancestor their containing block is the initial one — the document — so
          each one sat at its laid-out x inside a 640px-wide table and stretched
          the *page* to 580px on a 375px screen. The wrapper clipped the table
          correctly and the page scrolled sideways anyway.

          Making this element the containing block puts them back inside the
          scroller, where `overflow-x-auto` clips them. Asserted by
          `tests/e2e/commerce.spec.ts`.
        */}
        <div className="relative mt-12 overflow-x-auto rounded-3xl border bg-card shadow-sm">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <caption className="sr-only">{t('landing.compare.title')}</caption>
            <thead>
              <tr className="border-b">
                <th scope="col" className="p-4 text-left font-medium text-muted-foreground">
                  <span className="sr-only">{t('landing.compare.title')}</span>
                </th>
                {columns.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    className={cn(
                      'p-4 text-center text-sm font-semibold',
                      column.highlight && 'bg-primary/5 text-primary'
                    )}
                  >
                    {t(column.labelKey as 'landing.compare.us')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.labelKey} className="border-b last:border-0">
                  <th scope="row" className="p-4 text-left font-medium">
                    {t(row.labelKey as 'landing.compare.rows.cost')}
                  </th>
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={cn('p-4 text-center', column.highlight && 'bg-primary/5')}
                    >
                      <ComparisonCell
                        value={row[column.key as 'us' | 'paper' | 'app' | 'enterprise']}
                        inverted={row.inverted}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}

function ComparisonCell({
  value,
  inverted,
}: {
  value: boolean | string
  inverted?: boolean
}) {
  const { t } = useI18n()

  if (typeof value === 'string') {
    return <span className="text-muted-foreground">{value}</span>
  }

  // On an inverted row a tick is the bad outcome, so the colour follows the *meaning*
  // rather than the glyph. Green ticks in the "needs hardware" row would read as an
  // endorsement of exactly the thing we are arguing against.
  const good = inverted ? !value : value

  return (
    <span
      className={cn(
        'inline-flex size-6 items-center justify-center rounded-full',
        good
          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
          : 'bg-muted text-muted-foreground'
      )}
    >
      {value ? <Check className="size-3.5" /> : <Minus className="size-3.5" />}
      <span className="sr-only">{value ? t('common.yes') : t('common.no')}</span>
    </span>
  )
}

// -----------------------------------------------------------------------------
// Pricing + CTA + footer
// -----------------------------------------------------------------------------

function Pricing() {
  const { t } = useI18n()

  return (
    <section id="pricing" className="scroll-mt-20 border-t bg-muted/30 px-4 py-20">
      <div className="mx-auto max-w-6xl">
        <SectionHeading
          title={t('landing.pricing.title')}
          subtitle={t('landing.pricing.subtitle')}
        />
        <div className="mt-10">
          <PricingTable />
        </div>
      </div>
    </section>
  )
}

function FinalCta() {
  const { t } = useI18n()

  return (
    <section className="px-4 py-20">
      <div className="mx-auto max-w-4xl">
        <div className="relative overflow-hidden rounded-3xl border bg-card p-8 text-center shadow-2xl md:p-14">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-gradient-to-br from-amber-500/10 via-transparent to-rose-500/10"
          />
          <div className="relative">
            <h2 className="text-balance text-3xl font-bold tracking-tight md:text-4xl">
              {t('landing.cta.title')}
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-pretty text-muted-foreground">
              {t('landing.cta.subtitle')}
            </p>
            <Button size="lg" asChild className="mt-8 gap-2">
              <Link href="/signup">
                {t('landing.cta.button')}
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </Button>
            <p className="mt-4 text-sm text-muted-foreground">{t('landing.cta.note')}</p>
          </div>
        </div>
      </div>
    </section>
  )
}

function SiteFooter({ contactEmail }: { contactEmail: string | null }) {
  const { t } = useI18n()

  const groups = [
    {
      titleKey: 'landing.footer.product',
      links: [
        { href: '#features', labelKey: 'landing.footer.features' },
        { href: '#pricing', labelKey: 'landing.footer.pricing' },
        { href: '#demo', labelKey: 'landing.footer.demo' },
      ],
    },
    {
      titleKey: 'landing.footer.company',
      links: [
        { href: '/signup', labelKey: 'landing.footer.earlyAccess' },
        /*
         * Only when a mailbox exists. `SUPPORT_EMAIL` is unset by default, and a
         * `mailto:` at an unregistered domain is worse than no contact link: the
         * sender's message bounces somewhere they never see, and they believe
         * they have reached us.
         */
        ...(contactEmail
          ? [{ href: `mailto:${contactEmail}`, labelKey: 'landing.footer.contact' as const }]
          : []),
      ],
    },
    {
      titleKey: 'landing.footer.legal',
      links: [
        { href: '/legal/privacy', labelKey: 'landing.footer.privacy' },
        { href: '/legal/terms', labelKey: 'landing.footer.terms' },
        { href: '/legal/cookies', labelKey: 'landing.footer.cookies' },
      ],
    },
  ] as const

  return (
    <footer className="border-t px-4 py-14">
      <div className="mx-auto max-w-6xl">
        <div className="grid gap-10 md:grid-cols-4">
          <div>
            <Link href="/" className="flex items-center gap-2.5">
              <BrandMark />
              <span className="text-lg font-bold">{t('common.appName')}</span>
            </Link>
            <p className="mt-4 max-w-xs text-sm text-muted-foreground">{t('common.tagline')}</p>
          </div>

          {groups.map((group) => (
            <div key={group.titleKey}>
              <h3 className="text-sm font-semibold">
                {t(group.titleKey as 'landing.footer.product')}
              </h3>
              <ul className="mt-4 space-y-2.5 text-sm">
                {group.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {t(link.labelKey as 'landing.footer.features')}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t pt-8 sm:flex-row">
          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} {t('common.appName')} · {t('landing.footer.rights')}
          </p>
          <div className="flex items-center gap-4">
            <LanguageLinks />
            <ThemeToggle />
          </div>
        </div>
      </div>
    </footer>
  )
}

function SectionHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <h2 className="text-balance text-3xl font-bold tracking-tight md:text-4xl">{title}</h2>
      <p className="mt-4 text-pretty text-muted-foreground">{subtitle}</p>
    </div>
  )
}
