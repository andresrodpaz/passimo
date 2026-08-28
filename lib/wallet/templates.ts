/**
 * Industry wallet strategies.
 *
 * A merchant who has just signed up does not know what radius to use, what time
 * a coffee notification should fire, or how long to wait before nudging someone
 * who has not been back. They know they run a bakery. So a template is the whole
 * strategy — settings, campaigns and rules — for one kind of business, and
 * applying it is one click that leaves them with a working, sensible setup they
 * can then edit.
 *
 * The numbers here are the opinionated part of the product and are chosen from
 * how each trade actually works:
 *
 *   * A café's radius is small (120 m) and its window is the morning commute,
 *     because nobody detours four blocks for coffee.
 *   * A gym's radius is large (600 m) and its trigger is *absence*, because the
 *     problem a gym has is members who stopped coming, not members walking past.
 *   * A pharmacy sends almost nothing. Trust, not frequency, is the product.
 *
 * Templates live in code, not in the database, for the same reason plans do:
 * they are product strategy, identical for every tenant, and readable on the
 * client without a round trip. Applying one *writes* ordinary rows the merchant
 * then owns and can freely change — a template is a starting point, never a
 * binding.
 *
 * ## Every string here is a key, and that is the point
 *
 * This file used to hold its copy as English literals. Two of them were merely
 * embarrassing — a Spanish merchant read "Coffee shop / Morning regulars, small
 * radius" in the gallery. The rest were worse: `title`, `message` and `ctaLabel`
 * are written into `wallet_campaigns` when a template is applied, and from there
 * onto a *customer's lock screen*. A Spanish café that clicked "Cafetería" got
 * campaigns that would tell its customers "Your morning coffee is ready", in a
 * language the merchant cannot fix from the dashboard because the row was
 * seeded, not typed.
 *
 * So copy is resolved through a translator at the point of use, and which
 * translator depends on who the words are for:
 *
 *   * **The gallery** resolves with the *viewer's* locale — whoever is reading
 *     the dashboard right now.
 *   * **Applying a template** resolves with the *business's* locale
 *     (`translatorForBusiness`), because the rows it writes outlive the request
 *     and are read by customers, not by the person who clicked.
 *
 * Isomorphic: the gallery renders from the same objects the API applies.
 */

import type { TranslationKey } from '@/lib/i18n/dictionaries/en'
import type { Translator } from '@/lib/i18n/translate'
import type { RuleAction, RuleNode } from '@/lib/wallet/rules'
import type { GeofenceTrigger } from '@/lib/wallet/types'

export type TemplateCampaignKind =
  | 'welcome'
  | 'happy_hour'
  | 'double_points'
  | 'birthday'
  | 'weekend'
  | 'lunch'
  | 'coffee_morning'
  | 'vip_event'
  | 'seasonal'
  | 'win_back'
  | 'reward_ready'
  | 'new_location'
  | 'custom'

export type TemplateCampaign = {
  kind: TemplateCampaignKind
  /** Copy keys. Resolved by `resolveTemplateCampaign`, never read directly. */
  nameKey: TranslationKey
  descriptionKey: TranslationKey
  titleKey: TranslationKey
  messageKey: TranslationKey
  ctaKey: TranslationKey
  rewardDescriptionKey?: TranslationKey
  trigger: GeofenceTrigger
  emoji: string
  radiusMeters?: number
  dwellMinutes?: number
  weekdays?: number[]
  startTime?: string
  endTime?: string
  priority?: number
  cooldownHours?: number
  minPoints?: number
  minVisits?: number
  maxDaysSinceVisit?: number
  minDaysSinceVisit?: number
  vipOnly?: boolean
  eligibility?: Record<string, unknown>
}

/** A campaign with its copy in one language, ready to render or to store. */
export type ResolvedTemplateCampaign = Omit<
  TemplateCampaign,
  'nameKey' | 'descriptionKey' | 'titleKey' | 'messageKey' | 'ctaKey' | 'rewardDescriptionKey'
> & {
  name: string
  description: string
  title: string
  message: string
  ctaLabel: string
  rewardDescription?: string
}

