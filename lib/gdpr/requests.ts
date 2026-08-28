import 'server-only'
import { getDb } from '@/lib/db'
import { logger } from '@/lib/logger'
import { sendTransactionalEmail } from '@/lib/messaging/transactional'
import { storage, storageKeys } from '@/lib/storage'

/**
 * GDPR data subject requests (art. 15 access, art. 17 erasure).
 *
 * Both flows are email-verified before anything happens: without verification,
 * an open endpoint that erases a customer by email address is a denial-of-
 * service weapon against the merchant. Erasure anonymises rather than deletes
 * so aggregate revenue history stays correct while all personal data is gone.
 */

export type RequestResult = { status: string; requestId: string }

/**
 * Seven days. Long enough that a subject who requested their data on a Friday
 * can still read it the following weekend; short enough that the link in their
 * mailbox is not a permanent copy of their record. It is also the ceiling SigV4
 * allows on a presigned URL, so the two limits coincide rather than one silently
 * truncating the other.
 */
const EXPORT_LINK_TTL_SECONDS = 7 * 86_400

export async function exportCustomerData(requestId: string): Promise<RequestResult> {
  const admin = getDb()
  const { data: request } = await admin
    .from('data_requests')
    .select('*')
    .eq('id', requestId)
    .maybeSingle()

  if (!request) return { status: 'missing', requestId }
  if (request.status !== 'verified') return { status: 'not_verified', requestId }

  const customerId = request.customer_id as string | null
  if (!customerId) {
    await admin
      .from('data_requests')
      .update({ status: 'rejected', completed_at: new Date().toISOString() })
      .eq('id', requestId)
    return { status: 'no_customer', requestId }
  }

  const [customer, events, ledger, redemptions, messages, notes, surveys] = await Promise.all([
    admin.from('customers').select('*').eq('id', customerId).maybeSingle(),
    admin
      .from('activity_events')
      .select('type, amount, currency, occurred_at, source')
      .eq('customer_id', customerId)
      .order('occurred_at', { ascending: false })
      .limit(5000),
    admin
      .from('loyalty_ledger')
      .select('entry_type, amount, balance_after, reason, created_at')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(5000),
    admin
      .from('reward_redemptions')
      .select('code, cost, status, created_at')
      .eq('customer_id', customerId),
    admin
      .from('messages')
      .select('channel, subject, status, sent_at')
      .eq('customer_id', customerId)
      .limit(1000),
    admin.from('customer_notes').select('body, created_at').eq('customer_id', customerId),
    admin
      .from('survey_responses')
      .select('score, scale_max, comment, responded_at')
      .eq('customer_id', customerId),
  ])

  const record = customer.data as Record<string, unknown> | null
  if (!record) return { status: 'customer_missing', requestId }

  // Never re-export internal identifiers or push credentials: an export
  // bundle is emailed to the subject and must not leak device tokens.
  const safeProfile = { ...record }
  for (const secret of ['apple_push_token', 'wallet_auth_token', 'web_push_subscription']) {
    delete safeProfile[secret]
  }

  const bundle = {
    exported_at: new Date().toISOString(),
    profile: safeProfile,
    activity: events.data ?? [],
    loyalty_ledger: ledger.data ?? [],
    rewards: redemptions.data ?? [],
    messages: messages.data ?? [],
    notes: notes.data ?? [],
    survey_responses: surveys.data ?? [],
  }

  const key = storageKeys.gdprExport(request.business_id as string, requestId)

  let downloadUrl: string | null = null
  try {
    await storage().put({
      key,
      body: Buffer.from(JSON.stringify(bundle, null, 2)),
      contentType: 'application/json',
      // Never public: this is one person's entire record.
      public: false,
    })

    // Time-limited link rather than a public object. The bundle is delivered by
    // email, so the link will sit in a mailbox — it has to stop working.
    const signed = await storage().signedUrl(key, EXPORT_LINK_TTL_SECONDS)
    downloadUrl = signed.url
  } catch (error) {
    logger.error('gdpr.export_upload_failed', {
      requestId,
      driver: storage().name,
      error: (error as Error).message,
    })
    return { status: 'upload_failed', requestId }
  }

  await admin
    .from('data_requests')
    .update({
      status: 'completed',
      result_url: downloadUrl,
      completed_at: new Date().toISOString(),
    })
    .eq('id', requestId)

  if (downloadUrl) {
    await sendTransactionalEmail({
      to: request.email as string,
      businessId: request.business_id as string,
      subject: 'Your data export is ready',
      body:
        'Your data export is ready. The download link below is valid for 7 days, ' +
        'after which the file is deleted automatically.',
      ctaLabel: 'Download your data',
      ctaUrl: downloadUrl,
    })
  }

  return { status: 'completed', requestId }
}

export async function eraseCustomerData(requestId: string): Promise<RequestResult> {
  const admin = getDb()
  const { data: request } = await admin
    .from('data_requests')
    .select('*')
    .eq('id', requestId)
    .maybeSingle()

  if (!request) return { status: 'missing', requestId }
  if (request.status !== 'verified') return { status: 'not_verified', requestId }

  const customerId = request.customer_id as string | null
  if (customerId) {
    const { error } = await admin.rpc('passimo_anonymize_customer', {
      p_business_id: request.business_id,
      p_customer_id: customerId,
    })
    if (error) {
      logger.error('gdpr.erase_failed', { requestId, error })
      return { status: 'failed', requestId }
    }
  }

  await admin
    .from('data_requests')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', requestId)

  await sendTransactionalEmail({
    to: request.email as string,
    businessId: request.business_id as string,
    subject: 'Your data has been erased',
    body:
      'Your personal data has been erased. Aggregate, anonymous statistics may be ' +
      'retained as permitted under GDPR art. 17(3).',
  })

  return { status: 'completed', requestId }
}
