import { createHmac, timingSafeEqual } from 'node:crypto'
import { getDb } from '@/lib/db'
import { ingestPurchase, maybeAutoEnroll, type NormalizedPurchase } from '@/lib/integrations/ingest'
import { env } from '@/lib/env'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Inbound commerce webhooks.
 *
 * One route, one adapter per provider. Every provider signs differently, so
 * verification is explicit per provider and the raw body is read *before* any
 * parsing — a signature computed over re-serialised JSON never matches.
 *
 * A webhook that fails verification returns 401 and is not retried into the
 * loyalty engine, so a spoofed request cannot mint points.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ provider: string }> }
) {
  const { provider } = await context.params
  const businessId = new URL(request.url).searchParams.get('business')
  const rawBody = await request.text()

  if (!businessId) return json({ error: 'Missing business parameter' }, 400)

  const admin = getDb()
  const { data: integration } = await admin
    .from('integrations')
    .select('id, credentials, config, auto_earn_enabled')
    .eq('business_id', businessId)
    .eq('provider', provider)
    .maybeSingle()

  if (!integration) return json({ error: 'Integration not connected' }, 404)

  const credentials = (integration.credentials as Record<string, string>) ?? {}

  if (!verifySignature(provider, request, rawBody, credentials)) {
    logger.warn('integrations.bad_signature', { provider, businessId })
    return json({ error: 'Invalid signature' }, 401)
  }

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  const purchase = adapt(provider, payload)
  if (!purchase) {
    // Not every event is a purchase; acknowledge so the provider stops retrying.
    return json({ ignored: true, reason: 'event_not_relevant' }, 200)
  }

  let result = await ingestPurchase(businessId, purchase)

  if (result.status === 'no_customer') {
    const customerId = await maybeAutoEnroll(businessId, purchase)
    if (customerId) result = await ingestPurchase(businessId, purchase)
  }

  return json({ status: result.status, awarded: result.awarded ?? 0 }, 200)
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// -----------------------------------------------------------------------------
// Signature verification
// -----------------------------------------------------------------------------

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB)
}

function verifySignature(
  provider: string,
  request: Request,
  rawBody: string,
  credentials: Record<string, string>
): boolean {
  switch (provider) {
    case 'stripe': {
      const secret = credentials.webhook_secret ?? env.stripe.webhookSecret
      const header = request.headers.get('stripe-signature')
      if (!secret || !header) return false
      // t=timestamp,v1=signature
      const parts = Object.fromEntries(
        header.split(',').map((part) => part.split('=') as [string, string])
      )
      if (!parts.t || !parts.v1) return false
      // Reject anything older than 5 minutes to prevent replay.
      if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) return false
      const expected = createHmac('sha256', secret)
        .update(`${parts.t}.${rawBody}`)
        .digest('hex')
      return safeEqual(parts.v1, expected)
    }

    case 'shopify': {
      const secret = credentials.webhook_secret
      const header = request.headers.get('x-shopify-hmac-sha256')
      if (!secret || !header) return false
      const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64')
      return safeEqual(header, expected)
    }

    case 'square': {
      const secret = credentials.signature_key
      const header = request.headers.get('x-square-hmacsha256-signature')
      const notificationUrl = credentials.notification_url
      if (!secret || !header || !notificationUrl) return false
      const expected = createHmac('sha256', secret)
        .update(notificationUrl + rawBody)
        .digest('base64')
      return safeEqual(header, expected)
    }

    case 'woocommerce': {
      const secret = credentials.webhook_secret
      const header = request.headers.get('x-wc-webhook-signature')
      if (!secret || !header) return false
      const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64')
      return safeEqual(header, expected)
    }

    case 'sumup':
    case 'zapier':
    case 'make':
    case 'custom': {
      /*
       * Providers without native signing authenticate with a shared secret
       * header issued when the integration is connected.
       *
       * `x-passimo-secret` is the documented header. `x-fidelio-secret` is still
       * accepted because the header name is configured in somebody else's system
       * — a Zapier action, a till, a bespoke script — and a rename we ship cannot
       * reach into their configuration. Both carry the same secret, so accepting
       * the old spelling widens no trust boundary.
       */
      const secret = credentials.shared_secret
      const header =
        request.headers.get('x-passimo-secret') ?? request.headers.get('x-fidelio-secret')
      return Boolean(secret && header && safeEqual(header, secret))
    }

    default:
      return false
  }
}

// -----------------------------------------------------------------------------
// Provider adapters — normalise each payload into one purchase shape
// -----------------------------------------------------------------------------

function adapt(provider: string, payload: Record<string, unknown>): NormalizedPurchase | null {
  switch (provider) {
    case 'stripe':
      return adaptStripe(payload)
    case 'square':
      return adaptSquare(payload)
    case 'shopify':
      return adaptShopify(payload)
    case 'woocommerce':
      return adaptWooCommerce(payload)
    case 'sumup':
      return adaptSumUp(payload)
    default:
      return adaptGeneric(provider, payload)
  }
}

