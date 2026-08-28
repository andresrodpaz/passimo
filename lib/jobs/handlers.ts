import 'server-only'
import { getDb } from '@/lib/db'
import { env } from '@/lib/env'
import { logger } from '@/lib/logger'
import { enqueue, enqueueMany, type JobType } from '@/lib/jobs/queue'
import { dispatchMessage } from '@/lib/messaging/dispatch'
import { deliverWebhooks } from '@/lib/webhooks/deliver'
import { enrollCustomer, runAutomation } from '@/lib/automations/engine'
import { listSegmentCustomerIds, resolveSegmentDefinition } from '@/lib/segments/resolve'
import { performWalletSync, type SyncReason } from '@/lib/wallet/sync'
import type { WalletProviderId } from '@/lib/wallet/sync-state'
import { retryNotification } from '@/lib/wallet/notifications'
import { reportPosition } from '@/lib/wallet/proximity'
import type { WalletPlatform } from '@/lib/wallet/types'
import { generateInsights } from '@/lib/ai/capabilities'
import { importCustomerRows } from '@/lib/customers/import'
import { exportCustomerData, eraseCustomerData } from '@/lib/gdpr/requests'
import { num, type Channel } from '@/lib/domain/types'
import {
  deliverGiftCard,
  deliverScheduledGiftCards,
  fulfilGiftCard,
  notifyUpcomingRenewals,
  renewMembershipsJob,
} from '@/lib/jobs/commerce-handlers'

/**
 * Job handlers.
 *
 * Each handler is idempotent: the queue guarantees at-least-once delivery, so
 * running a job twice must be harmless. Where a side effect is externally
 * visible (an email, a webhook), the underlying primitive carries an
 * idempotency key.
 */

export type JobHandler = (
  payload: Record<string, unknown>,
  context: { jobId: string; businessId: string | null }
) => Promise<Record<string, unknown> | void>

// -----------------------------------------------------------------------------
// Campaigns
// -----------------------------------------------------------------------------

/**
 * Resolves the audience and fans out into fixed-size batches.
 *
 * Sending inline was the single worst scalability bug in the original code: one
 * HTTP request looping `await resend.send()` over every customer. A 3,000-person
 * list guaranteed a timeout, a partial send, and duplicate emails on retry.
 */
const dispatchCampaign: JobHandler = async (payload) => {
  const campaignId = payload.campaignId as string
  const admin = getDb()

  const { data: campaign } = await admin
    .from('campaigns')
    .select('*')
    .eq('id', campaignId)
    .maybeSingle()
  if (!campaign) return { skipped: 'campaign_missing' }
  if (!['scheduled', 'sending', 'draft'].includes(campaign.status as string)) {
    return { skipped: `status_${campaign.status}` }
  }

  const definition = await resolveSegmentDefinition(
    campaign.business_id as string,
    campaign.segment_id as string | null,
    (campaign.audience_filter as never) ?? null
  )
  const customerIds = await listSegmentCustomerIds(campaign.business_id as string, definition, {
    limit: 20000,
  })

  await admin
    .from('campaigns')
    .update({
      status: 'sending',
      started_at: new Date().toISOString(),
      reach_count: customerIds.length,
    })
    .eq('id', campaignId)

  const batchSize = env.limits.campaignBatchSize
  const batches: Array<{ type: JobType; payload: Record<string, unknown>; options: object }> = []

  for (let offset = 0; offset < customerIds.length; offset += batchSize) {
    const slice = customerIds.slice(offset, offset + batchSize)
    batches.push({
      type: 'campaign.send_batch',
      payload: { campaignId, customerIds: slice, batchIndex: offset / batchSize },
      options: {
        businessId: campaign.business_id,
        idempotencyKey: `campaign:${campaignId}:batch:${offset / batchSize}`,
        priority: 60,
      },
    })
  }

  await enqueueMany(batches)

  // Measure the outcome once the attribution window closes.
  await enqueue(
    'campaign.attribute',
    { campaignId },
    {
      businessId: campaign.business_id as string,
      runAfter: new Date(Date.now() + num(campaign.attribution_window_days, 14) * 86_400_000),
      idempotencyKey: `campaign:${campaignId}:attribution`,
    }
  )

  return { reach: customerIds.length, batches: batches.length }
}

const sendCampaignBatch: JobHandler = async (payload) => {
  const campaignId = payload.campaignId as string
  const customerIds = (payload.customerIds as string[]) ?? []
  const admin = getDb()

  const { data: campaign } = await admin
    .from('campaigns')
    .select('*')
    .eq('id', campaignId)
    .maybeSingle()
  if (!campaign) return { skipped: 'campaign_missing' }
  if (campaign.status === 'cancelled' || campaign.status === 'paused') {
    return { skipped: `status_${campaign.status}` }
  }

  const channels = ((campaign.channels as string[]) ?? ['email']) as Channel[]
  let sent = 0
  let skipped = 0

  for (const customerId of customerIds) {
    for (const channel of channels) {
      const outcome = await dispatchMessage({
        businessId: campaign.business_id as string,
        customerId,
        channel,
        subject: campaign.subject as string | null,
        body: bodyForChannel(campaign, channel),
        html: channel === 'email' ? (campaign.body_html as string | null) : null,
        url: campaign.cta_url as string | null,
        campaignId,
        category: 'marketing',
        // One message per (campaign, customer, channel), ever.
        idempotencyKey: `campaign:${campaignId}:${customerId}:${channel}`,
      })
      if (outcome.sent) sent += 1
      else skipped += 1
    }
  }

  await finalizeCampaignIfComplete(campaignId)
  return { sent, skipped, batch: payload.batchIndex }
}

