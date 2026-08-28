import type { TranslationKey } from '@/lib/i18n/dictionaries/en'
import { DEFAULT_CARD_DESIGN, type CardDesign } from '@/lib/wallet/card-design'
import { applyCardTemplate, findCardTemplate } from '@/lib/wallet/card-templates'

/**
 * The landing page demo, as a state machine.
 *
 * Pure and isomorphic, with no React and no DOM, for two reasons. The obvious
 * one is that it can be tested — the demo is the single most persuasive thing on
 * the marketing site and "does the reward actually unlock at the goal" should
 * not be a question answered by clicking. The less obvious one is that keeping
 * the rules here forced them to be *rules*: the panel component now renders a
 * stage rather than deciding one, so the sequence a visitor sees cannot drift
 * between the counter panel and the wallet panel.
 *
 * ## Why there is no camera in here
 *
 * The previous demo opened on a simulated QR scanner: a dark viewport, a
 * reticle, a scan line. It photographed well and it was the wrong thing to lead
 * with. Most landing-page traffic is desktop, and a camera view on a laptop is
 * either an irrelevance or — worse — read as a request for camera permission
 * before the visitor knows what the product is. It also framed the product as
 * *scanning*, which is the mechanism, when the thing worth paying for is the
 * loop: a customer comes back, the balance moves, the reward unlocks, the card
 * in their pocket updates, the merchant sees it.
 *
 * So the demo is that loop, driven by a button. The real camera scanner lives
 * where it belongs — in the merchant dashboard and at `/pos`, behind a login,
 * on a device that is actually at a counter.
 */

/** Where the visitor is in the story. Ordered; `STAGES.indexOf` is meaningful. */
export const STAGES = [
  /** A regular who has not been in today. */
  'idle',
  /** They have just been served. */
  'visit',
  /** Points and stamps have moved. */
  'credited',
  /** The balance crossed the goal. */
  'rewardReady',
  /** The pass in their pocket has been pushed the new balance. */
  'walletUpdated',
  /** The merchant's numbers moved too. */
  'analytics',
] as const

export type Stage = (typeof STAGES)[number]

export type DemoConfig = {
  /** Stamps needed for a reward. */
  goal: number
  /** Points credited per visit. */
  pointsPerVisit: number
  /** Points needed for the points-based reward tier. */
  pointsGoal: number
}

export const DEFAULT_CONFIG: DemoConfig = {
  goal: 8,
  pointsPerVisit: 120,
  pointsGoal: 1000,
}

export type DemoState = {
  visits: number
  points: number
  stamps: number
  redeemed: number
  stage: Stage
  /** Bumped on every change, so a card can animate without diffing values. */
  revision: number
}

/**
 * A customer part way through, not a customer at zero.
 *
 * Seven visits and 840 points is someone the merchant would recognise, and it
 * puts the reward within one visit — so the visitor's first click produces the
 * unlock rather than a shrug. A demo that starts empty asks the visitor to press
 * a button eight times to see the point of the product.
 */
export const INITIAL_STATE: DemoState = {
  visits: 7,
  points: 840,
  stamps: 7,
  redeemed: 0,
  stage: 'idle',
  revision: 0,
}

export type DemoCustomer = {
  name: string
  /** Dictionary key for how long they have been a member. */
  memberSinceKey: TranslationKey
}

/**
 * The customer on screen.
 *
 * A name and nothing else invented. There are no customer counts, no revenue
 * figures and no testimonials anywhere in this demo — a single fabricated number
 * on a marketing page discounts every true claim beside it, and this page has
 * true claims worth protecting.
 */
export const DEMO_CUSTOMER: DemoCustomer = {
  name: 'María González',
  memberSinceKey: 'landing.demo.memberSince',
}

/** How many points until the next points-tier reward. */
export function pointsToNextReward(state: DemoState, config: DemoConfig): number {
  const remainder = state.points % config.pointsGoal
  return remainder === 0 && state.points > 0 ? 0 : config.pointsGoal - remainder
}

export function stampsToGo(state: DemoState, config: DemoConfig): number {
  return Math.max(0, config.goal - state.stamps)
}

export function rewardReady(state: DemoState, config: DemoConfig): boolean {
  return state.stamps >= config.goal
}

/**
 * Records a visit.
 *
 * The stage it lands on depends on what the visit *did*, which is the whole
 * point: a visit that completes the card is a different event from one that does
 * not, and the demo should say so rather than always advancing one notch.
 */
export function recordVisit(state: DemoState, config: DemoConfig = DEFAULT_CONFIG): DemoState {
  const stamps = Math.min(config.goal, state.stamps + 1)
  const unlocked = stamps >= config.goal && state.stamps < config.goal

  return {
    visits: state.visits + 1,
    points: state.points + config.pointsPerVisit,
    stamps,
    redeemed: state.redeemed,
    stage: unlocked ? 'rewardReady' : 'credited',
    revision: state.revision + 1,
  }
}

