import { defineRoute } from '@/lib/api/handler'
import { positionReportSchema, walletEventSchema } from '@/lib/api/wallet-schemas'
import { verifyToken } from '@/lib/crypto'
import { forbidden } from '@/lib/errors'
import { getDb } from '@/lib/db'
import { recordWalletEvent } from '@/lib/wallet/events'
import { nearbyOffers, reportPosition } from '@/lib/wallet/proximity'
import { isValidLatLng } from '@/lib/wallet/geo'

export const runtime = 'nodejs'

/**
 * The customer-facing proximity endpoint.
 *
 * Web geofencing, for the very large population of customers who will never install
 * a wallet pass — around half of everyone who joins. On the card page the browser
 * offers `geolocation.watchPosition`, and each report comes here to be evaluated by
 * exactly the same engine that serves Apple and Google. That is the point: proximity
 * is a property of the product, not of a vendor SDK, so it works on a laptop, on a
 * pass, and on a phone that has neither.
 *
 * Authentication is the **signed card token**, not a session. The caller is an
 * anonymous customer on a public page, and the token is the only thing that proves
 * which card they hold. It carries the customer id, so a caller can only ever report
 * a position for themselves — there is no parameter that would let them report for
 * someone else.
 *
 * `GET` is read-only and evaluates nothing. Opening the card page must never be
 * able to trigger a notification.
 */

function customerFrom(token: string): string {
  const payload = verifyToken<{ c: string }>('card', token)
  if (!payload?.c) throw forbidden('This card link is invalid or has expired')
  return payload.c
}

async function businessFor(customerId: string): Promise<string | null> {
  const admin = getDb()
  const { data } = await admin
    .from('customers')
    .select('business_id, status')
    .eq('id', customerId)
    .maybeSingle()
  if (!data || data.status !== 'active') return null
  return data.business_id as string
}

const nearbyQuery = positionReportSchema.partial({ lat: true, lng: true })

/** Where can I use this card, what is on offer there, and is it open now. */
export const GET = defineRoute(
  {
    name: 'public.proximity.nearby',
    auth: 'none',
    query: nearbyQuery,
    rateLimit: 'publicRelaxed',
  },
  async ({ query }) => {
    const customerId = customerFrom(query.token)
    const businessId = await businessFor(customerId)
    if (!businessId) throw forbidden('This card is no longer active')

    const position =
      query.lat !== undefined && query.lng !== undefined
        ? { lat: Number(query.lat), lng: Number(query.lng) }
        : null

    return nearbyOffers({
      businessId,
      customerId,
      position: position && isValidLatLng(position) ? position : null,
    })
  }
)

/**
 * A position report. Evaluates geofences and may send a notification.
 *
 * Rate-limited on the public write bucket: a browser watching position can emit a
 * report every few seconds, and while the engine deduplicates notifications, it
 * should not be asked to.
 */
export const POST = defineRoute(
  {
    name: 'public.proximity.report',
    auth: 'none',
    body: positionReportSchema,
    rateLimit: 'proximity',
  },
  async ({ body }) => {
    const customerId = customerFrom(body.token)
    const businessId = await businessFor(customerId)
    if (!businessId) throw forbidden('This card is no longer active')

    const outcome = await reportPosition({
      businessId,
      customerId,
      position: { lat: body.lat, lng: body.lng },
      accuracyMeters: body.accuracyMeters ?? null,
      platform: body.platform ?? 'web',
    })

    // The response is deliberately thin. A customer's browser has no business
    // knowing which campaigns exist, which rules matched, or why one did not
    // fire — that is merchant-facing detail and it stays server-side.
    return {
      at_location: outcome.location?.name ?? null,
      distance_meters: outcome.location?.distanceMeters ?? null,
      nearby: outcome.nearby,
      notified: outcome.notification?.sent ?? false,
    }
  }
)

/**
 * A client-reported funnel event: an impression, a tap, a wallet open.
 *
 * These are the only funnel stages a server cannot observe, which is why they are
 * accepted from a client at all. Revenue is never accepted here — it is attributed
 * server-side from a real ledger entry, because a client-supplied figure would make
 * the merchant's ROI column fiction.
 */
export const PUT = defineRoute(
  {
    name: 'public.proximity.event',
    auth: 'none',
    body: walletEventSchema,
    rateLimit: 'proximity',
  },
  async ({ body }) => {
    const customerId = customerFrom(body.token)
    const businessId = await businessFor(customerId)
    if (!businessId) throw forbidden('This card is no longer active')

    await recordWalletEvent({
      businessId,
      customerId,
      type: body.type as Parameters<typeof recordWalletEvent>[0]['type'],
      campaignId: body.campaignId ?? null,
      locationId: body.locationId ?? null,
      platform: body.platform ?? 'web',
    })

    return { ok: true }
  }
)
