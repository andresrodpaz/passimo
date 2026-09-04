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
    cardDesignCustomised: false,
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

  it('keeps the card design step separate from the brand step', () => {
    // These were one item, called "Personalise the card", which pointed at
    // Settings. They are two questions — the card face and the business
    // identity — and answering one must not tick the other.
    expect(isItemDone('cardDesign', facts({ brandingCustomised: true }))).toBe(false)
    expect(isItemDone('branding', facts({ cardDesignCustomised: true }))).toBe(false)
    expect(isItemDone('cardDesign', facts({ cardDesignCustomised: true }))).toBe(true)
  })
})

describe('what a merchant is shown', () => {
  it('puts the first scan first, because it is the only step that teaches the job', () => {
    expect(CHECKLIST_ITEMS[0]!.key).toBe('firstScan')
  })

  it('puts customising the card second, above everything a plan can hide', () => {
    // The discoverability fix. A merchant who reads nothing but the first two
    // rows of this list has still been shown where the designer is.
    expect(CHECKLIST_ITEMS[1]!.key).toBe('cardDesign')
  })

  it('points the card step at the designer itself, not at the screen around it', () => {
    const item = CHECKLIST_ITEMS.find((candidate) => candidate.key === 'cardDesign')!
    expect(item.href).toBe('/dashboard/wallet/design')
  })

  it('offers card design on every purchasable plan', () => {
    // €5/month Starter included. Gating the signature feature of the product
    // behind an upgrade would be a worse bug than hiding it was.
    const item = CHECKLIST_ITEMS.find((candidate) => candidate.key === 'cardDesign')!
    expect(item.feature).toBeUndefined()

    for (const plan of ['starter', 'growth', 'pro', 'business'] as const) {
      const keys = resolveChecklist(facts(), has(plan)).items.map((entry) => entry.key)
      expect(keys, `${plan} cannot reach the card designer`).toContain('cardDesign')
    }
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
    expect(starter.items.filter((item) => item.done)).toHaveLength(1)
    expect(starter.total).toBe(starter.items.length)
    expect(starter.total).toBeLessThan(CHECKLIST_ITEMS.length)
  })

  it('retires itself once every visible step is done', () => {
    const complete = resolveChecklist(
      facts({ scanCount: 5, brandingCustomised: true, cardDesignCustomised: true }),
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
