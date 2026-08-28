import 'server-only'
import { getDb } from '@/lib/db'
import { getCustomer } from '@/lib/customers/service'
import { getCustomerLoyalty } from '@/lib/loyalty/engine'
import { membershipsForCustomer } from '@/lib/commerce/memberships'
import { listOffers } from '@/lib/growth/coalition'
import { num } from '@/lib/domain/types'
import { logger } from '@/lib/logger'
import { isPlaceholderEmail, realEmailOrNull } from '@/lib/customers/placeholder-email'

/**
 * The counter view of a customer.
 *
 * One object containing everything the person behind the till needs to decide
 * what to do next, assembled in a single round trip. The scanner must not have
 * to fetch a profile, then balances, then rewards, then offers while a queue
 * builds — every follow-up request is a second of someone's patience.
 *
 * It is also the offline cache unit: whatever is in here is what a cached
 * customer can be served with when the connection drops.
 */

export type CounterProgram = {
  programId: string
  name: string
  type: string
  unitSingular: string
  unitPlural: string
  balance: number
  goal: number | null
  progressPercent: number
  remainingToGoal: number | null
  rewardAvailable: boolean
  tier: { name: string; level: number; color: string } | null
  nextTier: { name: string; remaining: number } | null
}

export type CounterReward = {
  id: string
  name: string
  description: string | null
  cost: number
  affordable: boolean
}

/** A reward already granted or claimed, waiting to be handed over. */
export type CounterClaim = {
  redemptionId: string
  code: string
  name: string
  expiresAt: string | null
  granted: boolean
}

export type CounterOffer = {
  id: string
  title: string
  businessName: string | null
}

export type CounterCustomer = {
  id: string
  name: string | null
  firstName: string | null
  displayName: string
  initials: string
  email: string | null
  phone: string | null
  avatarUrl: string | null
  isVip: boolean
  visitCount: number
  lifetimeSpend: number
  averageTicket: number
  lastVisit: string | null
  memberSince: string | null
  tierName: string | null
  programs: CounterProgram[]
  rewards: CounterReward[]
  claims: CounterClaim[]
  membership: {
    planName: string
    status: string
    earnMultiplier: number
    renewsAt: string | null
  } | null
  giftCardBalance: number
  giftCardCurrency: string | null
  partnerOffers: CounterOffer[]
  /** Facts worth surfacing without the cashier having to read numbers. */
  flags: {
    firstVisit: boolean
    birthdayToday: boolean
    returningAfterLapse: boolean
    atRisk: boolean
  }
  /** One short line telling staff the single most valuable thing to say. */
  nextBestAction: string | null
}

/**
 * Assembles the counter view. Every independent read runs concurrently: the
 * latency of this function is the slowest single query, not their sum.
 */
