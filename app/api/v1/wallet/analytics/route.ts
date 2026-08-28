import { defineRoute } from '@/lib/api/handler'
import { analyticsQuery } from '@/lib/api/wallet-schemas'
import { getProximityAnalytics } from '@/lib/wallet/analytics'
import { recentNotifications } from '@/lib/wallet/notifications'

export const runtime = 'nodejs'

/**
 * Proximity analytics.
 *
 * One request returns the whole funnel, per-campaign performance, per-location
 * performance, a daily timeline and the most recent notification log — because the
 * merchant question these answer is a single question ("is this working?") and
 * splitting it across five endpoints would mean five loading states on one screen.
 *
 * The notification log is included deliberately. Analytics that only report
 * successes cannot explain a quiet week; a merchant seeing *"48 skipped —
 * no_pass_installed"* learns something actionable, which a conversion rate alone
 * never tells them.
 */
export const GET = defineRoute(
  {
    name: 'wallet.analytics',
    auth: 'required',
    query: analyticsQuery,
    businessIdFrom: { source: 'query', key: 'businessId' },
    permissions: ['analytics:read'],
    rateLimit: 'dashboard',
  },
  async ({ query, business }) => {
    const to = new Date()
    const from = new Date(to.getTime() - query.days * 86_400_000)

    const [analytics, notifications] = await Promise.all([
      getProximityAnalytics(business.businessId, { from, to }),
      recentNotifications(business.businessId, { limit: 25 }),
    ])

    return { ...analytics, notifications }
  }
)
