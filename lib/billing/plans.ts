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
 * Three tiers, $29 / $59 / $99, and no free plan.
 *
 * The ladder is deliberately short. A café owner deciding between four columns
 * does not decide; they leave. Three prices, each with one sentence explaining
 * who it is for, is a decision someone can make between customers.
 *
 * The tiers differ by **scale** and **advanced capability**, never by crippling
 * the core. A $29 merchant gets the whole loyalty product: wallet passes in
 * Apple and Google Wallet, the card designer, the brand kit, the scanner,
 * campaigns, automations, segments and a real AI allowance. What $59 and $99
 * buy is more of it — more customers, more locations, more sends, more AI —
 * plus the capabilities a bigger business actually needs (geofencing,
 * multi-site reporting, gift cards, memberships, deep analytics, the partner
 * network). Nobody upgrades because we broke something on purpose.
 *
 * Every feature listed here is implemented and gated. Tiers used to advertise
 * `sso`, `api_access`, `webhooks` and `team_management`, none of which existed
 * anywhere in the codebase — four promises a merchant could pay for and never
 * receive. They are gone rather than renamed.
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
export const PLAN_IDS = ['lapsed', 'starter', 'growth', 'pro'] as const
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
 *
 * Nothing in this list is aspirational. Each value is checked by a route, a
 * navigation entry or a screen — `tests/unit/billing.test.ts` asserts that every
 * feature is sold on some purchasable plan, and the audit in `PRICING_AUDIT.md`
 * records where each one is enforced.
 */
export const FEATURES = [
  /** Marketing campaigns over email, SMS, WhatsApp and push. */
  'campaigns',
  /** Event-driven lifecycle automations: welcome, birthday, win-back, reward-ready. */
  'automations',
  /** Saved customer segments with the condition builder. */
  'segments',
  /** Brand kit and the wallet card designer: logo, colours, templates, fields. */
  'custom_branding',
  /** Location-aware wallet passes: lock-screen relevance and nearby suggestions. */
  'wallet_proximity',
  /** AI campaign copy, insights, segment building and program optimisation. */
  'ai',
  /** More than one location, with per-site reporting. */
  'multi_location',
  /** Merchant-configured geofences with entry / exit / dwell triggers. */
  'geofencing',
  /** Scheduled, segmented, location-scoped wallet campaigns. */
  'proximity_campaigns',
  /** The no-code IF/THEN rule builder for proximity and lifecycle triggers. */
  'automation_rules',
  /** Sellable gift cards, including the public purchase page. */
  'gift_cards',
  /** Retention cohorts, churn risk, CLV and campaign attribution. */
  'advanced_analytics',
  /** Paid recurring memberships — the merchant's own subscription revenue. */
  'memberships',
  /** The partner network: shared offers with nearby businesses. */
  'coalition',
  /** Named support contact and a same-business-day first response. */
  'priority_support',
] as const
export type Feature = (typeof FEATURES)[number]

