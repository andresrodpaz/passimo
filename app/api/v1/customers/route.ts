import { defineRoute } from '@/lib/api/handler'
import { createCustomerSchema, listCustomersQuery } from '@/lib/api/schemas'
import { listCustomers } from '@/lib/customers/service'
import { getDb } from '@/lib/db'
import { conflict, unprocessable } from '@/lib/errors'
import { recordAudit } from '@/lib/audit'
import { enqueue } from '@/lib/jobs/queue'
import { requireWithinLimit } from '@/lib/billing/entitlements'
import { placeholderEmailForPhone } from '@/lib/customers/placeholder-email'

export const runtime = 'nodejs'

export const GET = defineRoute(
  {
    name: 'customers.list',
    auth: 'required',
    query: listCustomersQuery,
    businessIdFrom: { source: 'query', key: 'businessId' },
    permissions: ['customers:read'],
    rateLimit: 'dashboard',
  },
  async ({ query }) => {
    const { customers, total } = await listCustomers({
      businessId: query.businessId,
      q: query.q,
      segmentId: query.segmentId,
      tag: query.tag,
      vip: query.vip === undefined ? undefined : query.vip === 'true',
      rfm: query.rfm,
      sort: query.sort,
      limit: query.limit,
      offset: query.offset,
    })

    return {
      customers,
      pagination: {
        total,
        limit: query.limit,
        offset: query.offset,
        has_more: query.offset + customers.length < total,
      },
    }
  }
)

/** Staff adding someone at the counter who does not want to scan a QR code. */
export const POST = defineRoute(
  {
    name: 'customers.create',
    auth: 'required',
    body: createCustomerSchema,
    businessIdFrom: { source: 'body', key: 'businessId' },
    permissions: ['customers:write'],
    rateLimit: 'dashboard',
  },
  async ({ body, actor, business, request }) => {
    // Checked before the insert so the merchant sees a plan prompt rather than
    // a half-created record. Enrolment through the public QR is deliberately
    // *not* gated the same way — see `public.join`.
    await requireWithinLimit(business.businessId, 'customers')

    const admin = getDb()
    const email =
      body.email ?? placeholderEmailForPhone(body.phone!)

    const { data, error } = await admin.rpc('passimo_enroll_customer', {
      p_business_id: business.businessId,
      p_email: email,
      p_name: body.name ?? null,
      p_first_name: body.firstName ?? null,
      p_last_name: body.lastName ?? null,
      p_phone: body.phone ?? null,
      p_birthday: body.birthday ?? null,
      p_locale: body.locale ?? null,
      p_source: 'manual',
      p_location_id: null,
      p_referral_code: null,
      p_consents: {
        email: body.consents?.email ?? Boolean(body.email),
        sms: body.consents?.sms ?? false,
        whatsapp: body.consents?.whatsapp ?? false,
        push: body.consents?.push ?? true,
        marketing: body.consents?.marketing ?? false,
      },
      p_consent_ip: null,
      p_custom_fields: {},
    })

    if (error) {
      if (error.code === '23505') throw conflict('A customer with that email already exists')
      throw unprocessable(error.message)
    }

    const payload = data as { is_new: boolean; customer_id: string }

    if (body.anniversary || body.isVip) {
      await admin
        .from('customers')
        .update({
          ...(body.anniversary ? { anniversary: body.anniversary } : {}),
          ...(body.isVip !== undefined ? { is_vip: body.isVip } : {}),
        })
        .eq('id', payload.customer_id)
    }

    if (body.tags?.length) {
      for (const name of body.tags) {
        const { data: tag } = await admin
          .from('tags')
          .upsert({ business_id: business.businessId, name }, { onConflict: 'business_id,name' })
          .select('id')
          .maybeSingle()
        if (tag) {
          await admin.from('customer_tags').upsert(
            {
              customer_id: payload.customer_id,
              tag_id: tag.id,
              business_id: business.businessId,
              tagged_by: actor.id,
            },
            { onConflict: 'customer_id,tag_id', ignoreDuplicates: true }
          )
        }
      }
    }

    if (payload.is_new) {
      await Promise.allSettled([
        enqueue(
          'automation.enroll',
          {
            businessId: business.businessId,
            customerId: payload.customer_id,
            trigger: 'customer_joined',
          },
          { businessId: business.businessId }
        ),
        enqueue(
          'webhook.deliver',
          {
            businessId: business.businessId,
            event: 'customer.created',
            data: { customer_id: payload.customer_id, source: 'manual' },
          },
          { businessId: business.businessId }
        ),
        recordAudit({
          businessId: business.businessId,
          actor,
          action: 'customer.created',
          resourceType: 'customer',
          resourceId: payload.customer_id,
          summary: `Added ${email}`,
          request,
        }),
      ])
    }

    return { customer_id: payload.customer_id, is_new: payload.is_new }
  }
)
