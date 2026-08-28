import 'server-only'
import { cookies } from 'next/headers'
import { getDb } from '@/lib/db'
import { randomToken, sha256 } from '@/lib/crypto'
import { env } from '@/lib/env'
import { logger } from '@/lib/logger'
import {
  SESSION_COOKIE,
  decodeSessionToken,
  encodeSessionToken,
  sessionSecret,
} from '@/lib/auth/session-token'

/**
 * Server-side sessions.
 *
 * A session is a row in `user_sessions` plus a signed cookie that carries its
 * secret. Two properties follow from that, and both were requirements:
 *
 *  - **Revocation is real.** Signing out, changing a password, or an
 *    administrator suspending an account all mark rows revoked, and the next
 *    request fails — there is no window during which a stateless token outlives
 *    the decision to end it.
 *  - **Sessions are visible.** A merchant can be told "you are signed in on
 *    three devices" because that is a query, and an operator investigating an
 *    incident can see when and from where.
 *
 * The cost is one indexed lookup per authenticated request against a database
 * the application is already talking to. That is cheaper than the network round
 * trip the previous hosted-auth transport made for the same check.
 */

/** Absolute lifetime. A merchant using the till daily should not be signed out. */
const SESSION_TTL_DAYS = 30

/**
 * Sliding-window refresh. Touching the row (and re-issuing the cookie) at most
 * once a day keeps `last_used_at` useful for the device list without writing on
 * every request.
 */
const REFRESH_AFTER_HOURS = 24

export type SessionUser = {
  id: string
  email: string
  fullName: string | null
  locale: string
  emailVerifiedAt: string | null
}

export type ActiveSession = {
  sessionId: string
  user: SessionUser
  expiresAt: string
}

function cookieOptions(expires: Date) {
  return {
    httpOnly: true,
    /*
     * `secure` only outside development: a secure cookie is silently dropped
     * over plain http, which would make local sign-in fail with no error
     * anywhere. Production is https, so this is not a weakening.
     */
    secure: env.isProduction,
    /*
     * `lax`, not `strict`. Merchants arrive at the dashboard from links in
     * transactional email — a verification link, a reset link, a team
     * invitation — and `strict` would withhold the cookie on those top-level
     * navigations, presenting a signed-in user with a login form.
     */
    sameSite: 'lax' as const,
    path: '/',
    expires,
  }
}

/**
 * Creates a session and writes the cookie.
 *
 * Only the SHA-256 of the session secret is stored, so a database dump cannot be
 * replayed as a set of live logins.
 */
export async function createSession(input: {
  userId: string
  request?: Request
}): Promise<{ token: string; expiresAt: string }> {
  const secret = randomToken(32)
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000)

  const { data, error } = await getDb()
    .from('user_sessions')
    .insert({
      user_id: input.userId,
      token_hash: sha256(secret),
      expires_at: expiresAt.toISOString(),
      ip: clientIp(input.request) ?? null,
      user_agent: input.request?.headers.get('user-agent')?.slice(0, 300) ?? null,
    })
    .select('id')
    .single()

  if (error || !data) throw new Error(error?.message ?? 'Could not create session')

  const token = await encodeSessionToken(sessionSecret(), {
    s: secret,
    u: input.userId,
    e: Math.floor(expiresAt.getTime() / 1000),
  })

  const store = await cookies()
  store.set(SESSION_COOKIE, token, cookieOptions(expiresAt))

  return { token, expiresAt: expiresAt.toISOString() }
}

/**
 * Resolves the session for the current request, or `null`.
 *
 * Signature first (free, and rejects a forged cookie without a query), then the
 * database (authoritative on revocation, expiry and account status).
 */
export async function getSession(): Promise<ActiveSession | null> {
  const store = await cookies()
  const raw = store.get(SESSION_COOKIE)?.value
  return resolveSessionToken(raw)
}

/** Resolves an explicit token. Used for bearer-token clients and for tests. */
export async function resolveSessionToken(
  raw: string | undefined | null
): Promise<ActiveSession | null> {
  const payload = await decodeSessionToken(sessionSecret(), raw)
  if (!payload) return null

  const { data } = await getDb()
    .from('user_sessions')
    .select(
      'id, user_id, expires_at, revoked_at, last_used_at, ' +
        'app_users:user_id (id, email, full_name, locale, status, email_verified_at)'
    )
    .eq('token_hash', sha256(payload.s))
    .maybeSingle()

  if (!data) return null

  const row = data as unknown as {
    id: string
    user_id: string
    expires_at: string
    revoked_at: string | null
    last_used_at: string
    app_users: {
      id: string
      email: string
      full_name: string | null
      locale: string
      status: string
      email_verified_at: string | null
    } | null
  }

  if (row.revoked_at) return null
  if (new Date(row.expires_at).getTime() <= Date.now()) return null

  const user = row.app_users
  if (!user || user.status !== 'active') return null

  await maybeRefresh(row.id, row.last_used_at)

  return {
    sessionId: row.id,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      locale: user.locale ?? 'es',
      emailVerifiedAt: user.email_verified_at,
    },
    expiresAt: row.expires_at,
  }
}

async function maybeRefresh(sessionId: string, lastUsedAt: string): Promise<void> {
  const age = Date.now() - new Date(lastUsedAt).getTime()
  if (age < REFRESH_AFTER_HOURS * 3_600_000) return

  // Fire-and-forget: a failed presence stamp must never fail the request.
  void getDb()
    .from('user_sessions')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', sessionId)
    .then(({ error }) => {
      if (error) logger.warn('auth.session_touch_failed', { error: error.message })
    })
}

/** Ends the current session and clears the cookie. */
export async function destroySession(): Promise<void> {
  const store = await cookies()
  const raw = store.get(SESSION_COOKIE)?.value

  const payload = await decodeSessionToken(sessionSecret(), raw).catch(() => null)
  if (payload) {
    await getDb()
      .from('user_sessions')
      .update({ revoked_at: new Date().toISOString() })
      .eq('token_hash', sha256(payload.s))
      .is('revoked_at', null)
  }

  store.delete(SESSION_COOKIE)
}

/**
 * Revokes every session for a user.
 *
 * Called after a password reset. A reset that left old sessions alive would mean
 * a merchant who resets because they think someone else is in their account has
 * not actually got them out.
 */
export async function revokeAllSessions(userId: string, except?: string): Promise<number> {
  let request = getDb()
    .from('user_sessions')
    .update({ revoked_at: new Date().toISOString() }, { count: 'exact' })
    .eq('user_id', userId)
    .is('revoked_at', null)

  if (except) request = request.neq('id', except)

  const { count } = await request
  return count ?? 0
}

/** Sessions for the device list in settings. */
export async function listSessions(userId: string) {
  const { data } = await getDb()
    .from('user_sessions')
    .select('id, created_at, last_used_at, expires_at, ip, user_agent')
    .eq('user_id', userId)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('last_used_at', { ascending: false })
    .limit(20)
  return data ?? []
}

/** Housekeeping for the daily job. */
export async function purgeExpiredSessions(): Promise<number> {
  const { count } = await getDb()
    .from('user_sessions')
    .delete({ count: 'exact' })
    .lt('expires_at', new Date(Date.now() - 7 * 86_400_000).toISOString())
  return count ?? 0
}

function clientIp(request?: Request): string | null {
  if (!request) return null
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0]?.trim() ?? null
  return request.headers.get('x-real-ip')
}

export { SESSION_COOKIE }
