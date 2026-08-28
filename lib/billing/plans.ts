/**
 * The plan catalogue.
 *
 * One definition, used by the pricing page, the checkout session, the
 * entitlement checks in the API, the usage meters in the dashboard and the
 * upgrade prompts. A tier's value is described exactly once, so the marketing
 * site can never promise something the API refuses to do.
 *
 * Deliberately not stored in the database. Plan shape is product strategy, not
 * tenant data: it changes with a deploy, is identical for everyone, and needs
 * to be readable on the client without a round trip. Stripe holds the prices
 * that customers are actually charged; this holds what those prices *mean*.
 *
 * There is no free tier. A loyalty program that costs nothing is worth nothing
 * to its owner: it never gets set up, never gets scanned, and churns silently.
 * Every tier is paid, starting at $5 — less than two coffees, which is the
 * comparison a café owner actually makes — and every tier is preceded by a
 * full-featured trial so the decision is made with evidence rather than faith.
 *
 * Isomorphic on purpose — no `server-only`.
 */

import type { TranslationKey } from '@/lib/i18n/dictionaries/en'

/**
 * `lapsed` is not for sale. It is where a workspace lands when a trial ends
 * without a card, or a subscription is cancelled: their data stays, their
 * screens stay readable, and every write is met with one upgrade button.
 * Modelling it as a tier rather than a boolean means the existing entitlement
 * machinery gates it correctly without a single special case.
 */
export const PLAN_IDS = ['lapsed', 'starter', 'growth', 'pro', 'business'] as const
export type PlanId = (typeof PLAN_IDS)[number]

/** The currency every price in this file is quoted in. */
export const PLAN_CURRENCY = 'USD' as const
export const PLAN_CURRENCY_SYMBOL = '$' as const

/**
 * Capabilities a plan can unlock.
 *
 * Gates are coarse on purpose. A merchant should be able to predict what they
 * get from the plan name; a matrix of forty checkboxes sells nothing and
 * generates support tickets.
 */
export const FEATURES = [
  'campaigns',
  'automations',
  'gift_cards',
  'memberships',
  'ai',
  'advanced_analytics',
  'segments',
  'api_access',
  'webhooks',
  'coalition',
  'multi_location',
  'custom_branding',
  'priority_support',
  'sso',
  'team_management',
  /** Location-aware wallet passes: lock-screen relevance and nearby suggestions. */
  'wallet_proximity',
  /** Merchant-configured geofences with entry / exit / dwell triggers. */
  'geofencing',
  /** Scheduled, segmented, location-scoped wallet campaigns. */
  'proximity_campaigns',
  /** The no-code IF/THEN rule builder. */
  'automation_rules',
] as const
export type Feature = (typeof FEATURES)[number]

/**
 * Quantities a plan caps.
 *
 * `null` means unlimited. Countable resources (`customers`, `locations`,
 * `team_members`) are checked against live rows; metered ones
 * (`messages_per_month`, `ai_actions_per_month`) against `usage_counters`,
 * which resets every calendar month.
 */
export type Limits = {
  customers: number | null
  locations: number | null
  team_members: number | null
  messages_per_month: number | null
  ai_actions_per_month: number | null
  campaigns_per_month: number | null
  /** Active proximity campaigns; the cost driver is wallet push volume. */
  proximity_campaigns: number | null
  /** Active no-code automation rules. */
  automation_rules: number | null
}

export type LimitKey = keyof Limits

export type Plan = {
  id: PlanId
  /**
   * The tier's name, in every language.
   *
   * A proper noun: it appears on the invoice, in the Stripe dashboard and in
   * support conversations, and a merchant on "Growth" who reads "Crecimiento" in
   * the product but "Growth" on their receipt has to work out that those are the
   * same thing.
   */
  name: string
  /** Dictionary key for the one line a café owner understands without a demo. */
  taglineKey: TranslationKey
  /** Monthly price, billed monthly. `null` means "talk to us". */
  monthlyPrice: number | null
  /** Annual price, billed yearly — two months free. */
  annualPrice: number | null
  features: readonly Feature[]
  limits: Limits
  /**
   * Dictionary keys for the pricing card's bullets, written as outcomes rather
   * than feature names. Keys, not prose, so the marketing page and the billing
   * screen read the same words in whichever language the viewer chose.
   */
  highlightKeys: readonly TranslationKey[]
  popular?: boolean
  /** False for internal states that must never appear on a pricing page. */
  purchasable: boolean
}

const ALL_FEATURES = FEATURES

