import { describe, expect, it } from 'vitest'
import {
  CHECKLIST_ITEMS,
  isItemDone,
  resolveChecklist,
  type ChecklistFacts,
} from '@/lib/onboarding/checklist'
import { PLANS, type Feature } from '@/lib/billing/plans'

/**
 * The first-steps checklist.
 *
 * Onboarding now asks for three things instead of six, so this is where the
 * other three live. That makes it the thing standing between a merchant and the
 * features they were previously forced through — worth testing properly, because
 * a checklist that shows a locked item, lies about what is done, or never
 * disappears is worse than not having one.
 */

function facts(overrides: Partial<ChecklistFacts> = {}): ChecklistFacts {
  return {
    locationCount: 1,
    scanCount: 0,
    campaignCount: 0,
    teamMemberCount: 1,
    proximityEnabled: false,
    brandingCustomised: false,
    ...overrides,
  }
}

const has = (plan: keyof typeof PLANS) => (feature: Feature) =>
  PLANS[plan].features.includes(feature)

describe('what counts as done', () => {
  it('counts the second location, not the first', () => {
    // Onboarding created one. The step is about the *next* one, so a merchant
    // who finished setup does not open the dashboard to a tick they did not earn.
    expect(isItemDone('locations', facts({ locationCount: 1 }))).toBe(false)
    expect(isItemDone('locations', facts({ locationCount: 2 }))).toBe(true)
  })

  it('counts the second team member, not the owner', () => {
    expect(isItemDone('team', facts({ teamMemberCount: 1 }))).toBe(false)
    expect(isItemDone('team', facts({ teamMemberCount: 2 }))).toBe(true)
  })

  it('counts a single recorded visit as having learned the loop', () => {
    expect(isItemDone('firstScan', facts({ scanCount: 0 }))).toBe(false)
    expect(isItemDone('firstScan', facts({ scanCount: 1 }))).toBe(true)
  })

  it('needs both proximity switches, because either one off means nothing fires', () => {
    expect(isItemDone('proximity', facts({ proximityEnabled: false }))).toBe(false)
    expect(isItemDone('proximity', facts({ proximityEnabled: true }))).toBe(true)
  })
})

describe('what a merchant is shown', () => {
  it('puts the first scan first, because it is the only step that teaches the job', () => {
    expect(CHECKLIST_ITEMS[0]!.key).toBe('firstScan')
  })

  it('hides steps the plan does not include rather than padlocking them', () => {
    // A "first steps" list that opens with three things the merchant cannot do
    // reads as a bait-and-switch on day one. The sidebar already sells locked
    // features; this is not the place for a second pitch.
    const starter = resolveChecklist(facts(), has('starter'))
    const keys = starter.items.map((item) => item.key)

    expect(keys).toContain('firstScan')
    expect(keys).toContain('branding')
    expect(keys).not.toContain('coalition')
    expect(keys).not.toContain('campaign')
    expect(keys).not.toContain('proximity')
  })

  it('shows the full list on a plan that includes everything', () => {
    const business = resolveChecklist(facts(), has('business'))
    expect(business.items).toHaveLength(CHECKLIST_ITEMS.length)
  })

  it('reports progress against what is actually visible', () => {
    // Counting hidden items would show "1 of 6" to a Starter merchant who can
    // only ever reach two of them.
    const starter = resolveChecklist(facts({ scanCount: 3 }), has('starter'))
    expect(starter.done).toBe(1)
    expect(starter.total).toBe(starter.items.length)
    expect(starter.total).toBeLessThan(CHECKLIST_ITEMS.length)
  })

  it('retires itself once every visible step is done', () => {
    const complete = resolveChecklist(
      facts({ scanCount: 5, brandingCustomised: true }),
      has('starter')
    )
    expect(complete.complete).toBe(true)
  })

  it('is not complete while anything visible is outstanding', () => {
    const partial = resolveChecklist(facts({ scanCount: 5 }), has('starter'))
    expect(partial.complete).toBe(false)
  })

  it('sends every item somewhere real', () => {
    for (const item of CHECKLIST_ITEMS) {
      expect(item.href, `${item.key} has no destination`).toMatch(/^\/(dashboard|pos)/)
      expect(item.titleKey).toMatch(/^checklist\.items\./)
      expect(item.bodyKey).toMatch(/^checklist\.items\./)
    }
  })

  it('never shows an empty card', () => {
    // Every plan includes at least the scan and the branding steps, so the
    // component's "nothing to show" branch is a safety net rather than a state a
    // real merchant reaches.
    for (const plan of ['starter', 'growth', 'pro', 'business'] as const) {
      expect(resolveChecklist(facts(), has(plan)).total).toBeGreaterThan(0)
    }
  })
})
