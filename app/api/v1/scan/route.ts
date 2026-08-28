import { defineRoute } from '@/lib/api/handler'
import { scanSchema } from '@/lib/api/schemas'
import { forbidden } from '@/lib/errors'
import { performScan } from '@/lib/scan/checkin'

export const runtime = 'nodejs'

/**
 * The counter endpoint.
 *
 * Everything a scan can mean resolves here: a wallet pass, a reward claim code,
 * a gift card, a referral code, a typed phone number. The client sends the raw
 * string and the server decides what it was — so a merchant never has to pick a
 * mode before pointing the camera, and every client stays consistent.
 *
 * With `action: "checkin"` it also credits the visit in the same request, which
 * is what keeps the scan-to-confirmation time inside a second on café wifi.
 */
export const POST = defineRoute(
  {
    name: 'scan',
    auth: 'required',
    body: scanSchema,
    businessIdFrom: { source: 'body', key: 'businessId' },
    permissions: ['customers:read'],
    rateLimit: 'pos',
  },
  async ({ body, actor, business, log }) => {
    // Identifying a customer needs `customers:read`; crediting one needs
    // `loyalty:earn`. Checked here rather than in the route options so a viewer
    // can still look someone up.
    if (body.action === 'checkin' && !business.permissions.has('loyalty:earn')) {
      throw forbidden('Your role cannot record visits')
    }

    const startedAt = Date.now()

    const result = await performScan({
      businessId: business.businessId,
      raw: body.raw,
      staffUserId: actor.id,
      source: actor.kind === 'api_key' ? 'api' : 'pos',
      action:
        body.action === 'checkin'
          ? {
              type: 'checkin',
              trigger: body.trigger,
              amount: body.amount ?? null,
              quantity: body.quantity ?? null,
              idempotencyKey: body.idempotencyKey!,
              locationId: body.locationId ?? null,
            }
          : { type: 'identify' },
    })

    // Counter speed is a number merchants care about and a regression we want to
    // notice before they do, so every scan reports how long it actually took.
    log.info('scan.resolved', {
      resolution: result.resolution.kind,
      action: body.action,
      server_ms: Date.now() - startedAt,
      decode_ms: body.decodeMs ?? null,
      replayed: Boolean(body.queuedAt),
      duplicate: result.checkin?.duplicate ?? false,
    })

    return {
      resolution: result.resolution,
      checkin: result.checkin,
      fulfilled: result.fulfilled,
      /** Echoed so an offline replay can be matched to its queued entry. */
      queued_at: body.queuedAt ?? null,
    }
  }
)
