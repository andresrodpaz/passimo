import type { Permission } from '@/lib/auth/rbac'
import type { Feature } from '@/lib/billing/plans'
import type { TranslationKey } from '@/lib/i18n/dictionaries/en'

/**
 * The merchant sidebar, as data.
 *
 * Lifted out of `app/dashboard/layout.tsx` because the sidebar is a *product*
 * decision, not a rendering detail: it decides whether a merchant ever finds a
 * feature. The card designer was the proof. It shipped complete — route,
 * endpoint, table, eleven templates, a live preview that renders through the
 * same resolver the pass builder uses — and was reachable only as the first tab
 * of a screen labelled "Wallet & proximity", filed under "Configure", at the
 * bottom of the list. Nothing in the navigation contained the word *card*. A
 * merchant looking for where to customise their loyalty card could not find it,
 * which makes the feature incomplete however good the editor is.
 *
 * Two consequences for this file:
 *
 *   * **It is pure.** No React, no icon components — `iconKey` is a string the
 *     layout maps to a Lucide component. That keeps the structure unit-testable,
 *     and `tests/unit/dashboard-navigation.test.ts` asserts the things a screen
 *     test never would: that the designer has an entry, that its label is a
 *     dictionary key, that no paid plan hides it, and that every entry points at
 *     a route that exists.
 *
 *   * **Groups are named after what a merchant is trying to do**, not after
 *     database tables: run the shop today, sell more, look after the card, grow
 *     it, understand it, configure it.
 */

export type NavIconKey =
  | 'overview'
  | 'pos'
  | 'customers'
  | 'rewards'
  | 'giftCards'
  | 'memberships'
  | 'walletCard'
  | 'wallet'
  | 'campaigns'
  | 'automations'
  | 'growth'
  | 'network'
  | 'analytics'
  | 'insights'
  | 'locations'
  | 'settings'
  | 'billing'

export type NavEntry = {
  href: string
  iconKey: NavIconKey
  /** Dictionary key, not a literal — the sidebar is the most-read text in the app. */
  labelKey: TranslationKey
  permission?: Permission
  /**
   * Plan capability. A gated item is still *shown* — with a lock — because a
   * merchant cannot want a feature they have never seen. Hiding paid features
   * is how a product sells nothing.
   */
  feature?: Feature
}

export type NavGroup = { labelKey: TranslationKey; items: readonly NavEntry[] }

