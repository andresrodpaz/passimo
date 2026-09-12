import { z } from 'zod'
import { defineRoute } from '@/lib/api/handler'
import { getDb } from '@/lib/db'
import { env } from '@/lib/env'
import { issueCardToken } from '@/lib/loyalty/card-token'
import { notFound, unprocessable } from '@/lib/errors'
import { recordAudit } from '@/lib/audit'

export const runtime = 'nodejs'

const paramsSchema = z.object({ id: z.string().uuid() })
const businessQuery = z.object({ businessId: z.string().uuid() })

/**
 * A customer's card link, and the button that invalidates it.
 *
 * The link is a bearer credential: whoever holds the URL sees the card, and
 * this card carries gift-card balances and redemption codes. So a merchant
 * needs an answer to "I think someone else has my card link" that does not
 * involve deleting the member — which, before `card_token_version` existed, was
 * the only option there was.
 *
 * Tenant safety comes from `defineRoute`, not from the request: `businessIdFrom`
 * resolves the workspace and verifies the caller's membership before the
 * handler runs, so `business.businessId` is proven rather than supplied. The
 * customer id in the path is then checked against it, and the rotation function
 * checks the pair a third time in SQL. A merchant naming another tenant's
 * customer gets the same 404 as one naming a customer that does not exist —
 * distinguishing them would make this endpoint an existence oracle.
 */

/** Confirms the customer belongs to the caller's workspace. */
async function requireOwnCustomer(businessId: string, customerId: string): Promise<void> {
  const admin = getDb()
  const { data } = await admin
    .from('customers')
    .select('id')
    .eq('id', customerId)
    .eq('business_id', businessId)
    .maybeSingle()

  if (!data) throw notFound('Customer')
}

/**
 * The link as it stands. Minted on request rather than stored: the token is
 * stateless, so "the current link" is simply a fresh signature at the
 * customer's current version. Nothing is written and nothing is invalidated.
 */
export const GET = defineRoute(
  {
    name: 'customers.card_link',
    auth: 'required',
    params: paramsSchema,
    query: businessQuery,
    businessIdFrom: { source: 'query', key: 'businessId' },
    permissions: ['customers:read'],
    rateLimit: 'dashboard',
  },
  async ({ params, business }) => {
    await requireOwnCustomer(business.businessId, params.id)
    return { card_url: `${env.appUrl}/card/${await issueCardToken(params.id)}` }
  }
)

/**
 * Invalidates every link issued so far and returns a new one.
 *
 * `customers:write` rather than `customers:delete`: this is recoverable — the
 * replacement link is in the response — and the person who needs it is usually
 * the one at the counter with the customer in front of them. Erasure stays at
 * admin level because erasure is not recoverable.
 *
 * **What this does not revoke.** An already-installed Apple or Google pass
 * keeps working. It authenticates to the pass web service with
 * `customers.wallet_auth_token`, a separate credential this does not touch, and
 * the card link baked into the pass is re-minted the next time the pass
 * updates. Rotation revokes the *browser* card link. Saying otherwise in the UI
 * would be the more dangerous kind of wrong, so the copy says exactly this.
 */
export const POST = defineRoute(
  {
    name: 'customers.card_link.rotate',
    auth: 'required',
    params: paramsSchema,
    query: businessQuery,
    businessIdFrom: { source: 'query', key: 'businessId' },
    permissions: ['customers:write'],
    rateLimit: 'dashboard',
  },
  async ({ params, actor, business, request }) => {
    await requireOwnCustomer(business.businessId, params.id)

    const admin = getDb()
    const { data, error } = await admin.rpc('passimo_rotate_card_token', {
      p_business_id: business.businessId,
      p_customer_id: params.id,
    })
    if (error) throw unprocessable(error.message)
    // Null means the function's own tenant check disagreed with ours. It should
    // be unreachable after `requireOwnCustomer`, and it is still not ignored.
    if (data === null || data === undefined) throw notFound('Customer')

    /*
     * Audited, because invalidating somebody's card is a security action and
     * "who did this and when" is the question asked afterwards. The token, the
     * URL and the version are all deliberately absent: an audit row is read by
     * more people than the endpoint is, and a log that quietly republishes the
     * credential it is recording the rotation of would defeat the rotation.
     */
    await recordAudit({
      businessId: business.businessId,
      actor,
      action: 'customer.card_link_rotated',
      resourceType: 'customer',
      resourceId: params.id,
      summary: 'Card link rotated; previous links no longer open this card',
      request,
    })

    return {
      ok: true,
      rotated: true,
      card_url: `${env.appUrl}/card/${await issueCardToken(params.id)}`,
    }
  }
)
