import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { env } from '@/lib/env'
import { logger } from '@/lib/logger'
import { notConfigured, upstreamFailed } from '@/lib/errors'

/**
 * A minimal Stripe client over `fetch`.
 *
 * The official SDK is 3 MB and pulls in a Node HTTP stack that Edge and
 * serverless cold starts pay for on every boot. We use six endpoints, all of
 * them form-encoded POSTs, so the surface here is smaller than the shim we
 * would need to write around the SDK anyway — and signature verification is
 * eleven lines of `node:crypto`.
 *
 * Everything returns `null` rather than throwing when Stripe is unconfigured,
 * so a self-hosted deployment without billing simply has no billing screen.
 */

const API = 'https://api.stripe.com/v1'

export function isStripeConfigured(): boolean {
  return env.stripe.isConfigured
}

/** Stripe accepts nested objects as `a[b][c]=v`; this is that encoding. */
function toForm(value: Record<string, unknown>, prefix = ''): string[] {
  const parts: string[] = []
  for (const [key, raw] of Object.entries(value)) {
    if (raw === undefined || raw === null) continue
    const name = prefix ? `${prefix}[${key}]` : key
    if (Array.isArray(raw)) {
      raw.forEach((item, index) => {
        if (item && typeof item === 'object') {
          parts.push(...toForm(item as Record<string, unknown>, `${name}[${index}]`))
        } else {
          parts.push(`${encodeURIComponent(`${name}[${index}]`)}=${encodeURIComponent(String(item))}`)
        }
      })
    } else if (typeof raw === 'object') {
      parts.push(...toForm(raw as Record<string, unknown>, name))
    } else {
      parts.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(raw))}`)
    }
  }
  return parts
}

async function stripeRequest<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'DELETE'
    body?: Record<string, unknown>
    idempotencyKey?: string
  } = {}
): Promise<T> {
  const secret = env.stripe.secretKey
  if (!secret) throw notConfigured('Billing (STRIPE_SECRET_KEY)')

  const method = options.method ?? 'POST'
  const encoded = options.body ? toForm(options.body).join('&') : undefined

  const headers: Record<string, string> = {
    Authorization: `Bearer ${secret}`,
    'Stripe-Version': '2024-11-20.acacia',
  }
  if (encoded) headers['Content-Type'] = 'application/x-www-form-urlencoded'
  // Stripe deduplicates retried writes for 24h against this key, which is what
  // makes a network timeout during checkout safe to retry.
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey

  let response: Response
  try {
    response = await fetch(`${API}${path}`, {
      method,
      headers,
      body: encoded,
      signal: AbortSignal.timeout(15_000),
    })
  } catch (cause) {
    throw upstreamFailed('Stripe', cause)
  }

  const text = await response.text()
  const payload = text ? (JSON.parse(text) as Record<string, unknown>) : {}

  if (!response.ok) {
    const detail = (payload.error ?? {}) as { message?: string; code?: string }
    logger.error('stripe.request_failed', {
      path,
      status: response.status,
      code: detail.code,
      message: detail.message,
    })
    throw upstreamFailed('Stripe', new Error(detail.message ?? `HTTP ${response.status}`))
  }

  return payload as T
}

// -----------------------------------------------------------------------------
// Customers
// -----------------------------------------------------------------------------

export type StripeCustomer = { id: string; email: string | null }

export async function createCustomer(input: {
  email: string
  name: string
  businessId: string
}): Promise<StripeCustomer> {
  return stripeRequest<StripeCustomer>('/customers', {
    body: {
      email: input.email,
      name: input.name,
      // The reverse lookup the webhook needs when Stripe is the source of truth.
      metadata: { business_id: input.businessId },
    },
    idempotencyKey: `customer:${input.businessId}`,
  })
}

// -----------------------------------------------------------------------------
// Checkout & portal
// -----------------------------------------------------------------------------

export type CheckoutSession = { id: string; url: string | null }

export async function createCheckoutSession(input: {
  customerId: string
  priceId: string
  businessId: string
  plan: string
  interval: 'month' | 'year'
  successUrl: string
  cancelUrl: string
  trialDays?: number
}): Promise<CheckoutSession> {
  return stripeRequest<CheckoutSession>('/checkout/sessions', {
    body: {
      mode: 'subscription',
      customer: input.customerId,
      line_items: [{ price: input.priceId, quantity: 1 }],
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      allow_promotion_codes: true,
      // Required for VAT/IVA in the EU, and it is the merchant's own invoice.
      billing_address_collection: 'auto',
      automatic_tax: { enabled: true },
      customer_update: { address: 'auto', name: 'auto' },
      subscription_data: {
        metadata: { business_id: input.businessId, plan: input.plan },
        ...(input.trialDays && input.trialDays > 0 ? { trial_period_days: input.trialDays } : {}),
      },
      metadata: { business_id: input.businessId, plan: input.plan, interval: input.interval },
    },
  })
}

export type PortalSession = { id: string; url: string }

export async function createPortalSession(input: {
  customerId: string
  returnUrl: string
}): Promise<PortalSession> {
  return stripeRequest<PortalSession>('/billing_portal/sessions', {
    body: { customer: input.customerId, return_url: input.returnUrl },
  })
}

// -----------------------------------------------------------------------------
// One-off payments (gift cards bought by the public)
// -----------------------------------------------------------------------------

export async function createGiftCardCheckout(input: {
  businessId: string
  businessName: string
  amountCents: number
  currency: string
  purchaserEmail: string
  successUrl: string
  cancelUrl: string
  metadata: Record<string, string>
}): Promise<CheckoutSession> {
  return stripeRequest<CheckoutSession>('/checkout/sessions', {
    body: {
      mode: 'payment',
      customer_email: input.purchaserEmail,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: input.currency.toLowerCase(),
            unit_amount: input.amountCents,
            product_data: {
              name: `${input.businessName} gift card`,
              description: `A gift card redeemable at ${input.businessName}.`,
            },
          },
        },
      ],
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      payment_intent_data: {
        metadata: { ...input.metadata, business_id: input.businessId, kind: 'gift_card' },
      },
      metadata: { ...input.metadata, business_id: input.businessId, kind: 'gift_card' },
    },
  })
}

// -----------------------------------------------------------------------------
// Subscriptions
// -----------------------------------------------------------------------------

export type StripeSubscription = {
  id: string
  status: string
  cancel_at_period_end: boolean
  current_period_end: number
  customer: string
  items: { data: Array<{ price: { id: string; recurring?: { interval?: string } } }> }
  metadata?: Record<string, string>
}

export async function getSubscription(id: string): Promise<StripeSubscription> {
  return stripeRequest<StripeSubscription>(`/subscriptions/${id}`, { method: 'GET' })
}

export async function cancelSubscriptionAtPeriodEnd(
  id: string,
  cancel = true
): Promise<StripeSubscription> {
  return stripeRequest<StripeSubscription>(`/subscriptions/${id}`, {
    body: { cancel_at_period_end: cancel },
  })
}

// -----------------------------------------------------------------------------
// Webhook signature verification
// -----------------------------------------------------------------------------

export type StripeEvent = {
  id: string
  type: string
  data: { object: Record<string, unknown> }
  created: number
}

/**
 * Verifies the `Stripe-Signature` header against the raw request body.
 *
 * Rejects on a stale timestamp as well as a bad digest: without the tolerance
 * check a signature captured once could be replayed forever.
 */
export function verifyWebhook(
  rawBody: string,
  signatureHeader: string | null,
  toleranceSeconds = 300
): StripeEvent {
  const secret = env.stripe.webhookSecret
  if (!secret) throw notConfigured('Billing webhooks (STRIPE_WEBHOOK_SECRET)')
  if (!signatureHeader) throw upstreamFailed('Stripe', new Error('Missing Stripe-Signature header'))

  const parts = new Map(
    signatureHeader.split(',').map((piece) => {
      const [key, ...rest] = piece.trim().split('=')
      return [key ?? '', rest.join('=')] as const
    })
  )

  const timestamp = parts.get('t')
  const signature = parts.get('v1')
  if (!timestamp || !signature) {
    throw upstreamFailed('Stripe', new Error('Malformed Stripe-Signature header'))
  }

  const age = Math.abs(Date.now() / 1000 - Number(timestamp))
  if (!Number.isFinite(age) || age > toleranceSeconds) {
    throw upstreamFailed('Stripe', new Error('Stripe signature timestamp outside tolerance'))
  }

  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`, 'utf8')
    .digest('hex')

  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(signature, 'utf8')
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw upstreamFailed('Stripe', new Error('Stripe signature mismatch'))
  }

  return JSON.parse(rawBody) as StripeEvent
}

/**
 * Maps a plan + interval to the configured Stripe price.
 *
 * Prices live in environment variables rather than the database because they
 * are deployment configuration: the same plan is a different price id in test
 * and live mode, and nobody should be editing that in a settings screen.
 */
export function priceIdFor(plan: string, interval: 'month' | 'year'): string | null {
  const key = `STRIPE_PRICE_${plan.toUpperCase()}_${interval === 'year' ? 'YEARLY' : 'MONTHLY'}`
  const value = process.env[key]
  return value && value.trim() !== '' ? value.trim() : null
}
