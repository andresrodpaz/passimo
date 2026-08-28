import 'server-only'
import { getDb } from '@/lib/db'
import { logger } from '@/lib/logger'
import { walletService } from '@/lib/wallet/service'
import { recordWalletEvent } from '@/lib/wallet/events'
import type { WalletPlatform, WalletSettings } from '@/lib/wallet/types'

/**
 * Wallet notification service.
 *
 * Renders a merchant's campaign into the copy a customer sees, records the intent,
 * delivers it through whichever wallets are installed, and marks the outcome.
 *
 * The order matters and is the whole design: **the delivery ledger is written
 * before delivery is attempted.** A unique index on `dedupe_key` therefore turns
 * the duplicate geofence crossings phones emit at a boundary — sometimes dozens a
 * minute — into a single notification, without a distributed lock. If the row
 * already exists, someone else is already sending it, and we stop.
 */

export type NotificationContent = {
  title: string
  message: string
  emoji: string | null
  ctaLabel: string | null
  ctaUrl: string | null
  expiresAt: string | null
}

export type SendNotificationInput = {
  businessId: string
  customerId: string
  content: NotificationContent
  campaignId?: string | null
  ruleId?: string | null
  locationId?: string | null
  /**
   * Identity of *this* notification occurrence. Same key twice means the same
   * event, and the second attempt is dropped.
   */
  dedupeKey: string
  platform?: WalletPlatform
  distanceMeters?: number | null
}

export type SendOutcome =
  | { sent: true; notificationId: string; platforms: string[]; eventId: string | null }
  | { sent: false; reason: 'duplicate' | 'no_pass' | 'not_configured' | 'failed' }

/**
 * Interpolates the tokens a merchant can use in campaign copy.
 *
 * Deliberately a tiny fixed vocabulary rather than a template language: a merchant
 * typing into a notification field needs five placeholders they can remember, and
 * an unresolved token must render as empty rather than as `{{first_name}}` on a
 * stranger's lock screen.
 */
export function renderNotificationCopy(
  content: NotificationContent,
  tokens: Record<string, string | number | null | undefined>
): NotificationContent {
  const replace = (value: string): string =>
    value.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_match, key: string) => {
      const token = tokens[key.toLowerCase()]
      return token === null || token === undefined ? '' : String(token)
    })

  return {
    ...content,
    title: replace(content.title).trim(),
    message: replace(content.message).replace(/\s{2,}/g, ' ').trim(),
  }
}

export async function sendWalletNotification(
  input: SendNotificationInput
): Promise<SendOutcome> {
  const admin = getDb()
  const { content } = input

  // Claim the send. `dedupe_key` is uniquely indexed per business, so a conflict
  // means another concurrent evaluation already owns this occurrence.
  const { data: claimed, error: claimError } = await admin
    .from('wallet_notifications')
    .insert({
      business_id: input.businessId,
      customer_id: input.customerId,
      campaign_id: input.campaignId ?? null,
      rule_id: input.ruleId ?? null,
      location_id: input.locationId ?? null,
      channel: 'wallet',
      platform: input.platform ?? 'unknown',
      status: 'queued',
      title: content.title,
      message: content.message,
      emoji: content.emoji,
      cta_label: content.ctaLabel,
      cta_url: content.ctaUrl,
      dedupe_key: input.dedupeKey,
    })
    .select('id')
    .maybeSingle()

  if (claimError) {
    // 23505 is a unique violation: the expected, benign outcome at a boundary.
    if ((claimError as { code?: string }).code === '23505') return { sent: false, reason: 'duplicate' }
    logger.warn('wallet.notification_claim_failed', {
      business_id: input.businessId,
      error: claimError,
    })
    return { sent: false, reason: 'failed' }
  }
  if (!claimed) return { sent: false, reason: 'duplicate' }

  const notificationId = claimed.id as string

  const service = walletService()
  if (!service.isAnyConfigured()) {
    await markNotification(notificationId, 'skipped', 'wallet_not_configured')
    return { sent: false, reason: 'not_configured' }
  }

  try {
    const { delivered } = await service.notify({
      customerId: input.customerId,
      title: content.title,
      message: content.message,
      emoji: content.emoji,
      ctaLabel: content.ctaLabel,
      ctaUrl: content.ctaUrl,
      expiresAt: content.expiresAt,
      locationId: input.locationId ?? null,
      campaignId: input.campaignId ?? null,
      ruleId: input.ruleId ?? null,
    })

    if (delivered.length === 0) {
      // The customer never installed the pass. Recorded as skipped, not failed:
      // it is a normal state for most enrolled customers and must not look like an
      // incident on the merchant's screen.
      await markNotification(notificationId, 'skipped', 'no_pass_installed')
      return { sent: false, reason: 'no_pass' }
    }

    await markNotification(notificationId, 'sent', null, delivered.join(','))

    const eventId = await recordWalletEvent({
      businessId: input.businessId,
      customerId: input.customerId,
      locationId: input.locationId ?? null,
      campaignId: input.campaignId ?? null,
      ruleId: input.ruleId ?? null,
      type: 'notification_sent',
      platform: delivered.includes('apple') ? 'apple' : 'google',
      distanceMeters: input.distanceMeters ?? null,
      metadata: { title: content.title, notification_id: notificationId },
    })

    return { sent: true, notificationId, platforms: delivered, eventId }
  } catch (cause) {
    logger.error('wallet.notification_failed', {
      business_id: input.businessId,
      notification_id: notificationId,
      cause,
    })
    await failNotification(
      notificationId,
      input.businessId,
      cause instanceof Error ? cause.message : 'Unknown error'
    )
    return { sent: false, reason: 'failed' }
  }
}

