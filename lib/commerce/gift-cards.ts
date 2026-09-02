import 'server-only'
import { getDb } from '@/lib/db'
import { conflictBecause, notFound, unprocessable } from '@/lib/errors'
import { logger } from '@/lib/logger'
import { num } from '@/lib/domain/types'
import { enqueue } from '@/lib/jobs/queue'
import { notify } from '@/lib/notifications'
import { getBusinessLocale } from '@/lib/i18n/business'
import { createTranslator, formatCurrency } from '@/lib/i18n/translate'

/**
 * Gift cards.
 *
 * The single best cash-flow feature a local business can have, and the one they
 * most often lack: money arrives today, the cost is incurred later, and roughly
 * a third of recipients are new customers who arrive already holding a reason
 * to walk in. Breakage — the unspent remainder — is pure margin.
 *
 * All balance movement happens inside `passimo_issue_gift_card`,
 * `passimo_redeem_gift_card` and `passimo_void_gift_card`, which take a row
 * lock and append to `gift_card_transactions`. This module is the typed surface
 * over those, plus the fulfilment side-effects (delivery email, activity,
 * merchant notification) that must not run inside the transaction.
 */

export type GiftCardStatus = 'active' | 'depleted' | 'expired' | 'void'

export type GiftCard = {
  id: string
  code: string
  status: GiftCardStatus
  initialValue: number
  remainingValue: number
  currency: string
  purchaserEmail: string | null
  purchaserName: string | null
  recipientEmail: string | null
  recipientName: string | null
  recipientCustomerId: string | null
  message: string | null
  design: string
  source: string
  expiresAt: string | null
  deliverAt: string | null
  deliveredAt: string | null
  createdAt: string
  redeemedAt: string | null
}

export type GiftCardStats = {
  issued_count: number
  active_count: number
  issued_value: number
  outstanding_value: number
  redeemed_value: number
  issued_30d: number
  issued_value_30d: number
  breakage_value: number
}

/** Amounts merchants actually sell. Free entry is allowed; these just remove a decision. */
export const SUGGESTED_AMOUNTS = [10, 25, 50, 100] as const

export const GIFT_CARD_DESIGNS = ['classic', 'birthday', 'thank_you', 'celebration', 'festive'] as const
export type GiftCardDesign = (typeof GIFT_CARD_DESIGNS)[number]

const SELECT =
  'id, code, status, initial_value, remaining_value, currency, purchaser_email, purchaser_name, ' +
  'recipient_email, recipient_name, recipient_customer_id, message, design, source, expires_at, ' +
  'deliver_at, delivered_at, created_at, redeemed_at'

function mapCard(row: Record<string, unknown>): GiftCard {
  return {
    id: row.id as string,
    code: row.code as string,
    status: row.status as GiftCardStatus,
    initialValue: num(row.initial_value),
    remainingValue: num(row.remaining_value),
    currency: (row.currency as string) ?? 'EUR',
    purchaserEmail: (row.purchaser_email as string) ?? null,
    purchaserName: (row.purchaser_name as string) ?? null,
    recipientEmail: (row.recipient_email as string) ?? null,
    recipientName: (row.recipient_name as string) ?? null,
    recipientCustomerId: (row.recipient_customer_id as string) ?? null,
    message: (row.message as string) ?? null,
    design: (row.design as string) ?? 'classic',
    source: (row.source as string) ?? 'manual',
    expiresAt: (row.expires_at as string) ?? null,
    deliverAt: (row.deliver_at as string) ?? null,
    deliveredAt: (row.delivered_at as string) ?? null,
    createdAt: row.created_at as string,
    redeemedAt: (row.redeemed_at as string) ?? null,
  }
}

// -----------------------------------------------------------------------------
// Issue
// -----------------------------------------------------------------------------

export type IssueGiftCardInput = {
  businessId: string
  amount: number
  purchaserEmail?: string | null
  purchaserName?: string | null
  recipientEmail?: string | null
  recipientName?: string | null
  message?: string | null
  design?: string | null
  /** Months until it expires. Null keeps it valid forever, which is the kinder default. */
  expiresInMonths?: number | null
  deliverAt?: string | null
  source?: 'manual' | 'online' | 'pos' | 'import' | 'promo'
  issuedBy?: string | null
  locationId?: string | null
  idempotencyKey?: string | null
  /** Skip the delivery email — the caller is handing over a printed card. */
  skipDelivery?: boolean
}

export type IssueResult = {
  duplicate: boolean
  giftCardId: string
  code: string
  initialValue: number
  remainingValue: number
  recipientCustomerId: string | null
}

