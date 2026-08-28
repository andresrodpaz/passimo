import 'server-only'
import { enqueue } from '@/lib/jobs/queue'
import { getDb } from '@/lib/db'
import { logger } from '@/lib/logger'
import { walletService } from '@/lib/wallet/service'
import { planSync, type ProviderState, type WalletProviderId } from '@/lib/wallet/sync-state'

/**
 * Wallet synchronisation service.
 *
 * "The card changed — tell the devices." Called from every path that moves the
 * state a card displays: earning, redeeming, tier changes, a merchant editing a
 * location, applying a template.
 *
 * Always asynchronous. A pass update is two network round trips to Apple and
 * Google, and the customer is standing at the counter — making them wait for
 * APNs to acknowledge a background push is the wrong trade every time. The work
 * goes on the existing job queue, which already gives it retries, idempotency and
 * a worker.
 */

export type SyncReason =
  | 'balance_change'
  | 'reward_claimed'
  | 'reward_redeemed'
  | 'tier_change'
  | 'locations_changed'
  | 'settings_changed'
  | 'campaign_applied'
  | 'manual'

/**
 * Queues a pass refresh for one customer.
 *
 * The idempotency key buckets by minute, which collapses the burst a single
 * transaction produces — earn, tier check, reward grant all firing within a
 * second — into one push. A customer whose watch buzzes three times for one
 * coffee learns to delete the card.
 */
export async function scheduleWalletSync(
  customerId: string,
  reason: SyncReason = 'balance_change',
  options: { businessId?: string; delaySeconds?: number } = {}
): Promise<void> {
  const minuteBucket = Math.floor(Date.now() / 60_000)
  try {
    await enqueue(
      'wallet.sync',
      { customerId, reason },
      {
        businessId: options.businessId,
        idempotencyKey: `wallet-sync:${customerId}:${minuteBucket}`,
        ...(options.delaySeconds
          ? { runAfter: new Date(Date.now() + options.delaySeconds * 1_000) }
          : {}),
      }
    )
  } catch (cause) {
    // Never fail the action that changed the balance because we could not queue
    // the notification about it.
    logger.warn('wallet.sync_enqueue_failed', { customer_id: customerId, reason, cause })
  }
}

/**
 * Performs one queued sync, and records what each vendor did with it.
 *
 * The behaviour this replaces: Apple and Google were pushed concurrently, either
 * one could fail, and the failure became a log line. A customer whose Google
 * pass did not update kept a stale balance until something else happened to
 * trigger another sync — which for a quiet customer could be weeks. Neither the
 * merchant nor we could see it.
 *
 * Now a partial failure is a *state*: the succeeding vendor is recorded synced,
 * the failing one stale with its error, and only the failing one is re-queued,
 * with backoff. The request that caused the sync still completes normally —
 * pushing a card is background work and must never fail a check-in at the
 * counter.
 */
export async function performWalletSync(
  customerId: string,
  reason: SyncReason = 'balance_change',
  options: { providers?: WalletProviderId[] } = {}
): Promise<{ apple: number; google: number; skipped: boolean; degraded: boolean }> {
  const result = await walletService().sync(customerId, { reason, providers: options.providers })

  if (result.skipped || result.attempts.length === 0 || !result.businessId) {
    return { apple: result.apple, google: result.google, skipped: result.skipped, degraded: false }
  }

  const previous = await loadSyncState(customerId)
  const plan = planSync(result.attempts, previous)

  await persistSyncState(result.businessId, customerId, plan.states)

  for (const retry of plan.retry) {
    await enqueue(
      'wallet.sync_retry',
      { customerId, reason, providers: [retry.provider] },
      {
        businessId: result.businessId,
        runAfter: new Date(Date.now() + retry.delaySeconds * 1_000),
        /*
         * Keyed by provider and attempt rather than by minute: a retry is a
         * distinct piece of work from the sync that produced it, and bucketing
         * it with the original would collapse the two into one job that never
         * runs again.
         */
        idempotencyKey: `wallet-sync-retry:${customerId}:${retry.provider}:${
          plan.states.find((state) => state.provider === retry.provider)?.attempts ?? 1
        }`,
      }
    )
  }

  if (plan.degraded) {
    logger.warn('wallet.sync_degraded', {
      customer_id: customerId,
      states: plan.states.map((state) => `${state.provider}:${state.status}`),
    })
  }

  return {
    apple: result.apple,
    google: result.google,
    skipped: false,
    degraded: plan.degraded,
  }
}

