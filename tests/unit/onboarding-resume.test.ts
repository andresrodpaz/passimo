import { describe, expect, it } from 'vitest'
import {
  STEPS,
  completionPercent,
  hasConfiguredLocation,
  resumeStep,
} from '@/app/onboarding/page'

/**
 * Onboarding resume.
 *
 * A café owner sets Passimo up between customers, and the phone rings. Every
 * case here is a merchant coming back to a half-finished setup.
 *
 * Three properties are being pinned. First, the account decides wherever it can
 * know — a location row means the location step is done, full stop. Second, the
 * steps that leave no trace (the program screen and the plan screen, both of
 * which a merchant passes by clicking a button that writes nothing) fall back to
 * the recorded cursor, and a live trial is *not* evidence of that click, because
 * every new account has one. Third, a cursor written by the previous version of
 * the wizard still resumes correctly — those rows are in the database and a
 * merchant who paused across a deploy must not be sent back to the start.
 */
const base = { completed: false, hasPaidPlan: false, hasLocation: false, lastStep: null } as const

describe('resumeStep', () => {
  it('starts at the program for a brand-new account', () => {
    expect(resumeStep({ ...base })).toBe('program')
  })

  it('still shows the plan screen to an account on a fresh trial', () => {
    // The regression this exists for. Every signup starts a trial, so treating a
    // live trial as "chose a plan" skipped the only screen showing prices.
    expect(resumeStep({ ...base, hasPaidPlan: false, lastStep: 'plan' })).toBe('plan')
  })

  it('skips the plan once the merchant clicked past it', () => {
    expect(resumeStep({ ...base, lastStep: 'shop' })).toBe('shop')
  })

  it('skips the plan for a paying subscriber even with no cursor', () => {
    // They checked out and then lost the session. Asking again would be absurd.
    expect(resumeStep({ ...base, hasPaidPlan: true })).toBe('shop')
  })

  it('goes to the card once a location exists', () => {
    expect(resumeStep({ ...base, hasLocation: true })).toBe('card')
  })

  it('goes to the finished screen for a completed setup', () => {
    expect(resumeStep({ ...base, completed: true, hasLocation: true })).toBe('ready')
  })

  it('never lets a stale cursor jump past a missing location', () => {
    // Stored 'card', but the location it depended on was deleted since.
    expect(resumeStep({ ...base, lastStep: 'card', hasLocation: false })).toBe('shop')
    expect(resumeStep({ ...base, lastStep: 'ready', hasLocation: false })).toBe('shop')
  })

  it('never claims completion the account does not show', () => {
    // A congratulations screen for a program that is not live is a lie the
    // merchant discovers at the counter.
    for (const lastStep of ['program', 'plan', 'shop', 'card', 'ready'] as const) {
      expect(resumeStep({ ...base, lastStep, hasLocation: true })).not.toBe('ready')
    }
  })

  it('reads a cursor written by the previous wizard', () => {
    // `location` was this step's name before it was renamed `shop`. Rows saying
    // so are in the database; resuming them at step one would be a regression
    // visible only to merchants who happened to pause across the deploy.
    expect(resumeStep({ ...base, lastStep: 'location' })).toBe('shop')
    expect(resumeStep({ ...base, lastStep: 'location', hasLocation: true })).toBe('card')
  })

  it('ignores an unrecognised cursor', () => {
    expect(resumeStep({ ...base, lastStep: 'branding' })).toBe('program')
  })
})

/**
 * The progress figure a merchant reads.
 *
 * It has to be monotonic and it has to end at 100, because a percentage that
 * goes backwards or stops at 80 on the final screen reads as the setup having
 * failed.
 */
describe('completionPercent', () => {
  it('rises with every step and never regresses', () => {
    const values = STEPS.map((step) => completionPercent(step.id))
    for (let index = 1; index < values.length; index += 1) {
      expect(values[index]!).toBeGreaterThan(values[index - 1]!)
    }
  })

  it('starts at nothing and finishes at everything', () => {
    expect(completionPercent('program')).toBe(0)
    expect(completionPercent('ready')).toBe(100)
  })
})

/**
 * The steps a merchant is allowed to postpone.
 *
 * Marked in one place and read by the skip control, the badge and the
 * percentage. If nothing were optional the flow would be four blocking screens
 * again, which is what this rebuild exists to avoid.
 */
describe('STEPS', () => {
  it('lets a merchant postpone the plan and the shop, but not the card', () => {
    const optional = STEPS.filter((step) => step.optional).map((step) => step.id)
    expect(optional).toEqual(['plan', 'shop'])

    const required = STEPS.filter((step) => !step.optional).map((step) => step.id)
    expect(required).toEqual(['program', 'card'])
  })

  it('gives every step a distinct translation key', () => {
    const keys = STEPS.map((step) => step.labelKey)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

/**
 * "Is there a location?" is not the same question as "has the merchant told us
 * where they are?".
 *
 * `passimo_provision_business` creates a placeholder location at signup — the
 * business name, and nothing else. Treating that as an answer is what made the
 * location step unreachable for every merchant who ever signed up: nobody was
 * ever asked for an address, so no geofence had a centre and no wallet pass
 * carried a place.
 */
describe('hasConfiguredLocation', () => {
  const placeholder = { address: null, city: null, lat: null, lng: null }

  it('does not count the placeholder provisioning creates', () => {
    expect(hasConfiguredLocation([placeholder])).toBe(false)
  })

  it('counts a city on its own', () => {
    expect(hasConfiguredLocation([{ ...placeholder, city: 'Madrid' }])).toBe(true)
  })

  it('counts a street address on its own', () => {
    expect(hasConfiguredLocation([{ ...placeholder, address: 'Calle Mayor 12' }])).toBe(true)
  })

  it('counts coordinates on their own', () => {
    expect(hasConfiguredLocation([{ ...placeholder, lat: 40.4155, lng: -3.7074 }])).toBe(true)
  })

  it('ignores whitespace-only values', () => {
    expect(hasConfiguredLocation([{ ...placeholder, city: '   ', address: '' }])).toBe(false)
  })

  it('needs both coordinates, not one', () => {
    expect(hasConfiguredLocation([{ ...placeholder, lat: 40.4155 }])).toBe(false)
    expect(hasConfiguredLocation([{ ...placeholder, lng: -3.7074 }])).toBe(false)
  })

  it('is satisfied by any one configured location among several', () => {
    expect(hasConfiguredLocation([placeholder, { ...placeholder, city: 'Barcelona' }])).toBe(true)
  })

  it('is false for no locations at all', () => {
    expect(hasConfiguredLocation([])).toBe(false)
  })
})
