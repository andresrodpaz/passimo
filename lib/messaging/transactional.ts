import 'server-only'
import { getDb } from '@/lib/db'
import { logger } from '@/lib/logger'
import { emailProvider } from '@/lib/messaging/providers'
import { emailBrandFromRow, renderBrandedEmail } from '@/lib/messaging/email-layout'
import { BRAND_KIT_COLUMNS } from '@/lib/brand/kit'
import { getBusinessLocale } from '@/lib/i18n/business'
import { DEFAULT_LOCALE } from '@/lib/i18n/locales'

/**
 * Transactional email to someone who is not (yet) a customer.
 *
 * `dispatchMessage` is the gate for everything addressed to a *customer* — it
 * checks consent, suppression, quiet hours and frequency caps against their
 * record. A gift card recipient, a GDPR export requester or a partner-invite
 * contact has no such record, so that gate has nothing to check and would
 * simply refuse to send.
 *
 * This is the narrow, deliberate exception: no marketing content ever goes
 * through it, and every caller is fulfilling something the recipient (or
 * someone paying on their behalf) explicitly asked for.
 */

export type TransactionalEmail = {
  to: string
  subject: string
  /** Plain-text body. Also used as the fallback part. */
  body: string
  /** Rendered HTML. Omit to wrap `body` in the business's branded shell. */
  html?: string | null
  /** When present, the email is branded with this business's logo and colours. */
  businessId?: string | null
  ctaLabel?: string | null
  ctaUrl?: string | null
}

export type TransactionalResult = { ok: boolean; error?: string }

export async function sendTransactionalEmail(
  input: TransactionalEmail
): Promise<TransactionalResult> {
  if (!emailProvider.isConfigured()) {
    logger.warn('transactional.email_not_configured', { subject: input.subject })
    return { ok: false, error: 'Email is not configured on this deployment' }
  }

  let html = input.html ?? null

  if (!html) {
    const [row, locale] = input.businessId
      ? await Promise.all([
          loadBrandRow(input.businessId),
          getBusinessLocale(input.businessId),
        ])
      : [null, DEFAULT_LOCALE]

    html = renderBrandedEmail({
      brand: emailBrandFromRow(row),
      locale,
      heading: input.subject,
      body: input.body,
      ctaLabel: input.ctaLabel ?? null,
      ctaUrl: input.ctaUrl ?? null,
      unsubscribeUrl: null,
    })
  }

  const result = await emailProvider.send({
    channel: 'email',
    to: input.to,
    subject: input.subject,
    body: input.body,
    html,
    url: input.ctaUrl ?? null,
    metadata: {},
  })

  if (!result.ok) {
    logger.warn('transactional.email_failed', { subject: input.subject, error: result.error })
  }
  return { ok: result.ok, error: result.error }
}

/**
 * The business's brand row, as the brand kit defines it.
 *
 * Selecting `BRAND_KIT_COLUMNS` rather than a hand-picked four means adding a
 * field to the kit reaches email without a second edit here — and it is the
 * column list `mapBrandKit` is written against, so nothing silently defaults.
 */
async function loadBrandRow(businessId: string): Promise<Record<string, unknown> | null> {
  const admin = getDb()
  const { data } = await admin
    .from('businesses')
    .select(BRAND_KIT_COLUMNS)
    .eq('id', businessId)
    .maybeSingle()
  return (data as Record<string, unknown> | null) ?? null
}
