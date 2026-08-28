import { z } from 'zod'
import { defineRoute } from '@/lib/api/handler'
import { unprocessable } from '@/lib/errors'
import {
  consumeToken,
  findUserById,
  issueToken,
  markEmailVerified,
} from '@/lib/auth/users'
import { sendTransactionalEmail } from '@/lib/messaging/transactional'
import { emailProvider } from '@/lib/messaging/providers'
import { env } from '@/lib/env'
import { createTranslator } from '@/lib/i18n/translate'

export const runtime = 'nodejs'

const confirmSchema = z.object({ token: z.string().min(20).max(200) })

/**
 * Confirms an email address.
 *
 * Verification is deliberately **not** a gate on using the product. A merchant
 * who signs up at 9pm to set up a loyalty card before opening tomorrow should
 * reach their dashboard immediately; blocking them behind an inbox round trip is
 * the single most reliable way to lose them. What verification gates is the
 * things that need a real address to be safe or useful: outbound marketing from
 * the account, billing notices, and password recovery.
 */
export const POST = defineRoute(
  { name: 'auth.verify_email', auth: 'none', body: confirmSchema, rateLimit: 'auth' },
  async ({ body }) => {
    const consumed = await consumeToken('email_verification', body.token)
    if (!consumed) {
      throw unprocessable(
        'This confirmation link is no longer valid. Sign in and request a new one from Settings.'
      )
    }

    await markEmailVerified(consumed.userId)
    const user = await findUserById(consumed.userId)

    return {
      ok: true,
      user: user ? { id: user.id, email: user.email, email_verified: true } : null,
    }
  }
)

/** Re-sends the confirmation email to the signed-in account. */
export const PUT = defineRoute(
  { name: 'auth.verify_email.resend', auth: 'required', rateLimit: 'outbound' },
  async ({ actor }) => {
    if (!actor.id) throw unprocessable('No account in context')

    const user = await findUserById(actor.id)
    if (!user) throw unprocessable('No account in context')
    if (user.emailVerifiedAt) return { ok: true, already_verified: true }

    const t = createTranslator((user.locale === 'en' ? 'en' : 'es') as 'en' | 'es')
    const { token } = await issueToken({ userId: user.id, purpose: 'email_verification' })
    const url = `${env.appUrl}/verify-email?token=${encodeURIComponent(token)}`

    const result = await sendTransactionalEmail({
      to: user.email,
      subject: t('auth.emails.verify.subject'),
      body: t('auth.emails.verify.body'),
      ctaLabel: t('auth.emails.verify.cta'),
      ctaUrl: url,
    })

    return { ok: true, delivered: result.ok, email_configured: emailProvider.isConfigured() }
  }
)
