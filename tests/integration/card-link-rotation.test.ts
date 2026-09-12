import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getDb } from '@/lib/db'
import { issueCardToken, verifyCardToken } from '@/lib/loyalty/card-token'
import { assertDatabaseReady, createTenant, dropTenant, shutdown, type TestTenant } from './helpers'

/**
 * Rotating a customer's card link: what it invalidates, and what it must not.
 *
 * The link is a bearer credential and the card behind it carries gift-card
 * balances and redemption codes, so a merchant needs to be able to kill a
 * leaked one. The risk in giving them that button is not that it fails — it is
 * that it does more than advertised. These tests pin both halves: the old link
 * stops, and the membership, balance, ledger and wallet credential do not.
 *
 * `join-hardening.test.ts` covers the token mechanics. This file is about the
 * rotation *operation* — tenant scoping, idempotence under repeats, and the
 * blast radius.
 */
describe('card link rotation', () => {
  let shopA: TestTenant
  let shopB: TestTenant

  beforeAll(async () => {
    await assertDatabaseReady()
    ;[shopA, shopB] = await Promise.all([
      createTenant('rot-a', { plan: 'growth' }),
      createTenant('rot-b', { plan: 'growth' }),
    ])
  })

  afterAll(async () => {
    await Promise.all([dropTenant(shopA), dropTenant(shopB)])
    await shutdown()
  })

  async function member(tenant: TestTenant): Promise<string> {
    const admin = getDb()
    const { data, error } = await admin.rpc('passimo_enroll_customer', {
      p_business_id: tenant.businessId,
      p_email: `rot-${Date.now()}-${Math.random()}@example.test`,
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
    if (error) throw new Error(error.message)
    return (data as { customer_id: string }).customer_id
  }

  function rotate(businessId: string, customerId: string) {
    return getDb().rpc('passimo_rotate_card_token', {
      p_business_id: businessId,
      p_customer_id: customerId,
    })
  }

  describe('tenant scoping', () => {
    it('a merchant can rotate their own customer', async () => {
      const customerId = await member(shopA)
      const before = await issueCardToken(customerId)

      const { data, error } = await rotate(shopA.businessId, customerId)
      expect(error).toBeNull()
      expect(Number(data)).toBeGreaterThan(0)

      expect(await verifyCardToken(before)).toBeNull()
    })

    it('a merchant cannot rotate another shop’s customer', async () => {
      /*
       * The decisive one. Shop B names a real customer id that happens to
       * belong to shop A — the sort of id that leaks through a screenshot or a
       * support ticket — and must change nothing.
       */
      const customerId = await member(shopA)
      const token = await issueCardToken(customerId)

      const { data } = await rotate(shopB.businessId, customerId)

      expect(data ?? null).toBeNull()
      expect(await verifyCardToken(token)).toEqual({ customerId })
    })

    it('a customer that does not exist is refused the same way', async () => {
      // Indistinguishable from "not yours", so the endpoint is not an oracle.
      const { data } = await rotate(shopA.businessId, '00000000-0000-0000-0000-000000000000')
      expect(data ?? null).toBeNull()
    })
  })

  describe('what rotation leaves alone', () => {
    it('keeps the member, their account and their balance exactly as they were', async () => {
      const customerId = await member(shopA)
      const admin = getDb()

      const before = {
        customer: (
          await admin
            .from('customers')
            .select('id, status, email, referral_code, business_id')
            .eq('id', customerId)
            .maybeSingle()
        ).data,
        accounts: (
          await admin
            .from('loyalty_accounts')
            .select('id, program_id, balance, lifetime_earned')
            .eq('customer_id', customerId)
        ).data,
        ledger: (await admin.from('loyalty_ledger').select('id').eq('customer_id', customerId)).data,
      }

      await rotate(shopA.businessId, customerId)

      const after = {
        customer: (
          await admin
            .from('customers')
            .select('id, status, email, referral_code, business_id')
            .eq('id', customerId)
            .maybeSingle()
        ).data,
        accounts: (
          await admin
            .from('loyalty_accounts')
            .select('id, program_id, balance, lifetime_earned')
            .eq('customer_id', customerId)
        ).data,
        ledger: (await admin.from('loyalty_ledger').select('id').eq('customer_id', customerId)).data,
      }

      expect(after).toEqual(before)
    })

    it('does not touch the wallet pass credential', async () => {
      /*
       * `customers.wallet_auth_token` is what an installed Apple pass presents
       * to the pass web service. It is a different credential on purpose, and
       * rotation must not disturb it — otherwise "replace the card link" would
       * silently break a pass the customer already has on their phone, which is
       * the opposite of what the confirmation dialog promises.
       */
      const customerId = await member(shopA)
      const admin = getDb()

      await admin
        .from('customers')
        .update({ wallet_auth_token: 'fixed-token-for-this-test' })
        .eq('id', customerId)

      await rotate(shopA.businessId, customerId)

      const { data } = await admin
        .from('customers')
        .select('wallet_auth_token')
        .eq('id', customerId)
        .maybeSingle()
      expect((data as { wallet_auth_token: string }).wallet_auth_token).toBe(
        'fixed-token-for-this-test'
      )
    })

    it('leaves a gift card’s balance and code untouched', async () => {
      const customerId = await member(shopA)
      const admin = getDb()

      const { data: created, error } = await admin
        .from('gift_cards')
        .insert({
          business_id: shopA.businessId,
          recipient_customer_id: customerId,
          code: `ROT${Date.now()}`.slice(0, 16),
          initial_value: 25,
          remaining_value: 25,
          currency: 'EUR',
          status: 'active',
        })
        .select('id, code, remaining_value')
        .single()
      if (error) throw new Error(error.message)

      await rotate(shopA.businessId, customerId)

      const { data: after } = await admin
        .from('gift_cards')
        .select('id, code, remaining_value')
        .eq('id', (created as { id: string }).id)
        .maybeSingle()
      expect(after).toEqual(created)
    })
  })

  describe('repeated rotation', () => {
    it('a double click leaves the newest link valid and every earlier one dead', async () => {
      /*
       * The merchant clicks twice, or two staff members click at once. The
       * update is a single statement, so the versions simply advance; what
       * matters is that the end state is coherent — exactly one live link.
       */
      const customerId = await member(shopA)

      const first = await issueCardToken(customerId)
      await rotate(shopA.businessId, customerId)
      const second = await issueCardToken(customerId)
      await rotate(shopA.businessId, customerId)
      const third = await issueCardToken(customerId)

      expect(await verifyCardToken(first)).toBeNull()
      expect(await verifyCardToken(second)).toBeNull()
      expect(await verifyCardToken(third)).toEqual({ customerId })
    })

    it('survives concurrent rotations without leaving a usable stale link', async () => {
      const customerId = await member(shopA)
      const stale = await issueCardToken(customerId)

      await Promise.all([
        rotate(shopA.businessId, customerId),
        rotate(shopA.businessId, customerId),
        rotate(shopA.businessId, customerId),
      ])

      expect(await verifyCardToken(stale)).toBeNull()
      // And the customer can still be issued a working link afterwards.
      expect(await verifyCardToken(await issueCardToken(customerId))).toEqual({ customerId })
    })
  })
})