export const DASHBOARD_NAV: readonly NavGroup[] = [
  {
    labelKey: 'dashboard.nav.today',
    items: [
      { href: '/dashboard', iconKey: 'overview', labelKey: 'dashboard.nav.overview' },
      {
        href: '/pos',
        iconKey: 'pos',
        labelKey: 'dashboard.nav.pointOfSale',
        permission: 'loyalty:earn',
      },
      {
        href: '/dashboard/customers',
        iconKey: 'customers',
        labelKey: 'dashboard.nav.customers',
        permission: 'customers:read',
      },
    ],
  },
  {
    labelKey: 'dashboard.nav.sell',
    items: [
      {
        href: '/dashboard/rewards',
        iconKey: 'rewards',
        labelKey: 'dashboard.nav.rewards',
        permission: 'programs:read',
      },
      {
        href: '/dashboard/gift-cards',
        iconKey: 'giftCards',
        labelKey: 'dashboard.nav.giftCards',
        permission: 'programs:read',
        feature: 'gift_cards',
      },
      {
        href: '/dashboard/memberships',
        iconKey: 'memberships',
        labelKey: 'dashboard.nav.memberships',
        permission: 'programs:read',
        feature: 'memberships',
      },
    ],
  },
  /*
   * The card gets its own group, and "Card design" is the first thing in it.
   *
   * This is the fix for the discoverability bug. The card is the object the
   * customer holds and the thing merchants most want to make theirs, so a
   * merchant scanning this list for where to change it should hit the word
   * without reading anything else. It carries no `feature`: card design is
   * included on every purchasable plan from Starter (€5/month) up, and gating
   * the signature feature of the product behind an upgrade would be a different
   * and worse bug than hiding it.
   */
  {
    labelKey: 'dashboard.nav.card',
    items: [
      {
        href: '/dashboard/wallet/design',
        iconKey: 'walletCard',
        labelKey: 'dashboard.nav.walletCard',
        permission: 'wallet:read',
      },
      {
        href: '/dashboard/wallet',
        iconKey: 'wallet',
        labelKey: 'dashboard.nav.wallet',
        permission: 'wallet:read',
      },
    ],
  },
  {
    labelKey: 'dashboard.nav.grow',
    items: [
      /*
       * These two carry their `feature` for the same reason gift cards and
       * memberships do. Reading a campaign list is not gated — a downgrade must
       * never hide data — but *creating* one is, so leaving the lock off meant a
       * Starter merchant met the paywall only after choosing a template and
       * writing the copy. The lock moves that answer to before the work.
       */
      {
        href: '/dashboard/campaigns',
        iconKey: 'campaigns',
        labelKey: 'dashboard.nav.campaigns',
        permission: 'campaigns:read',
        feature: 'campaigns',
      },
      {
        href: '/dashboard/automations',
        iconKey: 'automations',
        labelKey: 'dashboard.nav.automations',
        permission: 'campaigns:read',
        feature: 'automations',
      },
      {
        href: '/dashboard/growth',
        iconKey: 'growth',
        labelKey: 'dashboard.nav.growth',
        permission: 'analytics:read',
      },
      {
        href: '/dashboard/network',
        iconKey: 'network',
        labelKey: 'dashboard.nav.network',
        permission: 'settings:read',
        feature: 'coalition',
      },
    ],
  },
  {
    labelKey: 'dashboard.nav.understand',
    items: [
      {
        href: '/dashboard/analytics',
        iconKey: 'analytics',
        labelKey: 'dashboard.nav.analytics',
        permission: 'analytics:read',
      },
      {
        href: '/dashboard/insights',
        iconKey: 'insights',
        labelKey: 'dashboard.nav.insights',
        permission: 'analytics:read',
      },
    ],
  },
  {
    labelKey: 'dashboard.nav.configure',
    items: [
      /*
       * Locations stays here rather than beside the wallet screen. A geofence
       * needs a centre, and a merchant who opens proximity first and finds every
       * radius inert has been sent down the wrong path — so the proximity panel
       * raises that itself, with a link to this screen, which is a better answer
       * than relying on two sidebar rows happening to sit next to each other.
       */
      {
        href: '/dashboard/locations',
        iconKey: 'locations',
        labelKey: 'dashboard.nav.locations',
        permission: 'locations:read',
      },
      {
        href: '/dashboard/settings',
        iconKey: 'settings',
        labelKey: 'dashboard.nav.settings',
        permission: 'settings:read',
      },
      {
        href: '/dashboard/billing',
        iconKey: 'billing',
        labelKey: 'dashboard.nav.billing',
        permission: 'settings:read',
      },
    ],
  },
]

/** Every entry, flattened, in sidebar order. */
export const NAV_ENTRIES: readonly NavEntry[] = DASHBOARD_NAV.flatMap((group) => group.items)

/**
 * The entry a path belongs to.
 *
 * Longest prefix wins, which is the whole reason this is a function rather than
 * a `.find()` at the call site. `/dashboard/wallet/design` is a prefix match for
 * both itself and `/dashboard/wallet`, and the naive version highlighted both
 * rows and titled the page "Wallet & proximity" while the merchant was standing
 * in the card designer. `/dashboard` is excluded from prefix matching entirely —
 * it is a prefix of every other route.
 */
export function activeNavEntry(pathname: string): NavEntry | null {
  let best: NavEntry | null = null

  for (const entry of NAV_ENTRIES) {
    const matches =
      entry.href === pathname ||
      (entry.href !== '/dashboard' &&
        (pathname === entry.href || pathname.startsWith(`${entry.href}/`)))

    if (!matches) continue
    if (!best || entry.href.length > best.href.length) best = entry
  }

  return best
}
