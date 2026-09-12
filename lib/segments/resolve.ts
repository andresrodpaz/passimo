import 'server-only'
import { getDb, idsFrom } from '@/lib/db'
import { compileSegment } from '@/lib/segments/compile'
import { EMPTY_SEGMENT, type SegmentDefinition } from '@/lib/segments/definition'
import { notFound, upstreamFailed } from '@/lib/errors'
import { logger } from '@/lib/logger'

/**
 * Runs saved or ad-hoc segments against the database.
 *
 * **A failed query is not an audience of zero.** Every function here used to log
 * the error and return `0` / `[]`, which is the single most expensive shape a
 * bug can take in this product: zero is a *legitimate* answer, so a broken
 * predicate reported "no matching customers" and nothing anywhere said
 * otherwise.
 *
 * That is how a real defect survived. The compiler emitted
 * `= any((select array_agg(…)))` for every "is one of" condition — the subquery
 * form of `ANY`, which type-checks as `text = text[]` and fails — so the
 * built-in VIP segment read 0 against a workspace holding 50 VIPs, a merchant
 * filtering by language saw an empty table, and a campaign aimed at any of them
 * would have reported a reach of nobody. The predicate is fixed in
 * `compile.ts`; these throw now so the *next* one cannot hide the same way.
 *
 * Throwing is right for every caller: a merchant gets an error state with a
 * retry instead of a confident wrong number, and the job runner retries and
 * logs instead of caching a zero onto the segment card forever.
 */

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
    throw upstreamFailed('Segment count', error)
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
    throw upstreamFailed('Segment audience', error)
  }
  // `idsFrom`, not `.map((row) => row.id)`: a single-column `returns table` is
  // a `setof uuid` in the catalogue, so this arrives as bare strings. Reading
  // `.id` off them produced an array of `undefined`, which is how campaign
  // fan-out came to send to nobody while reporting a reach of 468.
  return idsFrom(data)
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
    throw upstreamFailed('Segment audience', error)
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
    /*
     * The one place that stays non-throwing, and deliberately: this answers
     * "does this person still match?" for an automation about to act on one
     * customer. Refusing to act on a failed check is the safe direction — the
     * alternative is granting a reward or sending a message on the strength of
     * a query that did not run. It logs, so the failure is still visible.
     */
    logger.error('segments.match_failed', { businessId, customerId, error })
    return false
  }
  return Boolean(data)
}
