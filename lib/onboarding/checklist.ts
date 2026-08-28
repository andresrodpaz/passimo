import type { Feature } from '@/lib/billing/plans'
import type { TranslationKey } from '@/lib/i18n/dictionaries/en'

/**
 * The first-steps checklist.
 *
 * Onboarding now asks for three things — a plan, a place, a card — because those
 * are the only three a merchant cannot serve a customer without. Everything the
 * old wizard also demanded is here instead: visible, ordered, dismissible, and
 * never blocking the counter.
 *
 * Two rules the shape encodes:
 *
 *  1. **Completion is derived, never stored.** Each item asks a question about
 *     the account — is there more than one location, is proximity on, has a scan
 *     happened — and answers it from the data that step would have produced. A
 *     stored `completed` flag drifts the moment a merchant archives the location
 *     they just added, and a checklist that disagrees with the product is worse
 *     than no checklist. Only the *dismissal* is a row.
 *
 *  2. **A gated step is hidden, not locked.** An item the plan does not include
 *     is dropped rather than shown with a padlock. The sidebar already sells
 *     locked features; a "first steps" list that opens with two things the
 *     merchant cannot do reads as a bait-and-switch on day one.
 *
 * Pure and free of React or database access so the ordering and gating rules are
 * unit-testable, which is the part that decides what a new merchant sees.
 */

export type ChecklistItemKey =
  | 'firstScan'
  | 'locations'
  | 'branding'
  | 'proximity'
  | 'campaign'
  | 'team'

export type ChecklistItem = {
  key: ChecklistItemKey
  titleKey: TranslationKey
  bodyKey: TranslationKey
  href: string
  /** Hidden entirely when the plan does not include this. */
  feature?: Feature
}

/**
 * Ordered by what earns the merchant something soonest.
 *
 * The first scan comes first because it is the only item that teaches the daily
 * workflow, and a merchant who has never scanned anybody has not really started.
 */
export const CHECKLIST_ITEMS: readonly ChecklistItem[] = [
  {
    key: 'firstScan',
    titleKey: 'checklist.items.firstScan',
    bodyKey: 'checklist.items.firstScanBody',
    href: '/pos',
  },
  {
    key: 'branding',
    titleKey: 'checklist.items.branding',
    bodyKey: 'checklist.items.brandingBody',
    href: '/dashboard/settings',
  },
  {
    key: 'locations',
    titleKey: 'checklist.items.locations',
    bodyKey: 'checklist.items.locationsBody',
    href: '/dashboard/locations',
    feature: 'multi_location',
  },
  {
    key: 'proximity',
    titleKey: 'checklist.items.proximity',
    bodyKey: 'checklist.items.proximityBody',
    href: '/dashboard/wallet',
    feature: 'geofencing',
  },
  {
    key: 'campaign',
    titleKey: 'checklist.items.campaign',
    bodyKey: 'checklist.items.campaignBody',
    href: '/dashboard/campaigns',
    feature: 'campaigns',
  },
  {
    key: 'team',
    titleKey: 'checklist.items.team',
    bodyKey: 'checklist.items.teamBody',
    href: '/dashboard/settings',
    feature: 'team_management',
  },
]

/** The facts each item is judged against, all cheap counts. */
export type ChecklistFacts = {
  locationCount: number
  scanCount: number
  campaignCount: number
  teamMemberCount: number
  proximityEnabled: boolean
  brandingCustomised: boolean
}

export type ChecklistState = {
  items: Array<ChecklistItem & { done: boolean }>
  done: number
  total: number
  /** True when every visible item is done — the list can retire itself. */
  complete: boolean
}

export function isItemDone(key: ChecklistItemKey, facts: ChecklistFacts): boolean {
  switch (key) {
    case 'firstScan':
      return facts.scanCount > 0
    case 'locations':
      // One location came from onboarding, so the *step* is about the second.
      return facts.locationCount > 1
    case 'branding':
      return facts.brandingCustomised
    case 'proximity':
      return facts.proximityEnabled
    case 'campaign':
      return facts.campaignCount > 0
    case 'team':
      // The owner is a team member, so an invitation is the second row.
      return facts.teamMemberCount > 1
    default:
      return false
  }
}

/**
 * Resolves the checklist for one workspace.
 *
 * `has` is the plan gate, passed in rather than imported so this stays pure and
 * the caller can be either the workspace context or a test.
 */
export function resolveChecklist(
  facts: ChecklistFacts,
  has: (feature: Feature) => boolean
): ChecklistState {
  const items = CHECKLIST_ITEMS.filter((item) => !item.feature || has(item.feature)).map((item) => ({
    ...item,
    done: isItemDone(item.key, facts),
  }))

  const done = items.filter((item) => item.done).length
  return { items, done, total: items.length, complete: items.length > 0 && done === items.length }
}
