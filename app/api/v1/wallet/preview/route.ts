import { defineRoute } from '@/lib/api/handler'
import { previewCampaignSchema } from '@/lib/api/wallet-schemas'
import { notFound } from '@/lib/errors'
import { getDb } from '@/lib/db'
import { getCampaign } from '@/lib/wallet/campaigns'
import {
  INELIGIBLE_REASON_LABELS,
  evaluateCampaign,
  passesFrequencyGuard,
} from '@/lib/wallet/eligibility'
import { loadCustomerFacts } from '@/lib/wallet/proximity'
import { renderNotificationCopy } from '@/lib/wallet/notifications'
import { getWalletSettings } from '@/lib/wallet/settings'
import { getLocation, listLocations } from '@/lib/wallet/locations'
import { buildApplePassJson } from '@/lib/wallet/apple-pass'
import { buildPassContent } from '@/lib/wallet/pass-content'
import { buildGoogleLoyaltyObject } from '@/lib/wallet/google-loyalty-jwt'

export const runtime = 'nodejs'

/**
 * Campaign preflight: *"would this actually send, and if not, why?"*
 *
 * The one thing a merchant cannot get from a settings screen is confidence. They
 * configure a campaign, nothing arrives, and they have no way to tell whether the
 * feature is broken or their own rule excluded everybody. This endpoint answers
 * that against a real customer, using the same evaluator the engine uses, and
 * returns *every* reason for refusal rather than the first.
 *
 * It also renders the notification copy with tokens resolved and the exact
 * `pass.json` / loyalty object the vendors will receive — which is the only way to
 * preview a wallet card truthfully without a signing certificate. That matters for
 * a deployment developing before Apple and Google have approved anyone.
 *
 * Sends nothing. Writes nothing.
 */
export const POST = defineRoute(
  {
    name: 'wallet.preview',
    auth: 'required',
    body: previewCampaignSchema,
    businessIdFrom: { source: 'body', key: 'businessId' },
    permissions: ['wallet:read'],
    rateLimit: 'dashboard',
  },
  async ({ body, business }) => {
    const campaign = await getCampaign(business.businessId, body.campaignId)
    const settings = await getWalletSettings(business.businessId)

    // Preview against a nominated customer, or the most recent visitor — the one
    // most likely to be affected, and the one the merchant can recognise.
    const customerId = body.customerId ?? (await mostRecentCustomer(business.businessId))
    if (!customerId) {
      throw notFound('A customer to preview against (add one, or nominate a customerId)')
    }

    const location = body.locationId
      ? await getLocation(business.businessId, body.locationId)
      : (await listLocations(business.businessId, { visibleOnly: true })).find(
          (candidate) => candidate.coordinates
        ) ?? null

    const now = new Date()
    const facts = await loadCustomerFacts(business.businessId, customerId, now)

    const evaluation = evaluateCampaign(campaign, facts, {
      now,
      locationId: location?.id ?? null,
      trigger: body.trigger,
      distanceMeters: campaign.radiusMeters ?? location?.geofence.notificationRadiusMeters ?? 100,
    })

    const guard = passesFrequencyGuard(facts, settings, now)

    const copy = renderNotificationCopy(
      {
        title: campaign.title,
        message: campaign.message,
        emoji: campaign.emoji,
        ctaLabel: campaign.ctaLabel,
        ctaUrl: campaign.ctaUrl,
        expiresAt: campaign.expiresAt,
      },
      {
        first_name: facts.firstName ?? 'there',
        points: facts.points,
        store: location?.name ?? 'your store',
        reward: campaign.rewardDescription ?? '',
        distance: `${campaign.radiusMeters ?? 100} m`,
      }
    )

    const content = await buildPassContent(customerId, {
      near: location?.coordinates ?? null,
      settings,
    })

    return {
      would_send: evaluation.eligible && guard.allowed,
      blockers: [
        ...evaluation.reasons.map((reason) => ({
          code: reason,
          label: INELIGIBLE_REASON_LABELS[reason],
        })),
        ...(guard.allowed
          ? []
          : [{ code: guard.reason!, label: FREQUENCY_LABELS[guard.reason!] }]),
      ],
      /** What the customer would actually see. */
      notification: copy,
      customer: {
        id: customerId,
        first_name: facts.firstName,
        points: facts.points,
        visits: facts.visits,
        is_vip: facts.isVip,
        days_since_visit: facts.daysSinceLastVisit,
        has_pass: facts.hasApplePass || facts.hasGooglePass,
        notifications_today: facts.notificationsToday,
      },
      location: location
        ? {
            id: location.id,
            name: location.name,
            has_coordinates: Boolean(location.coordinates),
            geofence: location.geofence,
          }
        : null,
      /*
       * The literal payloads. Both are generated without credentials, so a merchant
       * — and a developer — can verify exactly what a pass will contain before any
       * certificate exists.
       */
      pass_preview: content
        ? {
            apple: buildApplePassJson(content, { settings }),
            google: buildGoogleLoyaltyObject(content, { settings }),
          }
        : null,
    }
  }
)

const FREQUENCY_LABELS: Record<'daily_cap' | 'too_soon' | 'quiet_hours', string> = {
  daily_cap: 'This customer has already had today’s maximum number of notifications',
  too_soon: 'Another notification was sent too recently',
  quiet_hours: 'It is currently quiet hours',
}

async function mostRecentCustomer(businessId: string): Promise<string | null> {
  const admin = getDb()
  const { data } = await admin
    .from('customers')
    .select('id')
    .eq('business_id', businessId)
    .eq('status', 'active')
    .order('last_visit', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()
  return (data?.id as string) ?? null
}
