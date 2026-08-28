import { z } from 'zod'
import { defineRoute } from '@/lib/api/handler'
import { forbidden, unauthorized } from '@/lib/errors'
import { authenticate } from '@/lib/auth/users'
import { createSession } from '@/lib/auth/session'
import { listActorBusinesses } from '@/lib/auth/context'
import { MAX_PASSWORD_LENGTH } from '@/lib/auth/password'

export const runtime = 'nodejs'

const bodySchema = z.object({
  email: z.string().email().max(320),
  /*
   * No minimum here even though registration enforces one. A sign-in attempt
   * with a short password is a wrong password, and rejecting it with a
   * validation error would tell an attacker that no account uses a short one.
   */
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
})

/**
 * Signs a merchant in and establishes the session cookie.
 *
 * Rate limited on the `authSignIn` bucket (per IP) on top of the per-account
 * lockout in `authenticate`, so an attacker has to defeat both a network-level
 * and an account-level control. The per-IP number is the looser of the two by
 * design: a whole shop signs in from one address, while the account lockout is
 * what actually bounds guessing at five attempts per account per fifteen minutes.
 */
export const POST = defineRoute(
  { name: 'auth.login', auth: 'none', body: bodySchema, rateLimit: 'authSignIn' },
  async ({ body, request, log }) => {
    const outcome = await authenticate(body.email, body.password)

    if (!outcome.ok) {
      log.warn('auth.login_failed', { reason: outcome.reason })

      if (outcome.reason === 'suspended') {
        throw forbidden('This account has been suspended. Contact support to restore access.')
      }
      if (outcome.reason === 'locked') {
        throw unauthorized(
          'Too many failed attempts. Your account is locked for 15 minutes — ' +
            'reset your password to sign in immediately.'
        )
      }
      // One message for both "no such account" and "wrong password".
      throw unauthorized('That email and password combination is not correct.')
    }

    await createSession({ userId: outcome.user.id, request })

    /*
     * The workspace list rides along on the sign-in response so the client can
     * route straight to the dashboard, or to onboarding when the account has no
     * business yet, without a second round trip on the slowest screen transition
     * in the product.
     */
    const businesses = await listActorBusinesses({
      kind: 'user',
      id: outcome.user.id,
      email: outcome.user.email,
      scopedBusinessId: null,
      apiKeyId: null,
    })

    return {
      user: {
        id: outcome.user.id,
        email: outcome.user.email,
        full_name: outcome.user.fullName,
        locale: outcome.user.locale,
        email_verified: Boolean(outcome.user.emailVerifiedAt),
      },
      businesses: businesses.map((business) => ({
        id: business.id,
        slug: business.slug,
        name: business.name,
        role: business.role,
      })),
    }
  }
)