export type TemplateRule = {
  templateKey: string
  nameKey: TranslationKey
  descriptionKey: TranslationKey
  priority: number
  stopOnMatch?: boolean
  cooldownHours: number
  conditions: RuleNode
  /**
   * Actions as a function of the translator.
   *
   * `RuleAction` carries literal strings because merchants author their own
   * rules in the builder, and those really are literals. A template's actions
   * are not: they are seeded copy that ends up on a customer's phone, so they
   * have to be produced in the business's language at the moment the template is
   * applied. A function is the smallest way to express "these strings are
   * pending a language" without forking the `RuleAction` type.
   */
  actions: (t: Translator) => RuleAction[]
}

export type ResolvedTemplateRule = Omit<TemplateRule, 'nameKey' | 'descriptionKey' | 'actions'> & {
  name: string
  description: string
  actions: RuleAction[]
}

export type WalletTemplate = {
  key: string
  nameKey: TranslationKey
  /** One line the merchant recognises their own business in. */
  summaryKey: TranslationKey
  emoji: string
  /** Sensible defaults written into `wallet_settings`. */
  settings: {
    defaultRadiusMeters: number
    defaultDwellMinutes: number
    maxNotificationsPerDay: number
    minHoursBetweenNotifications: number
    quietHoursStart: number
    quietHoursEnd: number
    rewardNotifications: boolean
    loyaltyReminders: boolean
    nearbyRecommendations: boolean
    notificationEmoji: string
  }
  campaigns: TemplateCampaign[]
  rules: TemplateRule[]
}

export type ResolvedWalletTemplate = Omit<
  WalletTemplate,
  'nameKey' | 'summaryKey' | 'campaigns' | 'rules'
> & {
  name: string
  summary: string
  campaigns: ResolvedTemplateCampaign[]
  rules: ResolvedTemplateRule[]
}

// -----------------------------------------------------------------------------
// Shared rules
// -----------------------------------------------------------------------------

/** Reward-ready is universal: every trade wants it, so it is shared. */
const rewardReadyRule = (radius: number): TemplateRule => ({
  templateKey: 'reward_ready',
  nameKey: 'walletTemplates.rules.rewardReady.name',
  descriptionKey: 'walletTemplates.rules.rewardReady.description',
  priority: 10,
  cooldownHours: 24,
  conditions: {
    all: [
      { fact: 'has_claimable_reward', op: 'is_true' },
      { fact: 'distance_meters', op: 'lte', value: radius },
    ],
  },
  actions: () => [{ type: 'notify_reward_available' }],
})

const birthdayRule: TemplateRule = {
  templateKey: 'birthday',
  nameKey: 'walletTemplates.rules.birthday.name',
  descriptionKey: 'walletTemplates.rules.birthday.description',
  priority: 5,
  cooldownHours: 168,
  conditions: { all: [{ fact: 'is_birthday', op: 'is_true' }] },
  actions: (t) => [
    {
      type: 'send_wallet_notification',
      title: t('walletTemplates.rules.birthday.title'),
      message: t('walletTemplates.rules.birthday.message'),
      emoji: '🎂',
      cta_label: t('walletTemplates.rules.birthday.cta'),
    },
  ],
}

const winBackRule = (days: number): TemplateRule => ({
  templateKey: 'win_back',
  nameKey: 'walletTemplates.rules.winBack.name',
  descriptionKey: 'walletTemplates.rules.winBack.description',
  priority: 30,
  cooldownHours: 336,
  conditions: {
    all: [
      { fact: 'days_since_visit', op: 'gte', value: days },
      { fact: 'trigger', op: 'in', value: ['entry', 'nearby'] },
    ],
  },
  actions: (t) => [
    {
      type: 'send_wallet_notification',
      title: t('walletTemplates.rules.winBack.title'),
      message: t('walletTemplates.rules.winBack.message'),
      emoji: '👋',
      cta_label: t('walletTemplates.rules.winBack.cta'),
    },
  ],
})

const vipRule: TemplateRule = {
  templateKey: 'vip',
  nameKey: 'walletTemplates.rules.vip.name',
  descriptionKey: 'walletTemplates.rules.vip.description',
  priority: 1,
  cooldownHours: 4,
  conditions: {
    all: [
      { fact: 'is_vip', op: 'is_true' },
      { fact: 'trigger', op: 'eq', value: 'entry' },
    ],
  },
  actions: (t) => [{ type: 'notify_staff', title: t('walletTemplates.rules.vip.title') }],
}

