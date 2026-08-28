import 'server-only'
import { getDb } from '@/lib/db'
import { logger } from '@/lib/logger'
import { num } from '@/lib/domain/types'
import type { WalletEventType, WalletPlatform } from '@/lib/wallet/types'

/**
 * The proximity funnel recorder.
 *
 * Every proximity feature writes here, and the analytics screen reads nowhere
 * else. One append-only table for the whole funnel — suggestion, impression,
 * click, visit, redemption, with revenue attributed — is what makes *"did the
 * notification work?"* answerable at all. Splitting it per feature is how loyalty
 * platforms end up able to report sends but not conversions.
 *
 * **Never throws, never blocks.** A recording failure must not fail the pass
 * download, the scan, or the geofence report that produced it: measuring an action
 * is strictly less important than the action.
 */

export type RecordEventInput = {
  businessId: string
  type: WalletEventType
  customerId?: string | null
  locationId?: string | null
  campaignId?: string | null
  ruleId?: string | null
  platform?: WalletPlatform
  distanceMeters?: number | null
  /**
   * Revenue attributed to this event, in minor units. Only ever set by server
   * code reading a real ledger entry — a client-supplied figure would make the
   * ROI column fiction.
   */
  revenueCents?: number
  /** The notification this event converts from, for delay and attribution maths. */
  sourceEventId?: string | null
  metadata?: Record<string, unknown>
}

export async function recordWalletEvent(input: RecordEventInput): Promise<string | null> {
  try {
    const admin = getDb()
    const { data, error } = await admin.rpc('passimo_record_wallet_event', {
      p_business_id: input.businessId,
      p_type: input.type,
      p_customer_id: input.customerId ?? null,
      p_location_id: input.locationId ?? null,
      p_campaign_id: input.campaignId ?? null,
      p_rule_id: input.ruleId ?? null,
      p_platform: input.platform ?? 'unknown',
      p_distance_m: input.distanceMeters ?? null,
      p_revenue_cents: input.revenueCents ?? 0,
      p_source_event_id: input.sourceEventId ?? null,
      p_metadata: input.metadata ?? {},
    })

    if (error) {
      logger.warn('wallet.event_record_failed', {
        business_id: input.businessId,
        type: input.type,
        error,
      })
      return null
    }
    return (data as string) ?? null
  } catch (cause) {
    logger.warn('wallet.event_record_error', { type: input.type, cause })
    return null
  }
}

/** Fire-and-forget variant for hot paths (pass downloads, scans). */
export function recordWalletEventAsync(input: RecordEventInput): void {
  void recordWalletEvent(input)
}

/**
 * Attributes a visit to the notification that most plausibly caused it.
 *
 * The window is deliberately short. A customer who walks in 20 minutes after a
 * lock-screen nudge was plausibly nudged; one who walks in three days later was
 * going to come anyway, and counting them would let us report a conversion rate we
 * have not earned. 6 hours is the compromise: long enough for "I'll go after
 * work", short enough to be defensible to the merchant paying for it.
 */
const ATTRIBUTION_WINDOW_HOURS = 6

export async function attributeVisit(input: {
  businessId: string
  customerId: string
  locationId?: string | null
  revenueCents?: number
}): Promise<string | null> {
  const admin = getDb()
  const since = new Date(Date.now() - ATTRIBUTION_WINDOW_HOURS * 3_600_000).toISOString()

  try {
    const { data: source } = await admin
      .from('wallet_events')
      .select('id, campaign_id, location_id')
      .eq('business_id', input.businessId)
      .eq('customer_id', input.customerId)
      .in('type', ['notification_sent', 'notification_impression', 'wallet_suggestion'])
      .gte('occurred_at', since)
      .order('occurred_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    return await recordWalletEvent({
      businessId: input.businessId,
      type: 'store_visit',
      customerId: input.customerId,
      locationId: input.locationId ?? (source?.location_id as string) ?? null,
      campaignId: (source?.campaign_id as string) ?? null,
      revenueCents: input.revenueCents ?? 0,
      sourceEventId: (source?.id as string) ?? null,
    })
  } catch (cause) {
    logger.warn('wallet.attribute_visit_failed', { business_id: input.businessId, cause })
    return null
  }
}

/**
 * Notification pressure on one customer, used by the frequency guard.
 *
 * Counts *delivered* notifications only: a campaign skipped by quiet hours must
 * not consume the daily allowance, or a merchant's evening campaigns would
 * silently cannibalise their morning ones.
 */
export async function notificationPressure(
  businessId: string,
  customerId: string
): Promise<{ today: number; hoursSinceLast: number | null }> {
  const admin = getDb()
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)

  try {
    const [{ count }, { data: last }] = await Promise.all([
      admin
        .from('wallet_notifications')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', businessId)
        .eq('customer_id', customerId)
        .eq('status', 'sent')
        .gte('sent_at', startOfToday.toISOString()),
      admin
        .from('wallet_notifications')
        .select('sent_at')
        .eq('business_id', businessId)
        .eq('customer_id', customerId)
        .eq('status', 'sent')
        .order('sent_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    const hoursSinceLast = last?.sent_at
      ? (Date.now() - new Date(last.sent_at as string).getTime()) / 3_600_000
      : null

    return { today: num(count), hoursSinceLast }
  } catch (cause) {
    /*
     * Failing open here would spam a customer during a database hiccup, and a
     * deleted pass cannot be recovered. Failing closed loses at most one
     * notification, so the guard reports maximum pressure on error.
     */
    logger.warn('wallet.pressure_read_failed', { business_id: businessId, cause })
    return { today: Number.MAX_SAFE_INTEGER, hoursSinceLast: 0 }
  }
}
