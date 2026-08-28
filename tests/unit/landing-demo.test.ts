import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CONFIG,
  DEMO_PALETTES,
  DEMO_TRADES,
  INITIAL_STATE,
  STAGES,
  advanceStage,
  demoCardDesign,
  findDemoTrade,
  pointsToNextReward,
  recordVisit,
  redeem,
  resetDemo,
  rewardReady,
  stampsToGo,
  type DemoState,
} from '@/lib/landing/demo'
import { CARD_TEMPLATES } from '@/lib/wallet/card-templates'
import { resolveCardDesign, meetsContrastAA, normalizeHex } from '@/lib/wallet/card-design'
import { placeholderBrandKit } from '@/lib/brand/kit'
import { en } from '@/lib/i18n/dictionaries/en'

/**
 * The landing page demo.
 *
 * Its own module comment argues that "does the reward actually unlock at the
 * goal" should not be a question answered by clicking — which is why the state
 * machine was extracted as pure and isomorphic in the first place. It shipped
 * without the tests that argument implies, so here they are.
 *
 * The demo is the most-viewed thing in the product and the only part a stranger
 * judges it by. Two classes of failure matter: a loop that does not actually
 * complete (the visitor presses the button and nothing persuasive happens), and
 * a card that shows a design or a reward the real product cannot produce.
 */

function leaf(path: string): unknown {
  return path.split('.').reduce<unknown>((node, segment) => {
    if (typeof node !== 'object' || node === null) return undefined
    return (node as Record<string, unknown>)[segment]
  }, en)
}

describe('the starting state', () => {
  it('opens on a customer the merchant would recognise, not one at zero', () => {
    // A demo that starts empty asks a stranger to press a button eight times
    // before the product does anything worth seeing.
    expect(INITIAL_STATE.visits).toBeGreaterThan(0)
    expect(INITIAL_STATE.stamps).toBeGreaterThan(0)
    expect(INITIAL_STATE.points).toBeGreaterThan(0)
    expect(INITIAL_STATE.stage).toBe('idle')
  })

  it('puts the reward exactly one visit away', () => {
    // The single most important property of the demo: the first click unlocks.
    expect(stampsToGo(INITIAL_STATE, DEFAULT_CONFIG)).toBe(1)
    expect(rewardReady(INITIAL_STATE, DEFAULT_CONFIG)).toBe(false)
    expect(rewardReady(recordVisit(INITIAL_STATE), DEFAULT_CONFIG)).toBe(true)
  })

  it('hands back a fresh object, so a reset cannot be poisoned', () => {
    const first = resetDemo()
    first.stamps = 99
    expect(resetDemo().stamps).toBe(INITIAL_STATE.stamps)
  })
})

describe('recordVisit', () => {
  it('credits a stamp and the configured points', () => {
    const next = recordVisit(INITIAL_STATE)
    expect(next.visits).toBe(INITIAL_STATE.visits + 1)
    expect(next.stamps).toBe(INITIAL_STATE.stamps + 1)
    expect(next.points).toBe(INITIAL_STATE.points + DEFAULT_CONFIG.pointsPerVisit)
  })

  it('lands on rewardReady for the visit that completes the card', () => {
    // The stage depends on what the visit *did*. A visit that completes the card
    // is a different event from one that does not, and the demo says so.
    expect(recordVisit(INITIAL_STATE).stage).toBe('rewardReady')
  })

  it('lands on credited for a visit that does not complete the card', () => {
    const early: DemoState = { ...INITIAL_STATE, stamps: 2 }
    expect(recordVisit(early).stage).toBe('credited')
  })

  it('never counts past the goal', () => {
    let state = INITIAL_STATE
    for (let index = 0; index < 12; index += 1) state = recordVisit(state)
    expect(state.stamps).toBe(DEFAULT_CONFIG.goal)
  })

  it('announces the unlock once, not on every later visit', () => {
    /*
     * Without the `state.stamps < goal` guard, a visitor who keeps clicking gets
     * the celebration on every press, which reads as a bug rather than a reward.
     */
    const unlocked = recordVisit(INITIAL_STATE)
    expect(unlocked.stage).toBe('rewardReady')
    expect(recordVisit(unlocked).stage).toBe('credited')
  })

  it('keeps accruing points after the stamp card is full', () => {
    const full = recordVisit(INITIAL_STATE)
    expect(recordVisit(full).points).toBe(full.points + DEFAULT_CONFIG.pointsPerVisit)
  })

  it('bumps the revision so the card can animate without diffing', () => {
    expect(recordVisit(INITIAL_STATE).revision).toBe(INITIAL_STATE.revision + 1)
  })

  it('does not mutate the state it was given', () => {
    const before = { ...INITIAL_STATE }
    recordVisit(INITIAL_STATE)
    expect(INITIAL_STATE).toEqual(before)
  })

  it('honours a custom configuration', () => {
    const config = { goal: 3, pointsPerVisit: 10, pointsGoal: 100 }
    const state: DemoState = { ...INITIAL_STATE, stamps: 2, points: 0 }
    const next = recordVisit(state, config)
    expect(next.stamps).toBe(3)
    expect(next.points).toBe(10)
    expect(next.stage).toBe('rewardReady')
  })
})