// -----------------------------------------------------------------------------
// The gallery
// -----------------------------------------------------------------------------

/**
 * Builds the copy keys for one template's campaign.
 *
 * A helper rather than twenty-two hand-written key quintuplets: the keys are
 * mechanical, and writing them out invites exactly one typo that renders a raw
 * dotted path on a customer's lock screen.
 *
 * The cast is real and worth naming: keys assembled at runtime cannot be checked
 * by the compiler the way a literal `TranslationKey` is. What replaces that
 * guarantee is `tests/unit/wallet-templates.test.ts`, which walks every template
 * and asserts each key resolves in **both** dictionaries — a stronger check than
 * the type system offered anyway, since types only ever see English.
 */
function copy(
  template: string,
  kind: string
): Pick<
  TemplateCampaign,
  'nameKey' | 'descriptionKey' | 'titleKey' | 'messageKey' | 'ctaKey'
> {
  const base = `walletTemplates.${template}.campaigns.${kind}`
  return {
    nameKey: `${base}.name` as TranslationKey,
    descriptionKey: `${base}.description` as TranslationKey,
    titleKey: `${base}.title` as TranslationKey,
    messageKey: `${base}.message` as TranslationKey,
    ctaKey: `${base}.cta` as TranslationKey,
  }
}

export const WALLET_TEMPLATES: readonly WalletTemplate[] = [
  {
    key: 'coffee_shop',
    nameKey: 'walletTemplates.coffee_shop.name',
    summaryKey: 'walletTemplates.coffee_shop.summary',
    emoji: '☕',
    settings: {
      defaultRadiusMeters: 120,
      defaultDwellMinutes: 3,
      maxNotificationsPerDay: 1,
      minHoursBetweenNotifications: 12,
      quietHoursStart: 20,
      quietHoursEnd: 6,
      rewardNotifications: true,
      loyaltyReminders: true,
      nearbyRecommendations: true,
      notificationEmoji: '☕',
    },
    campaigns: [
      {
        kind: 'coffee_morning',
        ...copy('coffee_shop', 'coffee_morning'),
        trigger: 'entry',
        emoji: '☕',
        radiusMeters: 150,
        weekdays: [1, 2, 3, 4, 5],
        startTime: '07:00',
        endTime: '10:30',
        priority: 20,
        cooldownHours: 20,
      },
      {
        kind: 'reward_ready',
        ...copy('coffee_shop', 'reward_ready'),
        rewardDescriptionKey: 'walletTemplates.coffee_shop.campaigns.reward_ready.reward',
        trigger: 'nearby',
        emoji: '🎁',
        radiusMeters: 250,
        priority: 40,
        cooldownHours: 24,
        eligibility: { requires_claimable_reward: true },
      },
      {
        kind: 'win_back',
        ...copy('coffee_shop', 'win_back'),
        trigger: 'nearby',
        emoji: '👋',
        radiusMeters: 300,
        minDaysSinceVisit: 14,
        priority: 10,
        cooldownHours: 336,
      },
    ],
    rules: [rewardReadyRule(200), birthdayRule, winBackRule(21)],
  },

  {
    key: 'bakery',
    nameKey: 'walletTemplates.bakery.name',
    summaryKey: 'walletTemplates.bakery.summary',
    emoji: '🥐',
    settings: {
      defaultRadiusMeters: 150,
      defaultDwellMinutes: 3,
      maxNotificationsPerDay: 1,
      minHoursBetweenNotifications: 12,
      quietHoursStart: 20,
      quietHoursEnd: 6,
      rewardNotifications: true,
      loyaltyReminders: true,
      nearbyRecommendations: true,
      notificationEmoji: '🥐',
    },
    campaigns: [
      {
        kind: 'coffee_morning',
        ...copy('bakery', 'coffee_morning'),
        trigger: 'entry',
        emoji: '🥐',
        radiusMeters: 180,
        startTime: '07:30',
        endTime: '11:00',
        priority: 20,
        cooldownHours: 20,
      },
      {
        kind: 'weekend',
        ...copy('bakery', 'weekend'),
        trigger: 'nearby',
        emoji: '🍞',
        radiusMeters: 300,
        weekdays: [0, 6],
        startTime: '08:00',
        endTime: '13:00',
        priority: 15,
        cooldownHours: 48,
      },
    ],
    rules: [rewardReadyRule(200), birthdayRule],
  },

  {
    key: 'restaurant',
    nameKey: 'walletTemplates.restaurant.name',
    summaryKey: 'walletTemplates.restaurant.summary',
    emoji: '🍽️',
    settings: {
      defaultRadiusMeters: 400,
      defaultDwellMinutes: 10,
      maxNotificationsPerDay: 2,
      minHoursBetweenNotifications: 6,
      quietHoursStart: 23,
      quietHoursEnd: 9,
      rewardNotifications: true,
      loyaltyReminders: true,
      nearbyRecommendations: true,
      notificationEmoji: '🍽️',
    },
    campaigns: [
      {
        kind: 'lunch',
        ...copy('restaurant', 'lunch'),
        trigger: 'nearby',
        emoji: '🍽️',
        radiusMeters: 500,
        weekdays: [1, 2, 3, 4, 5],
        startTime: '11:30',
        endTime: '14:30',
        priority: 20,
        cooldownHours: 24,
      },
      {
        kind: 'weekend',
        ...copy('restaurant', 'weekend'),
        trigger: 'nearby',
        emoji: '🍷',
        radiusMeters: 800,
        weekdays: [5, 6],
        startTime: '17:00',
        endTime: '21:00',
        priority: 25,
        cooldownHours: 72,
      },
      {
        kind: 'vip_event',
        ...copy('restaurant', 'vip_event'),
        trigger: 'nearby',
        emoji: '✨',
        radiusMeters: 1_000,
        vipOnly: true,
        priority: 45,
        cooldownHours: 336,
      },
    ],
    rules: [rewardReadyRule(400), birthdayRule, vipRule, winBackRule(45)],
  },

  {
    key: 'barber_shop',
    nameKey: 'walletTemplates.barber_shop.name',
    summaryKey: 'walletTemplates.barber_shop.summary',
    emoji: '💈',
    settings: {
      defaultRadiusMeters: 250,
      defaultDwellMinutes: 5,
      maxNotificationsPerDay: 1,
      minHoursBetweenNotifications: 48,
      quietHoursStart: 21,
      quietHoursEnd: 8,
      rewardNotifications: true,
      loyaltyReminders: true,
      nearbyRecommendations: true,
      notificationEmoji: '💈',
    },
    campaigns: [
      {
        kind: 'custom',
        ...copy('barber_shop', 'custom'),
        trigger: 'nearby',
        emoji: '✂️',
        radiusMeters: 400,
        minDaysSinceVisit: 26,
        priority: 30,
        cooldownHours: 168,
      },
      {
        kind: 'reward_ready',
        ...copy('barber_shop', 'reward_ready'),
        trigger: 'nearby',
        emoji: '🎁',
        radiusMeters: 300,
        priority: 40,
        cooldownHours: 48,
        eligibility: { requires_claimable_reward: true },
      },
    ],
    rules: [rewardReadyRule(300), birthdayRule, winBackRule(60)],
  },

  {
    key: 'beauty_salon',
    nameKey: 'walletTemplates.beauty_salon.name',
    summaryKey: 'walletTemplates.beauty_salon.summary',
    emoji: '💅',
    settings: {
      defaultRadiusMeters: 300,
      defaultDwellMinutes: 5,
      maxNotificationsPerDay: 1,
      minHoursBetweenNotifications: 48,
      quietHoursStart: 21,
      quietHoursEnd: 9,
      rewardNotifications: true,
      loyaltyReminders: true,
      nearbyRecommendations: true,
      notificationEmoji: '💅',
    },
    campaigns: [
      {
        kind: 'custom',
        ...copy('beauty_salon', 'custom'),
        trigger: 'nearby',
        emoji: '💫',
        radiusMeters: 500,
        minDaysSinceVisit: 40,
        priority: 30,
        cooldownHours: 336,
      },
      {
        kind: 'vip_event',
        ...copy('beauty_salon', 'vip_event'),
        trigger: 'nearby',
        emoji: '✨',
        radiusMeters: 1_000,
        vipOnly: true,
        priority: 45,
        cooldownHours: 720,
      },
    ],
    rules: [rewardReadyRule(400), birthdayRule, vipRule],
  },

  {
    key: 'gym',
    nameKey: 'walletTemplates.gym.name',
    summaryKey: 'walletTemplates.gym.summary',
    emoji: '🏋️',
    settings: {
      defaultRadiusMeters: 600,
      defaultDwellMinutes: 20,
      maxNotificationsPerDay: 2,
      minHoursBetweenNotifications: 12,
      quietHoursStart: 22,
      quietHoursEnd: 6,
      rewardNotifications: true,
      loyaltyReminders: true,
      nearbyRecommendations: true,
      notificationEmoji: '🏋️',
    },
    campaigns: [
      {
        kind: 'custom',
        ...copy('gym', 'custom'),
        trigger: 'nearby',
        emoji: '💪',
        radiusMeters: 800,
        minDaysSinceVisit: 6,
        priority: 30,
        cooldownHours: 72,
      },
      {
        kind: 'double_points',
        ...copy('gym', 'double_points'),
        trigger: 'nearby',
        emoji: '⚡',
        radiusMeters: 1_000,
        weekdays: [1, 2, 3, 4, 5],
        startTime: '13:00',
        endTime: '16:00',
        priority: 20,
        cooldownHours: 48,
      },
      {
        kind: 'win_back',
        ...copy('gym', 'win_back'),
        trigger: 'nearby',
        emoji: '🔁',
        radiusMeters: 1_200,
        minDaysSinceVisit: 30,
        priority: 15,
        cooldownHours: 336,
      },
    ],
    rules: [rewardReadyRule(600), birthdayRule, winBackRule(30)],
  },

  {
    key: 'retail_store',
    nameKey: 'walletTemplates.retail_store.name',
    summaryKey: 'walletTemplates.retail_store.summary',
    emoji: '🛍️',
    settings: {
      defaultRadiusMeters: 200,
      defaultDwellMinutes: 5,
      maxNotificationsPerDay: 2,
      minHoursBetweenNotifications: 8,
      quietHoursStart: 21,
      quietHoursEnd: 9,
      rewardNotifications: true,
      loyaltyReminders: true,
      nearbyRecommendations: true,
      notificationEmoji: '🛍️',
    },
    campaigns: [
      {
        kind: 'welcome',
        ...copy('retail_store', 'welcome'),
        trigger: 'entry',
        emoji: '🛍️',
        radiusMeters: 200,
        priority: 15,
        cooldownHours: 48,
      },
      {
        kind: 'weekend',
        ...copy('retail_store', 'weekend'),
        trigger: 'nearby',
        emoji: '🏷️',
        radiusMeters: 500,
        weekdays: [5, 6, 0],
        priority: 25,
        cooldownHours: 72,
      },
      {
        kind: 'seasonal',
        ...copy('retail_store', 'seasonal'),
        trigger: 'nearby',
        emoji: '🎉',
        radiusMeters: 800,
        priority: 35,
        cooldownHours: 168,
      },
    ],
    rules: [rewardReadyRule(300), birthdayRule, winBackRule(60)],
  },

  {
    key: 'pet_shop',
    nameKey: 'walletTemplates.pet_shop.name',
    summaryKey: 'walletTemplates.pet_shop.summary',
    emoji: '🐾',
    settings: {
      defaultRadiusMeters: 300,
      defaultDwellMinutes: 5,
      maxNotificationsPerDay: 1,
      minHoursBetweenNotifications: 24,
      quietHoursStart: 21,
      quietHoursEnd: 8,
      rewardNotifications: true,
      loyaltyReminders: true,
      nearbyRecommendations: true,
      notificationEmoji: '🐾',
    },
    campaigns: [
      {
        kind: 'custom',
        ...copy('pet_shop', 'custom'),
        trigger: 'nearby',
        emoji: '🐕',
        radiusMeters: 400,
        minDaysSinceVisit: 25,
        priority: 30,
        cooldownHours: 336,
      },
      {
        kind: 'reward_ready',
        ...copy('pet_shop', 'reward_ready'),
        trigger: 'nearby',
        emoji: '🎁',
        radiusMeters: 300,
        priority: 40,
        cooldownHours: 72,
        eligibility: { requires_claimable_reward: true },
      },
    ],
    rules: [rewardReadyRule(300), birthdayRule],
  },

  {
    key: 'pharmacy',
    nameKey: 'walletTemplates.pharmacy.name',
    summaryKey: 'walletTemplates.pharmacy.summary',
    emoji: '💊',
    settings: {
      defaultRadiusMeters: 150,
      defaultDwellMinutes: 5,
      maxNotificationsPerDay: 1,
      minHoursBetweenNotifications: 72,
      quietHoursStart: 20,
      quietHoursEnd: 9,
      rewardNotifications: true,
      loyaltyReminders: false,
      nearbyRecommendations: false,
      notificationEmoji: '💊',
    },
    campaigns: [
      {
        kind: 'reward_ready',
        ...copy('pharmacy', 'reward_ready'),
        trigger: 'nearby',
        emoji: '💊',
        radiusMeters: 200,
        priority: 40,
        cooldownHours: 168,
        eligibility: { requires_claimable_reward: true },
      },
    ],
    rules: [rewardReadyRule(200)],
  },

  {
    key: 'supermarket',
    nameKey: 'walletTemplates.supermarket.name',
    summaryKey: 'walletTemplates.supermarket.summary',
    emoji: '🛒',
    settings: {
      defaultRadiusMeters: 500,
      defaultDwellMinutes: 15,
      maxNotificationsPerDay: 2,
      minHoursBetweenNotifications: 12,
      quietHoursStart: 22,
      quietHoursEnd: 7,
      rewardNotifications: true,
      loyaltyReminders: true,
      nearbyRecommendations: true,
      notificationEmoji: '🛒',
    },
    campaigns: [
      {
        kind: 'welcome',
        ...copy('supermarket', 'welcome'),
        trigger: 'entry',
        emoji: '🛒',
        radiusMeters: 500,
        priority: 20,
        cooldownHours: 24,
      },
      {
        kind: 'double_points',
        ...copy('supermarket', 'double_points'),
        trigger: 'nearby',
        emoji: '⚡',
        radiusMeters: 1_000,
        weekdays: [2, 3],
        priority: 25,
        cooldownHours: 72,
      },
    ],
    rules: [rewardReadyRule(500), birthdayRule],
  },
]

