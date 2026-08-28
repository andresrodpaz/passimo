import { z } from 'zod'
import { defineRoute } from '@/lib/api/handler'
import { getCounterRoster } from '@/lib/customers/service'
import { summarize } from '@/lib/scan/resolve'

export const runtime = 'nodejs'

const querySchema = z.object({
  businessId: z.string().uuid(),
})

/**
 * The counter's fallback roster: recent visitors and regulars.
 *
 * Exists so the merchant is never blocked. No camera, a flat customer phone, a
 * cracked screen — they tap a name from a list instead. Small and cacheable, so
 * the scanner can hold it in memory and stay useful when the network drops.
 */
export const GET = defineRoute(
  {
    name: 'counter.roster',
    auth: 'required',
    query: querySchema,
    businessIdFrom: { source: 'query', key: 'businessId' },
    permissions: ['customers:read'],
    rateLimit: 'pos',
  },
  async ({ business }) => {
    const { recent, vip } = await getCounterRoster(business.businessId)
    return {
      recent: recent.map(summarize),
      vip: vip.map(summarize),
    }
  }
)