/**
 * Re-attempts a notification whose delivery failed after it was claimed.
 *
 * Called by the `wallet.notification_retry` job. Reads the row back rather than
 * taking a payload, so the copy that is finally delivered is the copy that was
 * recorded — a retry must not be able to send something the delivery log does
 * not show.
 */
export async function retryNotification(
  notificationId: string
): Promise<{ sent: boolean; reason?: string }> {
  const admin = getDb()
  const { data } = await admin
    .from('wallet_notifications')
    .select(
      'id, business_id, customer_id, campaign_id, rule_id, location_id, title, message, emoji, cta_label, cta_url, status, attempts'
    )
    .eq('id', notificationId)
    .maybeSingle()

  if (!data) return { sent: false, reason: 'missing' }
  // Something already delivered it — a later crossing, or a concurrent retry.
  if (data.status !== 'failed') return { sent: false, reason: `status_${data.status}` }
  if (Number(data.attempts ?? 0) >= MAX_NOTIFICATION_ATTEMPTS) {
    return { sent: false, reason: 'exhausted' }
  }

  const service = walletService()
  if (!service.isAnyConfigured()) return { sent: false, reason: 'not_configured' }

  try {
    const { delivered } = await service.notify({
      customerId: data.customer_id as string,
      title: data.title as string,
      message: data.message as string,
      emoji: (data.emoji as string) ?? null,
      ctaLabel: (data.cta_label as string) ?? null,
      ctaUrl: (data.cta_url as string) ?? null,
      expiresAt: null,
      locationId: (data.location_id as string) ?? null,
      campaignId: (data.campaign_id as string) ?? null,
      ruleId: (data.rule_id as string) ?? null,
    })

    if (delivered.length === 0) {
      await markNotification(notificationId, 'skipped', 'no_pass_installed')
      return { sent: false, reason: 'no_pass' }
    }

    await markNotification(notificationId, 'sent', null, delivered.join(','))
    await recordWalletEvent({
      businessId: data.business_id as string,
      customerId: data.customer_id as string,
      locationId: (data.location_id as string) ?? null,
      campaignId: (data.campaign_id as string) ?? null,
      ruleId: (data.rule_id as string) ?? null,
      type: 'notification_sent',
      platform: delivered.includes('apple') ? 'apple' : 'google',
      metadata: { title: data.title, notification_id: notificationId, retry: true },
    })
    return { sent: true }
  } catch (cause) {
    await failNotification(
      notificationId,
      data.business_id as string,
      cause instanceof Error ? cause.message : 'Unknown error'
    )
    return { sent: false, reason: 'failed' }
  }
}

