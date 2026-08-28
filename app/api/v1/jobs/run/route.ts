import { z } from 'zod'
import { defineRoute } from '@/lib/api/handler'
import { runWorker } from '@/lib/jobs/worker'

export const runtime = 'nodejs'
export const maxDuration = 60
export const dynamic = 'force-dynamic'

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
})

/**
 * Queue worker tick.
 *
 * Called every minute by the platform scheduler. The budget is set below the
 * function timeout so the worker always returns cleanly and unfinished jobs are
 * requeued rather than abandoned mid-flight.
 */
export const POST = defineRoute(
  { name: 'jobs.run', auth: 'cron', query: querySchema, rateLimit: false },
  async ({ query }) => runWorker({ limit: query.limit, budgetMs: 45_000 })
)

export const GET = POST
