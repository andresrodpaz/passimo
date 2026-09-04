import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DASHBOARD_NAV,
  NAV_ENTRIES,
  activeNavEntry,
  type NavEntry,
} from '@/lib/dashboard/navigation'
import { PLANS, type PlanId } from '@/lib/billing/plans'
import { ROLES, ROLE_PERMISSIONS } from '@/lib/auth/rbac'
import { en } from '@/lib/i18n/dictionaries/en'
import { es } from '@/lib/i18n/dictionaries/es'

/**
 * The merchant sidebar.
 *
 * This file exists because of a real product failure, not a hypothetical one.
 * The Wallet card designer shipped complete — editor, eleven templates, live
 * Apple and Google previews, endpoint, table, migration — and merchants could
 * not find it. It was the first tab of a screen the sidebar called "Wallet &
 * proximity", filed under "Configure", and no string in the navigation
 * contained the word *card*. Every test in the repository passed.
 *
 * So the assertions here are about *reachability*, which is the property that
 * was broken: does the designer have an entry, is it labelled in a word a
 * merchant would search for, can every paying plan and every role that can read
 * wallet settings get to it, and does the route it points at exist on disk.
 */

const DESIGNER_HREF = '/dashboard/wallet/design'
const REPO_ROOT = path.resolve(__dirname, '../..')

function entry(href: string): NavEntry {
  const found = NAV_ENTRIES.find((candidate) => candidate.href === href)
  expect(found, `no sidebar entry points at ${href}`).toBeDefined()
  return found!
}

/** Resolves a nav href to the App Router file that serves it. */
function pageFileFor(href: string): string {
  return path.join(REPO_ROOT, 'app', href.replace(/^\//, ''), 'page.tsx')
}

describe('the card designer is reachable', () => {
  it('has its own sidebar entry', () => {
    expect(entry(DESIGNER_HREF)).toBeDefined()
  })

  it('is labelled with the word a merchant would look for', () => {
    // Not "Pass configuration", not "Wallet Card Designer". Both dictionaries
    // are checked, because a Spanish merchant hunting for "tarjeta" has the
    // same problem in reverse.
    const { labelKey } = entry(DESIGNER_HREF)
    expect(labelKey).toBe('dashboard.nav.walletCard')
    expect(en.dashboard.nav.walletCard.toLowerCase()).toContain('card')
    expect(es.dashboard.nav.walletCard.toLowerCase()).toContain('tarjeta')
  })

  it('sits above the proximity screen it used to hide inside', () => {
    const hrefs = NAV_ENTRIES.map((item) => item.href)
    expect(hrefs.indexOf(DESIGNER_HREF)).toBeLessThan(hrefs.indexOf('/dashboard/wallet'))
  })

  it('is not gated behind a plan', () => {
    // Card design is included from Starter (€5/month) up. There is no free
    // plan, so "every plan" and "every paying plan" are the same set.
    expect(entry(DESIGNER_HREF).feature).toBeUndefined()

    const purchasable = (Object.keys(PLANS) as PlanId[]).filter((id) => PLANS[id].purchasable)
    expect(purchasable.length).toBeGreaterThan(0)
    for (const id of purchasable) {
      expect(PLANS[id].monthlyPrice, `${id} is free`).not.toBe(0)
    }
  })

  it('is visible to every role that can read wallet settings', () => {
    const required = entry(DESIGNER_HREF).permission!
    expect(required).toBe('wallet:read')

    const roles = ROLES.filter((role) => ROLE_PERMISSIONS[role].has(required))
    // Owner, manager and at least one more — if this ever drops to nothing the
    // sidebar filter would hide the entry from everybody.
    expect(roles.length).toBeGreaterThan(1)
  })

  it('points at a page that exists', () => {
    expect(fs.existsSync(pageFileFor(DESIGNER_HREF))).toBe(true)
  })
})

describe('the sidebar as a whole', () => {
  it('sends every entry to a route that exists', () => {
    // The cheapest guard against the other half of the same bug: a link in the
    // sidebar that 404s, or a page nobody links to.
    for (const item of NAV_ENTRIES) {
      expect(fs.existsSync(pageFileFor(item.href)), `${item.href} has no page`).toBe(true)
    }
  })

  it('has no duplicate destinations', () => {
    const hrefs = NAV_ENTRIES.map((item) => item.href)
    expect(new Set(hrefs).size).toBe(hrefs.length)
  })

  it('labels every entry and group from the dictionary', () => {
    for (const group of DASHBOARD_NAV) {
      expect(group.labelKey).toMatch(/^dashboard\.nav\./)
      expect(group.items.length).toBeGreaterThan(0)
      for (const item of group.items) {
        expect(item.labelKey).toMatch(/^dashboard\.nav\./)
      }
    }
  })
})

describe('which entry a route belongs to', () => {
  it('prefers the longest match', () => {
    // The designer's href is a prefix match for the proximity screen's. The
    // naive `startsWith` highlighted both rows and titled the designer page
    // "Wallet & proximity".
    expect(activeNavEntry('/dashboard/wallet/design')?.href).toBe(DESIGNER_HREF)
    expect(activeNavEntry('/dashboard/wallet')?.href).toBe('/dashboard/wallet')
  })

  it('matches nested routes to their section', () => {
    expect(activeNavEntry('/dashboard/customers/abc')?.href).toBe('/dashboard/customers')
  })

  it('does not let the overview swallow every route', () => {
    expect(activeNavEntry('/dashboard')?.href).toBe('/dashboard')
    expect(activeNavEntry('/dashboard/analytics')?.href).toBe('/dashboard/analytics')
  })

  it('returns nothing for a route it does not own', () => {
    expect(activeNavEntry('/login')).toBeNull()
  })
})