export const PLANS: Record<PlanId, Plan> = {
  /**
   * Not sold, not shown. Reads work; writes return 402 with one remedy.
   */
  lapsed: {
    id: 'lapsed',
    name: 'Inactive',
    taglineKey: 'plans.lapsed.tagline',
    monthlyPrice: null,
    annualPrice: null,
    features: [],
    limits: {
      customers: 0,
      locations: 1,
      team_members: 1,
      messages_per_month: 0,
      ai_actions_per_month: 0,
      campaigns_per_month: 0,
      proximity_campaigns: 0,
      automation_rules: 0,
    },
    highlightKeys: [],
    purchasable: false,
  },

  starter: {
    id: 'starter',
    name: 'Starter',
    taglineKey: 'plans.starter.tagline',
    monthlyPrice: 5,
    annualPrice: 50,
    features: ['custom_branding', 'wallet_proximity'],
    limits: {
      customers: 500,
      locations: 1,
      team_members: 2,
      messages_per_month: 500,
      ai_actions_per_month: 0,
      campaigns_per_month: 2,
      proximity_campaigns: 1,
      automation_rules: 0,
    },
    highlightKeys: [
      'plans.starter.h1',
      'plans.starter.h2',
      'plans.starter.h3',
      'plans.starter.h4',
      'plans.starter.h5',
    ],
    purchasable: true,
  },

  growth: {
    id: 'growth',
    name: 'Growth',
    taglineKey: 'plans.growth.tagline',
    monthlyPrice: 19,
    annualPrice: 190,
    features: [
      'campaigns',
      'automations',
      'gift_cards',
      'segments',
      'custom_branding',
      'multi_location',
      'wallet_proximity',
      'geofencing',
      'proximity_campaigns',
      'automation_rules',
    ],
    limits: {
      customers: 5_000,
      locations: 5,
      team_members: 10,
      messages_per_month: 10_000,
      ai_actions_per_month: 0,
      campaigns_per_month: null,
      proximity_campaigns: 10,
      automation_rules: 10,
    },
    highlightKeys: [
      'plans.growth.h1',
      'plans.growth.h2',
      'plans.growth.h3',
      'plans.growth.h4',
      'plans.growth.h5',
      'plans.growth.h6',
    ],
    popular: true,
    purchasable: true,
  },

  pro: {
    id: 'pro',
    name: 'Pro',
    taglineKey: 'plans.pro.tagline',
    monthlyPrice: 49,
    annualPrice: 490,
    features: [
      'campaigns',
      'automations',
      'gift_cards',
      'memberships',
      'ai',
      'advanced_analytics',
      'segments',
      'api_access',
      'webhooks',
      'multi_location',
      'custom_branding',
      'wallet_proximity',
      'geofencing',
      'proximity_campaigns',
      'automation_rules',
    ],
    limits: {
      customers: 25_000,
      locations: 15,
      team_members: 25,
      messages_per_month: 50_000,
      ai_actions_per_month: 2_000,
      campaigns_per_month: null,
      proximity_campaigns: 50,
      automation_rules: 50,
    },
    highlightKeys: [
      'plans.pro.h1',
      'plans.pro.h2',
      'plans.pro.h3',
      'plans.pro.h4',
      'plans.pro.h5',
      'plans.pro.h6',
    ],
    purchasable: true,
  },

  business: {
    id: 'business',
    name: 'Business',
    taglineKey: 'plans.business.tagline',
    monthlyPrice: 99,
    annualPrice: 990,
    features: ALL_FEATURES,
    limits: {
      customers: null,
      locations: null,
      team_members: null,
      messages_per_month: null,
      ai_actions_per_month: null,
      campaigns_per_month: null,
      proximity_campaigns: null,
      automation_rules: null,
    },
    highlightKeys: [
      'plans.business.h1',
      'plans.business.h2',
      'plans.business.h3',
      'plans.business.h4',
      'plans.business.h5',
      'plans.business.h6',
    ],
    purchasable: true,
  },
}

export const PLAN_ORDER: readonly PlanId[] = ['lapsed', 'starter', 'growth', 'pro', 'business']

/** The tiers shown on the public pricing page, in order. */
export const PUBLIC_PLANS: readonly Plan[] = PLAN_ORDER.map((id) => PLANS[id]).filter(
  (plan) => plan.purchasable
)

/** The cheapest tier a merchant can actually buy — what "from $x" quotes. */
export const ENTRY_PLAN: Plan = PUBLIC_PLANS[0]

/**
 * The plan a trialling business is evaluating.
 *
 * A trial is not a tier — it is temporary access to one. Giving trials `pro`
 * means the features a merchant falls in love with are the ones we most want
 * them to pay for, and the downgrade at day 14 is a real, felt loss.
 */
export const TRIAL_PLAN: PlanId = 'pro'

/**
 * Where a trial lands if it ends without a card.
 *
 * Never a working tier — there is no free product — and never a deletion. The
 * merchant keeps every customer, card and campaign; they simply cannot write
 * until they subscribe.
 */
