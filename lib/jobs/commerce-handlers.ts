import 'server-only'
import { getDb } from '@/lib/db'
import { logger } from '@/lib/logger'
import { enqueueMany } from '@/lib/jobs/queue'
import { env } from '@/lib/env'
import { sendTransactionalEmail } from '@/lib/messaging/transactional'
import { emailBrandFromRow, renderBrandedEmail } from '@/lib/messaging/email-layout'
import { issueGiftCard } from '@/lib/commerce/gift-cards'
import { renewMemberships } from '@/lib/commerce/memberships'
import { num } from '@/lib/domain/types'
import { BRAND_KIT_COLUMNS } from '@/lib/brand/kit'
import { getBusinessLocale } from '@/lib/i18n/business'
import { resolveLocale, type Locale } from '@/lib/i18n/locales'
import { createTranslator } from '@/lib/i18n/translate'
import type { JobHandler } from '@/lib/jobs/handlers'

/**
 * Money and dates in the business's own language.
 *
 * Every one of these was `en-GB`, which put `£`-ordered dates and English month
 * names in the gift-card email of every Spanish merchant. The currency itself
 * still comes from the row — a Spanish café charging in euros formatted for an
 * English reader is a different bug from one charging in pounds.
 */
function intlTag(locale: Locale): string {
  return locale === 'en' ? 'en-GB' : 'es-ES'
}

function money(amount: number, currency: string, locale: Locale): string {
  return new Intl.NumberFormat(intlTag(locale), { style: 'currency', currency }).format(amount)
}

function longDate(iso: string, locale: Locale, withYear = true): string {
  return new Date(iso).toLocaleDateString(intlTag(locale), {
    day: 'numeric',
    month: 'long',
    ...(withYear ? { year: 'numeric' } : {}),
  })
}

/**
 * Commerce job handlers: gift card fulfilment and membership renewals.
 *
 * Kept out of `handlers.ts` so the commerce modules do not add their imports to
 * the hot path of every campaign send, and so the registry stays readable as
 * the product grows past a dozen job types.
 */

// -----------------------------------------------------------------------------
// Gift cards
// -----------------------------------------------------------------------------

/**
 * Mints a gift card after Stripe confirms payment.
 *
 * The purchase intent travels entirely in the checkout session metadata, so
 * there is no pending-order row to reconcile — and if this job is retried, the
 * idempotency key (the Stripe session id) makes the second run a no-op instead
 * of a second card.
 */
export const fulfilGiftCard: JobHandler = async (payload) => {
  const session = payload.session as Record<string, unknown> | undefined
  if (!session) return { skipped: 'no_session' }

  const metadata = (session.metadata ?? {}) as Record<string, string>
  const businessId = metadata.business_id
  if (!businessId || metadata.kind !== 'gift_card') return { skipped: 'not_a_gift_card' }

  // Trust the amount Stripe actually captured, never the one the browser sent.
  const captured = num(session.amount_total) / 100
  const amount = captured > 0 ? captured : Number(metadata.amount ?? 0)
  if (!Number.isFinite(amount) || amount <= 0) return { skipped: 'no_amount' }

  const result = await issueGiftCard({
    businessId,
    amount,
    purchaserEmail: metadata.purchaser_email || null,
    purchaserName: metadata.purchaser_name || null,
    recipientEmail: metadata.recipient_email || null,
    recipientName: metadata.recipient_name || null,
    message: metadata.gift_message || null,
    design: metadata.design || 'classic',
    deliverAt: metadata.deliver_at || null,
    source: 'online',
    idempotencyKey: `stripe:${String(session.id)}`,
  })

  if (!result.duplicate) {
    const admin = getDb()
    await admin
      .from('gift_cards')
      .update({ stripe_payment_intent_id: String(session.payment_intent ?? '') || null })
      .eq('id', result.giftCardId)

    // The buyer gets their own confirmation — they are not the recipient, and
    // "did that actually work?" is the question that generates support email.
    if (metadata.purchaser_email) {
      await sendPurchaseReceipt(businessId, metadata, amount, result.code)
    }
  }

  return { gift_card_id: result.giftCardId, duplicate: result.duplicate }
}

/**
 * Emails a gift card to its recipient.
 *
 * Sent directly rather than through `dispatchMessage`: the recipient is usually
 * not a customer yet, so there is no consent record to check, and a gift
 * someone paid for is transactional by any reading of GDPR art. 6(1)(b).
 */
