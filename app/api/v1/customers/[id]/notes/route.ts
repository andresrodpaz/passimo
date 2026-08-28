import { z } from 'zod'
import { defineRoute } from '@/lib/api/handler'
import { getDb } from '@/lib/db'
import { notFound, unprocessable } from '@/lib/errors'

export const runtime = 'nodejs'

const paramsSchema = z.object({ id: z.string().uuid() })
const bodySchema = z.object({
  businessId: z.string().uuid(),
  body: z.string().min(1).max(5000),
  pinned: z.boolean().default(false),
})

/**
 * Staff notes on a customer.
 *
 * Small feature, disproportionate value: "remember the regular's usual" is the
 * thing that makes a local business feel personal, and it is what keeps staff
 * opening the app rather than treating it as a stamp button.
 */
export const POST = defineRoute(
  {
    name: 'customers.add_note',
    auth: 'required',
    params: paramsSchema,
    body: bodySchema,
    businessIdFrom: { source: 'body', key: 'businessId' },
    permissions: ['customers:write'],
    rateLimit: 'dashboard',
  },
  async ({ params, body, actor, business }) => {
    const admin = getDb()

    const { data: customer } = await admin
      .from('customers')
      .select('id')
      .eq('id', params.id)
      .eq('business_id', business.businessId)
      .maybeSingle()
    if (!customer) throw notFound('Customer')

    const { data, error } = await admin
      .from('customer_notes')
      .insert({
        business_id: business.businessId,
        customer_id: params.id,
        author_id: actor.id,
        author_name: actor.email ?? 'Staff',
        body: body.body,
        pinned: body.pinned,
      })
      .select('id')
      .single()

    if (error) throw unprocessable(error.message)
    return { note_id: data.id }
  }
)

const deleteQuery = z.object({
  businessId: z.string().uuid(),
  noteId: z.string().uuid(),
})

export const DELETE = defineRoute(
  {
    name: 'customers.delete_note',
    auth: 'required',
    params: paramsSchema,
    query: deleteQuery,
    businessIdFrom: { source: 'query', key: 'businessId' },
    permissions: ['customers:write'],
    rateLimit: 'dashboard',
  },
  async ({ query, business }) => {
    const admin = getDb()
    await admin
      .from('customer_notes')
      .delete()
      .eq('id', query.noteId)
      .eq('business_id', business.businessId)
    return { ok: true }
  }
)
