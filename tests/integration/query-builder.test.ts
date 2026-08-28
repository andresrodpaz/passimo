import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getDb, query } from '@/lib/db'
import {
  assertDatabaseReady,
  createCustomer,
  createTenant,
  dropTenant,
  shutdown,
  type TestTenant,
} from './helpers'

/**
 * The query layer against a real PostgreSQL server.
 *
 * These are the tests a mock cannot write. Every assertion here is about
 * something the database decides: whether the emitted SQL parses, whether a cast
 * lands, whether `ON CONFLICT` resolves to the index the caller meant. The unit
 * suite covers the parsers; this covers the SQL.
 */
describe('query builder', () => {
  let tenant: TestTenant

  beforeAll(async () => {
    await assertDatabaseReady()
    tenant = await createTenant('qb')
  })

  afterAll(async () => {
    if (tenant) await dropTenant(tenant)
    await shutdown()
  })

  describe('select', () => {
    it('reads rows and returns an array', async () => {
      const { data, error } = await getDb()
        .from('loyalty_programs')
        .select('id, name, is_default')
        .eq('business_id', tenant.businessId)

      expect(error).toBeNull()
      expect(Array.isArray(data)).toBe(true)
      expect(data!.length).toBeGreaterThan(0)
    })

    it('returns count separately from the page when asked', async () => {
      for (let i = 0; i < 5; i += 1) await createCustomer(tenant.businessId)

      const { data, count, error } = await getDb()
        .from('customers')
        .select('id, email', { count: 'exact' })
        .eq('business_id', tenant.businessId)
        .order('created_at', { ascending: false })
        .range(0, 1)

      expect(error).toBeNull()
      expect(data).toHaveLength(2)
      expect(count).toBeGreaterThanOrEqual(5)
      // The window-function total must never leak into the caller's row shape.
      expect(Object.keys(data![0] as object)).toEqual(['id', 'email'])
    })

    it('returns only a count for head requests', async () => {
      const { data, count, error } = await getDb()
        .from('customers')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', tenant.businessId)

      expect(error).toBeNull()
      expect(data).toBeNull()
      expect(count).toBeGreaterThanOrEqual(5)
    })

    it('maybeSingle returns null for no rows and the row for one', async () => {
      const missing = await getDb()
        .from('customers')
        .select('id')
        .eq('business_id', tenant.businessId)
        .eq('email', 'nobody-at-all@passimo.test')
        .maybeSingle()

      expect(missing.error).toBeNull()
      expect(missing.data).toBeNull()

      const present = await getDb()
        .from('businesses')
        .select('id, slug')
        .eq('id', tenant.businessId)
        .maybeSingle()

      expect(present.error).toBeNull()
      expect(present.data?.slug).toBe(tenant.slug)
    })

    it('single errors rather than silently picking a row', async () => {
      const { data, error } = await getDb()
        .from('customers')
        .select('id')
        .eq('business_id', tenant.businessId)
        .single()

      expect(data).toBeNull()
      expect(error?.code).toBe('PGRST116')
      expect(error?.message).toMatch(/single row/i)
    })

    it('filters on uuid arrays with the right cast', async () => {
      const { data: all } = await getDb()
        .from('customers')
        .select('id')
        .eq('business_id', tenant.businessId)
        .limit(3)

      const ids = (all ?? []).map((row: { id: string }) => row.id)
      const { data, error } = await getDb().from('customers').select('id').in('id', ids)

      expect(error).toBeNull()
      expect(data).toHaveLength(ids.length)
    })

    it('treats an empty in() as matching nothing rather than everything', async () => {
      const { data, error } = await getDb().from('customers').select('id').in('id', [])
      expect(error).toBeNull()
      expect(data).toEqual([])
    })

    it('supports or() with nested and() groups', async () => {
      const { data, error } = await getDb()
        .from('businesses')
        .select('id, slug')
        .or(`and(slug.eq.${tenant.slug},plan.eq.growth),and(slug.eq.nonexistent,plan.eq.pro)`)

      expect(error).toBeNull()
      expect(data).toHaveLength(1)
      expect(data![0].slug).toBe(tenant.slug)
    })

    it('supports is null, not is null and neq', async () => {
      const nullable = await getDb()
        .from('customers')
        .select('id')
        .eq('business_id', tenant.businessId)
        .is('merged_into_customer_id', null)
        .neq('status', 'anonymized')
      expect(nullable.error).toBeNull()
      expect(nullable.data!.length).toBeGreaterThan(0)

      const notNull = await getDb()
        .from('customers')
        .select('id')
        .eq('business_id', tenant.businessId)
        .not('email', 'is', null)
      expect(notNull.error).toBeNull()
      expect(notNull.data!.length).toBeGreaterThan(0)
    })

    it('pattern-matches a citext column', async () => {
      const { data, error } = await getDb()
        .from('customers')
        .select('id, email')
        .eq('business_id', tenant.businessId)
        .ilike('email', '%@PASSIMO.TEST')

      expect(error).toBeNull()
      expect(data!.length).toBeGreaterThan(0)
    })
  })

  describe('embedded selects', () => {
    it('resolves a to-one embed into a nested object', async () => {
      const customerId = await createCustomer(tenant.businessId, { name: 'Embed Target' })

      const { data: reward } = await getDb()
        .from('rewards')
        .select('id, name')
        .eq('business_id', tenant.businessId)
        .limit(1)
        .single()

      const { data: inserted } = await getDb()
        .from('reward_redemptions')
        .insert({
          business_id: tenant.businessId,
          customer_id: customerId,
          reward_id: reward.id,
          code: `TEST${Date.now().toString(36).toUpperCase()}`,
          cost: 1,
          status: 'claimed',
        })
        .select('id')
        .single()

      const { data, error } = await getDb()
        .from('reward_redemptions')
        .select('id, code, rewards:reward_id (name)')
        .eq('id', inserted.id)
        .maybeSingle()

      expect(error).toBeNull()
      expect(data.rewards).toEqual({ name: reward.name })
    })

    it('returns null for a to-one embed with no related row', async () => {
      // `signup_location_id` is nullable, so the embed has nothing to join to.
      const customerId = await createCustomer(tenant.businessId)
      const { data, error } = await getDb()
        .from('customers')
        .select('id, locations:signup_location_id (name)')
        .eq('id', customerId)
        .maybeSingle()

      expect(error).toBeNull()
      expect(data.locations).toBeNull()
    })

    it('reports an embed that no foreign key supports', async () => {
      // `customers` and `campaigns` are unrelated: no column on either points at
      // the other. The layer refuses rather than inventing a join condition.
      const { error } = await getDb()
        .from('customers')
        .select('id, campaigns(name)')
        .eq('business_id', tenant.businessId)

      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/foreign key/i)
    })
  })

  describe('writes', () => {
    it('inserts and returns the requested columns', async () => {
      const { data, error } = await getDb()
        .from('tags')
        .insert({ business_id: tenant.businessId, name: `tag-${Date.now()}` })
        .select('id, name')
        .single()

      expect(error).toBeNull()
      expect(data.id).toBeTruthy()
    })

    it('writes a jsonb column from a JavaScript object', async () => {
      const { data, error } = await getDb()
        .from('app_users')
        .update({ metadata: { nested: { deep: [1, 2, 3] }, flag: true } })
        .eq('id', tenant.userId)
        .select('metadata')
        .single()

      expect(error).toBeNull()
      expect(data.metadata).toEqual({ nested: { deep: [1, 2, 3] }, flag: true })
    })

    it('writes a text[] column from a JavaScript array', async () => {
      const { data, error } = await getDb()
        .from('campaigns')
        .insert({
          business_id: tenant.businessId,
          name: 'Array test',
          type: 'manual',
          channels: ['email', 'sms'],
        })
        .select('id, channels')
        .single()

      expect(error).toBeNull()
      expect(data.channels).toEqual(['email', 'sms'])
    })

    it('reports a unique violation with the code callers branch on', async () => {
      const name = `dupe-${Date.now()}`
      await getDb().from('tags').insert({ business_id: tenant.businessId, name })
      const { error } = await getDb().from('tags').insert({ business_id: tenant.businessId, name })

      expect(error?.code).toBe('23505')
      expect(error).toBeTruthy()
    })

    it('upserts against a plain unique index', async () => {
      const name = `upsert-${Date.now()}`
      const first = await getDb()
        .from('tags')
        .upsert({ business_id: tenant.businessId, name, color: '#111111' }, { onConflict: 'business_id,name' })
        .select('id, color')
        .single()

      const second = await getDb()
        .from('tags')
        .upsert({ business_id: tenant.businessId, name, color: '#222222' }, { onConflict: 'business_id,name' })
        .select('id, color')
        .single()

      expect(first.error).toBeNull()
      expect(second.error).toBeNull()
      expect(second.data.id).toBe(first.data.id)
      expect(second.data.color).toBe('#222222')
    })

    it('upserts against a PARTIAL unique index', async () => {
      /*
       * The regression this exists for: `team_members` is unique on
       * `(business_id, user_id) WHERE user_id IS NOT NULL`, and PostgreSQL will
       * not match a bare `ON CONFLICT (business_id, user_id)` against a partial
       * index — it raises 42P10. Every membership write in the product goes
       * through this path.
       */
      const first = await getDb()
        .from('team_members')
        .upsert(
          { business_id: tenant.businessId, user_id: tenant.userId, role: 'owner', status: 'active' },
          { onConflict: 'business_id,user_id' }
        )
        .select('id, role')
        .single()

      const second = await getDb()
        .from('team_members')
        .upsert(
          { business_id: tenant.businessId, user_id: tenant.userId, role: 'admin', status: 'active' },
          { onConflict: 'business_id,user_id' }
        )
        .select('id, role')
        .single()

      expect(first.error).toBeNull()
      expect(second.error).toBeNull()
      expect(second.data.id).toBe(first.data.id)
      expect(second.data.role).toBe('admin')

      // Restore, since later tests assume the fixture owner is an owner.
      await getDb()
        .from('team_members')
        .update({ role: 'owner' })
        .eq('business_id', tenant.businessId)
        .eq('user_id', tenant.userId)
    })

    it('deduplicates with ignoreDuplicates against a partial index', async () => {
      const key = `job-idem-${Date.now()}`
      const row = {
        type: 'analytics.recompute',
        payload: { businessId: tenant.businessId },
        business_id: tenant.businessId,
        idempotency_key: key,
      }

      const first = await getDb()
        .from('jobs')
        .upsert([row], { onConflict: 'idempotency_key', ignoreDuplicates: true })
        .select('id')

      const second = await getDb()
        .from('jobs')
        .upsert([row], { onConflict: 'idempotency_key', ignoreDuplicates: true })
        .select('id')

      expect(first.error).toBeNull()
      expect(first.data).toHaveLength(1)
      expect(second.error).toBeNull()
      expect(second.data).toHaveLength(0)
    })

    it('returns the existing row when every column is part of the conflict target', async () => {
      const first = await getDb()
        .from('wallet_settings')
        .upsert({ business_id: tenant.businessId }, { onConflict: 'business_id' })
        .select('business_id')
        .single()

      expect(first.error).toBeNull()
      expect(first.data.business_id).toBe(tenant.businessId)
    })

    it('rejects a conflict target no unique index covers', async () => {
      const { error } = await getDb()
        .from('businesses')
        .upsert({ id: tenant.businessId, name: 'x' }, { onConflict: 'name' })

      expect(error?.message).toMatch(/no unique index/i)
    })

    it('refuses an unfiltered update', async () => {
      const { error } = await getDb().from('businesses').update({ city: 'Nowhere' })
      expect(error?.message).toMatch(/Refusing to update every row/)

      // And nothing was written.
      const { rows } = await query<{ count: number }>(
        "select count(*)::int as count from businesses where city = 'Nowhere'"
      )
      expect(rows[0]?.count).toBe(0)
    })

    it('refuses an unfiltered delete', async () => {
      const { error } = await getDb().from('customers').delete()
      expect(error?.message).toMatch(/Refusing to delete every row/)
    })

    it('reports affected rows when asked for a count', async () => {
      const { count, error } = await getDb()
        .from('customers')
        .update({ locale: 'en' }, { count: 'exact' })
        .eq('business_id', tenant.businessId)

      expect(error).toBeNull()
      expect(count).toBeGreaterThan(0)
    })
  })

  describe('rpc', () => {
    it('unwraps a jsonb-returning function to an object', async () => {
      const { data, error } = await getDb().rpc('passimo_analytics_overview', {
        p_business_id: tenant.businessId,
        p_days: 30,
      })

      expect(error).toBeNull()
      expect(Array.isArray(data)).toBe(false)
      expect(data).toHaveProperty('daily')
    })

    it('unwraps a table-returning function to an array of rows', async () => {
      const { data, error } = await getDb().rpc('passimo_rate_limit', {
        p_key: `integration-${Date.now()}`,
        p_limit: 5,
        p_window_seconds: 60,
      })

      expect(error).toBeNull()
      expect(Array.isArray(data)).toBe(true)
      expect(data[0]).toMatchObject({ allowed: true })
    })

    it('passes jsonb arguments through as JSON, not as an array literal', async () => {
      const customerId = await createCustomer(tenant.businessId)
      const { data, error } = await getDb().rpc('passimo_record_earn', {
        p_business_id: tenant.businessId,
        p_customer_id: customerId,
        p_event: { type: 'visit', source: 'pos' },
        p_awards: [{ program_id: tenant.programId, amount: 3, reason: 'Test' }],
        p_idempotency_key: `rpc-json-${Date.now()}`,
      })

      expect(error).toBeNull()
      expect(data).toMatchObject({ duplicate: false })
    })

    it('reports a missing function as a clear error', async () => {
      const { error } = await getDb().rpc('passimo_does_not_exist', {})
      expect(error?.message).toMatch(/does not exist/i)
    })
  })
})
