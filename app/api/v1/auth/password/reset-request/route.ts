import { z } from 'zod'
import { defineRoute } from '@/lib/api/handler'
import { findUserByEmail, issueToken } from '@/lib/auth/users'
import { sendTransactionalEmail } from '@/lib/messaging/transactional'
import { env } from '@/lib/env'
import { emailProvider } from '@/lib/messaging/providers'
import { createTranslator } from '@/lib/i18n/translate'

export const runtime = 'nodejs'

const bodySchema = z.object({
  email: z.string().email().max(320),
  locale: z.enum(['es', 'en']).optional(),
})

/**
 * Starts a password reset.
 *
 * Always reports success. Reporting "no account with that email" would turn this
 * endpoint into a membership oracle for every address an attacker cares to try,
 * and the merchant who mistyped their own address learns the same thing from the
 * email never arriving.
 *
 * The link is single-use and expires in an hour (see `issueToken`), and consuming
 * it revokes every existing session for the account.
 */
export const POST = defineRoute(
  { name: 'auth.password.reset_request', auth: 'none', body: bodySchema, rateLimit: 'auth' },
  async ({ body, log }) => {
    const t = createTranslator(body.locale ?? 'es')
    const user = await findUserByEmail(body.email)

    if (!user || user.status !== 'active') {
      log.info('auth.reset_requested_unknown_email')
      return { ok: true, email_configured: emailProvider.isConfigured() }
    }

    const { token } = await issueToken({ userId: user.id, purpose: 'password_reset' })
    const url = `${env.appUrl}/reset-password?token=${encodeURIComponent(token)}`

    const result = await sendTransactionalEmail({
      to: user.email,
      subject: t('auth.emails.passwordReset.subject'),
      body: t('auth.emails.passwordReset.body'),
      ctaLabel: t('auth.emails.passwordReset.cta'),
      ctaUrl: url,
    })

    /*
     * Outside production the link is logged, because a developer with no Resend
     * key otherwise has no way to complete the flow and would be tempted to add
     * a "return the token in the response" shortcut that then ships. It is never
     * logged in production and never returned to the client in any environment.
     */
    if (!env.isProduction) {
      log.info('auth.reset_link_development_only', { url })
    }

    log.info('auth.reset_email_sent', { delivered: result.ok })

    return {
      ok: true,
      /*
       * Whether email is configured *on this deployment* is not a secret, and the
       * client uses it to say "check your inbox" versus "email delivery is not
       * set up on this environment". It discloses nothing about the address.
       */
      email_configured: emailProvider.isConfigured(),
    }
  }
)
