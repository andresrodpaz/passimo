import { z } from 'zod'
import { requirePlatformAdmin } from '@/lib/auth/platform-admin'
import { getBusinessDetail, listBusinesses } from '@/lib/admin/platform'
import { errorResponse, json } from '@/lib/http'
import { badRequest, notFound, toAppError } from '@/lib/errors'
import { applyPlan, invalidateEntitlements } from '@/lib/billing/entitlements'
import { PLAN_IDS, isPlanId } from '@/lib/billing/plans'
import { recordAudit } from '@/lib/audit'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Business administration.
 *
 * Two operations, both of which a support team genuinely needs and neither of
 * which should exist without a trail:
 *
 *   * **Read** — the list with the counts an operator triages on, or one business
 *     in full.
 *   * **Change plan** — extend a trial, move someone to the tier they actually
 *     paid for after a failed webhook, or restore a lapsed account.
 *
 * The plan change writes to the merchant's own audit log, not only to ours. The
 * merchant is entitled to see that their plan was changed by platform support and
 * why — an operator action invisible to the customer it affects is how trust in a
 * platform is lost.
 */

const listQuery = z.object({
  q: z.string().trim().max(120).optional(),
  plan: z.enum(PLAN_IDS).optional(),
  status: z.enum(['active', 'trialing', 'lapsed']).optional(),
  id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

export async function GET(request: Request) {
  try {
    await requirePlatformAdmin()

    const parsed = listQuery.safeParse(
      Object.fromEntries(new URL(request.url).searchParams)
    )
    if (!parsed.success) throw badRequest('Invalid query')

    if (parsed.data.id) {
      const detail = await getBusinessDetail(parsed.data.id)
      if (!detail) throw notFound('Business')
      return json(detail)
    }

    return json(await listBusinesses(parsed.data))
  } catch (caught) {
    return errorResponse(toAppError(caught))
  }
}

const patchSchema = z.object({
  businessId: z.string().uuid(),
  plan: z.enum(PLAN_IDS).optional(),
  interval: z.enum(['month', 'year']).optional(),
  /** Extends or clears a trial. ISO timestamp, or null to remove it. */
  trialEndsAt: z.string().datetime().nullable().optional(),
  subscriptionStatus: z.string().max(40).nullable().optional(),
  /** Mandatory. An unexplained plan change is indistinguishable from a mistake. */
  reason: z.string().trim().min(4).max(300),
})

export async function PATCH(request: Request) {
  try {
    const admin = await requirePlatformAdmin()

    const body = patchSchema.safeParse(await request.json().catch(() => ({})))
    if (!body.success) {
      throw badRequest(
        body.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')
      )
    }

    const { businessId, reason, ...patch } = body.data
    if (patch.plan !== undefined && !isPlanId(patch.plan)) throw badRequest('Unknown plan')

    await applyPlan(businessId, patch)
    invalidateEntitlements(businessId)

    logger.warn('admin.plan_changed', {
      admin: admin.email,
      business_id: businessId,
      patch,
      reason,
    })

    // Written to the *merchant's* audit log on purpose: they are entitled to see
    // that support changed their plan, and why.
    await recordAudit({
      businessId,
      actor: { kind: 'user', id: admin.userId, email: admin.email, scopedBusinessId: null, apiKeyId: null },
      action: 'billing.plan_changed_by_support',
      resourceType: 'business',
      resourceId: businessId,
      summary: `Platform support changed the plan (${Object.keys(patch).join(', ')}): ${reason}`,
      request,
    })

    return json({ ok: true })
  } catch (caught) {
    return errorResponse(toAppError(caught))
  }
}
