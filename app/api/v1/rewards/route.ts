import { z } from 'zod'
import { defineRoute } from '@/lib/api/handler'
import { rewardSchema } from '@/lib/api/schemas'
import { getDb } from '@/lib/db'
import { notFound, unprocessable } from '@/lib/errors'
import { num } from '@/lib/domain/types'
import { recordAudit } from '@/lib/audit'

export const runtime = 'nodejs'

const listQuery = z.object({
  businessId: z.string().uuid(),
  includeInactive: z.enum(['true', 'false']).optional(),
})

export const GET = defineRoute(
  {
    name: 'rewards.list',
    auth: 'required',
    query: listQuery,
    businessIdFrom: { source: 'query', key: 'businessId' },
    permissions: ['programs:read'],
    rateLimit: 'dashboard',
  },
  async ({ query, business }) => {
    const admin = getDb()
    let request = admin
      .from('rewards')
      .select('*')
      .eq('business_id', business.businessId)
      .order('sort_order')
      .order('cost')

    if (query.includeInactive !== 'true') request = request.eq('is_active', true)

    const { data } = await request
    return {
      rewards: (data ?? []).map((reward) => ({
        ...reward,
        cost: num(reward.cost),
        value: reward.value === null ? null : num(reward.value),
        /* A reward nobody has ever claimed is a signal the merchant should act on. */
        never_redeemed: num(reward.redeemed_count) === 0,
      })),
    }
  }
)

export const POST = defineRoute(
  {
    name: 'rewards.create',
    auth: 'required',
    body: rewardSchema,
    businessIdFrom: { source: 'body', key: 'businessId' },
    permissions: ['programs:write'],
    rateLimit: 'dashboard',
  },
  async ({ body, actor, business, request }) => {
    const admin = getDb()

    let programId = body.programId ?? null
    if (!programId) {
      const { data: program } = await admin
        .from('loyalty_programs')
        .select('id')
        .eq('business_id', business.businessId)
        .eq('is_default', true)
        .maybeSingle()
      programId = (program?.id as string) ?? null
    }

    const { data, error } = await admin
      .from('rewards')
      .insert({
        business_id: business.businessId,
        program_id: programId,
        name: body.name,
        description: body.description ?? null,
        cost: body.cost,
        type: body.type,
        value: body.value ?? null,
        min_tier_level: body.minTierLevel ?? null,
        stock: body.stock ?? null,
        usage_limit_per_customer: body.usageLimitPerCustomer ?? null,
        valid_days: body.validDays,
        starts_at: body.startsAt ?? null,
        ends_at: body.endsAt ?? null,
        auto_grant_trigger: body.autoGrantTrigger ?? null,
        is_active: body.isActive,
        sort_order: body.sortOrder,
      })
      .select('id')
      .single()

    if (error) throw unprocessable(error.message)

    await recordAudit({
      businessId: business.businessId,
      actor,
      action: 'reward.created',
      resourceType: 'reward',
      resourceId: data.id,
      summary: `Created reward "${body.name}" at ${body.cost}`,
      request,
    })

    return { reward_id: data.id }
  }
)

const patchSchema = rewardSchema.partial().extend({
  businessId: z.string().uuid(),
  id: z.string().uuid(),
})

export const PATCH = defineRoute(
  {
    name: 'rewards.update',
    auth: 'required',
    body: patchSchema,
    businessIdFrom: { source: 'body', key: 'businessId' },
    permissions: ['programs:write'],
    rateLimit: 'dashboard',
  },
  async ({ body, business }) => {
    const admin = getDb()
    const map: Record<string, string> = {
      name: 'name',
      description: 'description',
      cost: 'cost',
      type: 'type',
      value: 'value',
      minTierLevel: 'min_tier_level',
      stock: 'stock',
      usageLimitPerCustomer: 'usage_limit_per_customer',
      validDays: 'valid_days',
      startsAt: 'starts_at',
      endsAt: 'ends_at',
      autoGrantTrigger: 'auto_grant_trigger',
      isActive: 'is_active',
      sortOrder: 'sort_order',
      programId: 'program_id',
    }

    const patch: Record<string, unknown> = {}
    for (const [key, column] of Object.entries(map)) {
      const value = (body as Record<string, unknown>)[key]
      if (value !== undefined) patch[column] = value
    }
    if (Object.keys(patch).length === 0) throw unprocessable('Nothing to update')

    const { error, count } = await admin
      .from('rewards')
      .update(patch, { count: 'exact' })
      .eq('id', body.id)
      .eq('business_id', business.businessId)

    if (error) throw unprocessable(error.message)
    if (!count) throw notFound('Reward')

    return { ok: true }
  }
)
