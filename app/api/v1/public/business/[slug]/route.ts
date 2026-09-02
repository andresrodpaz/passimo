import { z } from 'zod'
import { defineRoute } from '@/lib/api/handler'
import { notFound } from '@/lib/errors'
import { getJoinPageData, toPublicJoinData } from '@/lib/public/join'

export const runtime = 'nodejs'

const paramsSchema = z.object({ slug: z.string().min(1).max(80) })

/**
 * Public brand + program metadata for the join page.
 *
 * Returns only what a prospective member needs to see. Deliberately excludes
 * anything that would let a competitor profile the business (customer counts,
 * revenue, campaign history).
 *
 * The read itself lives in `lib/public/join.ts` because the join page renders it
 * on the server too, and two copies of "what may a stranger see about a
 * business" is one copy too many — the next field added to the page is the field
 * that leaks from the endpoint.
 */
export const GET = defineRoute(
  {
    name: 'public.business',
    auth: 'none',
    params: paramsSchema,
    rateLimit: 'publicRelaxed',
  },
  async ({ params }) => {
    const data = await getJoinPageData(params.slug)
    if (!data) throw notFound('Business')

    // `business.id` is dropped on the way out; see `toPublicJoinData`.
    return toPublicJoinData(data)
  }
)
