import { z } from 'zod'
import { defineRoute } from '@/lib/api/handler'
import { recordAudit } from '@/lib/audit'
import { cancelMembership, enrolMember } from '@/lib/commerce/memberships'

export const runtime = 'nodejs'

const enrolSchema = z.object({
  businessId: z.string().uuid(),
  customerId: z.string().uuid(),
  planId: z.string().uuid(),
  /** How the membership was sold: at the counter, online, or comped. */
  source: z.enum(['manual', 'pos', 'online', 'comp']).default('manual'),
})

/**
 * Signs a customer up to a membership.
 *
 * Payment is deliberately out of scope here: the overwhelmingly common case in
 * a café or salon is the owner taking cash or card at the counter and marking
 * the person as a member. Forcing a Stripe subscription on that flow would kill
 * adoption of the feature that drives the most retention.
 */
export const POST = defineRoute(
  {
    name: 'memberships.enrol',
    auth: 'required',
    body: enrolSchema,
    businessIdFrom: { source: 'body', key: 'businessId' },
    permissions: ['customers:write'],
    feature: 'memberships',
    rateLimit: 'dashboard',
  },
  async ({ body, actor, business, request }) => {
    const result = await enrolMember({
      businessId: business.businessId,
      customerId: body.customerId,
      planId: body.planId,
      source: body.source,
    })

    if (!result.alreadyMember) {
      await recordAudit({
        businessId: business.businessId,
        actor,
        action: 'membership.started',
        resourceType: 'customer',
        resourceId: body.customerId,
        summary: `Enrolled a customer on "${result.planName}"`,
        metadata: { plan_id: body.planId, reactivated: result.reactivated },
        request,
      })
    }

    return result
  }
)

const cancelSchema = z.object({
  businessId: z.string().uuid(),
  membershipId: z.string().uuid(),
  /** Default is end-of-period; immediate is for refunds and fraud. */
  immediately: z.boolean().default(false),
})

export const DELETE = defineRoute(
  {
    name: 'memberships.cancel',
    auth: 'required',
    body: cancelSchema,
    businessIdFrom: { source: 'body', key: 'businessId' },
    permissions: ['customers:write'],
    feature: 'memberships',
    rateLimit: 'dashboard',
  },
  async ({ body, actor, business, request }) => {
    const result = await cancelMembership({
      businessId: business.businessId,
      membershipId: body.membershipId,
      immediately: body.immediately,
    })

    await recordAudit({
      businessId: business.businessId,
      actor,
      action: 'membership.cancelled',
      resourceType: 'membership',
      resourceId: body.membershipId,
      summary: body.immediately
        ? 'Cancelled a membership immediately'
        : 'Membership set to end at the period end',
      request,
    })

    return result
  }
)
