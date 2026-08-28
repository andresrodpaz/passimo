import { defineRoute } from '@/lib/api/handler'
import { earnSchema } from '@/lib/api/schemas'
import { badRequest, forbidden, notFound } from '@/lib/errors'
import { recordEarn } from '@/lib/loyalty/engine'
import { getDb } from '@/lib/db'
import { verifyToken } from '@/lib/crypto'
import { recordAudit } from '@/lib/audit'

export const runtime = 'nodejs'

/**
 * The single most-used endpoint in the product: a member is at the counter,
 * give them credit.
 *
 * Accepts whichever identifier the till has (id, scanned card token, email or
 * phone), is idempotent on a client-supplied key so a double tap or a flaky
 * connection cannot double-award, and returns everything the POS needs to show
 * the confirmation screen in one round trip.
 */
export const POST = defineRoute(
  {
    name: 'loyalty.earn',
    auth: 'required',
    body: earnSchema,
    businessIdFrom: { source: 'body', key: 'businessId' },
    permissions: ['loyalty:earn'],
    rateLimit: 'pos',
  },
  async ({ body, actor, business, request }) => {
    if (body.overrideAmount != null && !business.permissions.has('loyalty:adjust')) {
      throw forbidden('Your role cannot override the earned amount')
    }

    const customerId = await resolveCustomerId(business.businessId, body)

    const result = await recordEarn({
      businessId: business.businessId,
      customerId,
      trigger: body.trigger,
      amount: body.amount ?? null,
      quantity: body.quantity ?? null,
      locationId: body.locationId ?? null,
      staffUserId: actor.id,
      source: actor.kind === 'api_key' ? 'api' : 'pos',
      externalId: body.externalId ?? null,
      idempotencyKey: body.idempotencyKey ?? null,
      note: body.note ?? null,
      overrideAmount: body.overrideAmount ?? null,
      overrideProgramId: body.overrideProgramId ?? null,
    })

    // A referral only pays out once the referred friend actually transacts.
    if (!result.duplicate && (body.trigger === 'visit' || body.trigger === 'purchase')) {
      const admin = getDb()
      await admin.rpc('passimo_qualify_referrals', {
        p_business_id: business.businessId,
        p_customer_id: customerId,
      })
    }

    if (body.overrideAmount != null) {
      await recordAudit({
        businessId: business.businessId,
        actor,
        action: 'loyalty.manual_award',
        resourceType: 'customer',
        resourceId: customerId,
        summary: `Manually awarded ${body.overrideAmount}`,
        metadata: { note: body.note },
        request,
      })
    }

    const claimable = await claimableRewards(business.businessId, customerId)

    return {
      duplicate: result.duplicate,
      customer_id: customerId,
      total_awarded: result.totalAwarded,
      awards: result.awards,
      claimable_rewards: claimable,
      /* Included so a merchant can debug "why did that not give a bonus?". */
      skipped_rules: result.skipped,
    }
  }
)

async function resolveCustomerId(
  businessId: string,
  body: { customerId?: string; email?: string; phone?: string; cardToken?: string }
): Promise<string> {
  if (body.customerId) return body.customerId

  if (body.cardToken) {
    const payload = verifyToken<{ c: string }>('card', body.cardToken)
    if (!payload?.c) throw badRequest('Card token is invalid or has expired')
    return payload.c
  }

  const admin = getDb()
  const query = admin
    .from('customers')
    .select('id')
    .eq('business_id', businessId)
    .neq('status', 'anonymized')

  const { data } = body.email
    ? await query.eq('email', body.email).maybeSingle()
    : await query.eq('phone', body.phone!).maybeSingle()

  if (!data) throw notFound('Customer')
  return data.id as string
}

/** Rewards this customer can claim right now — shown on the POS success screen. */
async function claimableRewards(businessId: string, customerId: string) {
  const admin = getDb()
  const [granted, affordable] = await Promise.all([
    admin
      .from('reward_redemptions')
      .select('id, code, expires_at, rewards:reward_id (name)')
      .eq('business_id', businessId)
      .eq('customer_id', customerId)
      .eq('status', 'claimed')
      .limit(5),
    admin
      .from('loyalty_accounts')
      .select('balance, program_id')
      .eq('business_id', businessId)
      .eq('customer_id', customerId),
  ])

  const balances = new Map(
    (affordable.data ?? []).map((row) => [row.program_id as string, Number(row.balance)])
  )

  const { data: rewards } = await admin
    .from('rewards')
    .select('id, name, cost, program_id')
    .eq('business_id', businessId)
    .eq('is_active', true)
    .is('auto_grant_trigger', null)
    .order('cost')

  return {
    granted: (granted.data ?? []).map((row) => ({
      redemption_id: row.id,
      code: row.code,
      name: (row.rewards as unknown as { name: string } | null)?.name ?? 'Reward',
      expires_at: row.expires_at,
    })),
    affordable: (rewards ?? [])
      .filter((reward) => Number(reward.cost) <= (balances.get(reward.program_id as string) ?? 0))
      .map((reward) => ({ id: reward.id, name: reward.name, cost: Number(reward.cost) })),
  }
}
