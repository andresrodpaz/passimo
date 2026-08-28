import 'server-only'
import { getDb } from '@/lib/db'
import { getSession } from '@/lib/auth/session'
import { forbidden, unauthorized } from '@/lib/errors'
import { logger } from '@/lib/logger'

/**
 * Platform administration.
 *
 * Deliberately its own authorisation axis, not a role. A platform admin is not a
 * very powerful merchant: they are staff of the platform, and conflating the two
 * would mean the tenant permission matrix — which merchants can edit through team
 * management — becomes the thing that guards cross-tenant access.
 *
 * Two rules the implementation enforces:
 *
 *   1. **Membership is stored, never inferred.** No `email.endsWith('@ourdomain')`
 *      check, no environment variable listing addresses at runtime. A row in
 *      `platform_admins` with a granting user and a timestamp, revocable by
 *      deleting it.
 *
 *   2. **Impersonation is recorded before it starts, with a reason, and expires.**
 *      It is the most dangerous capability in the product. An unlogged
 *      impersonation is indistinguishable from a compromise, and a session with no
 *      expiry is a permanent backdoor someone forgot to close.
 */

export type PlatformAdmin = {
  userId: string
  email: string
  displayName: string | null
  scopes: string[]
}

/** Resolves the caller as a platform admin, or throws. */
export async function requirePlatformAdmin(): Promise<PlatformAdmin> {
  const session = await getSession()
  if (!session) throw unauthorized('Sign in to reach the admin console')

  const admin = getDb()
  const { data } = await admin
    .from('platform_admins')
    .select('user_id, email, display_name, scopes')
    .eq('user_id', session.user.id)
    .maybeSingle()

  if (!data) {
    // Logged at warn: a non-admin reaching an admin endpoint is either a bug in our
    // navigation or someone probing, and both are worth seeing.
    logger.warn('admin.access_denied', { user_id: session.user.id, email: session.user.email })
    throw forbidden('This area is restricted to platform administrators')
  }

  // Best-effort presence tracking; never blocks the request.
  void admin
    .from('platform_admins')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('user_id', session.user.id)

  return {
    userId: data.user_id as string,
    email: data.email as string,
    displayName: (data.display_name as string) ?? null,
    scopes: Array.isArray(data.scopes) ? (data.scopes as string[]) : ['*'],
  }
}

/** Non-throwing check, for rendering navigation. */
export async function isPlatformAdmin(): Promise<boolean> {
  try {
    await requirePlatformAdmin()
    return true
  } catch {
    return false
  }
}

const IMPERSONATION_TTL_MINUTES = 60

/**
 * Opens an impersonation session.
 *
 * The reason is mandatory and stored. Requiring an explanation is the cheapest
 * effective control on a capability like this: it converts "I looked at a
 * customer's data" into a sentence someone can audit, and it makes casual use feel
 * like what it is.
 */
export async function startImpersonation(input: {
  admin: PlatformAdmin
  businessId: string
  reason: string
  request?: Request
}): Promise<{ id: string; expiresAt: string }> {
  const client = getDb()
  const expiresAt = new Date(Date.now() + IMPERSONATION_TTL_MINUTES * 60_000).toISOString()

  const { data, error } = await client
    .from('admin_impersonations')
    .insert({
      admin_user_id: input.admin.userId,
      business_id: input.businessId,
      reason: input.reason,
      expires_at: expiresAt,
      ip: input.request?.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      user_agent: input.request?.headers.get('user-agent')?.slice(0, 300) ?? null,
    })
    .select('id')
    .single()

  if (error) throw error

  logger.warn('admin.impersonation_started', {
    admin: input.admin.email,
    business_id: input.businessId,
    reason: input.reason,
  })

  return { id: data.id as string, expiresAt }
}

export async function endImpersonation(id: string, adminUserId: string): Promise<void> {
  const client = getDb()
  await client
    .from('admin_impersonations')
    .update({ ended_at: new Date().toISOString() })
    .eq('id', id)
    .eq('admin_user_id', adminUserId)
    .is('ended_at', null)
}

/**
 * The impersonation grant a request is operating under, if any.
 *
 * Checked against the clock on every use rather than trusted from a cookie, so a
 * session that has run out cannot be resumed by replaying its id.
 */
export async function activeImpersonation(
  adminUserId: string,
  id: string
): Promise<{ businessId: string; expiresAt: string } | null> {
  const client = getDb()
  const { data } = await client
    .from('admin_impersonations')
    .select('business_id, expires_at, ended_at')
    .eq('id', id)
    .eq('admin_user_id', adminUserId)
    .maybeSingle()

  if (!data || data.ended_at) return null
  if (new Date(data.expires_at as string).getTime() <= Date.now()) return null

  return { businessId: data.business_id as string, expiresAt: data.expires_at as string }
}

/**
 * Promotes a user to platform admin.
 *
 * Used by the demo seed and by an existing admin. There is deliberately no
 * self-service path: the first admin is created by whoever can run the seed script
 * or reach the database, which is the correct bootstrap for a capability like this.
 */
export async function grantPlatformAdmin(input: {
  userId: string
  email: string
  displayName?: string | null
  grantedBy?: string | null
}): Promise<void> {
  const client = getDb()
  const { error } = await client.from('platform_admins').upsert(
    {
      user_id: input.userId,
      email: input.email,
      display_name: input.displayName ?? null,
      granted_by: input.grantedBy ?? null,
    },
    { onConflict: 'user_id' }
  )
  if (error) throw error
  logger.warn('admin.granted', { email: input.email, granted_by: input.grantedBy })
}
