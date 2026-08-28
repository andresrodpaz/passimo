import { defineRoute } from '@/lib/api/handler'
import { getDb } from '@/lib/db'
import { enqueueMany } from '@/lib/jobs/queue'
import { sweepTimeBasedAutomations } from '@/lib/automations/engine'
import { env } from '@/lib/env'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'
export const maxDuration = 60
export const dynamic = 'force-dynamic'

/**
 * Nightly maintenance.
 *
 * Everything here is *enqueued* rather than executed, so this endpoint returns
 * in well under a second regardless of how many businesses exist, and the work
 * is retried individually if a single tenant fails.
 */
export const POST = defineRoute(
  { name: 'cron.daily', auth: 'cron', rateLimit: false },
  async () => {
    const admin = getDb()

    const { data: businesses } = await admin
      .from('businesses')
      .select('id')
      .is('archived_at', null)

    const ids = (businesses ?? []).map((row) => row.id as string)
    const today = new Date().toISOString().slice(0, 10)

    // Time-based automations (birthday, anniversary, inactivity, expiry) have
    // no originating event, so they are swept once a day.
    const sweep = await sweepTimeBasedAutomations()

    const jobs = ids.flatMap((businessId) => [
      {
        type: 'customers.recompute_stats' as const,
        payload: { businessId },
        options: { businessId, idempotencyKey: `stats:${businessId}:${today}`, priority: 200 },
      },
      {
        type: 'analytics.recompute' as const,
        payload: { businessId },
        options: { businessId, idempotencyKey: `analytics:${businessId}:${today}`, priority: 210 },
      },
      ...(env.ai.isConfigured
        ? [
            {
              type: 'ai.generate_insights' as const,
              payload: { businessId },
              options: {
                businessId,
                idempotencyKey: `insights:${businessId}:${today}`,
                priority: 300,
              },
            },
          ]
        : []),
    ])

    const enqueued = await enqueueMany(jobs)

    // Global sweeps. Each SQL function batches internally, so these are one job
    // each rather than one per business — a thousand tenants must not become a
    // thousand queue rows for work that is a single statement.
    await enqueueMany([
      {
        type: 'loyalty.expire_balances',
        payload: {},
        options: { idempotencyKey: `expire:${today}`, priority: 150 },
      },
      {
        type: 'membership.renew',
        payload: {},
        options: { idempotencyKey: `renew:${today}`, priority: 60 },
      },
      {
        type: 'membership.notify_renewals',
        payload: {},
        options: { idempotencyKey: `renew-notice:${today}`, priority: 160 },
      },
      {
        type: 'giftcard.deliver_scheduled',
        payload: {},
        options: { idempotencyKey: `giftcard-scheduled:${today}`, priority: 50 },
      },
    ])

    // Campaigns whose scheduled time has arrived.
    const { data: due } = await admin
      .from('campaigns')
      .select('id, business_id')
      .eq('status', 'scheduled')
      .lte('scheduled_at', new Date().toISOString())
      .limit(500)

    if (due?.length) {
      await enqueueMany(
        due.map((campaign) => ({
          type: 'campaign.dispatch' as const,
          payload: { campaignId: campaign.id },
          options: {
            businessId: campaign.business_id as string,
            idempotencyKey: `campaign:${campaign.id}:dispatch`,
            priority: 40,
          },
        }))
      )
    }

    logger.info('cron.daily_completed', {
      businesses: ids.length,
      jobs_enqueued: enqueued,
      automations_enrolled: sweep.enrolled,
      campaigns_due: due?.length ?? 0,
    })

    return {
      businesses: ids.length,
      jobs_enqueued: enqueued,
      automations: sweep,
      campaigns_due: due?.length ?? 0,
    }
  }
)

export const GET = POST