/**
 * Claims the reward.
 *
 * The stamp count resets and the *points* deliberately do not. That is not a
 * detail — it is the two-speed loop most loyalty programs actually run: a fast
 * stamp card for the habit, and a slow spend tier underneath it that a customer
 * never loses. Zeroing both here would teach a visitor the wrong model of the
 * product they are being sold.
 */
export function redeem(state: DemoState, config: DemoConfig = DEFAULT_CONFIG): DemoState {
  if (!rewardReady(state, config)) return state

  return {
    ...state,
    stamps: 0,
    redeemed: state.redeemed + 1,
    stage: 'walletUpdated',
    revision: state.revision + 1,
  }
}

/** Moves the story on one beat without changing any balance. */
export function advanceStage(state: DemoState): DemoState {
  const index = STAGES.indexOf(state.stage)
  if (index < 0 || index >= STAGES.length - 1) return state
  return { ...state, stage: STAGES[index + 1]! }
}

export function resetDemo(): DemoState {
  return { ...INITIAL_STATE }
}

// -----------------------------------------------------------------------------
// The customisation demo
// -----------------------------------------------------------------------------

/**
 * The trades and palettes a visitor can try on the wallet card.
 *
 * Deliberately not the full onboarding list. Four of each is enough to make the
 * point — *this card is yours, not ours* — and a landing page that presents ten
 * options is asking a stranger to make a decision instead of noticing a
 * capability.
 *
 * The card template keys match `lib/wallet/card-templates.ts`, so the landing
 * page renders the same designs a merchant is actually offered. A marketing
 * mock-up of a template that does not exist is a promise the product breaks on
 * the first afternoon.
 */
export type DemoTrade = {
  key: string
  labelKey: TranslationKey
  emoji: string
  template: string
  background: string
  accent: string
  goal: number
  rewardKey: TranslationKey
  organizationName: string
}

export const DEMO_TRADES: readonly DemoTrade[] = [
  {
    key: 'cafe',
    labelKey: 'auth.signup.categories.cafe',
    emoji: '☕',
    template: 'coffee',
    background: '#3f2212',
    accent: '#e0a458',
    goal: 8,
    rewardKey: 'onboarding.presets.cafe',
    organizationName: 'Madrid Coffee',
  },
  {
    key: 'restaurant',
    labelKey: 'auth.signup.categories.restaurant',
    emoji: '🍽️',
    template: 'restaurant',
    background: '#4a1129',
    accent: '#f9a8d4',
    goal: 10,
    rewardKey: 'onboarding.presets.restaurant',
    organizationName: 'Sevilla Mesa',
  },
  {
    key: 'barber',
    labelKey: 'auth.signup.categories.barber',
    emoji: '💈',
    template: 'barber',
    background: '#0c4a6e',
    accent: '#7dd3fc',
    goal: 8,
    rewardKey: 'onboarding.presets.barber',
    organizationName: 'Barcelona Barber',
  },
  {
    key: 'gym',
    labelKey: 'auth.signup.categories.gym',
    emoji: '🏋️',
    template: 'gym',
    background: '#0f172a',
    accent: '#a3e635',
    goal: 12,
    rewardKey: 'onboarding.presets.gym',
    organizationName: 'Valencia Fitness',
  },
]

/** Swatches offered beside the trade picker. Named, so they read as choices. */
export const DEMO_PALETTES: ReadonlyArray<{ key: string; background: string; accent: string }> = [
  { key: 'espresso', background: '#3f2212', accent: '#e0a458' },
  { key: 'ink', background: '#111827', accent: '#f59e0b' },
  { key: 'ocean', background: '#0c4a6e', accent: '#7dd3fc' },
  { key: 'rose', background: '#4a1129', accent: '#f9a8d4' },
  { key: 'sage', background: '#1f3d2b', accent: '#a7d7a0' },
]

export function findDemoTrade(key: string): DemoTrade {
  return DEMO_TRADES.find((trade) => trade.key === key) ?? DEMO_TRADES[0]!
}

/**
 * The card design behind a demo trade.
 *
 * Built from a *real* template rather than from a bespoke marketing design, so
 * the card in the hero, the card in the demo and the card a merchant is offered
 * in the designer are the same object. A landing page showing a design the
 * product cannot produce is a promise broken on the first afternoon.
 */
export function demoCardDesign(
  trade: DemoTrade,
  palette?: { background: string; accent: string } | null
): CardDesign {
  const template = findCardTemplate(trade.template)
  const base = template
    ? applyCardTemplate(DEFAULT_CARD_DESIGN, template)
    : { ...DEFAULT_CARD_DESIGN }

  return {
    ...base,
    backgroundColor: palette?.background ?? trade.background,
    accentColor: palette?.accent ?? trade.accent,
  }
}
