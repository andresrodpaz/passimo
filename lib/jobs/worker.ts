import 'server-only'
import { randomUUID } from 'node:crypto'
import { env } from '@/lib/env'
import { logger } from '@/lib/logger'
import { claimJobs, completeJob, failJob, requeueStalledJobs } from '@/lib/jobs/queue'
import { handlerFor } from '@/lib/jobs/handlers'

/**
 * Queue worker.
 *
 * Invoked on a schedule (cron → `/api/v1/jobs/run`) or by a long-running
 * process. Bounded by both a job count and a wall-clock budget so it always
 * returns before a serverless timeout, leaving the rest for the next tick.
 */

export type WorkerResult = {
  worker: string
  claimed: number
  succeeded: number
  failed: number
  requeued: number
  durationMs: number
  results: Array<{ id: string; type: string; ok: boolean; error?: string }>
}

export async function runWorker(
  options: { limit?: number; budgetMs?: number } = {}
): Promise<WorkerResult> {
  const worker = `worker-${randomUUID().slice(0, 8)}`
  const startedAt = Date.now()
  const budgetMs = options.budgetMs ?? 45_000
  const limit = options.limit ?? env.limits.workerBatchSize

  const requeued = await requeueStalledJobs()
  const jobs = await claimJobs(worker, limit)

  const results: WorkerResult['results'] = []
  let succeeded = 0
  let failed = 0

  for (const job of jobs) {
    if (Date.now() - startedAt > budgetMs) {
      // Out of time: release the remainder so the next tick picks them up
      // immediately rather than waiting for the stall timeout.
      await failJob(job, new Error('worker budget exhausted, requeued'))
      results.push({ id: job.id, type: job.type, ok: false, error: 'requeued' })
      continue
    }

    const handler = handlerFor(job.type)
    if (!handler) {
      await failJob(job, new Error(`No handler registered for ${job.type}`))
      failed += 1
      results.push({ id: job.id, type: job.type, ok: false, error: 'no_handler' })
      continue
    }

    try {
      await handler(job.payload ?? {}, { jobId: job.id, businessId: job.business_id })
      await completeJob(job.id)
      succeeded += 1
      results.push({ id: job.id, type: job.type, ok: true })
    } catch (cause) {
      await failJob(job, cause)
      failed += 1
      results.push({
        id: job.id,
        type: job.type,
        ok: false,
        error: cause instanceof Error ? cause.message : String(cause),
      })
    }
  }

  const result: WorkerResult = {
    worker,
    claimed: jobs.length,
    succeeded,
    failed,
    requeued,
    durationMs: Date.now() - startedAt,
    results,
  }

  logger.info('worker.tick', {
    worker,
    claimed: jobs.length,
    succeeded,
    failed,
    duration_ms: result.durationMs,
  })
  return result
}
