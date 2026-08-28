import { z } from 'zod'
import { defineRoute } from '@/lib/api/handler'
import { unprocessable } from '@/lib/errors'
import { consumeToken, setPassword, markEmailVerified, findUserById } from '@/lib/auth/users'
import { createSession, revokeAllSessions } from '@/lib/auth/session'
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '@/lib/auth/password'

export const runtime = 'nodejs'

const bodySchema = z.object({
  token: z.string().min(20).max(200),
  // NIST 800-63B: length, not composition rules.
  password: z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH),
})

/**
 * Completes a password reset.
 *
 * Three things happen together, and all three are required for the reset to
 * actually mean anything:
 *
 *   1. The password changes.
 *   2. **Every other session is revoked.** A merchant resetting because they
 *      believe someone else is in their account has not achieved anything if
 *      that someone else stays signed in.
 *   3. The address is marked verified. Receiving mail at it is the same proof
 *      the verification link asks for, so making them click a second link would
 *      be friction for no security gain.
 *
 * Then a fresh session is created, so the merchant lands signed in rather than
 * back at the login form with a password they just typed twice.
 */
export const POST = defineRoute(
  { name: 'auth.password.reset', auth: 'none', body: bodySchema, rateLimit: 'auth' },
  async ({ body, request, log }) => {
    const consumed = await consumeToken('password_reset', body.token)
    if (!consumed) {
      throw unprocessable(
        'This reset link is no longer valid. Request a new one — links expire after an hour ' +
          'and can only be used once.'
      )
    }

    const user = await findUserById(consumed.userId)
    if (!user || user.status !== 'active') {
      throw unprocessable('This account is no longer active.')
    }

    await setPassword(consumed.userId, body.password)
    const revoked = await revokeAllSessions(consumed.userId)
    await markEmailVerified(consumed.userId)
    await createSession({ userId: consumed.userId, request })

    log.warn('auth.password_reset_completed', { user_id: consumed.userId, revoked_sessions: revoked })

    return {
      ok: true,
      user: { id: user.id, email: user.email },
      revoked_sessions: revoked,
    }
  }
)
