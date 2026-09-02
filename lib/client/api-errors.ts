'use client'

import { ApiError } from '@/lib/client/api'
import { FEATURE_LABEL_KEYS, LIMIT_LABEL_KEYS, PLANS, isPlanId } from '@/lib/billing/plans'
import type { TranslationKey } from '@/lib/i18n/dictionaries/en'
import type { Translator } from '@/lib/i18n/translate'

/**
 * The API's answer, in the merchant's language.
 *
 * The route contract returns one error envelope — `{ code, message, details }` —
 * and the message is written once, on the server, in one language. That is the
 * right trade for a JSON API: a handler has no view and no locale, and threading
 * a translator through every route to produce a string only the browser will ever
 * render would put presentation inside the transport.
 *
 * So the *browser* localises it. `code` is a stable enum and `details` is
 * structured, which between them describe every refusal precisely enough to write
 * a sentence from. The server's own message is the last fallback, for codes we do
 * not have copy for — an untranslated sentence beats a blank toast, and it is the
 * only case where one can still appear.
 */

type UpgradeDetails = {
  reason?: 'feature' | 'limit'
  feature?: string
  limit?: string
  used?: number
  allowed?: number
  current_plan?: string
  suggested_plan?: string | null
}

/**
 * Codes we have our own copy for.
 *
 * Deliberately not exhaustive over every `AppError` kind: a code with no entry
 * falls through to the server's message, which is always better than a generic
 * "something went wrong" that hides what actually happened.
 */
const CODE_KEYS: Record<string, TranslationKey> = {
  unauthorized: 'errors.api.unauthorized',
  forbidden: 'errors.api.forbidden',
  not_found: 'errors.api.not_found',
  conflict: 'errors.api.conflict',
  rate_limited: 'errors.api.rate_limited',
  not_configured: 'errors.api.not_configured',
  internal_error: 'errors.api.internal_error',
  validation_failed: 'errors.validation',
}

/**
 * Business-rule refusals, keyed on `details.reason`.
 *
 * `unprocessable` and `conflict` are where the *prose* carries the meaning:
 * "Not enough balance" and "This reward is out of stock" share a code, so the
 * code alone cannot produce a sentence and the server's English one was reaching
 * Spanish screens. `lib/errors.ts` now attaches a stable reason to the refusals
 * staff meet at the counter, and these are the words for them.
 *
 * Consulted *before* `CODE_KEYS`, because a reason is strictly more specific than
 * a code: "This gift card has expired" beats "That conflicts with something
 * else" every time.
 *
 * Deliberately not exhaustive. A reason with no entry falls through to the code,
 * and then to the server's sentence — the long tail of validation refusals on
 * configuration screens is read once, by an owner, at their own pace, and is not
 * worth a dictionary entry each.
 */
const REASON_KEYS: Record<string, TranslationKey> = {
  insufficient_balance: 'errors.reason.insufficient_balance',
  out_of_stock: 'errors.reason.out_of_stock',
  tier_too_low: 'errors.reason.tier_too_low',
  per_customer_limit: 'errors.reason.per_customer_limit',
  reward_unavailable: 'errors.reason.reward_unavailable',
  reward_not_started: 'errors.reason.reward_not_started',
  no_active_program: 'errors.reason.no_active_program',
  customer_blocked: 'errors.reason.customer_blocked',
  customer_anonymized: 'errors.reason.customer_anonymized',
  grant_not_found: 'errors.reason.grant_not_found',
  grant_already_used: 'errors.reason.grant_already_used',
  grant_expired: 'errors.reason.grant_expired',
  grant_cancelled: 'errors.reason.grant_cancelled',
  gift_card_inactive: 'errors.reason.gift_card_inactive',
  gift_card_expired: 'errors.reason.gift_card_expired',
  gift_card_empty: 'errors.reason.gift_card_empty',
}

function reasonOf(error: ApiError): string | null {
  const details = error.details
  if (details === null || typeof details !== 'object') return null
  const reason = (details as { reason?: unknown }).reason
  return typeof reason === 'string' ? reason : null
}

/**
 * Returns a translated sentence for an error, or `null` when there is nothing to
 * say — so a caller can decide between a toast and silence.
 */
export function apiErrorMessage(error: unknown, t: Translator): string | null {
  if (!(error instanceof ApiError)) {
    if (error instanceof Error) return error.message || null
    return null
  }

  if (error.code === 'payment_required') return upgradeMessage(error, t)

  const reason = reasonOf(error)
  if (reason && REASON_KEYS[reason]) return t(REASON_KEYS[reason])

  const key = CODE_KEYS[error.code]
  if (key) return t(key)

  // A network failure surfaces as a thrown `TypeError` before it ever becomes an
  // `ApiError`, so this only catches a 5xx with an unfamiliar code.
  if (error.status >= 500) return t('errors.api.internal_error')

  return error.message || null
}

/**
 * The paywall sentence, rebuilt from `details` rather than translated from prose.
 *
 * `requireFeature` and `requireWithinLimit` already return everything needed to
 * say *which* gate closed and *what* would open it. Rendering from those fields
 * means the merchant reads the same numbers the server enforced, in their own
 * language, with the feature and limit names coming from the same dictionary the
 * rest of the billing screen uses.
 */
function upgradeMessage(error: ApiError, t: Translator): string {
  const details = (error.details ?? {}) as UpgradeDetails
  const suggested = details.suggested_plan
  const planName = suggested && isPlanId(suggested) ? PLANS[suggested].name : null

  if (details.current_plan === 'lapsed') return t('errors.api.upgradeLapsed')

  if (details.reason === 'feature' && details.feature) {
    const featureKey = FEATURE_LABEL_KEYS[details.feature as keyof typeof FEATURE_LABEL_KEYS]
    if (featureKey && planName) {
      return t('errors.api.upgradeFeature', { feature: t(featureKey), plan: planName })
    }
  }

  if (details.reason === 'limit' && details.limit && details.allowed !== undefined) {
    const limitKey = LIMIT_LABEL_KEYS[details.limit as keyof typeof LIMIT_LABEL_KEYS]
    if (limitKey) {
      return t('errors.api.upgradeLimit', {
        allowed: details.allowed,
        limit: t(limitKey).toLocaleLowerCase(t.tag),
        used: details.used ?? 0,
      })
    }
  }

  return t('errors.api.payment_required')
}

/** The common `catch` shape: a sentence to put in a toast, never an empty one. */
export function toastError(error: unknown, t: Translator, fallback?: TranslationKey): string {
  return apiErrorMessage(error, t) ?? t(fallback ?? 'common.somethingWentWrong')
}