export const deliverGiftCard: JobHandler = async (payload) => {
  const giftCardId = payload.giftCardId as string
  const admin = getDb()

  const { data: card } = await admin
    .from('gift_cards')
    .select(
      'id, business_id, code, initial_value, remaining_value, currency, recipient_email, recipient_name, purchaser_name, message, expires_at, delivered_at, status'
    )
    .eq('id', giftCardId)
    .maybeSingle()

  if (!card) return { skipped: 'card_missing' }
  if (card.delivered_at) return { skipped: 'already_delivered' }
  if (card.status !== 'active') return { skipped: `card_${card.status}` }
  if (!card.recipient_email) return { skipped: 'no_recipient' }

  const { data: business } = await admin
    .from('businesses')
    .select(`${BRAND_KIT_COLUMNS}, slug, locale, google_review_url, settings`)
    .eq('id', card.business_id as string)
    .maybeSingle()

  if (!business) return { skipped: 'business_missing' }

  // The recipient is usually not a customer yet, so there is no personal locale
  // preference to honour — the shop's own language is the best available guess
  // and the only one the merchant can influence.
  const locale = resolveLocale(business.locale as string | undefined)
  const t = createTranslator(locale)

  const value = num(card.remaining_value)
  const currency = (card.currency as string) ?? 'EUR'
  const formatted = money(value, currency, locale)
  const from = (card.purchaser_name as string) ?? null
  const recipient = (card.recipient_name as string) ?? null
  const businessName = String(business.name ?? '')

  const heading = from
    ? t('emails.giftCard.sentSubject', { sender: from, amount: formatted })
    : t('emails.giftCard.receivedSubject', { amount: formatted })

  const lines = [
    recipient
      ? t('emails.giftCard.greetingNamed', { name: recipient.split(' ')[0] ?? recipient })
      : t('emails.giftCard.greeting'),
    '',
    from
      ? t('emails.giftCard.fromSender', { sender: from, business: businessName })
      : t('emails.giftCard.fromNobody', { business: businessName }),
    card.message ? `\n"${String(card.message)}"\n` : '',
    t('emails.giftCard.codeLine', {
      code: String(card.code).toUpperCase(),
      amount: formatted,
    }),
    t('emails.giftCard.showAtCounter'),
    card.expires_at
      ? t('emails.giftCard.validUntil', { date: longDate(card.expires_at as string, locale) })
      : t('emails.giftCard.noExpiry'),
  ]
    .filter(Boolean)
    .join('\n')

  const html = renderBrandedEmail({
    brand: emailBrandFromRow(business),
    locale,
    heading,
    body: lines,
    ctaLabel: t('emails.giftCard.seeShop'),
    ctaUrl: `${env.appUrl}/join/${business.slug}`,
    unsubscribeUrl: null,
  })

  const sent = await sendTransactionalEmail({
    to: card.recipient_email as string,
    subject: heading,
    body: lines,
    html,
  })

  if (!sent.ok) {
    // Throwing hands the job back to the queue's backoff, which is what we want
    // for a transient provider failure.
    throw new Error(sent.error ?? 'Gift card delivery failed')
  }

  await admin
    .from('gift_cards')
    .update({ delivered_at: new Date().toISOString() })
    .eq('id', giftCardId)

  return { delivered_to: card.recipient_email }
}

async function sendPurchaseReceipt(
  businessId: string,
  metadata: Record<string, string>,
  amount: number,
  code: string
): Promise<void> {
  try {
    const admin = getDb()
    const [{ data: business }, locale] = await Promise.all([
      admin
        .from('businesses')
        .select(`${BRAND_KIT_COLUMNS}, currency`)
        .eq('id', businessId)
        .maybeSingle(),
      getBusinessLocale(businessId),
    ])

    if (!business) return

    const t = createTranslator(locale)
    const businessName = String(business.name ?? '')
    const formatted = money(amount, (business.currency as string) ?? 'EUR', locale)

    const scheduled = metadata.deliver_at
      ? t('emails.giftCard.receiptScheduled', {
          recipient: metadata.recipient_email,
          date: longDate(metadata.deliver_at, locale, false),
        })
      : t('emails.giftCard.receiptSent', { recipient: metadata.recipient_email })

    const body = [
      t('emails.giftCard.receiptThanks', { amount: formatted, business: businessName }),
      '',
      scheduled,
      t('emails.giftCard.receiptCode', { code: code.toUpperCase() }),
    ].join('\n')

    await sendTransactionalEmail({
      to: metadata.purchaser_email,
      subject: t('emails.giftCard.receiptSubject', {
        amount: formatted,
        business: businessName,
      }),
      body,
      html: renderBrandedEmail({
        brand: emailBrandFromRow(business),
        locale,
        heading: t('emails.giftCard.receiptHeading'),
        body,
        ctaLabel: null,
        ctaUrl: null,
        unsubscribeUrl: null,
      }),
    })
  } catch (cause) {
    // A missing receipt must never fail fulfilment; the card itself is issued.
    logger.warn('giftcards.receipt_failed', { business_id: businessId, cause })
  }
}

