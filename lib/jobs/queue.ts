import 'server-only'
import { getDb } from '@/lib/db'
import { logger } from '@/lib/logger'

/**
 * Transactional outbox.
 *
 * Anything slow, fallible or fan-out shaped is enqueued rather than awaited in
 * the request: campaign sends, wallet pushes, webhook deliveries, automation
 * enrolment, AI generation. A web request never waits on a third party, and a
 * failed send retries with backoff instead of vanishing.
 */

export const JOB_TYPES = [
  'campaign.dispatch',
  'campaign.send_batch',
  'campaign.attribute',
  'automation.enroll',
  'automation.run',
  'message.send',
  'wallet.push',
  'wallet.sync_google',
  /* Refresh every installed pass for one customer, across both wallets. */
  'wallet.sync',
  /* Re-push to one vendor that failed while the other succeeded. */
  'wallet.sync_retry',
  /* Re-attempt a proximity notification whose delivery failed after it was claimed. */
  'wallet.notification_retry',
  /* Evaluate a queued geofence report that arrived while the device was offline. */
  'wallet.proximity_report',
  'webhook.deliver',
  'customers.import',
  'customers.recompute_stats',
  'analytics.recompute',
  'loyalty.expire_balances',
  'ai.generate_insights',
  'gdpr.export',
  'gdpr.erase',
  'giftcard.fulfil',
  'giftcard.deliver',
  'giftcard.deliver_scheduled',
  'membership.renew',
  'membership.notify_renewals',
] as const

export type JobType = (typeof JOB_TYPES)[number]

export type EnqueueOptions = {
  businessId?: string | null
  /** Delay execution until this moment. */
  runAfter?: Date
  /** Lower runs first. */
  priority?: number
  /** Stable key: enqueueing the same key twice is a no-op. */
  idempotencyKey?: string
  maxAttempts?: number
}

export async function enqueue(
  type: JobType,
  payload: Record<string, unknown>,
  options: EnqueueOptions = {}
): Promise<string | null> {
  const admin = getDb()
  const { data, error } = await admin
    .from('jobs')
    .upsert(
      {
        business_id: options.businessId ?? null,
        type,
        payload,
        priority: options.priority ?? 100,
        run_after: (options.runAfter ?? new Date()).toISOString(),
        max_attempts: options.maxAttempts ?? 5,
        idempotency_key: options.idempotencyKey ?? null,
      },
      { onConflict: 'idempotency_key', ignoreDuplicates: true }
    )
    .select('id')
    .maybeSingle()

  if (error) {
    // A queue failure must never break the user-visible operation that caused
    // it; the reconciliation cron re-derives anything genuinely missing.
    logger.error('jobs.enqueue_failed', { type, error })
    return null
  }
  return data?.id ?? null
}

/** Enqueue several jobs in one round trip (campaign batches, fan-out). */
export async function enqueueMany(
  jobs: Array<{ type: JobType; payload: Record<string, unknown>; options?: EnqueueOptions }>
): Promise<number> {
  if (jobs.length === 0) return 0
  const admin = getDb()
  const rows = jobs.map(({ type, payload, options = {} }) => ({
    business_id: options.businessId ?? null,
    type,
    payload,
    priority: options.priority ?? 100,
    run_after: (options.runAfter ?? new Date()).toISOString(),
    max_attempts: options.maxAttempts ?? 5,
    idempotency_key: options.idempotencyKey ?? null,
  }))

  const { data, error } = await admin
    .from('jobs')
    .upsert(rows, { onConflict: 'idempotency_key', ignoreDuplicates: true })
    .select('id')

  if (error) {
    logger.error('jobs.enqueue_many_failed', { count: jobs.length, error })
    return 0
  }
  return data?.length ?? 0
}

export type ClaimedJob = {
  id: string
  business_id: string | null
  type: JobType
  payload: Record<string, unknown>
  attempts: number
  max_attempts: number
}

export async function claimJobs(worker: string, limit: number): Promise<ClaimedJob[]> {
  const admin = getDb()
  const { data, error } = await admin.rpc('passimo_claim_jobs', {
    p_worker: worker,
    p_limit: limit,
  })
  if (error) {
    logger.error('jobs.claim_failed', { error })
    return []
  }
  return (data ?? []) as ClaimedJob[]
}

export async function completeJob(id: string): Promise<void> {
  const admin = getDb()
  await admin
    .from('jobs')
    .update({
      status: 'succeeded',
      completed_at: new Date().toISOString(),
      locked_at: null,
      locked_by: null,
      last_error: null,
    })
    .eq('id', id)
}

/** Exponential backoff with jitter, capped so a poison job dies rather than spins. */
export async function failJob(job: ClaimedJob, error: unknown): Promise<void> {
  const admin = getDb()
  const message = error instanceof Error ? error.message : String(error)
  const exhausted = job.attempts >= job.max_attempts

  const backoffSeconds = Math.min(3600, 2 ** job.attempts * 15)
  const jitter = Math.floor(Math.random() * 15)

  await admin
    .from('jobs')
    .update({
      status: exhausted ? 'dead' : 'pending',
      last_error: message.slice(0, 2000),
      locked_at: null,
      locked_by: null,
      run_after: new Date(Date.now() + (backoffSeconds + jitter) * 1000).toISOString(),
    })
    .eq('id', job.id)

  logger[exhausted ? 'error' : 'warn']('jobs.failed', {
    job_id: job.id,
    type: job.type,
    attempts: job.attempts,
    exhausted,
    error: message,
  })
}

export async function requeueStalledJobs(): Promise<number> {
  const admin = getDb()
  const { data } = await admin.rpc('passimo_requeue_stalled_jobs', {
    p_stale_after: '10 minutes',
  })
  return Number(data ?? 0)
}
