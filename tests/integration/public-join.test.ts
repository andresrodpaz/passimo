import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getDb } from '@/lib/db'
import { getJoinPageData, toPublicJoinData } from '@/lib/public/join'
import { assertDatabaseReady, createTenant, dropTenant, shutdown, type TestTenant } from './helpers'

/**
 * The public enrolment path, against real rows.
 *
 * `/join/{slug}` is the product's single conversion point: a customer standing
 * in a shop with a phone in one hand. Everything upstream of it — the QR
 * endpoint, the dashboard panel, the printed poster — exists only to deliver
 * someone here, and everything downstream (loyalty account, card, wallet,
 * first stamp) only happens if this works.
 *
 * It was also, before this file, the least-tested path in the repository. The
 * e2e suite visits `/join/definitely-not-a-real-slug` and asserts the 404; the
 * happy path had no integration coverage at all, and neither did the two
 * properties that actually matter here:
 *
 *   - **Idempotency.** A customer on café wifi double-taps "join". The
 *     enrolment has to be one customer and one loyalty account, not two of
 *     each, and it must not reset the progress of someone re-scanning the same
 *     poster months later.
 *   - **Tenant binding.** Everything the endpoint receives is attacker-supplied
 *     — it is unauthenticated by necessity. The business must come from the
 *     slug in the URL and nothing else, and no field in the body may be able to
 *     write a reference to another tenant's rows.
 *
 * These call `passimo_enroll_customer` directly rather than over HTTP, for the
 * same reason `entitlements.test.ts` calls the entitlement functions directly:
 * the route is a thin wrapper, and the invariants worth pinning are the
 * database's.
 */
