import 'server-only'
import { getDb } from '@/lib/db'
import { logger } from '@/lib/logger'
import { conflict, forbidden, notFound, unprocessable } from '@/lib/errors'
import { num } from '@/lib/domain/types'
import { notify } from '@/lib/notifications'
import { translatorForBusiness } from '@/lib/i18n/business'

/**
 * The coalition: local businesses that send each other customers.
 *
 * This is the only feature here with a genuine network effect. A loyalty app is
 * worth the same to the tenth merchant as to the first; a *network* of local
 * businesses that swap customers is worth more with every one that joins, and
 * the merchant who leaves loses their partners, not just their software.
 *
 * Three rules the design enforces:
 *
 *  1. **Opt in, per business.** `network_opt_in` is false by default. A
 *     merchant's participation, their listing and their customers are theirs;
 *     we never enrol anyone by default and call it a directory.
 *  2. **Nobody's customer list is ever shared.** A partnership grants the right
 *     to *honour* the other's members and publish offers to them. It never
 *     transfers contact data. `share_audience` gates aggregate reach only.
 *  3. **Both sides must agree.** An invitation is pending until accepted, and
 *     either side can end it at any time, immediately.
 */

export type PartnershipStatus = 'pending' | 'active' | 'declined' | 'ended'

export type Partner = {
  partnershipId: string
  partnerId: string
  partnerName: string
  partnerSlug: string
  partnerLogoUrl: string | null
  partnerCategory: string | null
  partnerCity: string | null
  status: PartnershipStatus
  /** `sent` means we invited them; `received` means they invited us. */
  direction: 'sent' | 'received'
  allowCrossEarn: boolean
  allowCrossRedeem: boolean
  shareAudience: boolean
  offersLive: number
  /** Redemptions of our offers by their members. */
  redemptionsIn: number
  /** Redemptions of their offers by our members. */
  redemptionsOut: number
  createdAt: string
}

export type DirectoryEntry = {
  id: string
  name: string
  slug: string
  logoUrl: string | null
  category: string | null
  city: string | null
  bio: string | null
  /** Approximate member count, bucketed — never an exact competitive figure. */
  reach: string
  relationship: PartnershipStatus | null
}

export type CoalitionOffer = {
  id: string
  businessId: string
  businessName: string | null
  partnershipId: string | null
  title: string
  description: string | null
  rewardId: string | null
  imageUrl: string | null
  terms: string | null
  startsAt: string | null
  endsAt: string | null
  redemptionLimit: number | null
  perCustomerLimit: number
  redeemedCount: number
  isActive: boolean
}

// -----------------------------------------------------------------------------
// Directory
// -----------------------------------------------------------------------------

/**
 * Nearby businesses that have opted into the network.
 *
 * Ranked by locality, because "the bakery on my street" is a partnership a café
 * owner will actually act on and "a gym in another city" is not.
 */
export async function browseDirectory(
  businessId: string,
  options: { search?: string; category?: string; limit?: number } = {}
): Promise<DirectoryEntry[]> {
  const admin = getDb()
  const limit = Math.min(options.limit ?? 30, 100)

  const { data: self } = await admin
    .from('businesses')
    .select('city, country, network_opt_in')
    .eq('id', businessId)
    .maybeSingle()

  let request = admin
    .from('businesses')
    .select('id, name, slug, logo_url, category, city, network_bio')
    .eq('network_opt_in', true)
    .is('archived_at', null)
    .neq('id', businessId)
    .limit(limit)

  if (self?.city) request = request.eq('city', self.city as string)
  if (options.category) request = request.eq('category', options.category)
  if (options.search?.trim()) request = request.ilike('name', `%${options.search.trim()}%`)

  const { data, error } = await request
  if (error) {
    logger.warn('coalition.directory_failed', { business_id: businessId, error })
    return []
  }

  const candidates = data ?? []
  if (candidates.length === 0) return []

  // One query for every existing relationship, so the list can show "Pending"
  // instead of inviting the same business twice.
  const ids = candidates.map((row) => row.id as string)
  const { data: existing } = await admin
    .from('business_partnerships')
    .select('business_id, partner_business_id, status')
    .or(`business_id.eq.${businessId},partner_business_id.eq.${businessId}`)
    .in('business_id', [...ids, businessId])

  const relationships = new Map<string, PartnershipStatus>()
  for (const row of existing ?? []) {
    const other =
      row.business_id === businessId
        ? (row.partner_business_id as string)
        : (row.business_id as string)
    relationships.set(other, row.status as PartnershipStatus)
  }

  const counts = await memberReach(ids)

  return candidates.map((row) => ({
    id: row.id as string,
    name: row.name as string,
    slug: row.slug as string,
    logoUrl: (row.logo_url as string) ?? null,
    category: (row.category as string) ?? null,
    city: (row.city as string) ?? null,
    bio: (row.network_bio as string) ?? null,
    reach: bucketReach(counts.get(row.id as string) ?? 0),
    relationship: relationships.get(row.id as string) ?? null,
  }))
}

