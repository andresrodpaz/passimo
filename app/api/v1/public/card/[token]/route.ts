import { z } from 'zod'
import { defineRoute } from '@/lib/api/handler'
import { verifyToken } from '@/lib/crypto'
import { getDb } from '@/lib/db'
import { getCustomerLoyalty } from '@/lib/loyalty/engine'
import { badRequest, notFound } from '@/lib/errors'
import { env } from '@/lib/env'
import { displayName, num } from '@/lib/domain/types'

export const runtime = 'nodejs'

const paramsSchema = z.object({ token: z.string().min(10).max(600) })

/**
 * The customer's own card, opened from an email or the wallet pass back.
 *
 * Authenticated by a signed capability token rather than a session — a customer
 * has no account with us, and asking them to create one would kill adoption.
 * The token is purpose-scoped and expiring, so it cannot be replayed against
 * any other endpoint.
 */
export const GET = defineRoute(
  {
    name: 'public.card',
    auth: 'none',
    params: paramsSchema,
    rateLimit: 'publicRelaxed',
  },
  async ({ params }) => {
    const payload = verifyToken<{ c: string }>('card', params.token)
    if (!payload?.c) throw badRequest('This link is invalid or has expired')

    const admin = getDb()
    const { data: customer } = await admin
      .from('customers')
      .select(
        'id, business_id, name, first_name, last_name, email, referral_code, created_at, status, is_vip'
      )
      .eq('id', payload.c)
      .maybeSingle()

    if (!customer || customer.status !== 'active') throw notFound('Card')

    const [{ data: business }, loyalty, { data: granted }, { data: giftCards }, { data: memberships }] =
      await Promise.all([
      admin
        .from('businesses')
        .select(
          'name, slug, logo_url, primary_color, accent_color, text_color, city, website, google_review_url'
        )
        .eq('id', customer.business_id as string)
        .maybeSingle(),
      getCustomerLoyalty(customer.business_id as string, customer.id as string),
      admin
        .from('reward_redemptions')
        .select('id, code, expires_at, rewards:reward_id (name, description)')
        .eq('customer_id', customer.id as string)
        .eq('status', 'claimed')
        .order('created_at', { ascending: false })
        .limit(5),
      // A gift card someone bought them is money they already hold. Showing it
      // on the card they actually open is the difference between it being spent
      // and it quietly expiring.
      admin
        .from('gift_cards')
        .select('code, remaining_value, currency, expires_at')
        .eq('recipient_customer_id', customer.id as string)
        .eq('status', 'active')
        .gt('remaining_value', 0)
        .order('created_at', { ascending: false })
        .limit(5),
      admin
        .from('customer_memberships')
        .select('current_period_end, membership_plans(name, perks, earn_multiplier)')
        .eq('customer_id', customer.id as string)
        .eq('status', 'active')
        .limit(3),
    ])

    if (!business) throw notFound('Business')

    return {
      customer: {
        id: customer.id,
        name: displayName({
          name: customer.name as string | null,
          firstName: customer.first_name as string | null,
          lastName: customer.last_name as string | null,
          email: customer.email as string | null,
        }),
        member_since: customer.created_at,
        is_vip: customer.is_vip,
        referral_code: customer.referral_code,
        referral_url: `${env.appUrl}/join/${business.slug}?ref=${customer.referral_code}`,
      },
      business,
      loyalty,
      claimable: (granted ?? []).map((row) => {
        const reward = row.rewards as unknown as { name: string; description: string | null } | null
        return {
          id: row.id,
          code: row.code,
          name: reward?.name ?? 'Reward',
          description: reward?.description ?? null,
          expires_at: row.expires_at,
        }
      }),
      gift_cards: (giftCards ?? []).map((card) => ({
        code: card.code,
        remaining_value: num(card.remaining_value),
        currency: (card.currency as string) ?? 'EUR',
        expires_at: card.expires_at,
      })),
      memberships: (memberships ?? []).map((membership) => {
        const plan = membership.membership_plans as unknown as {
          name: string
          perks: string[] | null
          earn_multiplier: number | string
        } | null
        return {
          name: plan?.name ?? 'Membership',
          perks: plan?.perks ?? [],
          earn_multiplier: num(plan?.earn_multiplier, 1),
          renews_at: membership.current_period_end,
        }
      }),
      wallet: {
        apple: `${env.appUrl}/api/v1/wallet/apple/${params.token}`,
        google: `${env.appUrl}/api/v1/wallet/google/${params.token}`,
        apple_available: env.apple.isConfigured,
        google_available: env.google.isConfigured,
      },
    }
  }
)