export async function issueGiftCard(input: IssueGiftCardInput): Promise<IssueResult> {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw unprocessable('Gift card amount must be greater than zero')
  }
  if (input.amount > 10_000) {
    // A four-figure typo at the counter is far more likely than a real €50,000
    // gift card, and the merchant cannot undo the cash implication.
    throw unprocessable('Gift cards are capped at 10,000. Contact us for higher amounts.')
  }

  const admin = getDb()

  const expiresAt =
    input.expiresInMonths && input.expiresInMonths > 0
      ? new Date(Date.now() + input.expiresInMonths * 30 * 86_400_000).toISOString()
      : null

  const { data, error } = await admin.rpc('passimo_issue_gift_card', {
    p_business_id: input.businessId,
    p_amount: input.amount,
    p_purchaser_email: input.purchaserEmail ?? null,
    p_purchaser_name: input.purchaserName ?? null,
    p_recipient_email: input.recipientEmail ?? null,
    p_recipient_name: input.recipientName ?? null,
    p_message: input.message ?? null,
    p_design: input.design ?? 'classic',
    p_expires_at: expiresAt,
    p_deliver_at: input.deliverAt ?? null,
    p_source: input.source ?? 'manual',
    p_issued_by: input.issuedBy ?? null,
    p_location_id: input.locationId ?? null,
    p_idempotency_key: input.idempotencyKey ?? null,
  })

  if (error) throw unprocessable(error.message)

  const payload = data as {
    duplicate: boolean
    gift_card_id: string
    code: string
    initial_value: number | string
    remaining_value: number | string
    recipient_customer_id: string | null
  }

  const result: IssueResult = {
    duplicate: payload.duplicate,
    giftCardId: payload.gift_card_id,
    code: payload.code,
    initialValue: num(payload.initial_value),
    remainingValue: num(payload.remaining_value),
    recipientCustomerId: payload.recipient_customer_id ?? null,
  }

  if (payload.duplicate) return result

  // Everything below is a side-effect of a committed transaction, so each one
  // is enqueued or best-effort — a mail provider outage must not undo a sale.
  if (!input.skipDelivery && input.recipientEmail) {
    const runAfter = input.deliverAt ? new Date(input.deliverAt) : undefined
    await enqueue(
      'giftcard.deliver',
      { businessId: input.businessId, giftCardId: result.giftCardId },
      {
        businessId: input.businessId,
        runAfter,
        idempotencyKey: `giftcard-deliver:${result.giftCardId}`,
      }
    )
  }

  if (input.source === 'online') {
    /*
     * The merchant's own language and currency. The title used to be
     * `initialValue.toFixed(2)` with no symbol at all, so a sale showed as
     * "Gift card sold — 25.00" and a merchant could not tell euros from pounds
     * in their own notification tray.
     */
    const [{ data: business }, locale] = await Promise.all([
      admin.from('businesses').select('currency').eq('id', input.businessId).maybeSingle(),
      getBusinessLocale(input.businessId),
    ])
    const t = createTranslator(locale)

    await notify(input.businessId, {
      type: 'gift_card',
      severity: 'success',
      title: t('notify.giftCardSoldTitle', {
        amount: formatCurrency(result.initialValue, locale, {
          currency: (business?.currency as string) ?? 'EUR',
        }),
      }),
      body: input.recipientName
        ? t('notify.giftCardSoldForBody', { name: input.recipientName })
        : t('notify.giftCardSoldBody'),
      url: '/dashboard/gift-cards',
    })
  }

  await enqueue(
    'webhook.deliver',
    {
      businessId: input.businessId,
      event: 'gift_card.issued',
      data: { gift_card_id: result.giftCardId, amount: result.initialValue },
    },
    { businessId: input.businessId }
  )

  return result
}

// -----------------------------------------------------------------------------
// Redeem
// -----------------------------------------------------------------------------

export type RedeemGiftCardInput = {
  businessId: string
  code: string
  /** Null spends the whole remaining balance. */
  amount?: number | null
  locationId?: string | null
  staffUserId?: string | null
  idempotencyKey?: string | null
}

export type RedeemResult = {
  duplicate: boolean
  giftCardId: string | null
  redeemedAmount: number
  remainingValue: number
}

export async function redeemGiftCard(input: RedeemGiftCardInput): Promise<RedeemResult> {
  const admin = getDb()
  const { data, error } = await admin.rpc('passimo_redeem_gift_card', {
    p_business_id: input.businessId,
    p_code: input.code.trim(),
    p_amount: input.amount ?? null,
    p_location_id: input.locationId ?? null,
    p_staff_user_id: input.staffUserId ?? null,
    p_idempotency_key: input.idempotencyKey ?? null,
  })

  if (error) throw translateRedeemError(error)

  const payload = data as {
    duplicate: boolean
    gift_card_id?: string
    redeemed_amount: number | string
    remaining_value: number | string
  }

  return {
    duplicate: payload.duplicate,
    giftCardId: payload.gift_card_id ?? null,
    redeemedAmount: num(payload.redeemed_amount),
    remainingValue: num(payload.remaining_value),
  }
}

/**
 * Turns Postgres exceptions into errors a cashier can act on.
 *
 * The `hint` set by the SQL function is the machine-readable discriminator; the
 * raw message is never shown, because "check_violation" means nothing to
 * someone holding a queue of four people.
 */