/**
 * Beyond this, a notification is left failed rather than retried forever.
 *
 * Small on purpose: the content is time-sensitive — "you are near the shop" is
 * worthless an hour later — so the retries exist to survive a blip, not an
 * outage. A campaign that matters will fire again on the next crossing.
 */
export const MAX_NOTIFICATION_ATTEMPTS = 3

/**
 * Marks a delivery failed, **releases its dedupe key**, and queues a retry.
 *
 * Releasing the key is the fix for a real gap. The key is claimed before
 * delivery is attempted — that ordering is what makes concurrent geofence
 * crossings collapse into one notification — but it meant a delivery that failed
 * after the claim held the key for the whole cooldown window. The next crossing
 * conflicted with the corpse of the failed attempt, so a transient APNs error
 * silently cost the merchant every send in that window.
 *
 * The column is nullable and Postgres treats nulls as distinct in a unique
 * index, so clearing it frees the slot while keeping the row in the delivery log
 * — where the merchant can see the failure and its reason.
 */
async function failNotification(
  notificationId: string,
  businessId: string,
  error: string
): Promise<void> {
  const admin = getDb()

  const { data } = await admin
    .from('wallet_notifications')
    .select('attempts')
    .eq('id', notificationId)
    .maybeSingle()

  const attempts = Number(data?.attempts ?? 0) + 1

  await admin
    .from('wallet_notifications')
    .update({
      status: 'failed',
      error,
      attempts,
      sent_at: null,
      // Released, so the cooldown window is not spent on a failed attempt.
      dedupe_key: null,
    })
    .eq('id', notificationId)

  if (attempts >= MAX_NOTIFICATION_ATTEMPTS) return

  const { enqueue } = await import('@/lib/jobs/queue')
  await enqueue(
    'wallet.notification_retry',
    { notificationId },
    {
      businessId,
      runAfter: new Date(Date.now() + 60_000 * attempts),
      idempotencyKey: `wallet-notification-retry:${notificationId}:${attempts}`,
    }
  )
}

async function markNotification(
  id: string,
  status: 'sent' | 'skipped' | 'failed',
  skipReason: string | null = null,
  platform: string | null = null,
  error: string | null = null
): Promise<void> {
  const admin = getDb()
  await admin
    .from('wallet_notifications')
    .update({
      status,
      skip_reason: skipReason,
      sent_at: status === 'sent' ? new Date().toISOString() : null,
      error,
      ...(platform && !platform.includes(',') ? { platform } : {}),
    })
    .eq('id', id)
}

/**
 * The merchant's own default copy, used when a rule action supplies none.
 *
 * A rule that says only "notify them their reward is ready" still has to produce a
 * sentence, and the merchant's branding settings are where that sentence should
 * come from — not a hardcoded string in the rule engine.
 */
export function defaultNotificationCopy(
  settings: WalletSettings,
  fallback: NotificationContent
): NotificationContent {
  return {
    title: settings.branding.title ?? fallback.title,
    message: settings.branding.message ?? fallback.message,
    emoji: settings.branding.emoji ?? fallback.emoji,
    ctaLabel: settings.branding.cta ?? fallback.ctaLabel,
    ctaUrl: fallback.ctaUrl,
    expiresAt: fallback.expiresAt,
  }
}

/** Recent notifications for one customer, for the support and profile screens. */
export async function recentNotifications(
  businessId: string,
  options: { customerId?: string; limit?: number } = {}
): Promise<
  Array<{
    id: string
    title: string
    message: string
    status: string
    skipReason: string | null
    campaignId: string | null
    sentAt: string | null
    createdAt: string
  }>
> {
  const admin = getDb()
  let query = admin
    .from('wallet_notifications')
    .select('id, title, message, status, skip_reason, campaign_id, sent_at, created_at')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false })
    .limit(options.limit ?? 50)

  if (options.customerId) query = query.eq('customer_id', options.customerId)

  const { data } = await query
  return (data ?? []).map((row) => ({
    id: row.id as string,
    title: row.title as string,
    message: row.message as string,
    status: row.status as string,
    skipReason: (row.skip_reason as string) ?? null,
    campaignId: (row.campaign_id as string) ?? null,
    sentAt: (row.sent_at as string) ?? null,
    createdAt: row.created_at as string,
  }))
}
