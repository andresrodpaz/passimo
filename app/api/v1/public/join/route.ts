import { defineRoute } from '@/lib/api/handler'
import { publicJoinSchema } from '@/lib/api/schemas'
import { getDb } from '@/lib/db'
import { notFound, unprocessable } from '@/lib/errors'
import { clientIp } from '@/lib/rate-limit'
import { enqueue } from '@/lib/jobs/queue'
import { recordEarn } from '@/lib/loyalty/engine'
import { signToken } from '@/lib/crypto'
import { env } from '@/lib/env'
import { logger } from '@/lib/logger'
import { reportSoftLimit } from '@/lib/billing/soft-limit'

export const runtime = 'nodejs'

/**
 * Public enrolment — the customer scanned the QR code in the shop.
 *
 * Unauthenticated by necessity, so it is tightly rate limited per IP, requires
 * explicit terms acceptance, records where and how consent was captured, and
 * never reveals whether an email was already enrolled (that would turn the
 * endpoint into a customer-list oracle for a competitor).
 */
export const POST = defineRoute(
  {
    name: 'public.join',
    auth: 'none',
    body: publicJoinSchema,
    rateLimit: 'publicStrict',
  },
  async ({ body, request }) => {
    const admin = getDb()

    const { data: business } = await admin
      .from('businesses')
      .select('id, name, slug, locale')
      .eq('slug', body.businessSlug)
      .is('archived_at', null)
      .maybeSingle()

    if (!business) throw notFound('Business')

    const { data, error } = await admin.rpc('passimo_enroll_customer', {
      p_business_id: business.id,
      p_email: body.email.toLowerCase(),
      p_name: body.name ?? null,
      p_first_name: body.name?.split(' ')[0] ?? null,
      p_last_name: body.name?.split(' ').slice(1).join(' ') || null,
      p_phone: body.phone ?? null,
      p_birthday: body.birthday ?? null,
      p_locale: body.locale ?? business.locale,
      p_source: 'qr',
      p_location_id: body.locationId ?? null,
      p_referral_code: body.referralCode ?? null,
      p_consents: {
        email: body.consents.email,
        sms: body.consents.sms,
        whatsapp: body.consents.whatsapp,
        push: true,
        marketing: body.consents.marketing,
      },
      p_consent_ip: nullableIp(clientIp(request)),
      p_custom_fields: {},
    })

    if (error) throw unprocessable(error.message)
    const payload = data as { is_new: boolean; customer_id: string; referral_code: string }

    if (payload.is_new) {
      // A customer standing in the shop with their phone out is never turned
      // away over a plan limit — that would cost the merchant a real sale to
      // sell them an upgrade, which is exactly backwards. The limit is soft
      // here: enrol them, then tell the owner they have outgrown their plan.
      void reportSoftLimit(business.id, 'customers')

      // Signup-triggered rules (welcome stamp) run through the same engine as
      // everything else rather than being special-cased here.
      await recordEarn({
        businessId: business.id,
        customerId: payload.customer_id,
        trigger: 'signup',
        source: 'web',
        locationId: body.locationId ?? null,
        idempotencyKey: `signup:${payload.customer_id}`,
      }).catch((cause) => logger.warn('join.signup_award_failed', { cause }))

      await Promise.allSettled([
        enqueue(
          'automation.enroll',
          {
            businessId: business.id,
            customerId: payload.customer_id,
            trigger: 'customer_joined',
          },
          { businessId: business.id, idempotencyKey: `joined:${payload.customer_id}` }
        ),
        enqueue(
          'webhook.deliver',
          {
            businessId: business.id,
            event: 'customer.created',
            data: { customer_id: payload.customer_id, source: 'qr' },
          },
          { businessId: business.id }
        ),
      ])
    }

    // A signed, long-lived capability URL: the customer's own card page. No
    // session required, and it cannot be guessed or enumerated.
    const cardToken = signToken('card', { c: payload.customer_id }, 365 * 86_400)

    return {
      // Deliberately identical whether or not the person already existed.
      joined: true,
      card_url: `${env.appUrl}/card/${cardToken}`,
      apple_wallet_url: `${env.appUrl}/api/v1/wallet/apple/${cardToken}`,
      google_wallet_url: `${env.appUrl}/api/v1/wallet/google/${cardToken}`,
      referral_code: payload.referral_code,
      business: { name: business.name, slug: business.slug },
    }
  }
)

function nullableIp(value: string): string | null {
  return value && value !== 'unknown' ? value : null
}
