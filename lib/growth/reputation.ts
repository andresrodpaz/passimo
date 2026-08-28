import 'server-only'
import { getDb } from '@/lib/db'
import { logger } from '@/lib/logger'
import { notFound, unprocessable } from '@/lib/errors'
import { num } from '@/lib/domain/types'
import { translatorForBusiness } from '@/lib/i18n/business'

/**
 * Reputation: the loop from "how did we do?" to a public review or a private fix.
 *
 * The gate is the whole point. Asking every customer for a Google review is how
 * a business collects one-star reviews from people it could have quietly made
 * happy. So promoters (9–10) are pointed at the public review link, and
 * detractors (0–6) are routed to the owner *privately*, before they write
 * anything anywhere.
 *
 * That is not review gating in the prohibited sense — nobody is prevented from
 * leaving a review, and no review is filtered. We simply do not *solicit* one
 * from someone who has just told us they are unhappy; we solve their problem
 * first. Google's policy prohibits selectively soliciting only positive reviews
 * from customers *and* discouraging negative ones. We do neither: the detractor
 * path is a real apology with a real fix, not a dead end.
 */

export type ReputationSummary = {
  nps: number | null
  responses: number
  promoters: number
  passives: number
  detractors: number
  average: number | null
  /** Detractors nobody has dealt with yet. The most urgent list in the product. */
  unresolved: number
  /** Promoters who were shown the review link. */
  review_prompted: number
  review_clicked: number
  review_click_rate: number
  trend: Array<{ month: string; nps: number | null; responses: number }>
}

export type FeedbackEntry = {
  id: string
  customerId: string | null
  customerName: string | null
  customerEmail: string | null
  score: number
  scaleMax: number
  comment: string | null
  sentiment: string | null
  themes: string[]
  category: 'promoter' | 'passive' | 'detractor'
  respondedAt: string
  resolvedAt: string | null
  resolutionNote: string | null
  reviewClickedAt: string | null
}

function categorise(score: number, scaleMax: number): FeedbackEntry['category'] {
  const promoterFloor = scaleMax === 5 ? 5 : 9
  const detractorCeiling = scaleMax === 5 ? 3 : 6
  if (score >= promoterFloor) return 'promoter'
  if (score <= detractorCeiling) return 'detractor'
  return 'passive'
}

export async function getReputationSummary(
  businessId: string,
  days = 180
): Promise<ReputationSummary> {
  const admin = getDb()
  const since = new Date(Date.now() - days * 86_400_000).toISOString()

  const { data, error } = await admin
    .from('survey_responses')
    .select('score, scale_max, responded_at, resolved_at, review_prompted_at, review_clicked_at')
    .eq('business_id', businessId)
    .gte('responded_at', since)
    .order('responded_at', { ascending: false })
    .limit(5000)

  if (error) {
    logger.warn('reputation.summary_failed', { business_id: businessId, error })
  }

  const rows = data ?? []
  let promoters = 0
  let passives = 0
  let detractors = 0
  let unresolved = 0
  let prompted = 0
  let clicked = 0
  let scoreSum = 0

  // Normalised to 0–10 so a business that switched from a 5-point to a 10-point
  // scale does not get a nonsense average across the boundary.
  const buckets = new Map<string, { promoters: number; detractors: number; total: number }>()

  for (const row of rows) {
    const scaleMax = num(row.scale_max, 10) || 10
    const score = num(row.score)
    const category = categorise(score, scaleMax)
    scoreSum += scaleMax === 10 ? score : (score / scaleMax) * 10

    if (category === 'promoter') promoters += 1
    else if (category === 'detractor') detractors += 1
    else passives += 1

    if (category === 'detractor' && !row.resolved_at) unresolved += 1
    if (row.review_prompted_at) prompted += 1
    if (row.review_clicked_at) clicked += 1

    const month = String(row.responded_at).slice(0, 7)
    const bucket = buckets.get(month) ?? { promoters: 0, detractors: 0, total: 0 }
    bucket.total += 1
    if (category === 'promoter') bucket.promoters += 1
    if (category === 'detractor') bucket.detractors += 1
    buckets.set(month, bucket)
  }

  const responses = rows.length

  return {
    nps: responses > 0 ? Math.round(((promoters - detractors) / responses) * 100) : null,
    responses,
    promoters,
    passives,
    detractors,
    average: responses > 0 ? Math.round((scoreSum / responses) * 10) / 10 : null,
    unresolved,
    review_prompted: prompted,
    review_clicked: clicked,
    review_click_rate: prompted > 0 ? Math.round((clicked / prompted) * 1000) / 10 : 0,
    trend: [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-12)
      .map(([month, bucket]) => ({
        month,
        nps:
          bucket.total > 0
            ? Math.round(((bucket.promoters - bucket.detractors) / bucket.total) * 100)
            : null,
        responses: bucket.total,
      })),
  }
}

