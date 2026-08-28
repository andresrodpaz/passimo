import { z } from 'zod'
import { defineRoute } from '@/lib/api/handler'
import { automationSchema } from '@/lib/api/schemas'
import { getDb } from '@/lib/db'
import { notFound, unprocessable } from '@/lib/errors'
import { recordAudit } from '@/lib/audit'
import { num } from '@/lib/domain/types'

export const runtime = 'nodejs'

const listQuery = z.object({ businessId: z.string().uuid() })

export const GET = defineRoute(
  {
    name: 'automations.list',
    auth: 'required',
    query: listQuery,
    businessIdFrom: { source: 'query', key: 'businessId' },
    permissions: ['campaigns:read'],
    rateLimit: 'dashboard',
  },
  async ({ business }) => {
    const admin = getDb()
    const [automations, recentRuns] = await Promise.all([
      admin
        .from('automations')
        .select('*')
        .eq('business_id', business.businessId)
        .order('is_active', { ascending: false })
        .order('name'),
      admin
        .from('automation_runs')
        .select('automation_id, status')
        .eq('business_id', business.businessId)
        .gte('created_at', new Date(Date.now() - 30 * 86_400_000).toISOString())
        .limit(20000),
    ])

    const last30 = new Map<string, { completed: number; skipped: number }>()
    for (const run of recentRuns.data ?? []) {
      const key = run.automation_id as string
      const current = last30.get(key) ?? { completed: 0, skipped: 0 }
      if (run.status === 'completed') current.completed += 1
      if (run.status === 'skipped') current.skipped += 1
      last30.set(key, current)
    }

    return {
      automations: (automations.data ?? []).map((automation) => ({
        ...automation,
        attributed_revenue: num(automation.attributed_revenue),
        last_30_days: last30.get(automation.id as string) ?? { completed: 0, skipped: 0 },
      })),
    }
  }
)

export const POST = defineRoute(
  {
    name: 'automations.create',
    auth: 'required',
    body: automationSchema,
    businessIdFrom: { source: 'body', key: 'businessId' },
    permissions: ['automations:write'],
    feature: 'automations',
    rateLimit: 'dashboard',
  },
  async ({ body, actor, business, request }) => {
    const admin = getDb()
    const { data, error } = await admin
      .from('automations')
      .insert({
        business_id: business.businessId,
        name: body.name,
        description: body.description ?? null,
        trigger: body.trigger,
        trigger_config: body.triggerConfig,
        delay_minutes: body.delayMinutes,
        segment_id: body.segmentId ?? null,
        actions: body.actions,
        cooldown_days: body.cooldownDays,
        is_active: body.isActive,
        created_by: actor.id,
      })
      .select('id')
      .single()

    if (error) throw unprocessable(error.message)

    await recordAudit({
      businessId: business.businessId,
      actor,
      action: 'automation.created',
      resourceType: 'automation',
      resourceId: data.id,
      summary: `Created automation "${body.name}"`,
      request,
    })

    return { automation_id: data.id }
  }
)

const patchSchema = automationSchema.partial().extend({
  businessId: z.string().uuid(),
  id: z.string().uuid(),
})

export const PATCH = defineRoute(
  {
    name: 'automations.update',
    auth: 'required',
    body: patchSchema,
    businessIdFrom: { source: 'body', key: 'businessId' },
    permissions: ['automations:write'],
    rateLimit: 'dashboard',
  },
  async ({ body, actor, business, request }) => {
    const admin = getDb()
    const map: Record<string, string> = {
      name: 'name',
      description: 'description',
      trigger: 'trigger',
      triggerConfig: 'trigger_config',
      delayMinutes: 'delay_minutes',
      segmentId: 'segment_id',
      actions: 'actions',
      cooldownDays: 'cooldown_days',
      isActive: 'is_active',
    }
    const patch: Record<string, unknown> = {}
    for (const [key, column] of Object.entries(map)) {
      const value = (body as Record<string, unknown>)[key]
      if (value !== undefined) patch[column] = value
    }
    if (Object.keys(patch).length === 0) throw unprocessable('Nothing to update')

    const { error, count } = await admin
      .from('automations')
      .update(patch, { count: 'exact' })
      .eq('id', body.id)
      .eq('business_id', business.businessId)

    if (error) throw unprocessable(error.message)
    if (!count) throw notFound('Automation')

    if (body.isActive !== undefined) {
      await recordAudit({
        businessId: business.businessId,
        actor,
        action: body.isActive ? 'automation.enabled' : 'automation.disabled',
        resourceType: 'automation',
        resourceId: body.id,
        request,
      })
    }

    return { ok: true }
  }
)
