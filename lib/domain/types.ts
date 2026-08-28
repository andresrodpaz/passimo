/**
 * Domain model shared by services, API contracts and UI.
 *
 * These are the shapes the application reasons about. Database rows are mapped
 * into them at the query boundary so a schema change never leaks into fifty
 * components, and the UI never has to guess whether a numeric column arrived as
 * a string (Postgres `numeric` does, over PostgREST).
 */

export type Uuid = string
export type IsoDateTime = string
export type IsoDate = string

// -----------------------------------------------------------------------------
// Loyalty
// -----------------------------------------------------------------------------

export const PROGRAM_TYPES = ['stamps', 'points', 'cashback', 'membership'] as const
export type ProgramType = (typeof PROGRAM_TYPES)[number]

export const EARN_TRIGGERS = [
  'purchase',
  'visit',
  'signup',
  'birthday',
  'anniversary',
  'referral',
  'referred_signup',
  'review',
  'survey',
  'milestone',
  'manual',
] as const
export type EarnTrigger = (typeof EARN_TRIGGERS)[number]

export const AWARD_TYPES = ['fixed', 'per_currency', 'per_item', 'percent'] as const
export type AwardType = (typeof AWARD_TYPES)[number]

export type LoyaltyProgram = {
  id: Uuid
  businessId: Uuid
  name: string
  type: ProgramType
  isActive: boolean
  isDefault: boolean
  unitSingular: string
  unitPlural: string
  description: string | null
  goalAmount: number | null
  rewardDescription: string | null
  resetOnReward: boolean
  cashbackPercent: number | null
  pointValue: number | null
  expiryMonths: number | null
  expiryWarningDays: number
  earnCooldownMinutes: number
  maxEarnPerDay: number | null
  tierEnabled: boolean
  tierMetric: 'lifetime_earned' | 'lifetime_spend' | 'visit_count'
  tierWindowDays: number | null
}

export type EarningRule = {
  id: Uuid
  businessId: Uuid
  programId: Uuid
  name: string
  isActive: boolean
  priority: number
  stackable: boolean
  trigger: EarnTrigger
  awardType: AwardType
  awardAmount: number
  perAmount: number
  maxAward: number | null
  minPurchase: number | null
  milestoneThreshold: number | null
  daysOfWeek: number[] | null
  timeFrom: string | null
  timeTo: string | null
  startsAt: IsoDateTime | null
  endsAt: IsoDateTime | null
  locationIds: Uuid[] | null
  tierIds: Uuid[] | null
  segmentId: Uuid | null
  cooldownMinutes: number
  usageLimitPerCustomer: number | null
  totalUsageLimit: number | null
  usageCount: number
}

export type ProgramTier = {
  id: Uuid
  programId: Uuid
  name: string
  level: number
  threshold: number
  earnMultiplier: number
  color: string
  icon: string | null
  perks: string[]
  allowDowngrade: boolean
}

export type LoyaltyAccount = {
  id: Uuid
  programId: Uuid
  customerId: Uuid
  balance: number
  lifetimeEarned: number
  lifetimeRedeemed: number
  rewardsEarned: number
  tierId: Uuid | null
  tierSince: IsoDateTime | null
  nextExpiryAt: IsoDateTime | null
}

export const REWARD_TYPES = [
  'free_item',
  'percent_off',
  'amount_off',
  'free_shipping',
  'gift_card',
  'custom',
] as const
export type RewardType = (typeof REWARD_TYPES)[number]

export type Reward = {
  id: Uuid
  businessId: Uuid
  programId: Uuid | null
  name: string
  description: string | null
  imageUrl: string | null
  cost: number
  type: RewardType
  value: number | null
  isActive: boolean
  minTierLevel: number | null
  stock: number | null
  redeemedCount: number
  usageLimitPerCustomer: number | null
  validDays: number
  autoGrantTrigger: string | null
  sortOrder: number
}

export type LedgerEntryType =
  | 'earn'
  | 'redeem'
  | 'adjust'
  | 'expire'
  | 'reversal'
  | 'transfer_in'
  | 'transfer_out'

export type LedgerEntry = {
  id: Uuid
  programId: Uuid
  entryType: LedgerEntryType
  amount: number
  balanceAfter: number
  reason: string | null
  rewardId: Uuid | null
  expiresAt: IsoDateTime | null
  createdAt: IsoDateTime
}

// -----------------------------------------------------------------------------
// Customers
// -----------------------------------------------------------------------------

export type ConsentChannel = 'email' | 'sms' | 'whatsapp' | 'push'

