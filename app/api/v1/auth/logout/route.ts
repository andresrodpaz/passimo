import { defineRoute } from '@/lib/api/handler'
import { destroySession } from '@/lib/auth/session'

export const runtime = 'nodejs'

/**
 * Signs the current session out.
 *
 * `auth: 'optional'` deliberately: signing out must succeed even when the
 * session has already expired or been revoked elsewhere, because the thing the
 * user is asking for — "make this browser not signed in" — is exactly what
 * clearing the cookie does. Returning 401 here would leave a stale cookie in
 * place and a user who cannot get rid of it.
 */
export const POST = defineRoute(
  { name: 'auth.logout', auth: 'optional', rateLimit: 'dashboard' },
  async () => {
    await destroySession()
    return { ok: true }
  }
)
