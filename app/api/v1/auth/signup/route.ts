import { z } from 'zod'
import { defineRoute } from '@/lib/api/handler'
import { conflict, unprocessable } from '@/lib/errors'
import { getDb } from '@/lib/db'
import { slugify } from '@/lib/slug'
import { recordAudit } from '@/lib/audit'
import { enqueue } from '@/lib/jobs/queue'
import { logger } from '@/lib/logger'
import {
  EmailAlreadyRegisteredError,
  createUser,
  deleteUser,
  issueToken,
} from '@/lib/auth/users'
import { createSession } from '@/lib/auth/session'
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '@/lib/auth/password'
import { sendTransactionalEmail } from '@/lib/messaging/transactional'
import { env } from '@/lib/env'
import { createTranslator } from '@/lib/i18n/translate'

export const runtime = 'nodejs'

const bodySchema = z.object({
  email: z.string().email().max(320),
  // NIST 800-63B: length over composition rules.
  password: z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH),
  businessName: z.string().min(1).max(100),
  fullName: z.string().max(120).optional(),
  slug: z.string().min(2).max(80).optional(),
  category: z.string().max(60).optional(),
  city: z.string().max(80).optional(),
  country: z.string().max(60).optional(),
  timezone: z.string().max(60).optional(),
  currency: z.string().length(3).optional(),
  locale: z.enum(['es', 'en']).optional(),
  referralCode: z.string().max(20).optional(),
})

/**
 * Creates the account, the workspace and the owner membership.
 *
 * Every failure path unwinds what it created — a half-provisioned tenant is
 * worse than no tenant, because the user cannot retry with the same email.
 *
 * The account is usable immediately; the confirmation email is a follow-up, not
 * a gate (see `app/api/v1/auth/verify-email`). Getting a merchant to a live
 * loyalty program in one sitting is the product's whole onboarding thesis, and an
 * inbox round trip in the middle of it is where that thesis dies.
 */
export const POST = defineRoute(
  { name: 'auth.signup', auth: 'none', body: bodySchema, rateLimit: 'auth' },
  async ({ body, request }) => {
    const db = getDb()
    const locale = body.locale ?? 'es'
    const slug = await allocateSlug(body.slug ?? slugify(body.businessName))

    let userId: string
    try {
      const user = await createUser({
        email: body.email,
        password: body.password,
        fullName: body.fullName ?? null,
        locale,
        metadata: { business_name: body.businessName },
      })
      userId = user.id
    } catch (error) {
      if (error instanceof EmailAlreadyRegisteredError) {
        throw conflict('An account with this email already exists. Try signing in instead.')
      }
      throw unprocessable((error as Error).message)
    }

    const referrer = body.referralCode
      ? await db
          .from('businesses')
          .select('id')
          .eq('referral_code', body.referralCode.trim().toUpperCase())
          .maybeSingle()
      : null

    const { data: business, error: businessError } = await db
      .from('businesses')
      .insert({
        owner_id: userId,
        name: body.businessName,
        slug,
        category: body.category ?? null,
        city: body.city ?? null,
        country: body.country ?? null,
        timezone: body.timezone ?? 'Europe/Madrid',
        currency: body.currency ?? 'EUR',
        locale,
        support_email: body.email,
        referred_by_business_id: referrer?.data?.id ?? null,
      })
      .select('id, slug, name')
      .single()

    if (businessError || !business) {
      await deleteUser(userId)
      throw unprocessable(businessError?.message ?? 'Could not create workspace')
    }

    const businessId = business.id as string

    const { error: teamError } = await db.from('team_members').insert({
      business_id: businessId,
      user_id: userId,
      role: 'owner',
      status: 'active',
      accepted_at: new Date().toISOString(),
      display_name: body.fullName ?? body.businessName,
    })

    if (teamError) {
      await db.from('businesses').delete().eq('id', businessId)
      await deleteUser(userId)
      throw unprocessable(teamError.message)
    }

    // Everything a new workspace needs to be immediately usable: a program,
    // rules, rewards, system segments, automations and a survey. Provisioned
    // by the same SQL that backfilled existing accounts, so there is exactly
    // one definition of "a correctly set up business".
    const { error: provisionError } = await db.rpc('passimo_provision_business', {
      p_business_id: businessId,
    })
    if (provisionError) {
      // Non-fatal: the account works, it just starts emptier than intended.
      logger.error('signup.provision_failed', { businessId, error: provisionError })
    }

    // Establish the cookie session so the client lands straight in onboarding.
    await createSession({ userId, request })

    // Best-effort confirmation email. A failure here must not fail the signup.
    void sendVerificationEmail({ userId, email: body.email, locale }).catch((error) => {
      logger.warn('signup.verification_email_failed', { error: (error as Error).message })
    })

    await recordAudit({
      businessId,
      actor: { kind: 'user', id: userId, email: body.email },
      action: 'business.created',
      resourceType: 'business',
      resourceId: businessId,
      summary: `Workspace "${business.name}" created`,
      request,
    })

    await enqueue(
      'analytics.recompute',
      { businessId },
      { businessId, runAfter: new Date(Date.now() + 60_000) }
    )

    return {
      user: { id: userId, email: body.email },
      business: { id: businessId, slug: business.slug, name: business.name },
      session_established: true,
    }
  }
)

async function sendVerificationEmail(input: {
  userId: string
  email: string
  locale: 'es' | 'en'
}): Promise<void> {
  const t = createTranslator(input.locale)
  const { token } = await issueToken({ userId: input.userId, purpose: 'email_verification' })
  const url = `${env.appUrl}/verify-email?token=${encodeURIComponent(token)}`

  await sendTransactionalEmail({
    to: input.email,
    subject: t('auth.emails.verify.subject'),
    body: t('auth.emails.verify.body'),
    ctaLabel: t('auth.emails.verify.cta'),
    ctaUrl: url,
  })
}

/**
 * Finds a free slug. The loop is bounded and falls back to a random suffix so a
 * popular business name can never spin here.
 */
async function allocateSlug(base: string): Promise<string> {
  const db = getDb()
  const root = slugify(base)

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = attempt === 0 ? root : `${root}-${attempt + 1}`
    const { data } = await db
      .from('businesses')
      .select('id')
      .eq('slug', candidate)
      .maybeSingle()
    if (!data) return candidate
  }
  return `${root}-${Math.random().toString(36).slice(2, 7)}`
}