export type CustomerConsents = {
  email: boolean
  sms: boolean
  whatsapp: boolean
  push: boolean
  marketing: boolean
  updatedAt: IsoDateTime | null
  source: string | null
}

export const RFM_SEGMENTS = [
  'champion',
  'loyal',
  'potential_loyalist',
  'new',
  'needs_attention',
  'at_risk',
  'cant_lose',
  'hibernating',
] as const
export type RfmSegment = (typeof RFM_SEGMENTS)[number]

export type Customer = {
  id: Uuid
  businessId: Uuid
  email: string
  name: string | null
  firstName: string | null
  lastName: string | null
  phone: string | null
  birthday: IsoDate | null
  anniversary: IsoDate | null
  locale: string | null
  avatarUrl: string | null
  isVip: boolean
  status: 'active' | 'blocked' | 'anonymized'
  source: string
  referralCode: string | null
  referredBy: Uuid | null
  notesCount: number
  tags: CustomerTag[]
  consents: CustomerConsents
  firstVisitAt: IsoDateTime | null
  lastVisit: IsoDateTime | null
  visitCount: number
  lifetimeSpend: number
  averageTicket: number
  daysBetweenVisits: number | null
  rfmSegment: RfmSegment | null
  churnRisk: number | null
  predictedClv: number | null
  createdAt: IsoDateTime
  accounts: LoyaltyAccount[]
}

export type CustomerTag = {
  id: Uuid
  name: string
  color: string
}

export type CustomerNote = {
  id: Uuid
  body: string
  pinned: boolean
  authorName: string | null
  createdAt: IsoDateTime
}

// -----------------------------------------------------------------------------
// Activity
// -----------------------------------------------------------------------------

export const ACTIVITY_TYPES = [
  'signup',
  'visit',
  'purchase',
  'earn',
  'redeem',
  'referral',
  'review',
  'survey',
  'tier_change',
  'gift_card',
  'message',
  'wallet_add',
  'custom',
] as const
export type ActivityType = (typeof ACTIVITY_TYPES)[number]

export type ActivityEvent = {
  id: Uuid
  customerId: Uuid | null
  type: ActivityType
  amount: number | null
  currency: string | null
  quantity: number | null
  source: string
  locationId: Uuid | null
  metadata: Record<string, unknown>
  occurredAt: IsoDateTime
}

// -----------------------------------------------------------------------------
// Messaging
// -----------------------------------------------------------------------------

export const CHANNELS = ['email', 'sms', 'whatsapp', 'push', 'wallet'] as const
export type Channel = (typeof CHANNELS)[number]

export const MESSAGE_STATUSES = [
  'queued',
  'sent',
  'delivered',
  'opened',
  'clicked',
  'bounced',
  'failed',
  'skipped',
  'unsubscribed',
] as const
export type MessageStatus = (typeof MESSAGE_STATUSES)[number]

// -----------------------------------------------------------------------------
// Analytics
// -----------------------------------------------------------------------------

export type AnalyticsOverview = {
  period_days: number
  customers: {
    total: number
    new: number
    new_previous: number
    active: number
    lapsed: number
    vip: number
    repeat_rate: number
    retention_rate: number
    churn_rate: number
  }
  revenue: {
    period: number
    previous: number
    lifetime: number
    average_ticket: number
    average_clv: number
  }
  engagement: {
    visits: number
    visits_previous: number
    redemptions: number
    balance_earned: number
    balance_redeemed: number
    balance_outstanding: number
  }
  nps: { score: number | null; responses: number; average: number | null }
  growth: { month: string; customers: number; visits: number; revenue: number }[]
  daily: { date: string; visits: number; revenue: number }[]
  top_rewards: { id: Uuid; name: string; redemptions: number }[]
  top_customers: {
    id: Uuid
    name: string | null
    email: string
    lifetime_spend: number
    visit_count: number
    is_vip: boolean
  }[]
}

// -----------------------------------------------------------------------------
// Utilities
// -----------------------------------------------------------------------------

/**
 * PostgREST serialises `numeric` as a string to avoid float precision loss.
 * Every read path funnels through this so the UI never does string maths.
 */
export function num(value: unknown, fallback = 0): number {
  if (value === null || value === undefined) return fallback
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function displayName(customer: {
  name?: string | null
  firstName?: string | null
  lastName?: string | null
  email?: string | null
}): string {
  const full = [customer.firstName, customer.lastName].filter(Boolean).join(' ').trim()
  if (full) return full
  if (customer.name?.trim()) return customer.name.trim()
  return customer.email?.split('@')[0] ?? 'Guest'
}