/**
 * Quantities a plan caps.
 *
 * `null` means unlimited. Countable resources (`customers`, `locations`,
 * `team_members`) are checked against live rows; metered ones
 * (`messages_per_month`, `ai_actions_per_month`, `campaigns_per_month`) against
 * `usage_counters`, which resets every calendar month.
 *
 * The four cost-bearing meters — messages, AI actions, campaign sends and
 * active proximity campaigns — exist because those are the lines on our own
 * invoices. Customers and locations are almost free to serve, so they are
 * generous; a model call and an SMS are not, so they are counted.
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

  /**
   * Starter — $29.
   *
   * The entry tier has to survive one question: *can I actually run my shop on
   * this?* So it is the complete loyalty product rather than a demo of it. A café
   * on Starter can design their wallet card, put their logo and colours on it,
   * print a QR code, scan customers at the counter, run ten campaigns a month,
   * leave the welcome / birthday / win-back automations running, segment their
   * list, and ask the AI to write copy twenty-five times a month.
   *
   * What it does not include is the second location, the geofence the merchant
   * configures themselves, gift cards, memberships, cohort analytics and the
   * partner network — every one of which is something a one-site café with 200
   * customers does not need this month. That is the difference between a limit
   * and a mutilation.
   */
  starter: {
    id: 'starter',
    name: 'Starter',
    taglineKey: 'plans.starter.tagline',
    monthlyPrice: 29,
    annualPrice: 290,
    features: [
      'campaigns',
      'automations',
      'segments',
      'custom_branding',
      'wallet_proximity',
      'ai',
    ],
    limits: {
      customers: 500,
      locations: 1,
      team_members: 3,
      /*
       * 2,000 messages covers a 500-customer list emailed four times a month
       * with room to spare, which is more than any café sends. It exists to stop
       * a runaway automation loop, not to ration marketing.
       */
      messages_per_month: 2_000,
      /*
       * Twenty-five model calls is roughly eight campaigns written end to end.
       * Enough for the AI to be genuinely useful at $29 — and small enough that
       * the worst case is under a dollar of inference against a $29 subscription.
       */
      ai_actions_per_month: 25,
      campaigns_per_month: 10,
      /*
       * Zero, not two — and zero because Starter has neither the
       * `proximity_campaigns` nor the `automation_rules` feature.
       *
       * A non-zero cap on a feature the plan does not include is a number nothing
       * can ever consume: the route refuses on the feature gate long before the
       * counter is read, so the merchant meets "available from Growth" on one
       * screen and "0 / 2" on the billing meter. Two screens, two answers, and
       * the encouraging one is the wrong one. It is also what
       * `lowestPlanWithLimit` needs to be told: asked for a plan that allows one
       * proximity campaign it now returns Growth, which is the plan that does.
       *
       * What Starter *does* get on the wallet is substantial and needs no
       * geofence: passes in both wallets, the full card designer, the brand kit,
       * QR and barcode, and `wallet_proximity` — the pass surfacing on the lock
       * screen when a customer is near the shop. What Growth adds is control:
       * geofences the merchant defines, entry / exit / dwell triggers, and pushes
       * they schedule. They see it working before they are asked to pay for it.
       */
      proximity_campaigns: 0,
      automation_rules: 0,
    },
    highlightKeys: [
      'plans.starter.h1',
      'plans.starter.h2',
      'plans.starter.h3',
      'plans.starter.h4',
      'plans.starter.h5',
      'plans.starter.h6',
    ],
    purchasable: true,
  },

  /**
   * Growth — $59.
   *
   * The recommended plan, and the one the trial runs on. The upgrade sentence is
   * "my business is growing and I need more automation and scale", not "the basic
   * product is unusable": ten times the customers, three sites with per-site
   * reporting, geofences the merchant configures, gift cards to sell, cohort and
   * churn analytics, and twelve times the AI allowance.
   */
  growth: {
    id: 'growth',
    name: 'Growth',
    taglineKey: 'plans.growth.tagline',
    monthlyPrice: 59,
    annualPrice: 590,
    features: [
      'campaigns',
      'automations',
      'segments',
      'custom_branding',
      'wallet_proximity',
      'ai',
      'multi_location',
      'geofencing',
      'proximity_campaigns',
      'automation_rules',
      'gift_cards',
      'advanced_analytics',
    ],
    limits: {
      customers: 5_000,
      locations: 3,
      team_members: 10,
      messages_per_month: 15_000,
      ai_actions_per_month: 300,
      campaigns_per_month: 50,
      proximity_campaigns: 15,
      automation_rules: 20,
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

  /**
   * Pro — $99.
   *
   * For a business running several sites and treating retention as a channel:
   * ten locations, twenty thousand customers, memberships as their own recurring
   * revenue, the partner network, and an AI allowance sized for daily automatic
   * insight generation plus real day-to-day use.
   *
   * Intentionally not "unlimited". Unlimited messages and unlimited model calls
   * on a $99 subscription is an invitation to a negative-margin customer, and the
   * honest version of a top tier is a large number rather than a promise we would
   * have to quietly break.
   */
  pro: {
    id: 'pro',
    name: 'Pro',
    taglineKey: 'plans.pro.tagline',
    monthlyPrice: 99,
    annualPrice: 990,
    features: [
      'campaigns',
      'automations',
      'segments',
      'custom_branding',
      'wallet_proximity',
      'ai',
      'multi_location',
      'geofencing',
      'proximity_campaigns',
      'automation_rules',
      'gift_cards',
      'advanced_analytics',
      'memberships',
      'coalition',
      'priority_support',
    ],
    limits: {
      customers: 20_000,
      locations: 10,
      team_members: 25,
      messages_per_month: 50_000,
      ai_actions_per_month: 1_500,
      campaigns_per_month: null,
      proximity_campaigns: 50,
      automation_rules: 100,
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
}

export const PLAN_ORDER: readonly PlanId[] = ['lapsed', 'starter', 'growth', 'pro']

/** The tiers shown on the public pricing page, in order. */
export const PUBLIC_PLANS: readonly Plan[] = PLAN_ORDER.map((id) => PLANS[id]).filter(
  (plan) => plan.purchasable
)

/** The cheapest tier a merchant can actually buy — what "from $x" quotes. */
export const ENTRY_PLAN: Plan = PUBLIC_PLANS[0]

/** The tier marked "most popular", used by onboarding as its default suggestion. */
export const RECOMMENDED_PLAN: Plan = PUBLIC_PLANS.find((plan) => plan.popular) ?? ENTRY_PLAN

/**
 * The plan a trialling business is evaluating.
 *
 * A trial is not a tier — it is temporary access to one. It is **Growth**, not
 * Pro, for two reasons that point the same way.
 *
 * Commercially, Growth is the plan we want most merchants to buy: trialling it
 * means the fourteen days are spent inside the product we are actually selling,
 * and the day-15 decision is "keep this" rather than "which of three things was
 * I using". A merchant who spends a trial on Pro learns to depend on memberships
 * and the partner network, then meets a $99 invoice for a café that needed $29 of
 * software — and the most likely outcome of that mismatch is no sale at all.
 *
 * Financially, a trial has no card on file. Growth's allowances (300 AI actions,
 * 15,000 messages) are generous enough that nobody hits them in two weeks, and
 * small enough that a scripted signup cannot run up a bill.
 */
export const TRIAL_PLAN: PlanId = 'growth'

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

/**
 * The next tier up from `current`, or null at the top.
 *
 * Used by the usage meters to answer "what would more of this cost?" without
 * every caller re-deriving the ladder from `PLAN_ORDER`.
 */
export function nextPlanAfter(current: PlanId): Plan | null {
  const rank = planRank(current)
  for (const id of PLAN_ORDER) {
    const plan = PLANS[id]
    if (plan.purchasable && planRank(id) > rank) return plan
  }
  return null
}

/** Annual saving, used to justify the yearly toggle. */
export function annualSaving(plan: Plan): number {
  if (plan.monthlyPrice === null || plan.annualPrice === null) return 0
  return Math.max(0, plan.monthlyPrice * 12 - plan.annualPrice)
}

/**
 * The annual discount as a whole percentage — "save 17%".
 *
 * Derived, never written down, so the badge on the pricing page cannot disagree
 * with the number Stripe charges.
 */
export function annualSavingPercent(plan: Plan): number {
  if (plan.monthlyPrice === null || plan.annualPrice === null) return 0
  const full = plan.monthlyPrice * 12
  if (full <= 0) return 0
  return Math.round((annualSaving(plan) / full) * 100)
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
  segments: 'billing.features.segments',
  custom_branding: 'billing.features.custom_branding',
  wallet_proximity: 'billing.features.wallet_proximity',
  ai: 'billing.features.ai',
  multi_location: 'billing.features.multi_location',
  geofencing: 'billing.features.geofencing',
  proximity_campaigns: 'billing.features.proximity_campaigns',
  automation_rules: 'billing.features.automation_rules',
  gift_cards: 'billing.features.gift_cards',
  advanced_analytics: 'billing.features.advanced_analytics',
  memberships: 'billing.features.memberships',
  coalition: 'billing.features.coalition',
  priority_support: 'billing.features.priority_support',
}

/** Metered usage metrics, matching the `metric` column in `usage_counters`. */
export const USAGE_METRICS = {
  messages: 'messages_per_month',
  ai_actions: 'ai_actions_per_month',
  campaigns: 'campaigns_per_month',
} as const satisfies Record<string, LimitKey>

export type UsageMetric = keyof typeof USAGE_METRICS

/**
 * Legacy plan identifiers, and what they resolve to now.
 *
 * Three generations of catalogue are represented here, because a resolver that
 * cannot read an old value would gate a paying customer during the window
 * between a deploy and its migration:
 *
 *  - `free` predates the paid-only catalogue. There has never been a free plan
 *    since; the row becomes `lapsed`, which keeps every byte of their data and
 *    refuses writes until they subscribe.
 *  - `enterprise` was renamed to `business` long ago.
 *  - `business` was the fourth tier at $99 when the ladder was
 *    $5 / $19 / $49 / $99. The three-tier catalogue puts `pro` at that same $99,
 *    so nobody's invoice moves. `business` was nominally unlimited on every cap,
 *    and Pro is not, which is the one place this remap can bite: a workspace
 *    remapped from `business` and already holding more than 20,000 customers, 10
 *    locations or 25 seats keeps all of it — reads are never gated and nothing is
 *    deleted — but cannot add more without a conversation. Migration 000024 logs
 *    any row in that position so it is a support call rather than a surprise.
 *
 * Migration `000024_pricing_v2.sql` rewrites the stored rows; this mapping keeps
 * the application correct before, during and after it runs.
 */
const LEGACY_PLAN_ALIASES: Record<string, PlanId> = {
  free: 'lapsed',
  enterprise: 'pro',
  business: 'pro',
}

/** Normalises any stored plan string to a current `PlanId`, or null. */
export function normalizePlanId(value: unknown): PlanId | null {
  if (isPlanId(value)) return value
  if (typeof value === 'string' && value in LEGACY_PLAN_ALIASES) {
    return LEGACY_PLAN_ALIASES[value]
  }
  return null
}