export type ListFeedbackOptions = {
  category?: FeedbackEntry['category'] | 'all'
  /** Only detractors nobody has dealt with. The default view for a busy owner. */
  unresolvedOnly?: boolean
  withCommentOnly?: boolean
  limit?: number
  offset?: number
}

export async function listFeedback(
  businessId: string,
  options: ListFeedbackOptions = {}
): Promise<{ feedback: FeedbackEntry[]; total: number }> {
  const admin = getDb()
  const limit = Math.min(options.limit ?? 50, 200)
  const offset = options.offset ?? 0

  let request = admin
    .from('survey_responses')
    .select(
      'id, customer_id, score, scale_max, comment, sentiment, themes, responded_at, ' +
        'resolved_at, resolution_note, review_clicked_at, ' +
        'customers(id, name, first_name, last_name, email)',
      { count: 'exact' }
    )
    .eq('business_id', businessId)
    .order('responded_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (options.unresolvedOnly) request = request.is('resolved_at', null)
  if (options.withCommentOnly) request = request.not('comment', 'is', null)

  const { data, count, error } = await request
  if (error) throw unprocessable(error.message)

  const entries = ((data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => {
    const customer = row.customers as unknown as {
      id: string
      name: string | null
      first_name: string | null
      last_name: string | null
      email: string
    } | null

    const scaleMax = num(row.scale_max, 10) || 10
    const fullName = [customer?.first_name, customer?.last_name].filter(Boolean).join(' ').trim()

    return {
      id: row.id as string,
      customerId: customer?.id ?? null,
      customerName: fullName || customer?.name || null,
      customerEmail: customer?.email ?? null,
      score: num(row.score),
      scaleMax,
      comment: (row.comment as string) ?? null,
      sentiment: (row.sentiment as string) ?? null,
      themes: (row.themes as string[]) ?? [],
      category: categorise(num(row.score), scaleMax),
      respondedAt: row.responded_at as string,
      resolvedAt: (row.resolved_at as string) ?? null,
      resolutionNote: (row.resolution_note as string) ?? null,
      reviewClickedAt: (row.review_clicked_at as string) ?? null,
    } satisfies FeedbackEntry
  })

  const filtered =
    options.category && options.category !== 'all'
      ? entries.filter((entry) => entry.category === options.category)
      : entries

  return { feedback: filtered, total: count ?? filtered.length }
}

/**
 * Marks a piece of feedback as dealt with.
 *
 * Recorded as a customer note too, so the next person to serve them knows what
 * happened without opening a separate screen — the most common failure in
 * service recovery is the second employee not knowing about the first apology.
 */
export async function resolveFeedback(input: {
  businessId: string
  feedbackId: string
  note: string
  userId: string | null
}): Promise<{ resolved: boolean }> {
  const admin = getDb()

  const { data, error } = await admin
    .from('survey_responses')
    .update({
      resolved_at: new Date().toISOString(),
      resolved_by: input.userId,
      resolution_note: input.note.slice(0, 1000),
    })
    .eq('id', input.feedbackId)
    .eq('business_id', input.businessId)
    .select('customer_id, score')
    .maybeSingle()

  if (error) throw unprocessable(error.message)
  if (!data) throw notFound('Feedback')

  if (data.customer_id) {
    // A pinned note the merchant's own staff read at the counter, so it is
    // written in the business's language rather than the platform's.
    const t = await translatorForBusiness(input.businessId)
    await admin.from('customer_notes').insert({
      business_id: input.businessId,
      customer_id: data.customer_id as string,
      author_id: input.userId,
      body: t('notify.serviceRecoveryBody', {
        score: String(data.score),
        note: input.note.slice(0, 800),
      }),
      pinned: true,
    })
  }

  return { resolved: true }
}

/**
 * Records that a promoter followed the public review link.
 *
 * The only honest way to know whether the review funnel works. Without it a
 * merchant can see that 40 people were asked, but not that 2 went.
 */
export async function trackReviewClick(feedbackId: string): Promise<void> {
  try {
    const admin = getDb()
    await admin
      .from('survey_responses')
      .update({ review_clicked_at: new Date().toISOString() })
      .eq('id', feedbackId)
      .is('review_clicked_at', null)
  } catch (cause) {
    logger.warn('reputation.review_click_failed', { feedback_id: feedbackId, cause })
  }
}