describe('redeem', () => {
  it('does nothing until the reward is actually ready', () => {
    // A demo that lets a visitor claim a reward they have not earned teaches the
    // wrong model of the product.
    expect(redeem(INITIAL_STATE)).toBe(INITIAL_STATE)
  })

  it('clears the stamps and advances to the wallet update', () => {
    const ready = recordVisit(INITIAL_STATE)
    const claimed = redeem(ready)
    expect(claimed.stamps).toBe(0)
    expect(claimed.redeemed).toBe(1)
    expect(claimed.stage).toBe('walletUpdated')
  })

  it('deliberately keeps the points balance', () => {
    /*
     * The two-speed loop most real programs run: a fast stamp card for the habit
     * and a slower spend tier underneath that a customer never loses. Zeroing
     * both would misrepresent the product.
     */
    const ready = recordVisit(INITIAL_STATE)
    expect(redeem(ready).points).toBe(ready.points)
  })

  it('supports a second full cycle', () => {
    // The loop has to be repeatable, or a curious visitor hits a dead end.
    let state = redeem(recordVisit(INITIAL_STATE))
    for (let index = 0; index < DEFAULT_CONFIG.goal; index += 1) state = recordVisit(state)
    expect(rewardReady(state, DEFAULT_CONFIG)).toBe(true)
    expect(redeem(state).redeemed).toBe(2)
  })
})

