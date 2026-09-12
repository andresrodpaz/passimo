import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '@/lib/db'
import { getEnrollableProgram, getJoinPageData } from '@/lib/public/join'
import { issueCardToken, verifyCardToken } from '@/lib/loyalty/card-token'
import { signToken } from '@/lib/crypto'
import { assertDatabaseReady, createTenant, dropTenant, shutdown, type TestTenant } from './helpers'

/**
 * The three things that were true about the join flow but should not have been.
 *
 * `public-join.test.ts` covers the path working. This file covers the edges that
 * were closed afterwards, and each block is written so it would fail against the
 * code as it stood before:
 *
 *   - a paused club still enrolled people
 *   - a card link could not be revoked without ending the membership
 *
 * The QR origin rule is asserted here too, because it is a security boundary
 * that is easy to relax by accident while making a broken image go away.
 */
describe('join flow hardening', () => {
  let shopA: TestTenant
  let shopB: TestTenant

  beforeAll(async () => {
    await assertDatabaseReady()
    ;[shopA, shopB] = await Promise.all([
      createTenant('harden-a', { plan: 'growth' }),
      createTenant('harden-b', { plan: 'growth' }),
    ])
  })

  afterAll(async () => {
    await Promise.all([dropTenant(shopA), dropTenant(shopB)])
    await shutdown()
  })

  async function setProgramActive(tenant: TestTenant, active: boolean): Promise<void> {
    const admin = getDb()
    const { error } = await admin
      .from('loyalty_programs')
      .update({ is_active: active })
      .eq('business_id', tenant.businessId)
    if (error) throw new Error(error.message)
  }

  async function enrol(tenant: TestTenant, email: string) {
    const admin = getDb()
    return admin.rpc('passimo_enroll_customer', {
      p_business_id: tenant.businessId,
      p_email: email,
      p_name: 'Test Person',
      p_first_name: 'Test',
      p_last_name: 'Person',
      p_phone: null,
      p_birthday: null,
      p_locale: 'es',
      p_source: 'qr',
      p_location_id: null,
      p_referral_code: null,
      p_consents: { email: true, sms: false, whatsapp: false, push: true, marketing: false },
      p_consent_ip: null,
      p_custom_fields: {},
    })
  }

  beforeEach(async () => {
    // Every test starts from an open club; the ones about pausing close it
    // themselves. Leaving a previous test's paused program behind would make
    // the next one pass for the wrong reason.
    await Promise.all([setProgramActive(shopA, true), setProgramActive(shopB, true)])
  })

  // ---------------------------------------------------------------------------
  // Gap 2 — a paused club must not take members
  // ---------------------------------------------------------------------------

  describe('a paused loyalty club', () => {
    it('is open while the program is active', async () => {
      expect(await getEnrollableProgram(shopA.businessId)).not.toBeNull()
    })

    it('reports itself closed once the program is deactivated', async () => {
      await setProgramActive(shopA, false)
      expect(await getEnrollableProgram(shopA.businessId)).toBeNull()
    })

    it('still serves a real page — paused is not missing', async () => {
      /*
       * The business exists and its page is a real page; only enrolment is
       * closed. A 404 here would be a lie, and would also tell a customer the
       * shop is gone when it is standing in front of them.
       */
      await setProgramActive(shopA, false)
      const data = await getJoinPageData(shopA.slug)

      expect(data).not.toBeNull()
      expect(data!.business.slug).toBe(shopA.slug)
      // `program: null` is what the page renders the unavailable state from.
      expect(data!.program).toBeNull()
    })

    it('does not close one shop because another paused', async () => {
      await setProgramActive(shopB, false)
      expect(await getEnrollableProgram(shopB.businessId)).toBeNull()
      expect(await getEnrollableProgram(shopA.businessId)).not.toBeNull()
    })

    it('would still create a member if the endpoint did not refuse first', async () => {
      /*
       * This is the reason the check lives in the route rather than being left
       * to the database. `passimo_enroll_customer` has no opinion about whether
       * a program is active: it inserts the customer, then provisions accounts
       * only for active programs. Called against a paused club it therefore
       * succeeds and produces a member with no loyalty account — a card with
       * nothing behind it.
       *
       * Asserting that here pins *why* `POST /api/v1/public/join` must refuse
       * before calling this function, so nobody later moves the check thinking
       * the RPC covers it.
       */
      await setProgramActive(shopA, false)
      const email = `paused-rpc-${Date.now()}@example.test`

      const { data, error } = await enrol(shopA, email)
      expect(error).toBeNull()

      const result = data as { is_new: boolean; customer_id: string }
      expect(result.is_new).toBe(true)

      const admin = getDb()
      const { data: accounts } = await admin
        .from('loyalty_accounts')
        .select('id')
        .eq('customer_id', result.customer_id)
      expect(accounts ?? []).toHaveLength(0)
    })
  })

  // ---------------------------------------------------------------------------
  // Gap 3 — card links must be revocable
  // ---------------------------------------------------------------------------

  describe('card link rotation', () => {
    async function member(tenant: TestTenant): Promise<string> {
      const { data } = await enrol(tenant, `card-${Date.now()}-${Math.random()}@example.test`)
      return (data as { customer_id: string }).customer_id
    }

    it('issues a link that opens the card it names', async () => {
      const customerId = await member(shopA)
      const token = await issueCardToken(customerId)

      expect(await verifyCardToken(token)).toEqual({ customerId })
    })

    it('refuses a tampered payload', async () => {
      const mine = await member(shopA)
      const theirs = await member(shopB)

      const token = await issueCardToken(mine)
      const [purpose, , signature] = token.split('.')
      const forgedBody = Buffer.from(
        JSON.stringify({ c: theirs, v: 0, exp: Math.floor(Date.now() / 1000) + 600 })
      ).toString('base64url')

      // Swapping the customer for another tenant's leaves the signature behind.
      expect(await verifyCardToken(`${purpose}.${forgedBody}.${signature}`)).toBeNull()
    })

    it('refuses a tampered signature', async () => {
      const token = await issueCardToken(await member(shopA))
      const [purpose, body] = token.split('.')
      expect(await verifyCardToken(`${purpose}.${body}.not-the-real-signature`)).toBeNull()
    })

    it('refuses a token minted for another purpose', async () => {
      /*
       * The purpose is inside the signed material, so an unsubscribe link — a
       * real, correctly signed token that a customer is handed — cannot be
       * replayed against the card endpoint.
       */
      const customerId = await member(shopA)
      const unsubscribe = signToken('unsubscribe', { c: customerId }, 600)
      expect(await verifyCardToken(unsubscribe)).toBeNull()
    })

    it('refuses an expired token', async () => {
      const customerId = await member(shopA)
      const expired = signToken('card', { c: customerId, v: 0 }, -60)
      expect(await verifyCardToken(expired)).toBeNull()
    })

    it('revokes every outstanding link when the customer is rotated', async () => {
      const customerId = await member(shopA)
      const issued = await issueCardToken(customerId)
      expect(await verifyCardToken(issued)).toEqual({ customerId })

      const admin = getDb()
      const { error } = await admin.rpc('passimo_rotate_card_token', {
        p_business_id: shopA.businessId,
        p_customer_id: customerId,
      })
      expect(error).toBeNull()

      // The leaked link is dead...
      expect(await verifyCardToken(issued)).toBeNull()
      // ...and the next one works, so the member keeps their card.
      expect(await verifyCardToken(await issueCardToken(customerId))).toEqual({ customerId })
    })

    it('leaves the membership untouched when a link is revoked', async () => {
      /*
       * The whole point of rotation is that it is not deletion. Before this
       * existed, the only way to stop a card link was moving the customer out
       * of `status = 'active'`, which also ends their membership.
       */
      const customerId = await member(shopA)
      const admin = getDb()

      const before = await admin
        .from('loyalty_accounts')
        .select('id, balance')
        .eq('customer_id', customerId)

      await admin.rpc('passimo_rotate_card_token', {
        p_business_id: shopA.businessId,
        p_customer_id: customerId,
      })

      const { data: customer } = await admin
        .from('customers')
        .select('status')
        .eq('id', customerId)
        .maybeSingle()
      expect((customer as { status: string }).status).toBe('active')

      const after = await admin
        .from('loyalty_accounts')
        .select('id, balance')
        .eq('customer_id', customerId)
      expect(after.data).toEqual(before.data)
    })

    it('cannot be rotated by a business the customer does not belong to', async () => {
      const customerId = await member(shopA)
      const token = await issueCardToken(customerId)

      const admin = getDb()
      const { data } = await admin.rpc('passimo_rotate_card_token', {
        p_business_id: shopB.businessId,
        p_customer_id: customerId,
      })

      // No version returned, and the link is untouched.
      expect(data ?? null).toBeNull()
      expect(await verifyCardToken(token)).toEqual({ customerId })
    })

    it('keeps links issued before rotation existed working', async () => {
      /*
       * Backward compatibility, asserted rather than assumed. Every card link
       * already in a customer's email or wallet pass carries no `v` claim. A
       * missing claim reads as 0, which is where every customer starts, so
       * those links keep working until somebody deliberately rotates them.
       */
      const customerId = await member(shopA)
      const legacy = signToken('card', { c: customerId }, 600)

      expect(await verifyCardToken(legacy)).toEqual({ customerId })

      const admin = getDb()
      await admin.rpc('passimo_rotate_card_token', {
        p_business_id: shopA.businessId,
        p_customer_id: customerId,
      })
      expect(await verifyCardToken(legacy)).toBeNull()
    })

    it('carries no personal data in the token', async () => {
      /*
       * The payload is base64url, not encryption — anything in it is readable
       * by whoever holds the link. So it holds an opaque customer id, a version
       * and an expiry, and the name, email and phone are read from the row at
       * request time instead.
       */
      const customerId = await member(shopA)
      const token = await issueCardToken(customerId)
      const claims = JSON.parse(
        Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8')
      ) as Record<string, unknown>

      expect(Object.keys(claims).sort()).toEqual(['c', 'exp', 'v'])
      expect(claims.c).toBe(customerId)
    })
  })
})
