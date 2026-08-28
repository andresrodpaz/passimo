import { z } from 'zod'
import { CHANNELS, PROGRAM_TYPES, REWARD_TYPES, EARN_TRIGGERS, AWARD_TYPES } from '@/lib/domain/types'
import { segmentDefinitionSchema } from '@/lib/segments/definition'
import { ROLES } from '@/lib/auth/rbac'

/** Reusable request schemas. Keeping them here stops the same shape drifting
 *  between the route that writes it and the route that reads it. */

export const uuid = z.string().uuid()
export const businessIdSchema = z.object({ businessId: uuid })

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

export const listCustomersQuery = paginationSchema.extend({
  businessId: uuid,
  q: z.string().trim().max(200).optional(),
  segmentId: uuid.optional(),
  tag: z.string().max(60).optional(),
  vip: z.enum(['true', 'false']).optional(),
  rfm: z.string().max(40).optional(),
  sort: z
    .enum(['recent', 'name', 'spend', 'visits', 'balance', 'churn'])
    .default('recent'),
})

export const createCustomerSchema = z.object({
  businessId: uuid,
  email: z.string().email().optional(),
  phone: z.string().min(6).max(32).optional(),
  name: z.string().max(120).optional(),
  firstName: z.string().max(60).optional(),
  lastName: z.string().max(60).optional(),
  birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  anniversary: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  locale: z.string().max(10).optional(),
  isVip: z.boolean().optional(),
  consents: z
    .object({
      email: z.boolean().optional(),
      sms: z.boolean().optional(),
      whatsapp: z.boolean().optional(),
      push: z.boolean().optional(),
      marketing: z.boolean().optional(),
    })
    .optional(),
  tags: z.array(z.string().max(60)).max(20).optional(),
}).refine((value) => Boolean(value.email || value.phone), {
  message: 'Either email or phone is required',
  path: ['email'],
})

export const updateCustomerSchema = z.object({
  businessId: uuid,
  name: z.string().max(120).nullable().optional(),
  firstName: z.string().max(60).nullable().optional(),
  lastName: z.string().max(60).nullable().optional(),
  phone: z.string().max(32).nullable().optional(),
  birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  anniversary: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  locale: z.string().max(10).nullable().optional(),
  isVip: z.boolean().optional(),
  status: z.enum(['active', 'blocked']).optional(),
  consents: z
    .object({
      email: z.boolean().optional(),
      sms: z.boolean().optional(),
      whatsapp: z.boolean().optional(),
      push: z.boolean().optional(),
      marketing: z.boolean().optional(),
    })
    .optional(),
})

/**
 * Counter scan. One request covers "who is this?" and "credit them", because at
 * a counter those are the same action and two round trips is a second lost.
 *
 * `raw` is whatever the camera or keyboard produced, unparsed — the server owns
 * classification so every client (POS, dashboard, future native app, partner
 * integration) resolves identifiers identically.
 */
export const scanSchema = z.object({
  businessId: uuid,
  raw: z.string().min(1).max(2000),
  action: z.enum(['identify', 'checkin']).default('identify'),
  trigger: z.enum(EARN_TRIGGERS).optional(),
  amount: z.number().nonnegative().max(1_000_000).nullable().optional(),
  quantity: z.number().int().positive().max(10_000).nullable().optional(),
  locationId: uuid.nullable().optional(),
  /** Required to check in: it is what makes an offline replay safe. */
  idempotencyKey: z.string().min(8).max(120).optional(),
  /** Milliseconds from camera frame to submit; feeds counter-speed analytics. */
  decodeMs: z.number().int().nonnegative().max(600_000).optional(),
  /** Set when the scan was captured offline and is being replayed. */
  queuedAt: z.string().datetime().optional(),
}).refine((value) => value.action !== 'checkin' || Boolean(value.idempotencyKey), {
  message: 'idempotencyKey is required to check a customer in',
  path: ['idempotencyKey'],
})

