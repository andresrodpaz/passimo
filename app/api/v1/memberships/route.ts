import { z } from 'zod'
import { defineRoute } from '@/lib/api/handler'
import { recordAudit } from '@/lib/audit'
import {
  archiveMembershipPlan,
  getMembershipStats,
  listMembershipPlans,
  listMembers,
  upsertMembershipPlan,
} from '@/lib/commerce/memberships'

export const runtime = 'nodejs'

const listQuery = z.object({
  businessId: z.string().uuid(),
  includeInactive: z.enum(['true', 'false']).optional(),
  /** Also return the member roster, for the members tab. */
  withMembers: z.enum(['true', 'false']).optional(),
  planId: z.string().uuid().optional(),
  status: z.enum(['active', 'past_due', 'cancelled', 'expired', 'all']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

export const GET = defineRoute(
  {
    name: 'memberships.list',
    auth: 'required',
    query: listQuery,
    businessIdFrom: { source: 'query', key: 'businessId' },
    permissions: ['programs:read'],
    feature: 'memberships',
    rateLimit: 'dashboard',
  },
  async ({ query, business }) => {
    const [plans, stats, roster] = await Promise.all([
      listMembershipPlans(business.businessId, {
        includeInactive: query.includeInactive === 'true',
      }),
      getMembershipStats(business.businessId),
      query.withMembers === 'true'
        ? listMembers(business.businessId, {
            planId: query.planId,
            status: query.status,
            limit: query.limit,
            offset: query.offset,
          })
        : Promise.resolve(null),
    ])

    return {
      plans,
      stats,
      ...(roster ? { members: roster.members, member_total: roster.total } : {}),
    }
  }
)

const planSchema = z.object({
  businessId: z.string().uuid(),
  id: z.string().uuid().optional().nullable(),
  programId: z.string().uuid().optional().nullable(),
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional().nullable(),
  price: z.number().min(0).max(100_000),
  interval: z.enum(['month', 'year']).default('month'),
  includedBalance: z.number().min(0).max(100_000).default(0),
  earnMultiplier: z.number().min(1).max(10).default(1),
  perks: z.array(z.string().max(120)).max(10).default([]),
  trialDays: z.number().int().min(0).max(90).default(0),
  maxMembers: z.number().int().min(1).max(1_000_000).optional().nullable(),
  isActive: z.boolean().default(true),
  isPublic: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(1000).default(0),
  stripePriceId: z.string().max(120).optional().nullable(),
})

/** Create or update a membership plan. Upsert because the form is the same either way. */
export const POST = defineRoute(
  {
    name: 'memberships.upsert_plan',
    auth: 'required',
    body: planSchema,
    businessIdFrom: { source: 'body', key: 'businessId' },
    permissions: ['programs:write'],
    feature: 'memberships',
    rateLimit: 'dashboard',
  },
  async ({ body, actor, business, request }) => {
    const plan = await upsertMembershipPlan({ ...body, businessId: business.businessId })

    await recordAudit({
      businessId: business.businessId,
      actor,
      action: body.id ? 'membership_plan.updated' : 'membership_plan.created',
      resourceType: 'membership_plan',
      resourceId: plan.id,
      summary: `${body.id ? 'Updated' : 'Created'} membership "${plan.name}" at ${plan.price}/${plan.interval}`,
      request,
    })

    return { plan }
  }
)

const archiveSchema = z.object({
  businessId: z.string().uuid(),
  planId: z.string().uuid(),
})

/**
 * Retires a plan. Existing members keep their benefits until they cancel —
 * deleting would take away something they have already paid for.
 */
export const DELETE = defineRoute(
  {
    name: 'memberships.archive_plan',
    auth: 'required',
    body: archiveSchema,
    businessIdFrom: { source: 'body', key: 'businessId' },
    permissions: ['programs:write'],
    feature: 'memberships',
    rateLimit: 'dashboard',
  },
  async ({ body, actor, business, request }) => {
    const result = await archiveMembershipPlan(business.businessId, body.planId)

    await recordAudit({
      businessId: business.businessId,
      actor,
      action: 'membership_plan.archived',
      resourceType: 'membership_plan',
      resourceId: body.planId,
      summary: `Archived a membership plan with ${result.activeMembers} active members`,
      request,
    })

    return result
  }
)
