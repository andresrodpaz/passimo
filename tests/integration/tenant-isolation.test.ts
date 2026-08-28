import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getDb } from '@/lib/db'
import { requireBusinessAccess, type Actor } from '@/lib/auth/context'
import { listCustomers } from '@/lib/customers/service'
import {
  assertDatabaseReady,
  createCustomer,
  createTenant,
  dropTenant,
  shutdown,
  type TestTenant,
} from './helpers'

/**
 * Tenant isolation.
 *
 * This is the property the product cannot get wrong, and since migration 000018
 * removed the provider-era row-level security policies it is enforced entirely in
 * the application layer — `requireBusinessAccess` plus an explicit `business_id`
 * filter on every query. That makes these tests the thing standing in for those
 * policies, so they are written as attacks rather than as happy paths: two real
 * tenants, and every attempt by one to reach the other.
 *
 * See docs/SECURITY.md and the header of db/migrations/000018.
 */
describe('tenant isolation', () => {
  let alice: TestTenant
  let bob: TestTenant
  let bobCustomerId: string

  const actorFor = (tenant: TestTenant): Actor => ({
    kind: 'user',
    id: tenant.userId,
    email: tenant.email,
    scopedBusinessId: null,
    apiKeyId: null,
  })

  beforeAll(async () => {
    await assertDatabaseReady()
    alice = await createTenant('alice')
    bob = await createTenant('bob')
    bobCustomerId = await createCustomer(bob.businessId, {
      email: 'bobs-only-customer@passimo.test',
      name: "Bob's Customer",
    })
    await createCustomer(alice.businessId, { name: "Alice's Customer" })
  })

  afterAll(async () => {
    if (alice) await dropTenant(alice)
    if (bob) await dropTenant(bob)
    await shutdown()
  })

  describe('authorisation gate', () => {
    it('grants an owner access to their own business', async () => {
      const context = await requireBusinessAccess(actorFor(alice), alice.businessId)
      expect(context.businessId).toBe(alice.businessId)
      expect(context.role).toBe('owner')
      expect(context.permissions.has('customers:read')).toBe(true)
    })

    it("refuses access to another merchant's business", async () => {
      await expect(requireBusinessAccess(actorFor(alice), bob.businessId)).rejects.toThrow(
        /do not have access/i
      )
    })

    it('refuses an actor with no id', async () => {
      await expect(
        requireBusinessAccess(
          { kind: 'user', id: null, email: null, scopedBusinessId: null, apiKeyId: null },
          bob.businessId
        )
      ).rejects.toThrow()
    })

    it('refuses a business that does not exist', async () => {
      await expect(
        requireBusinessAccess(actorFor(alice), '00000000-0000-0000-0000-000000000000')
      ).rejects.toThrow(/do not have access/i)
    })

    it('scopes an api key to exactly one business', async () => {
      const key: Actor = {
        kind: 'api_key',
        id: 'key-1',
        email: null,
        scopedBusinessId: alice.businessId,
        apiKeyId: 'key-1',
      }

      await expect(requireBusinessAccess(key, alice.businessId)).resolves.toMatchObject({
        businessId: alice.businessId,
      })
      await expect(requireBusinessAccess(key, bob.businessId)).rejects.toThrow(/not scoped/i)
    })

    it('revokes access the moment a membership stops being active', async () => {
      const extra = await createTenant('suspended')
      try {
        await getDb()
          .from('team_members')
          .update({ status: 'suspended' })
          .eq('business_id', extra.businessId)
          .eq('user_id', extra.userId)

        /*
         * `requireBusinessAccess` memoises a resolved role for 15 seconds, so a
         * change has to invalidate the cache to take effect immediately. This
         * asserts the invalidation path, not just the query.
         */
        const { invalidateRoleCache } = await import('@/lib/auth/context')
        invalidateRoleCache(extra.userId)

        await expect(
          requireBusinessAccess(actorFor(extra), extra.businessId)
        ).rejects.toThrow(/do not have access/i)
      } finally {
        await dropTenant(extra)
      }
    })
  })

  describe('data queries', () => {
    it("never returns another tenant's customers", async () => {
      const alicesView = await listCustomers({
        businessId: alice.businessId,
        limit: 100,
        offset: 0,
      })

      expect(alicesView.customers.length).toBeGreaterThan(0)
      const emails = alicesView.customers.map((customer) => customer.email)
      expect(emails).not.toContain('bobs-only-customer@passimo.test')
    })

    it("a search term matching another tenant's customer finds nothing", async () => {
      const result = await listCustomers({
        businessId: alice.businessId,
        limit: 100,
        offset: 0,
        q: 'bobs-only-customer',
      })
      expect(result.customers).toHaveLength(0)
      expect(result.total).toBe(0)
    })

    it("reading a known customer id under the wrong business_id returns nothing", async () => {
      // The shape every route uses: filter by id *and* by tenant. Holding a valid
      // uuid from somewhere else must not be enough.
      const { data } = await getDb()
        .from('customers')
        .select('id, email')
        .eq('id', bobCustomerId)
        .eq('business_id', alice.businessId)
        .maybeSingle()

      expect(data).toBeNull()
    })

    it("a tenant-scoped update cannot touch another tenant's row", async () => {
      const { count } = await getDb()
        .from('customers')
        .update({ name: 'Hijacked' }, { count: 'exact' })
        .eq('id', bobCustomerId)
        .eq('business_id', alice.businessId)

      expect(count).toBe(0)

      const { data } = await getDb()
        .from('customers')
        .select('name')
        .eq('id', bobCustomerId)
        .maybeSingle()
      expect(data.name).toBe("Bob's Customer")
    })
  })

  describe('database functions', () => {
    it('refuses to credit a customer that belongs to another business', async () => {
      const { error } = await getDb().rpc('passimo_record_earn', {
        p_business_id: alice.businessId,
        p_customer_id: bobCustomerId,
        p_event: { type: 'visit', source: 'pos' },
        p_awards: [{ program_id: alice.programId, amount: 5, reason: 'Cross-tenant attempt' }],
        p_idempotency_key: `isolation-${Date.now()}`,
      })

      // The guard lives inside the function, so it holds for every caller —
      // including a future one that forgets the application-level check.
      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/does not belong to business/i)
    })

    it("analytics for one business never counts another's activity", async () => {
      const { data: aliceOverview } = await getDb().rpc('passimo_analytics_overview', {
        p_business_id: alice.businessId,
        p_days: 365,
      })
      const { data: bobOverview } = await getDb().rpc('passimo_analytics_overview', {
        p_business_id: bob.businessId,
        p_days: 365,
      })

      // Each fixture tenant has exactly one customer, so a leak between them
      // would show up as a total of two.
      type Overview = { customers: { total: number } }
      expect((aliceOverview as Overview).customers.total).toBe(1)
      expect((bobOverview as Overview).customers.total).toBe(1)
    })
  })
})