export const earnSchema = z.object({
  businessId: uuid,
  /** Identify the customer by id, email, phone or scanned card token. */
  customerId: uuid.optional(),
  email: z.string().email().optional(),
  phone: z.string().min(6).max(32).optional(),
  cardToken: z.string().max(400).optional(),
  trigger: z.enum(EARN_TRIGGERS).default('visit'),
  amount: z.number().nonnegative().max(1_000_000).nullable().optional(),
  quantity: z.number().int().positive().max(10_000).nullable().optional(),
  locationId: uuid.nullable().optional(),
  note: z.string().max(500).nullable().optional(),
  /** Staff override; requires loyalty:adjust. */
  overrideAmount: z.number().nullable().optional(),
  overrideProgramId: uuid.nullable().optional(),
  idempotencyKey: z.string().min(8).max(120).optional(),
  externalId: z.string().max(200).optional(),
}).refine(
  (value) => Boolean(value.customerId || value.email || value.phone || value.cardToken),
  { message: 'Provide customerId, email, phone or cardToken', path: ['customerId'] }
)

export const redeemSchema = z.object({
  businessId: uuid,
  customerId: uuid,
  rewardId: uuid,
  locationId: uuid.nullable().optional(),
  idempotencyKey: z.string().min(8).max(120).optional(),
})

export const adjustSchema = z.object({
  businessId: uuid,
  customerId: uuid,
  programId: uuid,
  amount: z.number().refine((value) => value !== 0, 'Amount must not be zero'),
  reason: z.string().min(2).max(200),
  idempotencyKey: z.string().min(8).max(120).optional(),
})

export const programSchema = z.object({
  businessId: uuid,
  name: z.string().min(1).max(80),
  type: z.enum(PROGRAM_TYPES),
  unitSingular: z.string().max(30).optional(),
  unitPlural: z.string().max(30).optional(),
  description: z.string().max(400).nullable().optional(),
  goalAmount: z.number().positive().max(100_000).nullable().optional(),
  rewardDescription: z.string().max(200).nullable().optional(),
  cashbackPercent: z.number().min(0).max(100).nullable().optional(),
  pointValue: z.number().min(0).max(1000).nullable().optional(),
  expiryMonths: z.number().int().min(1).max(120).nullable().optional(),
  earnCooldownMinutes: z.number().int().min(0).max(1440).optional(),
  maxEarnPerDay: z.number().positive().nullable().optional(),
  tierEnabled: z.boolean().optional(),
  tierMetric: z.enum(['lifetime_earned', 'lifetime_spend', 'visit_count']).optional(),
  isActive: z.boolean().optional(),
  isDefault: z.boolean().optional(),
})

export const ruleSchema = z.object({
  businessId: uuid,
  programId: uuid,
  name: z.string().min(1).max(80),
  trigger: z.enum(EARN_TRIGGERS),
  awardType: z.enum(AWARD_TYPES).default('fixed'),
  awardAmount: z.number().positive().max(100_000),
  perAmount: z.number().positive().max(100_000).default(1),
  maxAward: z.number().positive().nullable().optional(),
  minPurchase: z.number().nonnegative().nullable().optional(),
  milestoneThreshold: z.number().positive().nullable().optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).nullable().optional(),
  timeFrom: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).nullable().optional(),
  timeTo: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).nullable().optional(),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  locationIds: z.array(uuid).max(50).nullable().optional(),
  segmentId: uuid.nullable().optional(),
  cooldownMinutes: z.number().int().min(0).max(10_080).default(0),
  usageLimitPerCustomer: z.number().int().positive().nullable().optional(),
  totalUsageLimit: z.number().int().positive().nullable().optional(),
  priority: z.number().int().min(0).max(1000).default(100),
  stackable: z.boolean().default(false),
  isActive: z.boolean().default(true),
})