/** The stored per-vendor state, for the reducer to fold the new attempt into. */
async function loadSyncState(customerId: string): Promise<ProviderState[]> {
  const admin = getDb()
  const { data } = await admin
    .from('wallet_sync_state')
    .select('provider, status, attempts, last_error')
    .eq('customer_id', customerId)

  return (data ?? []).map((row) => ({
    provider: row.provider as WalletProviderId,
    status: row.status as ProviderState['status'],
    attempts: Number(row.attempts ?? 0),
    lastError: (row.last_error as string) ?? null,
  }))
}

async function persistSyncState(
  businessId: string,
  customerId: string,
  states: ProviderState[]
): Promise<void> {
  if (states.length === 0) return
  const admin = getDb()
  const now = new Date().toISOString()

  const { error } = await admin.from('wallet_sync_state').upsert(
    states.map((state) => ({
      business_id: businessId,
      customer_id: customerId,
      provider: state.provider,
      status: state.status,
      attempts: state.attempts,
      last_error: state.lastError,
      last_synced_at: state.status === 'synced' ? now : undefined,
      last_failed_at: state.status === 'synced' ? undefined : now,
      updated_at: now,
    })),
    { onConflict: 'customer_id,provider' }
  )

  if (error) {
    // Recording that a push failed must not itself fail the caller. The retry is
    // already queued; this only costs us the diagnosis.
    logger.warn('wallet.sync_state_write_failed', { customer_id: customerId, error })
  }
}

/** Vendors currently known to be behind, for support and the admin console. */
export async function staleWalletSyncs(
  businessId: string,
  limit = 100
): Promise<Array<{ customerId: string; provider: WalletProviderId; attempts: number; error: string | null }>> {
  const admin = getDb()
  const { data } = await admin
    .from('wallet_sync_state')
    .select('customer_id, provider, attempts, last_error')
    .eq('business_id', businessId)
    .neq('status', 'synced')
    .order('updated_at', { ascending: false })
    .limit(limit)

  return (data ?? []).map((row) => ({
    customerId: row.customer_id as string,
    provider: row.provider as WalletProviderId,
    attempts: Number(row.attempts ?? 0),
    error: (row.last_error as string) ?? null,
  }))
}

/**
 * Refreshes every installed pass for a business.
 *
 * Used when a merchant changes something that affects all cards — adding a
 * location, applying a template, editing brand colours. Fanned out as one job per
 * customer rather than one long job, so a chain with 20,000 members does not sit in
 * a single worker slot for an hour, and a failure retries one customer instead of
 * all of them.
 *
 * Only customers with an installed pass are enqueued. Most enrolled customers
 * never add the card, and queueing 20,000 no-ops to reach 900 real ones is how a
 * job queue becomes the bottleneck.
 */
export async function scheduleBusinessWalletSync(
  businessId: string,
  reason: SyncReason = 'locations_changed'
): Promise<{ queued: number }> {
  const admin = getDb()

  const [{ data: appleRegs }, { data: googleSaves }] = await Promise.all([
    admin
      .from('wallet_registrations')
      .select('customer_id')
      .eq('business_id', businessId)
      .limit(50_000),
    admin
      .from('customers')
      .select('id')
      .eq('business_id', businessId)
      .not('google_wallet_saved_at', 'is', null)
      .limit(50_000),
  ])

  const customerIds = new Set<string>([
    ...(appleRegs ?? []).map((row) => row.customer_id as string),
    ...(googleSaves ?? []).map((row) => row.id as string),
  ])

  for (const customerId of customerIds) {
    await scheduleWalletSync(customerId, reason, { businessId })
  }

  logger.info('wallet.business_sync_queued', {
    business_id: businessId,
    reason,
    queued: customerIds.size,
  })

  return { queued: customerIds.size }
}
