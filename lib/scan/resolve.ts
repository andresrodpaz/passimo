import 'server-only'
import { getDb } from '@/lib/db'
import { verifyToken } from '@/lib/crypto'
import { lookupCustomers } from '@/lib/customers/service'
import { lookupForRedemption } from '@/lib/commerce/gift-cards'
import { num } from '@/lib/domain/types'
import { classifyScan, searchTermFor, type CodeKind, type ScanPayload } from '@/lib/scan/payload'
import { buildCounterCustomer, type CounterCustomer } from '@/lib/scan/counter'
import { realEmailOrNull } from '@/lib/customers/placeholder-email'

/**
 * Scan resolution.
 *
 * Turns whatever the camera read into something the merchant can act on. The
 * governing rule is that the merchant is never asked what kind of code they are
 * holding: an ambiguous human code is probed against every table that could own
 * it, concurrently, and the single match wins.
 */

export type CustomerSummary = {
  id: string
  displayName: string
  initials: string
  email: string | null
  phone: string | null
  isVip: boolean
  visitCount: number
  lastVisit: string | null
  tierName: string | null
  balance: number
  goal: number | null
  rewardAvailable: boolean
}

export type ScanResolution =
  /** Exactly one person: the check-in can proceed immediately. */
  | { kind: 'customer'; customer: CounterCustomer }
  /** A reward claim code: staff hand something over, nothing is deducted. */
  | { kind: 'reward_claim'; claim: { code: string; name: string }; customer: CounterCustomer }
  | {
      kind: 'gift_card'
      giftCard: {
        code: string
        status: string
        remainingValue: number
        initialValue: number
        currency: string
        recipientName: string | null
        redeemable: boolean
        expiresAt: string | null
      }
    }
  /** A referral code belonging to an existing member who is recommending us. */
  | { kind: 'referral'; advocate: CustomerSummary; code: string }
  /** Several possible people: the merchant picks, one tap. */
  | { kind: 'candidates'; customers: CustomerSummary[]; term: string }
  /** A join link — this person is not a member yet. */
  | { kind: 'join'; businessSlug: string; referralCode: string | null }
  /** Nothing matched. `hint` is written to be read aloud to a customer. */
  | { kind: 'unknown'; raw: string; hint: string }

export type ResolveOptions = {
  businessId: string
  raw: string
}

export async function resolveScan({ businessId, raw }: ResolveOptions): Promise<ScanResolution> {
  const payload = classifyScan(raw)

  switch (payload.kind) {
    case 'customer_id':
      return resolveCustomerId(businessId, payload.customerId, raw)

    case 'card_token': {
      const verified = verifyToken<{ c: string }>('card', payload.token)
      if (!verified?.c) {
        return {
          kind: 'unknown',
          raw,
          hint: 'That wallet card has expired. Ask them to open the link in their latest email.',
        }
      }
      return resolveCustomerId(businessId, verified.c, raw)
    }

    case 'join':
      return { kind: 'join', businessSlug: payload.businessSlug, referralCode: payload.referralCode }

    case 'code':
      return resolveCode(businessId, payload.code, payload.candidates, raw)

    case 'email':
    case 'phone':
    case 'text':
      return resolveByTerm(businessId, payload, raw)
  }
}

// -----------------------------------------------------------------------------
// Direct identity
// -----------------------------------------------------------------------------

async function resolveCustomerId(
  businessId: string,
  customerId: string,
  raw: string
): Promise<ScanResolution> {
  const admin = getDb()

  // Scoped to the business, so one merchant's pass can never resolve against
  // another's customer list. Merged customers forward to their surviving record
  // rather than failing — a wallet pass outlives a deduplication.
  const { data } = await admin
    .from('customers')
    .select('id, status, merged_into_customer_id')
    .eq('id', customerId)
    .eq('business_id', businessId)
    .maybeSingle()

  if (!data) {
    return {
      kind: 'unknown',
      raw,
      hint: 'That card belongs to a different business. Search for them by name instead.',
    }
  }
  if (data.status === 'anonymized') {
    return { kind: 'unknown', raw, hint: 'This customer asked to be deleted from your records.' }
  }

  const effectiveId = (data.merged_into_customer_id as string | null) ?? (data.id as string)
  return { kind: 'customer', customer: await buildCounterCustomer(businessId, effectiveId) }
}

// -----------------------------------------------------------------------------
// Ambiguous codes
// -----------------------------------------------------------------------------

/**
 * Probes each table that could own the code, in parallel.
 *
 * Codes are drawn from a 32-character alphabet at 8+ characters, so a collision
 * across two tables is not a practical concern; if one ever happened, the
 * priority order below decides, and it is ordered by what a cashier most likely
 * has in their hand.
 */