export const rewardSchema = z.object({
  businessId: uuid,
  programId: uuid.nullable().optional(),
  name: z.string().min(1).max(100),
  description: z.string().max(400).nullable().optional(),
  cost: z.number().nonnegative().max(1_000_000),
  type: z.enum(REWARD_TYPES).default('free_item'),
  value: z.number().nonnegative().nullable().optional(),
  minTierLevel: z.number().int().min(0).max(20).nullable().optional(),
  stock: z.number().int().min(0).nullable().optional(),
  usageLimitPerCustomer: z.number().int().positive().nullable().optional(),
  validDays: z.number().int().min(1).max(730).default(30),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  autoGrantTrigger: z
    .enum(['welcome', 'birthday', 'anniversary', 'winback', 'referral', 'milestone', 'tier_upgrade'])
    .nullable()
    .optional(),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(1000).default(0),
})

export const segmentSchema = z.object({
  businessId: uuid,
  name: z.string().min(1).max(80),
  description: z.string().max(300).nullable().optional(),
  definition: segmentDefinitionSchema,
})

export const campaignSchema = z.object({
  businessId: uuid,
  name: z.string().min(1).max(120),
  description: z.string().max(400).nullable().optional(),
  type: z
    .enum([
      'manual',
      'birthday',
      'winback',
      'double_stamp',
      'promo',
      'welcome',
      'anniversary',
      'milestone',
      'referral',
      'review_request',
      'reward_reminder',
      'expiry_warning',
      'tier_upgrade',
      'nps',
    ])
    .default('manual'),
  channels: z.array(z.enum(CHANNELS)).min(1).max(5),
  segmentId: uuid.nullable().optional(),
  subject: z.string().max(200).nullable().optional(),
  preheader: z.string().max(200).nullable().optional(),
  bodyHtml: z.string().max(50_000).nullable().optional(),
  bodyText: z.string().max(10_000).nullable().optional(),
  smsBody: z.string().max(1000).nullable().optional(),
  whatsappBody: z.string().max(2000).nullable().optional(),
  pushTitle: z.string().max(80).nullable().optional(),
  pushBody: z.string().max(300).nullable().optional(),
  walletMessage: z.string().max(300).nullable().optional(),
  ctaLabel: z.string().max(60).nullable().optional(),
  ctaUrl: z.string().url().max(600).nullable().optional(),
  attachedRewardId: uuid.nullable().optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
  status: z.enum(['draft', 'scheduled']).default('draft'),
  generatedByAi: z.boolean().optional(),
  aiPrompt: z.string().max(2000).nullable().optional(),
})

export const automationSchema = z.object({
  businessId: uuid,
  name: z.string().min(1).max(120),
  description: z.string().max(400).nullable().optional(),
  trigger: z.enum([
    'customer_joined',
    'visit_recorded',
    'purchase_recorded',
    'reward_unlocked',
    'reward_redeemed',
    'birthday',
    'anniversary',
    'inactivity',
    'balance_expiring',
    'tier_upgraded',
    'referral_qualified',
    'nps_detractor',
    'nps_promoter',
    'membership_renewal',
  ]),
  triggerConfig: z.record(z.unknown()).default({}),
  delayMinutes: z.number().int().min(0).max(43_200).default(0),
  segmentId: uuid.nullable().optional(),
  actions: z.array(z.record(z.unknown())).min(1).max(10),
  cooldownDays: z.number().int().min(0).max(3650).default(30),
  isActive: z.boolean().default(false),
})

export const teamInviteSchema = z.object({
  businessId: uuid,
  email: z.string().email(),
  role: z.enum(ROLES).refine((role) => role !== 'owner', 'Ownership must be transferred, not invited'),
  displayName: z.string().max(80).optional(),
})

export const publicJoinSchema = z.object({
  businessSlug: z.string().min(1).max(80),
  email: z.string().email(),
  name: z.string().max(120).optional(),
  phone: z.string().max(32).optional(),
  birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  locale: z.string().max(10).optional(),
  referralCode: z.string().max(20).optional(),
  locationId: uuid.optional(),
  consents: z
    .object({
      email: z.boolean().default(true),
      sms: z.boolean().default(false),
      whatsapp: z.boolean().default(false),
      marketing: z.boolean().default(false),
    })
    .default({ email: true, sms: false, whatsapp: false, marketing: false }),
  acceptedTerms: z.literal(true, {
    errorMap: () => ({ message: 'You must accept the terms to join' }),
  }),
})