describe('public enrolment', () => {
  let shopA: TestTenant
  let shopB: TestTenant

  beforeAll(async () => {
    await assertDatabaseReady()
    ;[shopA, shopB] = await Promise.all([
      createTenant('join-a', { plan: 'growth' }),
      createTenant('join-b', { plan: 'growth' }),
    ])
  })

  afterAll(async () => {
    await Promise.all([dropTenant(shopA), dropTenant(shopB)])
    await shutdown()
  })

  /** Enrol through the same function the public route calls. */
  async function enrol(
    tenant: TestTenant,
    email: string,
    extra: Record<string, unknown> = {}
  ): Promise<{ is_new: boolean; customer_id: string; referral_code: string }> {
    const admin = getDb()
    const { data, error } = await admin.rpc('passimo_enroll_customer', {
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
      ...extra,
    })
    if (error) throw new Error(error.message)
    return data as { is_new: boolean; customer_id: string; referral_code: string }
  }

  async function countRows(table: string, column: string, value: string): Promise<number> {
    const admin = getDb()
    const { data } = await admin.from(table).select('id').eq(column, value)
    return (data ?? []).length
  }

  async function createLocation(tenant: TestTenant, name: string): Promise<string> {
    const admin = getDb()
    const { data, error } = await admin
      .from('locations')
      .insert({ business_id: tenant.businessId, name })
      .select('id')
      .single()
    if (error) throw new Error(error.message)
    return (data as { id: string }).id
  }

  describe('the join page read', () => {
    it('serves a real business by slug', async () => {
      const data = await getJoinPageData(shopA.slug)
      expect(data).not.toBeNull()
      expect(data!.business.slug).toBe(shopA.slug)
    })

    it('returns null for an unknown slug, so the page can answer a real 404', async () => {
      expect(await getJoinPageData('definitely-not-a-real-slug-xyz')).toBeNull()
    })

    it('returns null for an archived business', async () => {
      const admin = getDb()
      const victim = await createTenant('join-archived', { plan: 'starter' })
      try {
        await admin
          .from('businesses')
          .update({ archived_at: new Date().toISOString() })
          .eq('id', victim.businessId)
        expect(await getJoinPageData(victim.slug)).toBeNull()
      } finally {
        await dropTenant(victim)
      }
    })

    it('never hands the tenant primary key to the client', async () => {
      /*
       * `business.id` is the one field on the record a prospective member has no
       * use for and the one whose leak lets somebody address the tenant
       * directly. The page passes `toPublicJoinData`'s output into a client
       * component, so this projection is the boundary.
       */
      const data = await getJoinPageData(shopA.slug)
      const published = toPublicJoinData(data!)
      expect('id' in published.business).toBe(false)
      expect(JSON.stringify(published)).not.toContain(shopA.businessId)
    })
  })

  describe('enrolment', () => {
    it('creates one customer and one loyalty account', async () => {
      const email = `new-${Date.now()}@example.test`
      const result = await enrol(shopA, email)

      expect(result.is_new).toBe(true)
      expect(result.referral_code).toBeTruthy()
      expect(await countRows('customers', 'id', result.customer_id)).toBe(1)
      // The account is what makes the card and the first stamp possible.
      expect(await countRows('loyalty_accounts', 'customer_id', result.customer_id)).toBe(1)
    })

    it('is idempotent — a double tap is one member, not two', async () => {
      const email = `double-${Date.now()}@example.test`
      const first = await enrol(shopA, email)
      const second = await enrol(shopA, email)

      expect(second.customer_id).toBe(first.customer_id)
      expect(first.is_new).toBe(true)
      // The decisive bit: the second call reports the person was already here.
      expect(second.is_new).toBe(false)
      expect(await countRows('loyalty_accounts', 'customer_id', first.customer_id)).toBe(1)
    })

    it('survives a genuinely concurrent double submit', async () => {
      /*
       * The sequential case above is the double tap; this is the one where both
       * requests are in flight at once. `on conflict (business_id, email)` is
       * what makes it safe, so this asserts the constraint rather than the
       * application ordering.
       */
      const email = `race-${Date.now()}@example.test`
      const results = await Promise.all([enrol(shopA, email), enrol(shopA, email)])

      const ids = new Set(results.map((r) => r.customer_id))
      expect(ids.size).toBe(1)
      expect(await countRows('loyalty_accounts', 'customer_id', [...ids][0]!)).toBe(1)
    })

    it('does not overwrite an existing member’s details on a re-scan', async () => {
      /*
       * Someone who joined months ago re-scans the poster and types only their
       * email. The enrolment must not blank the name the merchant already has,
       * which is why the upsert coalesces rather than assigns.
       */
      const admin = getDb()
      const email = `keep-${Date.now()}@example.test`
      const first = await enrol(shopA, email)

      await admin
        .from('customers')
        .update({ name: 'Original Name', first_name: 'Original' })
        .eq('id', first.customer_id)

      await enrol(shopA, email)

      const { data } = await admin
        .from('customers')
        .select('name, first_name')
        .eq('id', first.customer_id)
        .maybeSingle()
      expect((data as { name: string }).name).toBe('Original Name')
    })

    it('lets the same person join a second, unrelated club', async () => {
      /*
       * The unique key is (business_id, email), not email — a person can be a
       * member of two shops. Each membership is a separate customer row in a
       * separate tenant, which is what keeps their histories from mixing.
       */
      const email = `multi-${Date.now()}@example.test`
      const inA = await enrol(shopA, email)
      const inB = await enrol(shopB, email)

      expect(inA.customer_id).not.toBe(inB.customer_id)
      expect(inB.is_new).toBe(true)

      const admin = getDb()
      const { data } = await admin
        .from('customers')
        .select('business_id')
        .eq('id', inB.customer_id)
        .maybeSingle()
      expect((data as { business_id: string }).business_id).toBe(shopB.businessId)
    })
  })

  describe('tenant binding', () => {
    it('drops a signup location that belongs to another business', async () => {
      /*
       * Regression test for migration 000026.
       *
       * `locationId` arrives in the body of an unauthenticated request, and the
       * foreign key on `customers.signup_location_id` proves only that the
       * location exists — not whose it is. Before the guard, enrolling into shop
       * A with one of shop B's location ids wrote a cross-tenant reference into
       * A's `customers` row and its signup `activity_events` row, and answered
       * 200. Nothing reads that column today, which is why it went unnoticed;
       * the first per-location signup report would have surfaced B's location
       * inside A's dashboard.
       *
       * The signup still succeeds — a customer at a counter is not turned away
       * over an optional analytics field — but the foreign reference is gone.
       */
      const foreign = await createLocation(shopB, 'Shop B counter')
      const email = `foreign-loc-${Date.now()}@example.test`

      const result = await enrol(shopA, email, { p_location_id: foreign })
      expect(result.is_new).toBe(true)

      const admin = getDb()
      const { data: customer } = await admin
        .from('customers')
        .select('business_id, signup_location_id')
        .eq('id', result.customer_id)
        .maybeSingle()

      const row = customer as { business_id: string; signup_location_id: string | null }
      expect(row.business_id).toBe(shopA.businessId)
      expect(row.signup_location_id).toBeNull()

      const { data: events } = await admin
        .from('activity_events')
        .select('location_id')
        .eq('customer_id', result.customer_id)
      for (const event of events ?? []) {
        expect((event as { location_id: string | null }).location_id).toBeNull()
      }
    })

    it('still records the business’s own location', async () => {
      // The guard must drop foreign locations without breaking real attribution.
      const own = await createLocation(shopA, 'Shop A counter')
      const email = `own-loc-${Date.now()}@example.test`

      const result = await enrol(shopA, email, { p_location_id: own })

      const admin = getDb()
      const { data } = await admin
        .from('customers')
        .select('signup_location_id')
        .eq('id', result.customer_id)
        .maybeSingle()
      expect((data as { signup_location_id: string | null }).signup_location_id).toBe(own)
    })

    it('ignores a referral code issued by another business', async () => {
      /*
       * Referral codes are unique globally but only meaningful within a tenant.
       * Redeeming shop B's code while joining shop A must not create a referral
       * edge across the boundary — it would pay B's member for A's customer and
       * link two tenants' records together.
       */
      const referrer = await enrol(shopB, `referrer-${Date.now()}@example.test`)
      const email = `referred-${Date.now()}@example.test`

      const joined = await enrol(shopA, email, { p_referral_code: referrer.referral_code })

      const admin = getDb()
      const { data } = await admin
        .from('referrals')
        .select('id')
        .eq('referred_customer_id', joined.customer_id)
      expect(data ?? []).toHaveLength(0)

      const { data: customer } = await admin
        .from('customers')
        .select('referred_by')
        .eq('id', joined.customer_id)
        .maybeSingle()
      expect((customer as { referred_by: string | null }).referred_by).toBeNull()
    })

    it('refuses to attach an account to another business’s program', async () => {
      /*
       * The last line of defence: even given a valid customer and a valid
       * program, `passimo_ensure_account` rejects the pair when they belong to
       * different tenants, rather than trusting its caller.
       */
      const member = await enrol(shopA, `prog-${Date.now()}@example.test`)
      const admin = getDb()

      const { error } = await admin.rpc('passimo_ensure_account', {
        p_business_id: shopA.businessId,
        p_program_id: shopB.programId,
        p_customer_id: member.customer_id,
      })
      expect(error).toBeTruthy()
      expect(error!.message).toMatch(/does not belong/i)
    })
  })

  describe('consent', () => {
    it('does not opt a new member into marketing by default', async () => {
      /*
       * Joining a loyalty club is not consent to be marketed at. The schema
       * defaults `marketing` to false and the route passes the customer's actual
       * choice through; this asserts the end state in the row, because that is
       * what a regulator would read.
       */
      const email = `consent-${Date.now()}@example.test`
      const result = await enrol(shopA, email)

      const admin = getDb()
      const { data } = await admin
        .from('customers')
        .select('consent_marketing, terms_accepted_at')
        .eq('id', result.customer_id)
        .maybeSingle()

      const row = data as { consent_marketing: boolean; terms_accepted_at: string | null }
      expect(row.consent_marketing).toBe(false)
      // Terms acceptance is recorded, because the route requires it explicitly.
      expect(row.terms_accepted_at).toBeTruthy()
    })
  })
})