function bodyForChannel(campaign: Record<string, unknown>, channel: Channel): string {
  switch (channel) {
    case 'sms':
      return (campaign.sms_body as string) ?? (campaign.body_text as string) ?? ''
    case 'whatsapp':
      return (campaign.whatsapp_body as string) ?? (campaign.body_text as string) ?? ''
    case 'push':
    case 'wallet':
      return (campaign.push_body as string) ?? (campaign.wallet_message as string) ?? ''
    default:
      return (campaign.body_text as string) ?? stripHtml((campaign.body_html as string) ?? '')
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .trim()
}

async function finalizeCampaignIfComplete(campaignId: string) {
  const admin = getDb()
  const { count } = await admin
    .from('jobs')
    .select('id', { count: 'exact', head: true })
    .eq('type', 'campaign.send_batch')
    .in('status', ['pending', 'running'])
    .like('idempotency_key', `campaign:${campaignId}:batch:%`)

  if ((count ?? 0) === 0) {
    await admin
      .from('campaigns')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', campaignId)
      .eq('status', 'sending')

    const { data: campaign } = await admin
      .from('campaigns')
      .select('business_id, name, sent_count')
      .eq('id', campaignId)
      .maybeSingle()
    if (campaign) {
      await enqueue(
        'webhook.deliver',
        {
          businessId: campaign.business_id,
          event: 'campaign.completed',
          data: { campaign_id: campaignId, name: campaign.name, sent: campaign.sent_count },
        },
        { businessId: campaign.business_id as string }
      )
    }
  }
}

const attributeCampaign: JobHandler = async (payload) => {
  const admin = getDb()
  const { data } = await admin.rpc('passimo_attribute_campaign', {
    p_campaign_id: payload.campaignId as string,
  })
  return (data as Record<string, unknown>) ?? {}
}

// -----------------------------------------------------------------------------
// Messaging & automations
// -----------------------------------------------------------------------------

const sendMessage: JobHandler = async (payload) => {
  const outcome = await dispatchMessage(payload as never)
  return { ...outcome }
}

const enrollAutomation: JobHandler = async (payload) => {
  return enrollCustomer({
    businessId: payload.businessId as string,
    customerId: payload.customerId as string,
    trigger: payload.trigger as never,
    eventId: (payload.eventId as string) ?? null,
    context: (payload.context as Record<string, unknown>) ?? {},
  })
}

const executeAutomation: JobHandler = async (payload) => {
  return runAutomation(payload.runId as string)
}

// -----------------------------------------------------------------------------
// Wallet
// -----------------------------------------------------------------------------

/**
 * All three wallet job types now route through the wallet service, so a card
 * refresh reaches both vendors with one code path. The two legacy type names are
 * kept because jobs enqueued before this deploy are still in the queue, and a
 * missing handler would fail them permanently.
 */
const syncWallet: JobHandler = async (payload) => {
  const customerId = payload.customerId as string
  const reason = (payload.reason as SyncReason) ?? 'balance_change'
  /*
   * `providers` is present only on a retry, where exactly one vendor failed and
   * the other is already current. Re-pushing the healthy one would be a second
   * background wake-up on the customer's phone for a card that did not change.
   */
  const providers = Array.isArray(payload.providers)
    ? (payload.providers as WalletProviderId[])
    : undefined
  const result = await performWalletSync(customerId, reason, { providers })
  return { customerId, ...result }
}

/**
 * A proximity notification whose delivery failed after its dedupe key was taken.
 *
 * The claim-then-send order is what makes concurrent geofence crossings collapse
 * into one notification, and it used to mean that a delivery failing after the
 * claim was lost for the whole cooldown window — the key was held by a dead
 * attempt. The key is now released on failure and the send re-attempted here, so
 * a transient APNs error costs a few minutes rather than the whole window.
 */
const retryWalletNotification: JobHandler = async (payload) => {
  return retryNotification(payload.notificationId as string)
}

/**
 * A geofence report that could not be evaluated when it happened — the device was
 * offline, or the queue absorbed a burst. Replayed with its original timestamp so
 * campaign hours and cooldowns are judged against when the customer was actually
 * at the door, not when we got round to it.
 */
const evaluateProximityReport: JobHandler = async (payload) => {
  const outcome = await reportPosition({
    businessId: payload.businessId as string,
    customerId: payload.customerId as string,
    position: { lat: Number(payload.lat), lng: Number(payload.lng) },
    accuracyMeters: payload.accuracyMeters === undefined ? null : Number(payload.accuracyMeters),
    platform: (payload.platform as WalletPlatform) ?? 'web',
    now: payload.occurredAt ? new Date(payload.occurredAt as string) : undefined,
  })
  return { transition: outcome.transition, notified: outcome.notification?.sent ?? false }
}

// -----------------------------------------------------------------------------
// Webhooks
// -----------------------------------------------------------------------------

const deliverWebhook: JobHandler = async (payload) => {
  return deliverWebhooks(
    payload.businessId as string,
    payload.event as string,
    (payload.data as Record<string, unknown>) ?? {}
  )
}

// -----------------------------------------------------------------------------
// Data operations
// -----------------------------------------------------------------------------

const importCustomers: JobHandler = async (payload) => {
  return importCustomerRows({
    businessId: payload.businessId as string,
    importId: payload.importId as string,
    rows: payload.rows as Record<string, string>[],
    mapping: payload.mapping as Record<string, string>,
  })
}

const recomputeStats: JobHandler = async (payload) => {
  const admin = getDb()
  const businessId = payload.businessId as string
  const [rfm, churn] = await Promise.all([
    admin.rpc('passimo_recompute_rfm', { p_business_id: businessId }),
    admin.rpc('passimo_recompute_churn_risk', { p_business_id: businessId }),
  ])
  return { rfm: rfm.data, churn: churn.data }
}

const recomputeAnalytics: JobHandler = async (payload) => {
  const admin = getDb()
  const businessId = payload.businessId as string

  // Keep every saved segment's cached count fresh for the audience picker.
  const { data: segments } = await admin
    .from('segments')
    .select('id')
    .eq('business_id', businessId)
    .limit(100)

  const { refreshSegmentCount } = await import('@/lib/segments/resolve')
  let refreshed = 0
  for (const segment of segments ?? []) {
    await refreshSegmentCount(businessId, segment.id as string)
    refreshed += 1
  }
  return { segments: refreshed }
}

const expireBalances: JobHandler = async (payload) => {
  const admin = getDb()
  const { data } = await admin.rpc('passimo_expire_balances', {
    p_business_id: (payload.businessId as string) ?? null,
  })
  return (data as Record<string, unknown>) ?? {}
}

const generateAiInsights: JobHandler = async (payload) => {
  const businessId = payload.businessId as string
  if (!env.ai.isConfigured) return { skipped: 'ai_not_configured' }

  const insights = await generateInsights(businessId)
  if (insights.length === 0) return { insights: 0 }

  const admin = getDb()
  // Supersede yesterday's advice so the feed never becomes a graveyard.
  await admin
    .from('ai_insights')
    .update({ status: 'expired' })
    .eq('business_id', businessId)
    .eq('status', 'new')
    .lt('generated_at', new Date(Date.now() - 3 * 86_400_000).toISOString())

  await admin.from('ai_insights').insert(
    insights.map((insight) => ({
      business_id: businessId,
      kind: insight.kind,
      title: insight.title,
      body: insight.body,
      severity: insight.severity,
      estimated_impact: insight.estimated_impact ?? null,
      confidence: insight.confidence,
      action: insight.action ?? null,
      model: env.ai.model,
      expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    }))
  )
  return { insights: insights.length }
}

const gdprExport: JobHandler = async (payload) => {
  return exportCustomerData(payload.requestId as string)
}

const gdprErase: JobHandler = async (payload) => {
  return eraseCustomerData(payload.requestId as string)
}

// -----------------------------------------------------------------------------
// Registry
// -----------------------------------------------------------------------------

export const JOB_HANDLERS: Record<JobType, JobHandler> = {
  'campaign.dispatch': dispatchCampaign,
  'campaign.send_batch': sendCampaignBatch,
  'campaign.attribute': attributeCampaign,
  'automation.enroll': enrollAutomation,
  'automation.run': executeAutomation,
  'message.send': sendMessage,
  'wallet.push': syncWallet,
  'wallet.sync_google': syncWallet,
  'wallet.sync': syncWallet,
  'wallet.sync_retry': syncWallet,
  'wallet.notification_retry': retryWalletNotification,
  'wallet.proximity_report': evaluateProximityReport,
  'webhook.deliver': deliverWebhook,
  'customers.import': importCustomers,
  'customers.recompute_stats': recomputeStats,
  'analytics.recompute': recomputeAnalytics,
  'loyalty.expire_balances': expireBalances,
  'ai.generate_insights': generateAiInsights,
  'gdpr.export': gdprExport,
  'gdpr.erase': gdprErase,
  'giftcard.fulfil': fulfilGiftCard,
  'giftcard.deliver': deliverGiftCard,
  'giftcard.deliver_scheduled': deliverScheduledGiftCards,
  'membership.renew': renewMembershipsJob,
  'membership.notify_renewals': notifyUpcomingRenewals,
}

export function handlerFor(type: string): JobHandler | null {
  const handler = JOB_HANDLERS[type as JobType]
  if (!handler) {
    logger.error('jobs.unknown_type', { type })
    return null
  }
  return handler
}