function adaptStripe(payload: Record<string, unknown>): NormalizedPurchase | null {
  const type = payload.type as string
  if (!['checkout.session.completed', 'payment_intent.succeeded', 'charge.succeeded'].includes(type)) {
    return null
  }
  const object = (payload.data as { object?: Record<string, unknown> })?.object ?? {}
  // Stripe amounts are in the currency's minor unit.
  const amountMinor = Number(object.amount_total ?? object.amount_received ?? object.amount ?? 0)
  if (!amountMinor) return null

  const details = object.customer_details as { email?: string; phone?: string } | undefined
  return {
    provider: 'stripe',
    externalId: String(payload.id ?? object.id),
    email: details?.email ?? (object.receipt_email as string) ?? null,
    phone: details?.phone ?? null,
    externalCustomerId: (object.customer as string) ?? null,
    amount: amountMinor / 100,
    currency: String(object.currency ?? 'eur').toUpperCase(),
    occurredAt: payload.created ? new Date(Number(payload.created) * 1000).toISOString() : null,
    metadata: { stripe_event: type },
  }
}

function adaptSquare(payload: Record<string, unknown>): NormalizedPurchase | null {
  if (payload.type !== 'payment.updated' && payload.type !== 'payment.created') return null
  const payment = (payload.data as { object?: { payment?: Record<string, unknown> } })?.object
    ?.payment
  if (!payment || payment.status !== 'COMPLETED') return null

  const money = payment.amount_money as { amount?: number; currency?: string } | undefined
  const buyer = payment.buyer_email_address as string | undefined
  return {
    provider: 'square',
    externalId: String(payment.id),
    email: buyer ?? null,
    externalCustomerId: (payment.customer_id as string) ?? null,
    amount: Number(money?.amount ?? 0) / 100,
    currency: String(money?.currency ?? 'EUR'),
    occurredAt: (payment.created_at as string) ?? null,
    locationExternalId: (payment.location_id as string) ?? null,
    metadata: { square_order_id: payment.order_id },
  }
}

function adaptShopify(payload: Record<string, unknown>): NormalizedPurchase | null {
  const total = Number(payload.total_price ?? 0)
  if (!total) return null
  const customer = payload.customer as
    | { id?: number; email?: string; phone?: string }
    | undefined
  return {
    provider: 'shopify',
    externalId: String(payload.id),
    email: (payload.email as string) ?? customer?.email ?? null,
    phone: customer?.phone ?? null,
    externalCustomerId: customer?.id ? String(customer.id) : null,
    amount: total,
    currency: String(payload.currency ?? 'EUR'),
    quantity: Array.isArray(payload.line_items) ? payload.line_items.length : null,
    occurredAt: (payload.created_at as string) ?? null,
    metadata: { order_number: payload.order_number },
  }
}

function adaptWooCommerce(payload: Record<string, unknown>): NormalizedPurchase | null {
  if (!['completed', 'processing'].includes(String(payload.status))) return null
  const total = Number(payload.total ?? 0)
  if (!total) return null
  const billing = payload.billing as { email?: string; phone?: string } | undefined
  return {
    provider: 'woocommerce',
    externalId: String(payload.id),
    email: billing?.email ?? null,
    phone: billing?.phone ?? null,
    externalCustomerId: payload.customer_id ? String(payload.customer_id) : null,
    amount: total,
    currency: String(payload.currency ?? 'EUR'),
    occurredAt: (payload.date_created_gmt as string) ?? null,
    metadata: { order_key: payload.order_key },
  }
}

function adaptSumUp(payload: Record<string, unknown>): NormalizedPurchase | null {
  if (payload.status !== 'SUCCESSFUL' && payload.status !== 'PAID') return null
  const amount = Number(payload.amount ?? 0)
  if (!amount) return null
  return {
    provider: 'sumup',
    externalId: String(payload.id ?? payload.transaction_code),
    email: (payload.customer_email as string) ?? null,
    amount,
    currency: String(payload.currency ?? 'EUR'),
    occurredAt: (payload.timestamp as string) ?? null,
    metadata: { transaction_code: payload.transaction_code },
  }
}

/** Zapier / Make / custom: a documented flat shape anyone can post. */
function adaptGeneric(
  provider: string,
  payload: Record<string, unknown>
): NormalizedPurchase | null {
  const amount = Number(payload.amount ?? 0)
  if (!amount && !payload.email) return null
  return {
    provider,
    externalId: String(payload.id ?? payload.external_id ?? crypto.randomUUID()),
    email: (payload.email as string) ?? null,
    phone: (payload.phone as string) ?? null,
    amount,
    currency: String(payload.currency ?? 'EUR'),
    quantity: payload.quantity ? Number(payload.quantity) : null,
    occurredAt: (payload.occurred_at as string) ?? null,
    metadata: { source: provider },
  }
}