async function resolveCode(
  businessId: string,
  code: string,
  candidates: CodeKind[],
  raw: string
): Promise<ScanResolution> {
  const wants = (kind: CodeKind) => candidates.includes(kind)

  const [reward, giftCard, referral] = await Promise.all([
    wants('reward') ? findRewardClaim(businessId, code) : Promise.resolve(null),
    wants('gift_card') ? findGiftCard(businessId, code) : Promise.resolve(null),
    wants('referral') ? findReferrer(businessId, code) : Promise.resolve(null),
  ])

  if (reward) {
    return {
      kind: 'reward_claim',
      claim: { code, name: reward.name },
      customer: await buildCounterCustomer(businessId, reward.customerId),
    }
  }

  if (giftCard) return { kind: 'gift_card', giftCard }

  if (referral) return { kind: 'referral', advocate: referral, code }

  // Codes are also printed on receipts and loyalty cards, so fall back to a
  // text search before giving up — a merchant may use them as member numbers.
  const fuzzy = await lookupCustomers(businessId, code, 5)
  if (fuzzy.length > 0) return candidatesFrom(fuzzy, code)

  return {
    kind: 'unknown',
    raw,
    hint: `No reward, gift card or member matches ${code}. Check for a typo, or search by name.`,
  }
}

async function findRewardClaim(
  businessId: string,
  code: string
): Promise<{ customerId: string; name: string } | null> {
  const admin = getDb()
  const { data } = await admin
    .from('reward_redemptions')
    .select('customer_id, status, expires_at, rewards:reward_id (name)')
    .eq('business_id', businessId)
    .eq('code', code)
    .maybeSingle()

  if (!data) return null

  const reward = data.rewards as unknown as { name: string } | null
  return { customerId: data.customer_id as string, name: reward?.name ?? 'Reward' }
}

async function findGiftCard(businessId: string, code: string) {
  const { found, card } = await lookupForRedemption(businessId, code)
  if (!found || !card) return null

  const expired = card.expiresAt ? new Date(card.expiresAt) < new Date() : false
  return {
    code: card.code,
    status: expired ? 'expired' : card.status,
    remainingValue: num(card.remainingValue),
    initialValue: num(card.initialValue),
    currency: card.currency ?? 'EUR',
    recipientName: card.recipientName ?? null,
    redeemable: card.status === 'active' && !expired && num(card.remainingValue) > 0,
    expiresAt: card.expiresAt ?? null,
  }
}

async function findReferrer(businessId: string, code: string): Promise<CustomerSummary | null> {
  const admin = getDb()
  const { data } = await admin
    .from('customers')
    .select('id')
    .eq('business_id', businessId)
    .eq('referral_code', code)
    .eq('status', 'active')
    .is('merged_into_customer_id', null)
    .maybeSingle()

  if (!data) return null

  const matches = await lookupCustomers(businessId, data.id as string, 1)
  const match = matches[0]
  if (!match) return null
  return summarize(match)
}

// -----------------------------------------------------------------------------
// Fuzzy identity
// -----------------------------------------------------------------------------

async function resolveByTerm(
  businessId: string,
  payload: ScanPayload,
  raw: string
): Promise<ScanResolution> {
  const term = searchTermFor(payload)
  if (!term) {
    return { kind: 'unknown', raw, hint: 'Nothing to search for. Try their phone or email.' }
  }

  const matches = await lookupCustomers(businessId, term, 8)

  // An exact contact match is an identification, not a suggestion — awarding
  // should not need a confirming tap when the merchant typed a full email.
  if (matches.length === 1 && (payload.kind === 'email' || payload.kind === 'phone')) {
    return { kind: 'customer', customer: await buildCounterCustomer(businessId, matches[0]!.id) }
  }

  if (matches.length === 0) {
    return {
      kind: 'unknown',
      raw,
      hint:
        payload.kind === 'email' || payload.kind === 'phone'
          ? 'No member with those details yet — add them in one tap.'
          : `No member matches “${term}”.`,
    }
  }

  return candidatesFrom(matches, term)
}

function candidatesFrom(
  matches: Awaited<ReturnType<typeof lookupCustomers>>,
  term: string
): ScanResolution {
  return { kind: 'candidates', customers: matches.map(summarize), term }
}

export function summarize(match: Awaited<ReturnType<typeof lookupCustomers>>[number]): CustomerSummary {
  const email = realEmailOrNull(match.email)
  const displayName = match.name ?? match.firstName ?? email ?? match.phone ?? 'Guest'
  return {
    id: match.id,
    displayName,
    initials: displayName.slice(0, 2).toUpperCase(),
    email,
    phone: match.phone,
    isVip: match.isVip,
    visitCount: match.visitCount,
    lastVisit: match.lastVisit,
    tierName: match.tierName,
    balance: match.primaryBalance,
    goal: match.primaryGoal,
    rewardAvailable: match.rewardAvailable,
  }
}
