import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getDb } from '@/lib/db'
import { performScan } from '@/lib/scan/checkin'
import { randomUUID } from 'node:crypto'
import {
  assertDatabaseReady,
  createCustomer,
  createTenant,
  dropTenant,
  shutdown,
  type TestTenant,
} from './helpers'

/**
 * The transaction the whole product exists to perform.
 *
 * A cashier scans a card, the customer earns, the card fills up, the reward comes
 * out, and the numbers on every screen agree afterwards. Asserted against the
 * database rather than against the response, because "the API said it worked" is
 * exactly the failure this suite is meant to catch.
 */
describe('loyalty flow', () => {
  let tenant: TestTenant
  let customerId: string

  const scan = (options: { key?: string; amount?: number | null } = {}) =>
    performScan({
      businessId: tenant.businessId,
      raw: customerId,
      staffUserId: tenant.userId,
      source: 'pos',
      action: {
        type: 'checkin',
        trigger: options.amount ? 'purchase' : 'visit',
        amount: options.amount ?? null,
        idempotencyKey: options.key ?? randomUUID(),
      },
    })

  const balance = async () => {
    const { data } = await getDb()
      .from('loyalty_accounts')
      .select('balance, lifetime_earned')
      .eq('customer_id', customerId)
      .eq('program_id', tenant.programId)
      .maybeSingle()
    return { balance: Number(data?.balance ?? 0), earned: Number(data?.lifetime_earned ?? 0) }
  }

  const stats = async () => {
    const { data } = await getDb()
      .from('customers')
      .select('visit_count, lifetime_spend, last_visit, average_ticket')
      .eq('id', customerId)
      .single()
    return data
  }

  beforeAll(async () => {
    await assertDatabaseReady()
    tenant = await createTenant('loyalty')
    customerId = await createCustomer(tenant.businessId, { name: 'Scan Target' })
  })

  afterAll(async () => {
    if (tenant) await dropTenant(tenant)
    await shutdown()
  })

  it('identifies a customer from a scanned id without crediting anything', async () => {
    const before = await balance()

    const result = await performScan({
      businessId: tenant.businessId,
      raw: customerId,
      staffUserId: tenant.userId,
      action: { type: 'identify' },
    })

    expect(result.resolution.kind).toBe('customer')
    expect(result.checkin).toBeNull()
    expect(await balance()).toEqual(before)
  })

  it('credits a visit and moves the balance', async () => {
    const before = await balance()
    const result = await scan()

    expect(result.checkin?.duplicate).toBe(false)
    expect(result.checkin?.totalAwarded).toBeGreaterThan(0)

    const after = await balance()
    expect(after.balance).toBeGreaterThan(before.balance)
    expect(after.earned).toBeGreaterThan(before.earned)
  })

  it('writes a ledger entry whose running balance matches the account', async () => {
    const { data: entries } = await getDb()
      .from('loyalty_ledger')
      .select('amount, balance_after, entry_type, created_at')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(1)

    const latest = entries![0]
    const account = await balance()

    expect(latest.entry_type).toBe('earn')
    expect(Number(latest.balance_after)).toBe(account.balance)
  })

  it('records the visit against the customer rollups', async () => {
    const before = await stats()
    await scan()
    const after = await stats()

    expect(after.visit_count).toBe(before.visit_count + 1)
    expect(after.last_visit).not.toBeNull()
  })

  it('records revenue for a purchase and derives the average ticket', async () => {
    await scan({ amount: 12.5 })
    await scan({ amount: 7.5 })

    const after = await stats()
    expect(Number(after.lifetime_spend)).toBeCloseTo(20, 2)
    expect(Number(after.average_ticket)).toBeCloseTo(10, 2)
  })

  it('is idempotent on the caller key — the regression from migration 000019', async () => {
    const key = `replay-${randomUUID()}`

    const before = { ...(await balance()), visits: (await stats()).visit_count }

    const first = await scan({ key })
    expect(first.checkin?.duplicate).toBe(false)

    const afterFirst = { ...(await balance()), visits: (await stats()).visit_count }
    expect(afterFirst.balance).toBeGreaterThan(before.balance)
    expect(afterFirst.visits).toBe(before.visits + 1)

    // The offline queue replays the whole backlog when connectivity returns, and
    // a cashier who saw no confirmation scans again. Neither may count twice.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const replay = await scan({ key })
      expect(replay.checkin?.duplicate).toBe(true)
      expect(replay.checkin?.totalAwarded).toBe(0)
    }

    const afterReplays = { ...(await balance()), visits: (await stats()).visit_count }
    expect(afterReplays.balance).toBe(afterFirst.balance)
    expect(afterReplays.visits).toBe(afterFirst.visits)
  })

  it('records exactly one activity event per distinct idempotency key', async () => {
    const key = `single-event-${randomUUID()}`
    await scan({ key })
    await scan({ key })
    await scan({ key })

    const { count } = await getDb()
      .from('activity_events')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', tenant.businessId)
      .eq('idempotency_key', key)

    expect(count).toBe(1)
  })

  it('unlocks a reward once the card is complete, and redeeming it debits the balance', async () => {
    const { data: program } = await getDb()
      .from('loyalty_programs')
      .select('id, goal_amount, type')
      .eq('id', tenant.programId)
      .single()

    const goal = Number(program.goal_amount ?? 8)

    // Fill the card.
    let guard = 0
    while ((await balance()).balance < goal && guard < 40) {
      await scan()
      guard += 1
    }

    const filled = await balance()
    expect(filled.balance).toBeGreaterThanOrEqual(goal)

    const { data: reward } = await getDb()
      .from('rewards')
      .select('id, name, cost')
      .eq('business_id', tenant.businessId)
      .lte('cost', filled.balance)
      .order('cost', { ascending: false })
      .limit(1)
      .single()

    const { data: redemption, error } = await getDb().rpc('passimo_redeem_reward', {
      p_business_id: tenant.businessId,
      p_customer_id: customerId,
      p_reward_id: reward.id,
      p_staff_user_id: tenant.userId,
      p_idempotency_key: `redeem-${randomUUID()}`,
    })

    expect(error).toBeNull()
    expect(redemption).toMatchObject({ duplicate: false })

    const after = await balance()
    expect(after.balance).toBe(filled.balance - Number(reward.cost))

    const { data: ledgerEntry } = await getDb()
      .from('loyalty_ledger')
      .select('entry_type, amount, balance_after')
      .eq('customer_id', customerId)
      .eq('entry_type', 'redeem')
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    expect(Number(ledgerEntry.amount)).toBe(-Number(reward.cost))
    expect(Number(ledgerEntry.balance_after)).toBe(after.balance)
  })

  it('refuses to redeem more than the balance', async () => {
    const { data: expensive } = await getDb()
      .from('rewards')
      .insert({
        business_id: tenant.businessId,
        program_id: tenant.programId,
        name: 'Unaffordable',
        cost: 100_000,
        is_active: true,
      })
      .select('id')
      .single()

    const { error } = await getDb().rpc('passimo_redeem_reward', {
      p_business_id: tenant.businessId,
      p_customer_id: customerId,
      p_reward_id: expensive.id,
      p_staff_user_id: tenant.userId,
      p_idempotency_key: `overdraw-${randomUUID()}`,
    })

    // A loyalty balance that can go negative is a loyalty balance a customer can
    // spend twice.
    expect(error).not.toBeNull()
  })

  it('reports the transaction in analytics, from the same rows', async () => {
    const { data: overview, error } = await getDb().rpc('passimo_analytics_overview', {
      p_business_id: tenant.businessId,
      p_days: 30,
    })

    expect(error).toBeNull()
    const typed = overview as {
      customers: { total: number }
      revenue: { period: number; lifetime: number; average_ticket: number }
    }

    expect(typed.customers.total).toBeGreaterThan(0)
    /*
     * The revenue asserted earlier in this file has to be the revenue analytics
     * reports. Both come from `activity_events`, so a mismatch here means the
     * dashboard is showing a number the transaction did not produce — which is
     * the whole reason the analytics claim is worth testing rather than trusting.
     */
    expect(typed.revenue.period).toBeCloseTo(20, 2)
    expect(typed.revenue.average_ticket).toBeCloseTo(10, 2)
  })
})
