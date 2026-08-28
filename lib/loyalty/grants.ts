import 'server-only'
import { getDb } from '@/lib/db'
import { logger } from '@/lib/logger'
import { num } from '@/lib/domain/types'

/**
 * Granted rewards.
 *
 * Distinct from a *redeemed* reward: nothing is deducted from a balance, the
 * business is giving something away (welcome gift, birthday treat, win-back
 * offer). The customer receives a claim code that staff scan at the counter,
 * which is what turns a marketing message into a measurable visit.
 */

export type GrantedReward = {
  redemptionId: string
  rewardId: string
  name: string
  code: string
  expiresAt: string | null
}

export async function createAdminGrantReward(input: {
  businessId: string
  customerId: string
  /** Pick the reward configured for this automation trigger. */
  autoGrantTrigger?: string | null
  /** Or grant a specific reward. */
  rewardId?: string | null
  source?: string
}): Promise<GrantedReward | null> {
  const admin = getDb()

  const query = admin
    .from('rewards')
    .select('id, name, valid_days, stock, program_id')
    .eq('business_id', input.businessId)
    .eq('is_active', true)
    .limit(1)

  if (input.rewardId) query.eq('id', input.rewardId)
  else if (input.autoGrantTrigger) query.eq('auto_grant_trigger', input.autoGrantTrigger)
  else return null

  const { data: reward } = await query.maybeSingle()
  if (!reward) return null
  if (reward.stock !== null && num(reward.stock) <= 0) {
    logger.warn('loyalty.grant_out_of_stock', { rewardId: reward.id })
    return null
  }

  const expiresAt = new Date(Date.now() + num(reward.valid_days, 30) * 86_400_000).toISOString()

  const { data: redemption, error } = await admin
    .from('reward_redemptions')
    .insert({
      business_id: input.businessId,
      customer_id: input.customerId,
      program_id: reward.program_id,
      reward_id: reward.id,
      cost: 0,
      // "claimed" means issued but not yet handed over at the counter.
      status: 'claimed',
      expires_at: expiresAt,
      metadata: { granted: true, source: input.source ?? 'system' },
    })
    .select('id, code')
    .maybeSingle()

  if (error || !redemption) {
    logger.error('loyalty.grant_failed', { rewardId: reward.id, error })
    return null
  }

  if (reward.stock !== null) {
    await admin
      .from('rewards')
      .update({ stock: Math.max(0, num(reward.stock) - 1) })
      .eq('id', reward.id)
  }

  return {
    redemptionId: redemption.id as string,
    rewardId: reward.id as string,
    name: reward.name as string,
    code: redemption.code as string,
    expiresAt,
  }
}

/** Marks a granted reward as handed over — the POS "scan the code" action. */
export async function fulfillGrantedReward(input: {
  businessId: string
  code: string
  staffUserId?: string | null
  locationId?: string | null
}): Promise<{ ok: boolean; reason?: string; customerId?: string; rewardName?: string }> {
  const admin = getDb()
  const { data: redemption } = await admin
    .from('reward_redemptions')
    .select('id, customer_id, status, expires_at, rewards:reward_id (name)')
    .eq('business_id', input.businessId)
    .eq('code', input.code.trim().toUpperCase())
    .maybeSingle()

  if (!redemption) return { ok: false, reason: 'not_found' }
  if (redemption.status === 'fulfilled') return { ok: false, reason: 'already_used' }
  if (redemption.status === 'cancelled') return { ok: false, reason: 'cancelled' }
  if (redemption.expires_at && new Date(redemption.expires_at as string) < new Date()) {
    await admin.from('reward_redemptions').update({ status: 'expired' }).eq('id', redemption.id)
    return { ok: false, reason: 'expired' }
  }

  await admin
    .from('reward_redemptions')
    .update({
      status: 'fulfilled',
      fulfilled_at: new Date().toISOString(),
      redeemed_by: input.staffUserId ?? null,
      location_id: input.locationId ?? null,
    })
    .eq('id', redemption.id)

  const reward = redemption.rewards as unknown as { name: string } | null

  await admin.from('activity_events').insert({
    business_id: input.businessId,
    customer_id: redemption.customer_id,
    location_id: input.locationId ?? null,
    type: 'redeem',
    source: 'pos',
    staff_user_id: input.staffUserId ?? null,
    metadata: { granted_reward: true, redemption_id: redemption.id },
  })

  return {
    ok: true,
    customerId: redemption.customer_id as string,
    rewardName: reward?.name ?? 'Reward',
  }
}
