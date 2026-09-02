import { z } from 'zod'
import { defineRoute } from '@/lib/api/handler'
import { redeemSchema } from '@/lib/api/schemas'
import { redeemReward } from '@/lib/loyalty/engine'
import { fulfillGrantedReward } from '@/lib/loyalty/grants'
import { recordAudit } from '@/lib/audit'
import { unprocessableBecause } from '@/lib/errors'

export const runtime = 'nodejs'

/** Spend balance on a catalogue reward. */
export const POST = defineRoute(
  {
    name: 'loyalty.redeem',
    auth: 'required',
    body: redeemSchema,
    businessIdFrom: { source: 'body', key: 'businessId' },
    permissions: ['loyalty:redeem'],
    rateLimit: 'pos',
  },
  async ({ body, actor, business, request }) => {
    const result = await redeemReward({
      businessId: business.businessId,
      customerId: body.customerId,
      rewardId: body.rewardId,
      locationId: body.locationId ?? null,
      staffUserId: actor.id,
      idempotencyKey: body.idempotencyKey ?? null,
    })

    if (!result.duplicate) {
      await recordAudit({
        businessId: business.businessId,
        actor,
        action: 'loyalty.reward_redeemed',
        resourceType: 'customer',
        resourceId: body.customerId,
        summary: `Redeemed ${result.rewardName} for ${result.cost}`,
        request,
      })
    }

    return {
      duplicate: result.duplicate,
      redemption_id: result.redemptionId,
      code: result.code,
      reward_name: result.rewardName,
      cost: result.cost,
      balance: result.balance,
      expires_at: result.expiresAt,
    }
  }
)

const fulfillSchema = z.object({
  businessId: z.string().uuid(),
  code: z.string().min(4).max(32),
  locationId: z.string().uuid().nullable().optional(),
})

/**
 * Hands over a reward that was *granted* (birthday gift, win-back offer) rather
 * than bought with balance. Staff scan or type the code printed in the message.
 */
export const PUT = defineRoute(
  {
    name: 'loyalty.fulfill_grant',
    auth: 'required',
    body: fulfillSchema,
    businessIdFrom: { source: 'body', key: 'businessId' },
    permissions: ['loyalty:redeem'],
    rateLimit: 'pos',
  },
  async ({ body, actor, business, request }) => {
    const result = await fulfillGrantedReward({
      businessId: business.businessId,
      code: body.code,
      staffUserId: actor.id,
      locationId: body.locationId ?? null,
    })

    if (!result.ok) {
      const messages: Record<string, string> = {
        not_found: 'That code does not exist',
        already_used: 'That reward has already been used',
        expired: 'That reward has expired',
        cancelled: 'That reward was cancelled',
      }
      /*
       * The reason travels with the refusal, prefixed so it cannot collide with
       * the balance-side reasons from `translatePostgresError`: "expired" means
       * different things for a granted code and for a reward window, and the
       * client renders a different sentence for each.
       */
      const reason = result.reason ?? 'unknown'
      throw unprocessableBecause(
        `grant_${reason}`,
        messages[reason] ?? 'Could not redeem that code'
      )
    }

    await recordAudit({
      businessId: business.businessId,
      actor,
      action: 'loyalty.grant_fulfilled',
      resourceType: 'customer',
      resourceId: result.customerId ?? null,
      summary: `Fulfilled granted reward ${result.rewardName}`,
      request,
    })

    return { ok: true, customer_id: result.customerId, reward_name: result.rewardName }
  }
)