/**
 * Bucketed member counts.
 *
 * A partner needs to know whether a business has 50 customers or 5,000 to judge
 * whether the swap is fair. They do not need the exact figure, which is
 * competitively sensitive and would make the directory a reconnaissance tool.
 */
function bucketReach(count: number): string {
  if (count === 0) return 'Just starting'
  if (count < 100) return 'Under 100 members'
  if (count < 500) return '100–500 members'
  if (count < 2000) return '500–2,000 members'
  return '2,000+ members'
}

async function memberReach(businessIds: string[]): Promise<Map<string, number>> {
  const admin = getDb()
  const result = new Map<string, number>()

  await Promise.all(
    businessIds.map(async (id) => {
      const { count } = await admin
        .from('customers')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', id)
        .eq('status', 'active')
      result.set(id, count ?? 0)
    })
  )

  return result
}

export async function setNetworkParticipation(input: {
  businessId: string
  optIn: boolean
  bio?: string | null
}): Promise<void> {
  const admin = getDb()
  const { error } = await admin
    .from('businesses')
    .update({
      network_opt_in: input.optIn,
      ...(input.bio !== undefined ? { network_bio: input.bio } : {}),
    })
    .eq('id', input.businessId)

  if (error) throw unprocessable(error.message)
}

// -----------------------------------------------------------------------------
// Partnerships
// -----------------------------------------------------------------------------

export async function listPartners(businessId: string): Promise<Partner[]> {
  const admin = getDb()
  const { data, error } = await admin.rpc('passimo_partner_summary', {
    p_business_id: businessId,
  })

  if (error) {
    logger.warn('coalition.partners_failed', { business_id: businessId, error })
    return []
  }

  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    partnershipId: row.partnership_id as string,
    partnerId: row.partner_id as string,
    partnerName: row.partner_name as string,
    partnerSlug: row.partner_slug as string,
    partnerLogoUrl: (row.partner_logo_url as string) ?? null,
    partnerCategory: (row.partner_category as string) ?? null,
    partnerCity: (row.partner_city as string) ?? null,
    status: row.status as PartnershipStatus,
    direction: row.direction as 'sent' | 'received',
    allowCrossEarn: Boolean(row.allow_cross_earn),
    allowCrossRedeem: Boolean(row.allow_cross_redeem),
    shareAudience: Boolean(row.share_audience),
    offersLive: num(row.offers_live),
    redemptionsIn: num(row.redemptions_in),
    redemptionsOut: num(row.redemptions_out),
    createdAt: row.created_at as string,
  }))
}

export async function invitePartner(input: {
  businessId: string
  partnerBusinessId: string
  invitedBy: string | null
  allowCrossEarn?: boolean
  allowCrossRedeem?: boolean
}): Promise<{ partnershipId: string; status: PartnershipStatus }> {
  if (input.businessId === input.partnerBusinessId) {
    throw unprocessable('A business cannot partner with itself')
  }

  const admin = getDb()

  const { data: partner } = await admin
    .from('businesses')
    .select('id, name, network_opt_in')
    .eq('id', input.partnerBusinessId)
    .is('archived_at', null)
    .maybeSingle()

  if (!partner) throw notFound('Business')
  if (!partner.network_opt_in) {
    throw forbidden('That business has not joined the partner network')
  }

  // Either direction counts as an existing relationship; the unique constraint
  // only covers one ordering.
  const { data: existing } = await admin
    .from('business_partnerships')
    .select('id, status, business_id')
    .or(
      `and(business_id.eq.${input.businessId},partner_business_id.eq.${input.partnerBusinessId}),` +
        `and(business_id.eq.${input.partnerBusinessId},partner_business_id.eq.${input.businessId})`
    )
    .maybeSingle()

  if (existing) {
    if (existing.status === 'active') throw conflict('You are already partners')
    if (existing.status === 'pending') throw conflict('An invitation is already pending')

    // A previously declined or ended relationship can be restarted.
    const { error } = await admin
      .from('business_partnerships')
      .update({
        status: 'pending',
        business_id: input.businessId,
        partner_business_id: input.partnerBusinessId,
        invited_by: input.invitedBy,
        ended_at: null,
        accepted_at: null,
      })
      .eq('id', existing.id)

    if (error) throw unprocessable(error.message)
    await notifyPartner(input.partnerBusinessId, input.businessId)
    return { partnershipId: existing.id as string, status: 'pending' }
  }

  const { data, error } = await admin
    .from('business_partnerships')
    .insert({
      business_id: input.businessId,
      partner_business_id: input.partnerBusinessId,
      status: 'pending',
      invited_by: input.invitedBy,
      allow_cross_earn: input.allowCrossEarn ?? false,
      allow_cross_redeem: input.allowCrossRedeem ?? false,
    })
    .select('id')
    .single()

  if (error) throw unprocessable(error.message)

  await notifyPartner(input.partnerBusinessId, input.businessId)
  return { partnershipId: data.id as string, status: 'pending' }
}

