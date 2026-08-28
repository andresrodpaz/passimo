import { z } from 'zod'
import { defineRoute } from '@/lib/api/handler'
import { verifyToken } from '@/lib/crypto'
import { getDb } from '@/lib/db'
import { suppress } from '@/lib/messaging/dispatch'
import { badRequest } from '@/lib/errors'
import type { Channel } from '@/lib/domain/types'

export const runtime = 'nodejs'

const bodySchema = z.object({
  token: z.string().min(10).max(600),
  /** Omitted = unsubscribe from everything. */
  channel: z.enum(['email', 'sms', 'whatsapp', 'push', 'all']).default('all'),
})

/**
 * Unsubscribe.
 *
 * Legally required, and also the single best protection for deliverability:
 * a person who cannot unsubscribe marks the message as spam instead, which
 * damages the sending domain for every merchant on the platform.
 *
 * Supports POST for the one-click `List-Unsubscribe-Post` header that Gmail and
 * Yahoo require from bulk senders.
 */
export const POST = defineRoute(
  { name: 'public.unsubscribe', auth: 'none', body: bodySchema, rateLimit: 'publicRelaxed' },
  async ({ body }) => {
    const payload = verifyToken<{ c: string; b: string }>('unsubscribe', body.token)
    if (!payload) throw badRequest('This unsubscribe link is invalid or has expired')

    const admin = getDb()
    const { data: customer } = await admin
      .from('customers')
      .select('id, email, phone, business_id')
      .eq('id', payload.c)
      .eq('business_id', payload.b)
      .maybeSingle()

    if (!customer) throw badRequest('This unsubscribe link is no longer valid')

    const patch: Record<string, unknown> = {
      consent_updated_at: new Date().toISOString(),
      consent_source: 'unsubscribe_link',
    }

    const channels: Channel[] =
      body.channel === 'all' ? ['email', 'sms', 'whatsapp', 'push'] : [body.channel as Channel]

    for (const channel of channels) {
      patch[`consent_${channel}`] = false
      const destination =
        channel === 'email' ? (customer.email as string) : (customer.phone as string | null)
      if (destination) {
        await suppress(
          payload.b,
          channel,
          destination,
          'unsubscribed',
          customer.id as string
        )
      }
    }
    if (body.channel === 'all') patch.consent_marketing = false

    await admin.from('customers').update(patch).eq('id', customer.id)

    return { unsubscribed: true, channel: body.channel }
  }
)

const querySchema = z.object({ token: z.string().min(10).max(600) })

/** Shows who the customer is unsubscribing from before they confirm. */
export const GET = defineRoute(
  { name: 'public.unsubscribe_info', auth: 'none', query: querySchema, rateLimit: 'publicRelaxed' },
  async ({ query }) => {
    const payload = verifyToken<{ c: string; b: string }>('unsubscribe', query.token)
    if (!payload) throw badRequest('This unsubscribe link is invalid or has expired')

    const admin = getDb()
    const [{ data: business }, { data: customer }] = await Promise.all([
      admin.from('businesses').select('name, logo_url').eq('id', payload.b).maybeSingle(),
      admin
        .from('customers')
        .select('email, consent_email, consent_sms, consent_whatsapp, consent_push')
        .eq('id', payload.c)
        .maybeSingle(),
    ])

    if (!business || !customer) throw badRequest('This unsubscribe link is no longer valid')

    return {
      business,
      email: customer.email,
      consents: {
        email: customer.consent_email,
        sms: customer.consent_sms,
        whatsapp: customer.consent_whatsapp,
        push: customer.consent_push,
      },
    }
  }
)
