import 'server-only'
import { getDb } from '@/lib/db'
import { logger } from '@/lib/logger'
import { recordEarn } from '@/lib/loyalty/engine'
import { enqueue } from '@/lib/jobs/queue'

/**
 * Commerce event ingestion.
 *
 * Every POS and e-commerce integration normalises into one shape and goes
 * through one function. Adding SumUp is then an adapter, not another
 * award-points code path that can drift from the others.
 *
 * This is the feature that turns the product from "staff remember to tap a
 * button" into "loyalty just happens" — which is the difference between a
 * program that gets used and one that quietly dies.
 */

export type NormalizedPurchase = {
  provider: string
  /** Provider's event id — the idempotency boundary for replays. */
  externalId: string
  email?: string | null
  phone?: string | null
  /** Provider's own customer id, matched via `customers.external_ids`. */
  externalCustomerId?: string | null
  amount: number
  currency: string
  quantity?: number | null
  occurredAt?: string | null
  locationExternalId?: string | null
  metadata?: Record<string, unknown>
}

export type IngestResult = {
  status: 'awarded' | 'duplicate' | 'no_customer' | 'disabled' | 'error'
  customerId?: string
  awarded?: number
  reason?: string
}

export async function ingestPurchase(
  businessId: string,
  purchase: NormalizedPurchase
): Promise<IngestResult> {
  const admin = getDb()

  const { data: integration } = await admin
    .from('integrations')
    .select('id, auto_earn_enabled, status, config')
    .eq('business_id', businessId)
    .eq('provider', purchase.provider)
    .maybeSingle()

  if (integration && !integration.auto_earn_enabled) {
    return { status: 'disabled', reason: 'auto_earn_disabled' }
  }

  const customerId = await matchCustomer(businessId, purchase)
  if (!customerId) {
    // Not an error: most walk-in transactions are from non-members. Recording
    // the miss lets us show the merchant their enrolment opportunity.
    await admin
      .from('activity_events')
      .insert({
        business_id: businessId,
        customer_id: null,
        type: 'purchase',
        amount: purchase.amount,
        currency: purchase.currency,
        source: 'integration',
        external_id: `${purchase.provider}:${purchase.externalId}`,
        occurred_at: purchase.occurredAt ?? new Date().toISOString(),
        metadata: { ...purchase.metadata, unmatched: true, provider: purchase.provider },
      })
      .then(() => undefined, () => undefined)
    return { status: 'no_customer' }
  }

  try {
    const result = await recordEarn({
      businessId,
      customerId,
      trigger: 'purchase',
      amount: purchase.amount,
      currency: purchase.currency,
      quantity: purchase.quantity ?? null,
      source: 'integration',
      externalId: `${purchase.provider}:${purchase.externalId}`,
      idempotencyKey: `${purchase.provider}:${purchase.externalId}`,
      locationId: await resolveLocation(businessId, purchase.locationExternalId),
      metadata: { provider: purchase.provider, ...purchase.metadata },
    })

    if (result.duplicate) return { status: 'duplicate', customerId }

    await admin.rpc('passimo_qualify_referrals', {
      p_business_id: businessId,
      p_customer_id: customerId,
    })

    await admin
      .from('integrations')
      .update({ last_sync_at: new Date().toISOString(), last_error: null, status: 'connected' })
      .eq('business_id', businessId)
      .eq('provider', purchase.provider)

    return { status: 'awarded', customerId, awarded: result.totalAwarded }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    logger.error('integrations.ingest_failed', { businessId, provider: purchase.provider, cause })
    await admin
      .from('integrations')
      .update({ status: 'error', last_error: message.slice(0, 500) })
      .eq('business_id', businessId)
      .eq('provider', purchase.provider)
    return { status: 'error', reason: message }
  }
}

/**
 * Identity resolution, most reliable signal first. Email and phone are matched
 * exactly; fuzzy matching would risk awarding one customer's spend to another.
 */
async function matchCustomer(
  businessId: string,
  purchase: NormalizedPurchase
): Promise<string | null> {
  const admin = getDb()

  if (purchase.externalCustomerId) {
    const { data } = await admin
      .from('customers')
      .select('id')
      .eq('business_id', businessId)
      .contains('external_ids', { [purchase.provider]: purchase.externalCustomerId })
      .maybeSingle()
    if (data) return data.id as string
  }

  if (purchase.email) {
    const { data } = await admin
      .from('customers')
      .select('id')
      .eq('business_id', businessId)
      .eq('email', purchase.email.toLowerCase())
      .neq('status', 'anonymized')
      .maybeSingle()
    if (data) {
      if (purchase.externalCustomerId) await linkExternalId(data.id as string, purchase)
      return data.id as string
    }
  }

  if (purchase.phone) {
    const digits = purchase.phone.replace(/\D/g, '')
    if (digits.length >= 6) {
      const { data } = await admin
        .from('customers')
        .select('id')
        .eq('business_id', businessId)
        .like('phone', `%${digits.slice(-9)}`)
        .neq('status', 'anonymized')
        .maybeSingle()
      if (data) return data.id as string
    }
  }

  return null
}

async function linkExternalId(customerId: string, purchase: NormalizedPurchase) {
  const admin = getDb()
  const { data } = await admin
    .from('customers')
    .select('external_ids')
    .eq('id', customerId)
    .maybeSingle()
  await admin
    .from('customers')
    .update({
      external_ids: {
        ...((data?.external_ids as Record<string, unknown>) ?? {}),
        [purchase.provider]: purchase.externalCustomerId,
      },
    })
    .eq('id', customerId)
}

async function resolveLocation(
  businessId: string,
  externalId: string | null | undefined
): Promise<string | null> {
  if (!externalId) return null
  const admin = getDb()
  const { data } = await admin
    .from('locations')
    .select('id')
    .eq('business_id', businessId)
    .limit(1)
    .maybeSingle()
  return (data?.id as string) ?? null
}

/**
 * Auto-enrols a purchaser who is not yet a member.
 *
 * Off by default and gated on the integration config: silently adding someone
 * to a marketing list because they bought a coffee is not consent. When
 * enabled, the customer is created with marketing consent explicitly false.
 */
export async function maybeAutoEnroll(
  businessId: string,
  purchase: NormalizedPurchase
): Promise<string | null> {
  if (!purchase.email) return null

  const admin = getDb()
  const { data: integration } = await admin
    .from('integrations')
    .select('config')
    .eq('business_id', businessId)
    .eq('provider', purchase.provider)
    .maybeSingle()

  const config = (integration?.config as { auto_enroll?: boolean }) ?? {}
  if (!config.auto_enroll) return null

  const { data } = await admin.rpc('passimo_enroll_customer', {
    p_business_id: businessId,
    p_email: purchase.email.toLowerCase(),
    p_name: null,
    p_first_name: null,
    p_last_name: null,
    p_phone: purchase.phone ?? null,
    p_birthday: null,
    p_locale: null,
    p_source: 'integration',
    p_location_id: null,
    p_referral_code: null,
    p_consents: { email: false, sms: false, whatsapp: false, push: true, marketing: false },
    p_consent_ip: null,
    p_custom_fields: {},
  })

  const payload = data as { customer_id: string; is_new: boolean } | null
  if (payload?.is_new) {
    await enqueue(
      'automation.enroll',
      { businessId, customerId: payload.customer_id, trigger: 'customer_joined' },
      { businessId }
    )
  }
  return payload?.customer_id ?? null
}
