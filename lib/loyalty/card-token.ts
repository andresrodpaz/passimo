import 'server-only'
import { signToken, verifyToken } from '@/lib/crypto'
import { getDb } from '@/lib/db'

/**
 * The customer's card link: issuing it, and checking it is still good.
 *
 * `/card/{token}` is a capability URL. A customer has no account with us and
 * asking them to create one would kill adoption, so the link *is* the
 * credential: signed with HMAC-SHA256 over `card.<payload>`, purpose inside the
 * signed material, 365 days, verified in constant time. Tamper with the
 * customer id and the signature stops matching; the business is never a claim
 * at all, it is read from the customer row, so there is no tenant field to
 * forge.
 *
 * What that design could not do until now is **stop**. The only lever was
 * moving the customer out of `status = 'active'`, which the card route checks —
 * and which also ends their membership. So a link that leaked left two options:
 * ignore it, or delete the member.
 *
 * That is too blunt for what this surface actually returns. The card is no
 * longer a stamp count: `GET /api/v1/public/card/{token}` serves
 * `gift_cards.remaining_value` and `gift_cards.code`, and the `code` of every
 * claimed reward redemption — money, and bearer secrets that can be spent — on
 * a URL built to be long-lived, pasted into wallet passes and emails, and
 * screenshotted.
 *
 * `customers.card_token_version` closes that: it rides in the token as `v`, is
 * compared on every public read, and bumping it invalidates every link
 * previously issued for that customer while the membership, balance, history
 * and wallet registration all stay put.
 *
 * ## Where the check applies, and where it deliberately does not
 *
 * Only on the **public** surfaces — the card, the two wallet pass endpoints,
 * and the proximity ping. Those are the ones where the token is the whole
 * authorisation.
 *
 * The merchant-side paths that also accept a card token — `loyalty/earn`,
 * `customers/lookup`, `lib/scan/resolve` — keep using `verifyToken` directly.
 * There the token is an *identifier* answering "which customer is this?", and
 * the authorisation is the staff member's own authenticated, tenant-scoped
 * session. Rejecting a rotated token there would stop a shop serving a customer
 * standing in front of them, to prevent an attack the merchant's own session
 * already permits.
 */

/** The current version, or 0 for a customer we cannot read. */
async function currentVersion(customerId: string): Promise<number> {
  const admin = getDb()
  const { data } = await admin
    .from('customers')
    .select('card_token_version')
    .eq('id', customerId)
    .maybeSingle()

  return Number((data as { card_token_version?: number } | null)?.card_token_version ?? 0)
}

/**
 * Mints a card link for a customer.
 *
 * Reads the version rather than taking it on trust from the caller: every
 * issuing site would otherwise have to remember to thread it through, and one
 * that forgot would mint a token that is already invalid for any customer whose
 * link had ever been rotated. The read is one indexed lookup on a path that is
 * already doing database work, and it is not the hot path — issuing happens on
 * enrolment, on a message send and on pass build, never per card view.
 */
export async function issueCardToken(customerId: string, ttlSeconds = 365 * 86_400): Promise<string> {
  return signToken('card', { c: customerId, v: await currentVersion(customerId) }, ttlSeconds)
}

/**
 * Verifies a card link and returns the customer it names.
 *
 * Null covers every failure — bad signature, wrong purpose, expired, malformed,
 * or rotated — because the caller turns all of them into the same sentence. A
 * response that distinguished "expired" from "revoked" would tell whoever is
 * holding a leaked URL whether it is worth trying again.
 *
 * A token with no `v` claim reads as version 0, which is what every customer
 * starts at. That is what keeps links issued before this existed working: they
 * stay valid until somebody deliberately rotates that customer.
 */
export async function verifyCardToken(token: string): Promise<{ customerId: string } | null> {
  const payload = verifyToken<{ c: string; v?: number }>('card', token)
  if (!payload?.c) return null

  const claimed = Number(payload.v ?? 0)
  if (claimed !== (await currentVersion(payload.c))) return null

  return { customerId: payload.c }
}
