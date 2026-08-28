import { defineRoute } from '@/lib/api/handler'
import { adjustSchema } from '@/lib/api/schemas'
import { adjustBalance } from '@/lib/loyalty/engine'
import { recordAudit } from '@/lib/audit'

export const runtime = 'nodejs'

/**
 * Manual correction: a goodwill gesture, or fixing a mis-scan.
 *
 * Restricted to `loyalty:adjust` and always audited, because this is the one
 * endpoint that can mint value without a customer having done anything.
 */
export const POST = defineRoute(
  {
    name: 'loyalty.adjust',
    auth: 'required',
    body: adjustSchema,
    businessIdFrom: { source: 'body', key: 'businessId' },
    permissions: ['loyalty:adjust'],
    rateLimit: 'pos',
  },
  async ({ body, actor, business, request }) => {
    const result = await adjustBalance({
      businessId: business.businessId,
      customerId: body.customerId,
      programId: body.programId,
      amount: body.amount,
      reason: body.reason,
      staffUserId: actor.id,
      idempotencyKey: body.idempotencyKey ?? null,
    })

    await recordAudit({
      businessId: business.businessId,
      actor,
      action: 'loyalty.adjusted',
      resourceType: 'customer',
      resourceId: body.customerId,
      summary: `${body.amount > 0 ? 'Added' : 'Removed'} ${Math.abs(body.amount)} — ${body.reason}`,
      metadata: { amount: body.amount, program_id: body.programId },
      request,
    })

    return { balance: result.balance, entry_id: result.entryId }
  }
)