async function notifyPartner(partnerBusinessId: string, fromBusinessId: string): Promise<void> {
  const admin = getDb()
  // The *invited* business reads this, so it resolves in their language — not in
  // the language of whoever clicked "invite" in another dashboard.
  const [{ data }, t] = await Promise.all([
    admin.from('businesses').select('name').eq('id', fromBusinessId).maybeSingle(),
    translatorForBusiness(partnerBusinessId),
  ])

  await notify(partnerBusinessId, {
    type: 'partnership',
    title: t('notify.partnershipInviteTitle'),
    body: t('notify.partnershipInviteBody', {
      business: (data?.name as string) ?? t('notify.partnershipInviteFallback'),
    }),
    url: '/dashboard/network',
  })
}

/**
 * Responds to an invitation.
 *
 * Only the *invited* side may accept: without that check, the inviter could
 * accept their own invitation and unilaterally create a partnership.
 */
export async function respondToInvite(input: {
  businessId: string
  partnershipId: string
  accept: boolean
}): Promise<{ status: PartnershipStatus }> {
  const admin = getDb()

  const { data: partnership } = await admin
    .from('business_partnerships')
    .select('id, business_id, partner_business_id, status')
    .eq('id', input.partnershipId)
    .maybeSingle()

  if (!partnership) throw notFound('Partnership')
  if (partnership.partner_business_id !== input.businessId) {
    throw forbidden('Only the invited business can respond to this invitation')
  }
  if (partnership.status !== 'pending') {
    throw conflict(`This invitation is already ${partnership.status}`)
  }

  const status: PartnershipStatus = input.accept ? 'active' : 'declined'
  const { error } = await admin
    .from('business_partnerships')
    .update({
      status,
      accepted_at: input.accept ? new Date().toISOString() : null,
    })
    .eq('id', input.partnershipId)

  if (error) throw unprocessable(error.message)

  if (input.accept) {
    const inviterId = partnership.business_id as string
    const t = await translatorForBusiness(inviterId)
    await notify(inviterId, {
      type: 'partnership',
      severity: 'success',
      title: t('notify.partnershipAcceptedTitle'),
      body: t('notify.partnershipAcceptedBody'),
      url: '/dashboard/network',
    })
  }

  return { status }
}

/** Either side may end a partnership at any time, immediately. */
export async function endPartnership(
  businessId: string,
  partnershipId: string
): Promise<{ ended: boolean }> {
  const admin = getDb()

  const { data, error } = await admin
    .from('business_partnerships')
    .update({ status: 'ended', ended_at: new Date().toISOString() })
    .eq('id', partnershipId)
    .or(`business_id.eq.${businessId},partner_business_id.eq.${businessId}`)
    .select('id')
    .maybeSingle()

  if (error) throw unprocessable(error.message)
  if (!data) throw notFound('Partnership')

  // Their offers stop being claimable the moment the relationship ends.
  await admin
    .from('coalition_offers')
    .update({ is_active: false })
    .eq('partnership_id', partnershipId)

  return { ended: true }
}

export async function updatePartnershipPermissions(input: {
  businessId: string
  partnershipId: string
  allowCrossEarn?: boolean
  allowCrossRedeem?: boolean
  shareAudience?: boolean
}): Promise<void> {
  const admin = getDb()
  const patch: Record<string, unknown> = {}
  if (input.allowCrossEarn !== undefined) patch.allow_cross_earn = input.allowCrossEarn
  if (input.allowCrossRedeem !== undefined) patch.allow_cross_redeem = input.allowCrossRedeem
  if (input.shareAudience !== undefined) patch.share_audience = input.shareAudience
  if (Object.keys(patch).length === 0) return

  const { error } = await admin
    .from('business_partnerships')
    .update(patch)
    .eq('id', input.partnershipId)
    .or(`business_id.eq.${input.businessId},partner_business_id.eq.${input.businessId}`)

  if (error) throw unprocessable(error.message)
}

// -----------------------------------------------------------------------------
// Offers
// -----------------------------------------------------------------------------

