import 'server-only'
import { getDb } from '@/lib/db'
import { logger } from '@/lib/logger'

/**
 * In-app notifications for the merchant's team.
 *
 * One writer, so "who on the team should see this?" is decided once. Every
 * caller states *what happened*; this decides *who hears about it*, which is
 * the part that is easy to get subtly wrong (notifying viewers about billing,
 * or notifying nobody because a business has one owner and no members).
 *
 * Never throws. A notification is a courtesy on top of an action that has
 * already succeeded; failing the action because the courtesy failed is
 * backwards.
 */

export type NotificationKind =
  | 'automation'
  | 'billing'
  | 'campaign'
  | 'insight'
  | 'customer'
  | 'partnership'
  | 'membership'
  | 'gift_card'
  | 'review'
  | 'system'

export type NotificationSeverity = 'info' | 'success' | 'warning' | 'critical'

export type NotificationInput = {
  type: NotificationKind
  title: string
  body?: string | null
  url?: string | null
  severity?: NotificationSeverity
  /**
   * Which roles should receive it. Defaults to the decision-makers; a barista
   * does not need to know the card on file expired.
   */
  roles?: readonly string[]
  /** Send to exactly one user instead of a role fan-out. */
  userId?: string | null
}

const DEFAULT_ROLES = ['owner', 'admin', 'manager'] as const

/** Notifications only the people who can act on them should see. */
const ROLES_BY_KIND: Partial<Record<NotificationKind, readonly string[]>> = {
  billing: ['owner', 'admin'],
  partnership: ['owner', 'admin'],
  membership: ['owner', 'admin', 'manager'],
  review: ['owner', 'admin', 'manager'],
}

export async function notify(
  businessId: string,
  input: NotificationInput
): Promise<number> {
  try {
    const admin = getDb()

    const recipients: string[] = []
    if (input.userId) {
      recipients.push(input.userId)
    } else {
      const roles = input.roles ?? ROLES_BY_KIND[input.type] ?? DEFAULT_ROLES
      const { data: members } = await admin
        .from('team_members')
        .select('user_id')
        .eq('business_id', businessId)
        .eq('status', 'active')
        .in('role', [...roles])

      for (const member of members ?? []) {
        if (member.user_id) recipients.push(member.user_id as string)
      }
    }

    if (recipients.length === 0) return 0

    const { error } = await admin.from('notifications').insert(
      recipients.map((userId) => ({
        business_id: businessId,
        user_id: userId,
        kind: input.type,
        title: input.title,
        body: input.body ?? null,
        url: input.url ?? null,
        severity: input.severity ?? 'info',
      }))
    )

    if (error) {
      logger.warn('notifications.insert_failed', { business_id: businessId, error })
      return 0
    }
    return recipients.length
  } catch (cause) {
    logger.warn('notifications.failed', { business_id: businessId, cause })
    return 0
  }
}

export async function markNotificationsRead(
  businessId: string,
  userId: string,
  ids?: string[]
): Promise<number> {
  const admin = getDb()
  let request = admin
    .from('notifications')
    .update({ read_at: new Date().toISOString() }, { count: 'exact' })
    .eq('business_id', businessId)
    .eq('user_id', userId)
    .is('read_at', null)

  if (ids?.length) request = request.in('id', ids)

  const { count } = await request
  return count ?? 0
}
