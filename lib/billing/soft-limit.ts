import 'server-only'
import { getDb } from '@/lib/db'
import { logger } from '@/lib/logger'
import { measureLimit, getEntitlements } from '@/lib/billing/entitlements'
import { LIMIT_LABEL_KEYS, lowestPlanWithLimit, type LimitKey } from '@/lib/billing/plans'
import { notify } from '@/lib/notifications'
import { translatorForBusiness } from '@/lib/i18n/business'

/**
 * Soft limits: the ones we refuse to enforce at the customer's expense.
 *
 * A hard limit (`requireWithinLimit`) is right when the merchant is the one
 * acting — importing a list, adding a location, inviting staff. It is wrong
 * when *their customer* is the one acting: refusing an enrolment at the counter
 * or a stamp on a paid coffee costs the merchant a real, immediate sale in
 * order to sell them an upgrade. That trade never favours us; a merchant who
 * watched us embarrass them in front of a customer churns.
 *
 * So the overage happens, and instead we make the merchant aware — once a day,
 * not once a scan.
 */

const NOTIFY_INTERVAL_MS = 24 * 60 * 60 * 1000
const lastNotified = new Map<string, number>()

/**
 * Records that a limit was exceeded and nudges the owner, at most daily.
 *
 * Fire-and-forget: callers `void` this. It must never delay or fail the action
 * that triggered it.
 */
export async function reportSoftLimit(businessId: string, key: LimitKey): Promise<void> {
  try {
    const cacheKey = `${businessId}:${key}`
    const previous = lastNotified.get(cacheKey) ?? 0
    if (Date.now() - previous < NOTIFY_INTERVAL_MS) return

    const entitlements = await getEntitlements(businessId)
    const status = await measureLimit(businessId, key, entitlements)
    if (!status.exceeded || status.allowed === null) return

    // Claim the slot before the async notify so two concurrent scans do not
    // both send. Losing a notification is fine; sending forty is not.
    lastNotified.set(cacheKey, Date.now())

    const suggested = lowestPlanWithLimit(key, status.used + 1)
    // The merchant's language, not the platform's: nobody is reading this in a
    // browser we could ask, so the answer comes from their own settings row.
    const t = await translatorForBusiness(businessId)
    const values = {
      limit: t(LIMIT_LABEL_KEYS[key]),
      used: status.used,
      allowed: status.allowed,
      plan: suggested?.name,
    }

    await notify(businessId, {
      type: 'billing',
      severity: 'warning',
      title: t('notify.softLimitTitle', { plan: entitlements.planDefinition.name }),
      body: suggested
        ? t('notify.softLimitBodyUpgrade', values)
        : t('notify.softLimitBody', values),
      url: '/dashboard/billing',
    })

    // Persisted so the billing screen can show the overage even if the
    // notification was dismissed, and so we can measure conversion from it.
    const admin = getDb()
    await admin.from('usage_counters').upsert(
      {
        business_id: businessId,
        period: 'overage',
        metric: key,
        used: status.used,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'business_id,period,metric' }
    )
  } catch (cause) {
    logger.warn('billing.soft_limit_failed', { business_id: businessId, key, cause })
  }
}

/** Clears the memo. Used by tests and after a plan change. */
export function resetSoftLimitCache(): void {
  lastNotified.clear()
}