function translateRedeemError(error: { message: string; hint?: string | null; code?: string | null }) {
  switch (error.hint) {
    case 'gift_card_inactive':
      return conflictBecause(
        'gift_card_inactive',
        'This gift card has already been used up or cancelled.'
      )
    case 'gift_card_expired':
      return conflictBecause('gift_card_expired', 'This gift card has expired.')
    case 'gift_card_empty':
      return conflictBecause('gift_card_empty', 'This gift card has no balance left.')
    default:
      if (error.code === 'P0002' || /invalid gift card/i.test(error.message)) {
        return notFound('Gift card')
      }
      return unprocessable(error.message)
  }
}

// -----------------------------------------------------------------------------
// Void
// -----------------------------------------------------------------------------

export async function voidGiftCard(
  businessId: string,
  giftCardId: string,
  staffUserId?: string | null
): Promise<{ alreadyVoid: boolean; voidedValue: number }> {
  const admin = getDb()
  const { data, error } = await admin.rpc('passimo_void_gift_card', {
    p_business_id: businessId,
    p_gift_card_id: giftCardId,
    p_staff_user_id: staffUserId ?? null,
  })

  if (error) {
    if (error.code === 'P0002') throw notFound('Gift card')
    throw unprocessable(error.message)
  }

  const payload = data as { already_void: boolean; voided_value?: number | string }
  return {
    alreadyVoid: payload.already_void,
    voidedValue: num(payload.voided_value),
  }
}

// -----------------------------------------------------------------------------
// Reads
// -----------------------------------------------------------------------------

export type ListGiftCardsOptions = {
  status?: GiftCardStatus | 'all'
  search?: string
  limit?: number
  offset?: number
}

export async function listGiftCards(
  businessId: string,
  options: ListGiftCardsOptions = {}
): Promise<{ cards: GiftCard[]; total: number }> {
  const admin = getDb()
  const limit = Math.min(options.limit ?? 50, 200)
  const offset = options.offset ?? 0

  let request = admin
    .from('gift_cards')
    .select(SELECT, { count: 'exact' })
    .eq('business_id', businessId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (options.status && options.status !== 'all') request = request.eq('status', options.status)
  if (options.search?.trim()) {
    const term = options.search.trim()
    request = request.or(
      `code.ilike.%${term}%,recipient_email.ilike.%${term}%,purchaser_email.ilike.%${term}%,recipient_name.ilike.%${term}%`
    )
  }

  const { data, count, error } = await request
  if (error) throw unprocessable(error.message)

  return {
    cards: (data ?? []).map((row) => mapCard(row as unknown as Record<string, unknown>)),
    total: count ?? 0,
  }
}

export async function getGiftCardStats(businessId: string): Promise<GiftCardStats> {
  const admin = getDb()
  const { data, error } = await admin.rpc('passimo_gift_card_stats', {
    p_business_id: businessId,
  })

  if (error) {
    logger.warn('giftcards.stats_failed', { business_id: businessId, error })
    return {
      issued_count: 0,
      active_count: 0,
      issued_value: 0,
      outstanding_value: 0,
      redeemed_value: 0,
      issued_30d: 0,
      issued_value_30d: 0,
      breakage_value: 0,
    }
  }

  const raw = (data ?? {}) as Record<string, unknown>
  return {
    issued_count: num(raw.issued_count),
    active_count: num(raw.active_count),
    issued_value: num(raw.issued_value),
    outstanding_value: num(raw.outstanding_value),
    redeemed_value: num(raw.redeemed_value),
    issued_30d: num(raw.issued_30d),
    issued_value_30d: num(raw.issued_value_30d),
    breakage_value: num(raw.breakage_value),
  }
}

export async function getGiftCard(
  businessId: string,
  idOrCode: string
): Promise<{ card: GiftCard; transactions: Array<Record<string, unknown>> }> {
  const admin = getDb()
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(idOrCode)

  const { data } = await admin
    .from('gift_cards')
    .select(SELECT)
    .eq('business_id', businessId)
    .eq(isUuid ? 'id' : 'code', isUuid ? idOrCode : idOrCode.trim())
    .maybeSingle()

  if (!data) throw notFound('Gift card')
  const card = mapCard(data as unknown as Record<string, unknown>)

  const { data: transactions } = await admin
    .from('gift_card_transactions')
    .select('id, amount, balance_after, kind, created_at')
    .eq('gift_card_id', card.id)
    .order('created_at', { ascending: false })
    .limit(50)

  return { card, transactions: (transactions ?? []) as Array<Record<string, unknown>> }
}

/**
 * Looks up a card for the point of sale without leaking whether a guessed code
 * exists — a wrong code and an inactive card return the same shape, and the
 * caller decides what to show.
 */
export async function lookupForRedemption(
  businessId: string,
  code: string
): Promise<{ found: boolean; card: GiftCard | null }> {
  const admin = getDb()
  const { data } = await admin
    .from('gift_cards')
    .select(SELECT)
    .eq('business_id', businessId)
    .ilike('code', code.trim())
    .maybeSingle()

  if (!data) return { found: false, card: null }
  return { found: true, card: mapCard(data as unknown as Record<string, unknown>) }
}