describe('pointsToNextReward', () => {
  it('counts down to the points tier', () => {
    expect(pointsToNextReward({ ...INITIAL_STATE, points: 840 }, DEFAULT_CONFIG)).toBe(160)
    expect(pointsToNextReward({ ...INITIAL_STATE, points: 0 }, DEFAULT_CONFIG)).toBe(1000)
  })

  it('reads zero exactly on a tier boundary', () => {
    expect(pointsToNextReward({ ...INITIAL_STATE, points: 1000 }, DEFAULT_CONFIG)).toBe(0)
    expect(pointsToNextReward({ ...INITIAL_STATE, points: 2000 }, DEFAULT_CONFIG)).toBe(0)
  })

  it('wraps past the first tier rather than going negative', () => {
    // A negative "points to go" on a marketing page is the kind of detail that
    // makes a visitor doubt everything else on the screen.
    expect(pointsToNextReward({ ...INITIAL_STATE, points: 1120 }, DEFAULT_CONFIG)).toBe(880)
    for (const points of [0, 1, 999, 1000, 1001, 5000, 12_345]) {
      expect(
        pointsToNextReward({ ...INITIAL_STATE, points }, DEFAULT_CONFIG),
        String(points)
      ).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('stage sequence', () => {
  it('walks the story forward one beat at a time', () => {
    let state: DemoState = { ...INITIAL_STATE, stage: 'idle' }
    for (const expected of STAGES.slice(1)) {
      state = advanceStage(state)
      expect(state.stage).toBe(expected)
    }
  })

  it('stops at the last stage instead of wrapping', () => {
    const last: DemoState = { ...INITIAL_STATE, stage: STAGES[STAGES.length - 1]! }
    expect(advanceStage(last)).toBe(last)
  })

  it('never changes a balance', () => {
    const state: DemoState = { ...INITIAL_STATE, stage: 'credited' }
    const next = advanceStage(state)
    expect(next.stamps).toBe(state.stamps)
    expect(next.points).toBe(state.points)
    expect(next.visits).toBe(state.visits)
  })

  it('ends on the merchant seeing the result, which is the point being made', () => {
    expect(STAGES[STAGES.length - 1]).toBe('analytics')
    expect(STAGES).toContain('walletUpdated')
  })
})

describe('the customisation demo', () => {
  it('offers trades that map to real card templates', () => {
    // A landing page showing a design the designer cannot produce is a promise
    // broken on the merchant's first afternoon.
    const templateKeys = new Set(CARD_TEMPLATES.map((template) => template.key))
    for (const trade of DEMO_TRADES) {
      expect(templateKeys.has(trade.template), `${trade.key} → ${trade.template}`).toBe(true)
    }
  })

  it('names every trade and reward with a key that exists in the dictionary', () => {
    for (const trade of DEMO_TRADES) {
      expect(typeof leaf(trade.labelKey), trade.labelKey).toBe('string')
      expect(typeof leaf(trade.rewardKey), trade.rewardKey).toBe('string')
    }
  })

  it('uses valid colours throughout', () => {
    for (const trade of DEMO_TRADES) {
      expect(normalizeHex(trade.background), trade.key).not.toBeNull()
      expect(normalizeHex(trade.accent), trade.key).not.toBeNull()
    }
    for (const palette of DEMO_PALETTES) {
      expect(normalizeHex(palette.background), palette.key).not.toBeNull()
      expect(normalizeHex(palette.accent), palette.key).not.toBeNull()
    }
  })

  it('falls back to the first trade for an unknown key', () => {
    expect(findDemoTrade('not-a-trade')).toBe(DEMO_TRADES[0])
    expect(findDemoTrade('gym').key).toBe('gym')
  })

  it('builds a design carrying the chosen trade colours', () => {
    const trade = findDemoTrade('cafe')
    const design = demoCardDesign(trade)
    expect(design.backgroundColor).toBe(trade.background)
    expect(design.accentColor).toBe(trade.accent)
  })

  it('lets a palette override the trade', () => {
    const trade = findDemoTrade('cafe')
    const palette = DEMO_PALETTES[2]!
    const design = demoCardDesign(trade, palette)
    expect(design.backgroundColor).toBe(palette.background)
    expect(design.accentColor).toBe(palette.accent)
  })

  it('produces a legible card for every trade and palette combination', () => {
    /*
     * The demo renders through the same `resolveCardDesign` the real pass uses,
     * so an unreadable pairing here would also be an unreadable pairing on a
     * customer's phone. Checking all 20 combinations is cheap.
     */
    const brand = placeholderBrandKit('Demo')
    for (const trade of DEMO_TRADES) {
      for (const palette of [null, ...DEMO_PALETTES]) {
        const resolved = resolveCardDesign(demoCardDesign(trade, palette), brand, {
          goal: trade.goal,
          isStampProgram: true,
        })
        expect(
          meetsContrastAA(resolved.foregroundColor, resolved.backgroundColor),
          `${trade.key} / ${palette?.key ?? 'trade default'}`
        ).toBe(true)
      }
    }
  })

  it('keeps the option lists short enough to read as a capability', () => {
    // Ten options asks a stranger to make a decision instead of noticing one.
    expect(DEMO_TRADES.length).toBeLessThanOrEqual(5)
    expect(DEMO_PALETTES.length).toBeLessThanOrEqual(6)
  })

  it('gives each trade and palette a distinct key', () => {
    expect(new Set(DEMO_TRADES.map((trade) => trade.key)).size).toBe(DEMO_TRADES.length)
    expect(new Set(DEMO_PALETTES.map((palette) => palette.key)).size).toBe(DEMO_PALETTES.length)
  })
})
