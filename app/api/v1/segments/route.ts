import { z } from 'zod'
import { defineRoute } from '@/lib/api/handler'
import { segmentSchema } from '@/lib/api/schemas'
import { getDb } from '@/lib/db'
import { conflict, unprocessable } from '@/lib/errors'
import { countSegment } from '@/lib/segments/resolve'
import { describeSegment, segmentDefinitionSchema } from '@/lib/segments/definition'

export const runtime = 'nodejs'

const listQuery = z.object({ businessId: z.string().uuid() })

export const GET = defineRoute(
  {
    name: 'segments.list',
    auth: 'required',
    query: listQuery,
    businessIdFrom: { source: 'query', key: 'businessId' },
    permissions: ['customers:read'],
    rateLimit: 'dashboard',
  },
  async ({ business }) => {
    const admin = getDb()
    const { data } = await admin
      .from('segments')
      .select('id, name, description, is_system, key, definition, cached_count, last_computed_at')
      .eq('business_id', business.businessId)
      .order('is_system', { ascending: false })
      .order('name')

    return {
      segments: (data ?? []).map((segment) => ({
        ...segment,
        summary: describeSegment(segment.definition as never),
      })),
    }
  }
)

export const POST = defineRoute(
  {
    name: 'segments.create',
    auth: 'required',
    body: segmentSchema,
    businessIdFrom: { source: 'body', key: 'businessId' },
    permissions: ['campaigns:write'],
    feature: 'segments',
    rateLimit: 'dashboard',
  },
  async ({ body, actor, business }) => {
    const admin = getDb()
    // Compute up front: a segment whose size the merchant cannot see is a
    // segment they will not trust enough to send to.
    const count = await countSegment(business.businessId, body.definition)

    const { data, error } = await admin
      .from('segments')
      .insert({
        business_id: business.businessId,
        name: body.name,
        description: body.description ?? null,
        definition: body.definition,
        cached_count: count,
        last_computed_at: new Date().toISOString(),
        created_by: actor.id,
      })
      .select('id')
      .single()

    if (error) {
      if (error.code === '23505') throw conflict('A segment with that name already exists')
      throw unprocessable(error.message)
    }

    return { segment_id: data.id, matching_customers: count }
  }
)

const previewSchema = z.object({
  businessId: z.string().uuid(),
  definition: segmentDefinitionSchema,
})

/** Live count while the merchant is building a filter. */
export const PUT = defineRoute(
  {
    name: 'segments.preview',
    auth: 'required',
    body: previewSchema,
    businessIdFrom: { source: 'body', key: 'businessId' },
    permissions: ['customers:read'],
    rateLimit: 'dashboard',
  },
  async ({ body, business }) => {
    const count = await countSegment(business.businessId, body.definition)
    return { matching_customers: count, summary: describeSegment(body.definition) }
  }
)