export async function listOffers(
  businessId: string,
  options: { includeInactive?: boolean; fromPartners?: boolean } = {}
): Promise<CoalitionOffer[]> {
  const admin = getDb()

  let businessIds = [businessId]

  if (options.fromPartners) {
    const partners = await listPartners(businessId)
    businessIds = partners
      .filter((partner) => partner.status === 'active')
      .map((partner) => partner.partnerId)
    if (businessIds.length === 0) return []
  }

  let request = admin
    .from('coalition_offers')
    .select(
      'id, business_id, partnership_id, title, description, reward_id, image_url, terms, ' +
        'starts_at, ends_at, redemption_limit, per_customer_limit, redeemed_count, is_active, ' +
        'businesses(name)'
    )
    .in('business_id', businessIds)
    .order('created_at', { ascending: false })

  if (!options.includeInactive) request = request.eq('is_active', true)

  const { data, error } = await request
  if (error) throw unprocessable(error.message)

  return ((data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => {
    const owner = row.businesses as unknown as { name: string } | null
    return {
      id: row.id as string,
      businessId: row.business_id as string,
      businessName: owner?.name ?? null,
      partnershipId: (row.partnership_id as string) ?? null,
      title: row.title as string,
      description: (row.description as string) ?? null,
      rewardId: (row.reward_id as string) ?? null,
      imageUrl: (row.image_url as string) ?? null,
      terms: (row.terms as string) ?? null,
      startsAt: (row.starts_at as string) ?? null,
      endsAt: (row.ends_at as string) ?? null,
      redemptionLimit: row.redemption_limit === null ? null : num(row.redemption_limit),
      perCustomerLimit: num(row.per_customer_limit, 1) || 1,
      redeemedCount: num(row.redeemed_count),
      isActive: Boolean(row.is_active),
    }
  })
}

export async function upsertOffer(input: {
  businessId: string
  id?: string | null
  partnershipId?: string | null
  title: string
  description?: string | null
  rewardId?: string | null
  terms?: string | null
  startsAt?: string | null
  endsAt?: string | null
  redemptionLimit?: number | null
  perCustomerLimit?: number
  isActive?: boolean
}): Promise<{ id: string }> {
  const admin = getDb()

  // An offer attached to a partnership must belong to a live one, or it would
  // be claimable by members of a business we are no longer working with.
  if (input.partnershipId) {
    const { data } = await admin
      .from('business_partnerships')
      .select('id, status')
      .eq('id', input.partnershipId)
      .or(`business_id.eq.${input.businessId},partner_business_id.eq.${input.businessId}`)
      .maybeSingle()

    if (!data) throw notFound('Partnership')
    if (data.status !== 'active') throw unprocessable('That partnership is not active')
  }

  const row = {
    business_id: input.businessId,
    partnership_id: input.partnershipId ?? null,
    title: input.title,
    description: input.description ?? null,
    reward_id: input.rewardId ?? null,
    terms: input.terms ?? null,
    starts_at: input.startsAt ?? null,
    ends_at: input.endsAt ?? null,
    redemption_limit: input.redemptionLimit ?? null,
    per_customer_limit: input.perCustomerLimit ?? 1,
    is_active: input.isActive ?? true,
  }

  const query = input.id
    ? admin.from('coalition_offers').update(row).eq('id', input.id).eq('business_id', input.businessId)
    : admin.from('coalition_offers').insert(row)

  const { data, error } = await query.select('id').maybeSingle()
  if (error) throw unprocessable(error.message)
  if (!data) throw notFound('Offer')

  return { id: data.id as string }
}

export async function redeemOffer(input: {
  offerId: string
  customerId: string
  redeemingBusinessId: string
  idempotencyKey?: string | null
}): Promise<{ duplicate: boolean; redemptionId: string; title: string; rewardId: string | null }> {
  const admin = getDb()
  const { data, error } = await admin.rpc('passimo_redeem_coalition_offer', {
    p_offer_id: input.offerId,
    p_customer_id: input.customerId,
    p_redeeming_business_id: input.redeemingBusinessId,
    p_idempotency_key: input.idempotencyKey ?? null,
  })

  if (error) {
    switch (error.hint) {
      case 'offer_inactive':
      case 'offer_ended':
      case 'offer_not_started':
      case 'offer_exhausted':
        throw conflict(error.message)
      case 'already_claimed':
        throw conflict('This customer has already claimed that offer')
      default:
        if (error.code === 'P0002') throw notFound('Offer')
        throw unprocessable(error.message)
    }
  }

  const payload = data as {
    duplicate: boolean
    redemption_id: string
    title?: string
    reward_id?: string | null
  }

  return {
    duplicate: payload.duplicate,
    redemptionId: payload.redemption_id,
    title: payload.title ?? '',
    rewardId: payload.reward_id ?? null,
  }
}
