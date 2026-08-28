import { z } from 'zod'
import { defineRoute } from '@/lib/api/handler'
import { updateCustomerSchema } from '@/lib/api/schemas'
import { getCustomerProfile } from '@/lib/customers/service'
import { getCustomerLoyalty } from '@/lib/loyalty/engine'
import { getDb } from '@/lib/db'
import { recordAudit } from '@/lib/audit'
import { unprocessable } from '@/lib/errors'
import { scheduleWalletSync } from '@/lib/wallet/sync'

export const runtime = 'nodejs'

const paramsSchema = z.object({ id: z.string().uuid() })
const businessQuery = z.object({ businessId: z.string().uuid() })

export const GET = defineRoute(
  {
    name: 'customers.get',
    auth: 'required',
    params: paramsSchema,
    query: businessQuery,
    businessIdFrom: { source: 'query', key: 'businessId' },
    permissions: ['customers:read'],
    rateLimit: 'dashboard',
  },
  async ({ params, business }) => {
    const [profile, loyalty] = await Promise.all([
      getCustomerProfile(business.businessId, params.id),
      getCustomerLoyalty(business.businessId, params.id),
    ])
    return { ...profile, loyalty }
  }
)

export const PATCH = defineRoute(
  {
    name: 'customers.update',
    auth: 'required',
    params: paramsSchema,
    body: updateCustomerSchema,
    businessIdFrom: { source: 'body', key: 'businessId' },
    permissions: ['customers:write'],
    rateLimit: 'dashboard',
  },
  async ({ params, body, actor, business, request }) => {
    const admin = getDb()

    const patch: Record<string, unknown> = {}
    if (body.name !== undefined) patch.name = body.name
    if (body.firstName !== undefined) patch.first_name = body.firstName
    if (body.lastName !== undefined) patch.last_name = body.lastName
    if (body.phone !== undefined) patch.phone = body.phone
    if (body.birthday !== undefined) patch.birthday = body.birthday
    if (body.anniversary !== undefined) patch.anniversary = body.anniversary
    if (body.locale !== undefined) patch.locale = body.locale
    if (body.isVip !== undefined) patch.is_vip = body.isVip
    if (body.status !== undefined) patch.status = body.status

    if (body.consents) {
      // Consent changes are timestamped and attributed — this is the record an
      // auditor asks for, and it is worthless without the "when" and "who".
      if (body.consents.email !== undefined) patch.consent_email = body.consents.email
      if (body.consents.sms !== undefined) patch.consent_sms = body.consents.sms
      if (body.consents.whatsapp !== undefined) patch.consent_whatsapp = body.consents.whatsapp
      if (body.consents.push !== undefined) patch.consent_push = body.consents.push
      if (body.consents.marketing !== undefined) patch.consent_marketing = body.consents.marketing
      patch.consent_updated_at = new Date().toISOString()
      patch.consent_source = 'staff'
    }

    if (Object.keys(patch).length === 0) throw unprocessable('Nothing to update')

    const { error } = await admin
      .from('customers')
      .update(patch)
      .eq('id', params.id)
      .eq('business_id', business.businessId)

    if (error) throw unprocessable(error.message)

    await recordAudit({
      businessId: business.businessId,
      actor,
      action: 'customer.updated',
      resourceType: 'customer',
      resourceId: params.id,
      summary: `Updated ${Object.keys(patch).join(', ')}`,
      request,
    })

    await scheduleWalletSync(params.id, 'manual', { businessId: business.businessId })

    return { ok: true }
  }
)

/**
 * Erasure, not deletion. The customer's personal data is destroyed while the
 * business keeps correct aggregate revenue history — which is exactly what
 * GDPR art. 17(3) permits and what merchants need for their accounts.
 */
export const DELETE = defineRoute(
  {
    name: 'customers.delete',
    auth: 'required',
    params: paramsSchema,
    query: businessQuery,
    businessIdFrom: { source: 'query', key: 'businessId' },
    permissions: ['customers:delete'],
    rateLimit: 'dashboard',
  },
  async ({ params, actor, business, request }) => {
    const admin = getDb()
    const { error } = await admin.rpc('passimo_anonymize_customer', {
      p_business_id: business.businessId,
      p_customer_id: params.id,
    })
    if (error) throw unprocessable(error.message)

    await recordAudit({
      businessId: business.businessId,
      actor,
      action: 'customer.erased',
      resourceType: 'customer',
      resourceId: params.id,
      summary: 'Customer personal data erased',
      request,
    })

    return { ok: true, erased: true }
  }
)
