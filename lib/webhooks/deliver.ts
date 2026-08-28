import 'server-only'
import { getDb } from '@/lib/db'
import { webhookSignature } from '@/lib/crypto'
import { logger } from '@/lib/logger'

/**
 * Outbound webhooks.
 *
 * Merchants and partners build automations on top of these (Zapier, Make, a
 * custom POS). Every payload is HMAC-signed with a per-endpoint secret and
 * carries a timestamp so receivers can reject replays. Endpoints that keep
 * failing are disabled automatically rather than retried forever.
 */

export const WEBHOOK_EVENTS = [
  'customer.created',
  'customer.updated',
  'loyalty.earned',
  'loyalty.expired',
  'reward.redeemed',
  'tier.changed',
  'referral.qualified',
  'campaign.completed',
  'survey.responded',
  'gift_card.redeemed',
] as const

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number]

const MAX_CONSECUTIVE_FAILURES = 10
const TIMEOUT_MS = 10_000

export async function deliverWebhooks(
  businessId: string,
  event: WebhookEvent | string,
  data: Record<string, unknown>
): Promise<{ attempted: number; succeeded: number }> {
  const admin = getDb()
  const { data: endpoints } = await admin
    .from('webhook_endpoints')
    .select('id, url, secret, events, consecutive_failures')
    .eq('business_id', businessId)
    .eq('is_active', true)

  const matching = (endpoints ?? []).filter((endpoint) => {
    const events = (endpoint.events as string[]) ?? []
    return events.includes('*') || events.includes(event)
  })

  if (matching.length === 0) return { attempted: 0, succeeded: 0 }

  const timestamp = Math.floor(Date.now() / 1000).toString()
  const payload = {
    id: crypto.randomUUID(),
    type: event,
    created: Number(timestamp),
    business_id: businessId,
    data,
  }
  const body = JSON.stringify(payload)

  const results = await Promise.allSettled(
    matching.map((endpoint) => deliverOne(businessId, endpoint, event, payload, body, timestamp))
  )

  const succeeded = results.filter(
    (result) => result.status === 'fulfilled' && result.value
  ).length
  return { attempted: matching.length, succeeded }
}

async function deliverOne(
  businessId: string,
  endpoint: { id: string; url: string; secret: string; consecutive_failures: number },
  event: string,
  payload: Record<string, unknown>,
  body: string,
  timestamp: string
): Promise<boolean> {
  const admin = getDb()
  const startedAt = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  let status = 0
  let responseBody = ''
  let ok = false

  try {
    const response = await fetch(endpoint.url, {
      method: 'POST',
      /*
       * `X-Passimo-*` is the documented contract. The `X-Fidelio-*` copies are
       * sent alongside it because a receiver written against the old names is
       * code we do not control — verifying a signature from a header that
       * vanished is a silent integration outage on the merchant's side, not ours.
       * They cost three header lines and can be dropped once no endpoint reads
       * them.
       */
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Passimo-Webhooks/1.0',
        'X-Passimo-Event': event,
        'X-Passimo-Timestamp': timestamp,
        'X-Passimo-Signature': webhookSignature(endpoint.secret, timestamp, body),
        'X-Fidelio-Event': event,
        'X-Fidelio-Timestamp': timestamp,
        'X-Fidelio-Signature': webhookSignature(endpoint.secret, timestamp, body),
      },
      body,
      signal: controller.signal,
    })
    status = response.status
    responseBody = (await response.text().catch(() => '')).slice(0, 1000)
    ok = response.ok
  } catch (cause) {
    responseBody = cause instanceof Error ? cause.message : 'request failed'
    logger.warn('webhook.delivery_failed', { endpoint: endpoint.id, cause: responseBody })
  } finally {
    clearTimeout(timer)
  }

  await admin.from('webhook_deliveries').insert({
    endpoint_id: endpoint.id,
    business_id: businessId,
    event_type: event,
    payload,
    status: ok ? 'succeeded' : 'failed',
    response_status: status || null,
    response_body: responseBody || null,
    attempts: 1,
    duration_ms: Date.now() - startedAt,
    delivered_at: ok ? new Date().toISOString() : null,
  })

  const failures = ok ? 0 : endpoint.consecutive_failures + 1
  await admin
    .from('webhook_endpoints')
    .update({
      consecutive_failures: failures,
      // Auto-disable dead endpoints; a merchant who removed their Zap should
      // not cost us a retry storm forever.
      ...(failures >= MAX_CONSECUTIVE_FAILURES
        ? { is_active: false, disabled_at: new Date().toISOString() }
        : {}),
    })
    .eq('id', endpoint.id)

  return ok
}