/** Sweeps cards whose scheduled delivery date has arrived. Runs daily. */
export const deliverScheduledGiftCards: JobHandler = async () => {
  const admin = getDb()
  const { data } = await admin
    .from('gift_cards')
    .select('id, business_id')
    .is('delivered_at', null)
    .not('deliver_at', 'is', null)
    .lte('deliver_at', new Date().toISOString())
    .eq('status', 'active')
    .limit(500)

  let delivered = 0
  for (const card of data ?? []) {
    try {
      await deliverGiftCard({ giftCardId: card.id }, { jobId: 'scheduled', businessId: null })
      delivered += 1
    } catch (cause) {
      logger.warn('giftcards.scheduled_delivery_failed', { gift_card_id: card.id, cause })
    }
  }
  return { delivered }
}

// -----------------------------------------------------------------------------
// Memberships
// -----------------------------------------------------------------------------

/** Rolls due memberships into their next period and grants the included balance. */
export const renewMembershipsJob: JobHandler = async (payload) => {
  const businessId = (payload.businessId as string | undefined) ?? null
  return renewMemberships(businessId)
}

/**
 * Warns members a few days before they renew.
 *
 * Surprise charges are the single largest driver of membership chargebacks, and
 * a chargeback costs the merchant the fee *and* the customer.
 *
 * Routed through the automation engine rather than dispatched directly, like
 * every other lifecycle message. That is what makes the reminder editable,
 * pausable and subject to the same cooldowns as birthdays and win-backs — and
 * it means `membership_renewal` is a real trigger rather than a dangling enum
 * value nobody can use.
 */
export const notifyUpcomingRenewals: JobHandler = async () => {
  const admin = getDb()
  const windowStart = new Date(Date.now() + 2 * 86_400_000).toISOString()
  const windowEnd = new Date(Date.now() + 3 * 86_400_000).toISOString()

  const { data } = await admin
    .from('customer_memberships')
    .select(
      'id, business_id, customer_id, current_period_end, membership_plans(name, price, currency)'
    )
    .eq('status', 'active')
    .eq('cancel_at_period_end', false)
    .gte('current_period_end', windowStart)
    .lt('current_period_end', windowEnd)
    .limit(2000)

  const memberships = data ?? []
  if (memberships.length === 0) return { enrolled: 0 }

  /*
   * The merge fields land in an automation template the merchant can edit, so
   * they have to be formatted in the merchant's language rather than the
   * platform's — an English "3 March" inside otherwise Spanish copy is worse
   * than either language on its own. Resolved per business and memoised by
   * `getBusinessLocale`, because one sweep spans every merchant on the
   * deployment.
   */
  const locales = new Map<string, Locale>()
  for (const membership of memberships) {
    const businessId = membership.business_id as string
    if (!locales.has(businessId)) {
      locales.set(businessId, await getBusinessLocale(businessId))
    }
  }

  const enrolled = await enqueueMany(
    memberships.map((membership) => {
      const plan = membership.membership_plans as unknown as {
        name: string
        price: number | string
        currency: string
      } | null

      const businessId = membership.business_id as string
      const locale = locales.get(businessId) ?? resolveLocale(undefined)
      const t = createTranslator(locale)

      return {
        type: 'automation.enroll' as const,
        payload: {
          businessId,
          customerId: membership.customer_id as string,
          trigger: 'membership_renewal',
          context: {
            plan_name: plan?.name ?? t('emails.membership.planFallback'),
            renewal_amount: money(num(plan?.price), plan?.currency ?? 'EUR', locale),
            renewal_date: longDate(
              membership.current_period_end as string,
              locale,
              false
            ),
          },
        },
        options: {
          businessId: membership.business_id as string,
          // Keyed on the period so a member is warned once per renewal, even if
          // the sweep runs twice inside the window.
          idempotencyKey: `membership-renewal:${membership.id}:${membership.current_period_end}`,
        },
      }
    })
  )

  return { enrolled }
}
