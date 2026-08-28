import { z } from 'zod'
import { defineRoute } from '@/lib/api/handler'
import { getDb } from '@/lib/db'
import { upstreamFailed } from '@/lib/errors'
import type { AnalyticsOverview } from '@/lib/domain/types'

export const runtime = 'nodejs'

const querySchema = z.object({
  businessId: z.string().uuid(),
  days: z.coerce.number().int().min(1).max(365).default(30),
  include: z.string().optional(),
})

/**
 * Headline analytics.
 *
 * One database call instead of the eleven sequential round trips the previous
 * implementation made, and it now answers the questions merchants actually ask:
 * retention, churn, repeat rate, CLV and attributed revenue — not just a count
 * of stamps.
 */
export const GET = defineRoute(
  {
    name: 'analytics.overview',
    auth: 'required',
    query: querySchema,
    businessIdFrom: { source: 'query', key: 'businessId' },
    permissions: ['analytics:read'],
    rateLimit: 'dashboard',
  },
  async ({ query, business }) => {
    const admin = getDb()
    const include = new Set((query.include ?? '').split(',').filter(Boolean))

    const [overview, cohorts] = await Promise.all([
      admin.rpc('passimo_analytics_overview', {
        p_business_id: business.businessId,
        p_days: query.days,
      }),
      include.has('cohorts')
        ? admin.rpc('passimo_cohort_retention', { p_business_id: business.businessId, p_months: 6 })
        : Promise.resolve({ data: null, error: null }),
    ])

    if (overview.error) throw upstreamFailed('Analytics', overview.error)

    return {
      ...(overview.data as AnalyticsOverview),
      ...(cohorts.data ? { cohorts: cohorts.data } : {}),
    }
  }
)
