import { getDb } from '@/lib/db'
import { env } from '@/lib/env'
import { scheduleWalletSync } from '@/lib/wallet/sync'

/**
 * Called after a customer enrols or their pass data changes.
 *
 * Stamps the pass type id — the value Apple's web service uses to identify which
 * pass a device is asking about — and queues a refresh across both wallets. The
 * refresh is queued rather than awaited because this runs inside enrolment, and
 * nobody scanning a QR code at a counter should wait on APNs.
 */
export async function triggerWalletCardGeneration(customerId: string): Promise<void> {
  const passTypeId = env.apple.passTypeId

  if (passTypeId) {
    const admin = getDb()
    await admin.from('customers').update({ apple_pass_type_id: passTypeId }).eq('id', customerId)
  }

  await scheduleWalletSync(customerId, 'manual')
}
