import 'server-only'
import { getDb } from '@/lib/db'
import { compileSegment } from '@/lib/segments/compile'
import { EMPTY_SEGMENT, type SegmentDefinition } from '@/lib/segments/definition'
import { notFound } from '@/lib/errors'
import { logger } from '@/lib/logger'

/** Runs saved or ad-hoc segments against the database. */

export async function resolveSegmentDefinition(
  businessId: string,
  segmentId: string | null | undefined,
  inlineDefinition?: SegmentDefinition | null
): Promise<SegmentDefinition> {
  if (inlineDefinition) return inlineDefinition
  if (!segmentId) return EMPTY_SEGMENT

  const admin = getDb()
  const { data } = await admin
    .from('segments')
    .select('definition')
    .eq('id', segmentId)
    .eq('business_id', businessId)
    .maybeSingle()

  if (!data) throw notFound('Segment')
  return (data.definition as SegmentDefinition) ?? EMPTY_SEGMENT
}

export async function countSegment(
  businessId: string,
  definition: SegmentDefinition
): Promise<number> {
  const { sql, params } = compileSegment(definition)
  const admin = getDb()
  const { data, error } = await admin.rpc('passimo_segment_count', {
    p_business_id: businessId,
    p_predicate: sql,
    p_params: params,
  })
  if (error) {
    logger.error('segments.count_failed', { businessId, error })
    return 0
  }
  return Number(data ?? 0)
}

export async function listSegmentCustomerIds(
  businessId: string,
  definition: SegmentDefinition,
  options: { limit?: number; offset?: number } = {}
): Promise<string[]> {
  const { sql, params } = compileSegment(definition)
  const admin = getDb()
  const { data, error } = await admin.rpc('passimo_segment_customer_ids', {
    p_business_id: businessId,
    p_predicate: sql,
    p_params: params,
    p_limit: options.limit ?? 5000,
    p_offset: options.offset ?? 0,
  })
  if (error) {
    logger.error('segments.list_ids_failed', { businessId, error })
    return []
  }
  return (data ?? []).map((row: { id: string }) => row.id)
}

export async function listSegmentCustomers(
  businessId: string,
  definition: SegmentDefinition,
  options: { limit?: number; offset?: number } = {}
): Promise<Record<string, unknown>[]> {
  const { sql, params } = compileSegment(definition)
  const admin = getDb()
  const { data, error } = await admin.rpc('passimo_segment_customers', {
    p_business_id: businessId,
    p_predicate: sql,
    p_params: params,
    p_limit: options.limit ?? 200,
    p_offset: options.offset ?? 0,
  })
  if (error) {
    logger.error('segments.list_failed', { businessId, error })
    return []
  }
  return (data ?? []) as Record<string, unknown>[]
}

/** Refreshes the cached count shown on segment cards. */
export async function refreshSegmentCount(businessId: string, segmentId: string): Promise<number> {
  const definition = await resolveSegmentDefinition(businessId, segmentId)
  const count = await countSegment(businessId, definition)
  const admin = getDb()
  await admin
    .from('segments')
    .update({ cached_count: count, last_computed_at: new Date().toISOString() })
    .eq('id', segmentId)
    .eq('business_id', businessId)
  return count
}

/** True when a customer currently satisfies a definition — used by automations. */
export async function customerMatchesSegment(
  businessId: string,
  customerId: string,
  definition: SegmentDefinition
): Promise<boolean> {
  if (!definition.conditions?.length) return true
  const { sql, params } = compileSegment(definition)
  const admin = getDb()
  const { data, error } = await admin.rpc('passimo_segment_matches', {
    p_business_id: businessId,
    p_customer_id: customerId,
    p_predicate: sql,
    p_params: params,
  })
  if (error) {
    logger.error('segments.match_failed', { businessId, customerId, error })
    return false
  }
  return Boolean(data)
}