export function findTemplate(key: string): WalletTemplate | null {
  return WALLET_TEMPLATES.find((template) => template.key === key) ?? null
}

export const TEMPLATE_KEYS = WALLET_TEMPLATES.map((template) => template.key)

// -----------------------------------------------------------------------------
// Resolution
// -----------------------------------------------------------------------------

export function resolveTemplateCampaign(
  campaign: TemplateCampaign,
  t: Translator
): ResolvedTemplateCampaign {
  const {
    nameKey,
    descriptionKey,
    titleKey,
    messageKey,
    ctaKey,
    rewardDescriptionKey,
    ...rest
  } = campaign

  return {
    ...rest,
    name: t(nameKey),
    description: t(descriptionKey),
    title: t(titleKey),
    message: t(messageKey),
    ctaLabel: t(ctaKey),
    ...(rewardDescriptionKey ? { rewardDescription: t(rewardDescriptionKey) } : {}),
  }
}

export function resolveTemplateRule(rule: TemplateRule, t: Translator): ResolvedTemplateRule {
  const { nameKey, descriptionKey, actions, ...rest } = rule
  return {
    ...rest,
    name: t(nameKey),
    description: t(descriptionKey),
    actions: actions(t),
  }
}

/**
 * One template, entirely in one language.
 *
 * Callers pick the translator according to who the words are for: the viewer's
 * for anything rendered now, the business's for anything written to a row a
 * customer will later read.
 */
export function resolveWalletTemplate(
  template: WalletTemplate,
  t: Translator
): ResolvedWalletTemplate {
  const { nameKey, summaryKey, campaigns, rules, ...rest } = template
  return {
    ...rest,
    name: t(nameKey),
    summary: t(summaryKey),
    campaigns: campaigns.map((campaign) => resolveTemplateCampaign(campaign, t)),
    rules: rules.map((rule) => resolveTemplateRule(rule, t)),
  }
}