export const TRIAL_EXPIRED_PLAN: PlanId = 'lapsed'

export const DEFAULT_TRIAL_DAYS = 14

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === 'string' && (PLAN_IDS as readonly string[]).includes(value)
}

/** True for the tiers a merchant can check out. */
export function isPurchasablePlan(value: unknown): value is PlanId {
  return isPlanId(value) && PLANS[value].purchasable
}

export function planRank(id: PlanId): number {
  return PLAN_ORDER.indexOf(id)
}

/** True when `candidate` is strictly better than `current`. */
export function isUpgrade(current: PlanId, candidate: PlanId): boolean {
  return planRank(candidate) > planRank(current)
}

/** The cheapest *purchasable* plan that includes a feature — what an upsell offers. */
export function lowestPlanWith(feature: Feature): Plan | null {
  for (const id of PLAN_ORDER) {
    const plan = PLANS[id]
    if (plan.purchasable && plan.features.includes(feature)) return plan
  }
  return null
}

/** The cheapest purchasable plan whose limit clears a required amount. */
export function lowestPlanWithLimit(key: LimitKey, required: number): Plan | null {
  for (const id of PLAN_ORDER) {
    const plan = PLANS[id]
    if (!plan.purchasable) continue
    const value = plan.limits[key]
    if (value === null || value >= required) return plan
  }
  return null
}

/** Annual saving, used to justify the yearly toggle. */
export function annualSaving(plan: Plan): number {
  if (plan.monthlyPrice === null || plan.annualPrice === null) return 0
  return Math.max(0, plan.monthlyPrice * 12 - plan.annualPrice)
}

export function priceFor(plan: Plan, interval: 'month' | 'year'): number | null {
  return interval === 'year' ? plan.annualPrice : plan.monthlyPrice
}

/**
 * Dictionary keys for limits and features.
 *
 * Keys rather than words, for the same reason the highlights are: these labels
 * appear in usage meters, paywalls and API refusals, and a merchant reading a
 * Spanish dashboard should not meet "Team members" in the one place the product
 * says no. `pnpm typecheck` proves every key exists; the i18n test proves the
 * Spanish value is not the English one.
 */
export const LIMIT_LABEL_KEYS: Record<LimitKey, TranslationKey> = {
  customers: 'billing.limits.customers',
  locations: 'billing.limits.locations',
  team_members: 'billing.limits.team_members',
  messages_per_month: 'billing.limits.messages_per_month',
  ai_actions_per_month: 'billing.limits.ai_actions_per_month',
  campaigns_per_month: 'billing.limits.campaigns_per_month',
  proximity_campaigns: 'billing.limits.proximity_campaigns',
  automation_rules: 'billing.limits.automation_rules',
}

export const FEATURE_LABEL_KEYS: Record<Feature, TranslationKey> = {
  campaigns: 'billing.features.campaigns',
  automations: 'billing.features.automations',
  gift_cards: 'billing.features.gift_cards',
  memberships: 'billing.features.memberships',
  ai: 'billing.features.ai',
  advanced_analytics: 'billing.features.advanced_analytics',
  segments: 'billing.features.segments',
  api_access: 'billing.features.api_access',
  webhooks: 'billing.features.webhooks',
  coalition: 'billing.features.coalition',
  multi_location: 'billing.features.multi_location',
  custom_branding: 'billing.features.custom_branding',
  priority_support: 'billing.features.priority_support',
  sso: 'billing.features.sso',
  team_management: 'billing.features.team_management',
  wallet_proximity: 'billing.features.wallet_proximity',
  geofencing: 'billing.features.geofencing',
  proximity_campaigns: 'billing.features.proximity_campaigns',
  automation_rules: 'billing.features.automation_rules',
}

/** Metered usage metrics, matching the `metric` column in `usage_counters`. */
export const USAGE_METRICS = {
  messages: 'messages_per_month',
  ai_actions: 'ai_actions_per_month',
  campaigns: 'campaigns_per_month',
} as const satisfies Record<string, LimitKey>

export type UsageMetric = keyof typeof USAGE_METRICS

/**
 * Legacy plan identifiers that predate the paid-only catalogue.
 *
 * Rows written before this change still say `free` or `enterprise`. Migration
 * 15 rewrites them, but a resolver that cannot read the old value would gate a
 * paying customer during the deploy window, so the mapping lives in code too.
 */
const LEGACY_PLAN_ALIASES: Record<string, PlanId> = {
  free: 'lapsed',
  enterprise: 'business',
}

/** Normalises any stored plan string to a current `PlanId`, or null. */
export function normalizePlanId(value: unknown): PlanId | null {
  if (isPlanId(value)) return value
  if (typeof value === 'string' && value in LEGACY_PLAN_ALIASES) {
    return LEGACY_PLAN_ALIASES[value]
  }
  return null
}