export async function buildCounterCustomer(
  businessId: string,
  customerId: string
): Promise<CounterCustomer> {
  const admin = getDb()

  const [customer, loyalty, memberships, claimRows, giftCardRows, offers] = await Promise.all([
    getCustomer(businessId, customerId),
    getCustomerLoyalty(businessId, customerId),
    membershipsForCustomer(businessId, customerId),
    admin
      .from('reward_redemptions')
      .select('id, code, status, expires_at, metadata, rewards:reward_id (name)')
      .eq('business_id', businessId)
      .eq('customer_id', customerId)
      // `claimed` is the only pre-fulfilment state the status constraint allows:
      // issued to the customer, not yet handed over at the counter.
      .eq('status', 'claimed')
      .order('created_at', { ascending: false })
      .limit(10),
    admin
      .from('gift_cards')
      .select('remaining_value, currency, status')
      .eq('business_id', businessId)
      .eq('recipient_customer_id', customerId)
      .eq('status', 'active'),
    // Partner offers are a bonus, never a reason to fail a check-in.
    listOffers(businessId, { fromPartners: true }).catch((cause) => {
      logger.warn('scan.partner_offers_failed', { businessId, cause: String(cause) })
      return []
    }),
  ])

  const programs: CounterProgram[] = loyalty.programs.map((program) => ({
    programId: program.programId,
    name: program.programName,
    type: program.type,
    unitSingular: program.unitSingular,
    unitPlural: program.unitPlural,
    balance: program.balance,
    goal: program.goalAmount,
    progressPercent: program.progressPercent,
    remainingToGoal:
      program.goalAmount == null ? null : Math.max(0, program.goalAmount - program.balance),
    rewardAvailable: program.rewardAvailable,
    tier: program.tier
      ? { name: program.tier.name, level: program.tier.level, color: program.tier.color }
      : null,
    nextTier: program.nextTier,
  }))

  const claims: CounterClaim[] = (claimRows.data ?? [])
    .filter((row) => {
      const expiry = row.expires_at as string | null
      return !expiry || new Date(expiry) > new Date()
    })
    .map((row) => {
      const reward = row.rewards as unknown as { name: string } | null
      const metadata = (row.metadata ?? {}) as Record<string, unknown>
      return {
        redemptionId: row.id as string,
        code: (row.code as string) ?? '',
        name: reward?.name ?? 'Reward',
        expiresAt: (row.expires_at as string) ?? null,
        granted: Boolean(metadata.granted),
      }
    })

  const activeCards = giftCardRows.data ?? []
  const giftCardBalance = activeCards.reduce((total, row) => total + num(row.remaining_value), 0)

  const membershipRows = memberships as unknown as Array<Record<string, unknown>>
  const activeMembership = membershipRows.find(
    (row) => row.status === 'active' || row.status === 'past_due'
  )
  const plan = activeMembership?.membership_plans as
    | { name: string; earn_multiplier: number | string }
    | undefined

  const displayName =
    customer.name ??
    customer.firstName ??
    realEmailOrNull(customer.email) ??
    customer.phone ??
    'Guest'

  const flags = {
    firstVisit: customer.visitCount === 0,
    birthdayToday: isBirthdayToday(customer.birthday),
    returningAfterLapse: isReturningAfterLapse(customer.lastVisit, customer.daysBetweenVisits),
    atRisk: (customer.churnRisk ?? 0) >= 0.6,
  }

  return {
    id: customer.id,
    name: customer.name,
    firstName: customer.firstName,
    displayName,
    initials: initialsOf(displayName),
    email: isPlaceholderEmail(customer.email) ? null : customer.email,
    phone: customer.phone,
    avatarUrl: customer.avatarUrl,
    isVip: customer.isVip,
    visitCount: customer.visitCount,
    lifetimeSpend: customer.lifetimeSpend,
    averageTicket: customer.averageTicket,
    lastVisit: customer.lastVisit,
    memberSince: customer.firstVisitAt ?? customer.createdAt,
    tierName: customer.tierName,
    programs,
    rewards: loyalty.availableRewards.map((reward) => ({
      id: reward.id,
      name: reward.name,
      description: reward.description,
      cost: reward.cost,
      affordable: reward.affordable,
    })),
    claims,
    membership: plan
      ? {
          planName: plan.name,
          status: activeMembership!.status as string,
          earnMultiplier: num(plan.earn_multiplier, 1) || 1,
          renewsAt: (activeMembership!.current_period_end as string) ?? null,
        }
      : null,
    giftCardBalance,
    giftCardCurrency: (activeCards[0]?.currency as string) ?? null,
    flags,
    partnerOffers: offers
      .filter((offer) => offer.isActive)
      .slice(0, 3)
      .map((offer) => ({ id: offer.id, title: offer.title, businessName: offer.businessName })),
    nextBestAction: suggestAction({ flags, programs, claims, customer: { isVip: customer.isVip } }),
  }
}

// -----------------------------------------------------------------------------
// Derived signals
// -----------------------------------------------------------------------------

/**
 * The one sentence staff should read.
 *
 * Ordered by what earns the most goodwill per second of the cashier's attention:
 * something to hand over beats something to celebrate, which beats something to
 * mention. Deliberately rule-based rather than an AI call — this renders while
 * the customer is still holding their phone up, and a model round trip would
 * blow the sub-second budget.
 */
function suggestAction(input: {
  flags: CounterCustomer['flags']
  programs: CounterProgram[]
  claims: CounterClaim[]
  customer: { isVip: boolean }
}): string | null {
  const readyClaim = input.claims[0]
  if (readyClaim) return `Hand over their ${readyClaim.name} — code ${readyClaim.code}`

  const completed = input.programs.find((program) => program.rewardAvailable)
  if (completed) return `Reward unlocked — offer it now before they leave`

  if (input.flags.birthdayToday) return `It's their birthday today — wish them happy birthday`
  if (input.flags.firstVisit) return `First visit — explain how the card works in one sentence`
  if (input.flags.returningAfterLapse) return `Back after a while — say it's good to see them again`

  const closest = input.programs
    .filter((program) => program.remainingToGoal != null && program.remainingToGoal > 0)
    .sort((a, b) => (a.remainingToGoal ?? 0) - (b.remainingToGoal ?? 0))[0]
  if (closest && (closest.remainingToGoal ?? 0) <= 2) {
    return `${closest.remainingToGoal} more ${
      closest.remainingToGoal === 1 ? closest.unitSingular : closest.unitPlural
    } to their reward — tell them`
  }

  if (input.customer.isVip) return `VIP customer — give them the good table`
  return null
}

function isBirthdayToday(birthday: string | null): boolean {
  if (!birthday) return false
  const date = new Date(birthday)
  if (Number.isNaN(date.getTime())) return false
  const today = new Date()
  return date.getUTCMonth() === today.getUTCMonth() && date.getUTCDate() === today.getUTCDate()
}

/**
 * "Longer than usual for this person", not a fixed threshold: a daily coffee
 * customer who vanished for three weeks matters, a monthly haircut customer who
 * is three weeks out is simply on time.
 */
function isReturningAfterLapse(
  lastVisit: string | null,
  daysBetweenVisits: number | null
): boolean {
  if (!lastVisit) return false
  const days = (Date.now() - new Date(lastVisit).getTime()) / 86_400_000
  if (!Number.isFinite(days)) return false
  const usual = daysBetweenVisits && daysBetweenVisits > 0 ? daysBetweenVisits : 30
  return days > Math.max(usual * 2.5, 21)
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/[\s@.]+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase()
}
