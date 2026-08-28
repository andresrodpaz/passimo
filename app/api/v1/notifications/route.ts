import { z } from 'zod'
import { defineRoute } from '@/lib/api/handler'
import { getDb } from '@/lib/db'
import { unauthorized } from '@/lib/errors'
import { markNotificationsRead } from '@/lib/notifications'

export const runtime = 'nodejs'

const listQuery = z.object({
  businessId: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
})

/**
 * The notification feed for the signed-in user.
 *
 * Scoped to the *user*, not the business: a manager and an owner in the same
 * workspace see different things, because they were told different things.
 */
export const GET = defineRoute(
  {
    name: 'notifications.list',
    auth: 'required',
    query: listQuery,
    businessIdFrom: { source: 'query', key: 'businessId' },
    rateLimit: 'dashboard',
  },
  async ({ query, actor, business }) => {
    if (!actor.id) throw unauthorized()

    const admin = getDb()
    const { data } = await admin
      .from('notifications')
      .select('id, kind, title, body, url, severity, read_at, created_at')
      .eq('business_id', business.businessId)
      .eq('user_id', actor.id)
      .order('created_at', { ascending: false })
      .limit(query.limit)

    const notifications = data ?? []
    return {
      notifications,
      unread: notifications.filter((row) => !row.read_at).length,
    }
  }
)

const readSchema = z.object({
  businessId: z.string().uuid(),
  /** Omit to mark everything read — the "clear the badge" action. */
  ids: z.array(z.string().uuid()).max(50).optional(),
})

export const POST = defineRoute(
  {
    name: 'notifications.read',
    auth: 'required',
    body: readSchema,
    businessIdFrom: { source: 'body', key: 'businessId' },
    rateLimit: 'dashboard',
  },
  async ({ body, actor, business }) => {
    if (!actor.id) throw unauthorized()
    const marked = await markNotificationsRead(business.businessId, actor.id, body.ids)
    return { marked }
  }
)
