import { z } from 'zod'
import { defineRoute } from '@/lib/api/handler'
import { getDb } from '@/lib/db'
import { unprocessable } from '@/lib/errors'
import { num } from '@/lib/domain/types'

export const runtime = 'nodejs'

const listQuery = z.object({
  businessId: z.string().uuid(),
  status: z.enum(['new', 'accepted', 'dismissed', 'expired']).default('new'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
})

export const GET = defineRoute(
  {
    name: 'insights.list',
    auth: 'required',
    query: listQuery,
    businessIdFrom: { source: 'query', key: 'businessId' },
    permissions: ['analytics:read'],
    rateLimit: 'dashboard',
  },
  async ({ query, business }) => {
    const admin = getDb()
    const { data } = await admin
      .from('ai_insights')
      .select('*')
      .eq('business_id', business.businessId)
      .eq('status', query.status)
      .order('severity', { ascending: false })
      .order('generated_at', { ascending: false })
      .limit(query.limit)

    return {
      insights: (data ?? []).map((insight) => ({
        ...insight,
        estimated_impact:
          insight.estimated_impact === null ? null : num(insight.estimated_impact),
        confidence: num(insight.confidence),
      })),
    }
  }
)

const patchSchema = z.object({
  businessId: z.string().uuid(),
  id: z.string().uuid(),
  status: z.enum(['accepted', 'dismissed']),
})

/** Dismissing is a signal, not just a UI action — it stops the same advice recurring. */
export const PATCH = defineRoute(
  {
    name: 'insights.update',
    auth: 'required',
    body: patchSchema,
    businessIdFrom: { source: 'body', key: 'businessId' },
    permissions: ['analytics:read'],
    rateLimit: 'dashboard',
  },
  async ({ body, actor, business }) => {
    const admin = getDb()
    const { error } = await admin
      .from('ai_insights')
      .update({ status: body.status, dismissed_by: actor.id })
      .eq('id', body.id)
      .eq('business_id', business.businessId)

    if (error) throw unprocessable(error.message)
    return { ok: true }
  }
)
