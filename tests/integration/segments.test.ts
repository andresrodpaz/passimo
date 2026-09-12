import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getDb } from '@/lib/db'
import { countSegment, listSegmentCustomerIds } from '@/lib/segments/resolve'
import { compileSegment } from '@/lib/segments/compile'
import {
  SEGMENT_OPERATORS,
  type SegmentDefinition,
  type SegmentField,
  type SegmentOperator,
} from '@/lib/segments/definition'
import {
  assertDatabaseReady,
  createCustomer,
  createTenant,
  dropTenant,
  shutdown,
  type TestTenant,
} from './helpers'

/**
 * Segments, end to end: TypeScript compiler → PL/pgSQL function → row count.
 *
 * This file exists because of a defect that lived on both sides of a boundary
 * neither side's tests crossed.
 *
 * `lib/segments/compile.ts` emitted parameter accessors named `p_params`, after
 * the PL/pgSQL *argument* the four `passimo_segment_*` functions take. Those
 * functions bind it with `EXECUTE ... USING p_params`, which makes it `$1` —
 * `EXECUTE` performs no variable substitution, so the SQL engine saw an unknown
 * column and raised `column "p_params" does not exist`. `resolveSegmentDefinition`'s
 * callers log and return 0 / [] on error, deliberately, so a broken segment can
 * never take a campaign screen down with it.
 *
 * The consequence was that **every segment carrying a value matched nobody**, in
 * complete silence. The dashboard read 0 for "At risk", "Lost", "New this month"
 * and "Reward ready"; every segmented campaign reported a reach of zero; and the
 * one system segment that worked — "VIP", built from `is_true`, which emits no
 * accessor — made the whole thing look like an empty database.
 *
 * The unit suite passed throughout: the compiled SQL had exactly the right
 * *shape*. The SQL functions were also correct. Only running one against the
 * other reveals it, which is what these tests do: they assert a **count**, not a
 * string, and every case is one where the answer is independently known because
 * this file created the rows.
 */

describe('segments resolve against real rows', () => {
  let tenant: TestTenant

  beforeAll(async () => {
    await assertDatabaseReady()
    tenant = await createTenant('segment')

    const db = getDb()

    /*
     * Six customers with deliberately distinct shapes, so every assertion below
     * has an unambiguous expected answer:
     *
     *   regular-a  12 visits, spent 240, seen yesterday,   VIP
     *   regular-b   8 visits, spent 160, seen 3 days ago
     *   casual      3 visits, spent  45, seen 40 days ago
     *   lapsed      2 visits, spent  30, seen 200 days ago
     *   onetimer    1 visit,  spent  12, seen 10 days ago
     *   never       0 visits, spent   0, never seen
     */
    const shapes = [
      { label: 'regular-a', visits: 12, spend: 240, daysAgo: 1, vip: true },
      { label: 'regular-b', visits: 8, spend: 160, daysAgo: 3, vip: false },
      { label: 'casual', visits: 3, spend: 45, daysAgo: 40, vip: false },
      { label: 'lapsed', visits: 2, spend: 30, daysAgo: 200, vip: false },
      { label: 'onetimer', visits: 1, spend: 12, daysAgo: 10, vip: false },
      { label: 'never', visits: 0, spend: 0, daysAgo: null, vip: false },
    ]

    for (const shape of shapes) {
      const id = await createCustomer(tenant.businessId, {
        email: `${shape.label}@segment.test`,
        name: shape.label,
      })
      await db
        .from('customers')
        .update({
          visit_count: shape.visits,
          lifetime_spend: shape.spend,
          is_vip: shape.vip,
          last_visit:
            shape.daysAgo === null
              ? null
              : new Date(Date.now() - shape.daysAgo * 86_400_000).toISOString(),
        })
        .eq('id', id)
    }
  })

  afterAll(async () => {
    if (tenant) await dropTenant(tenant)
    await shutdown()
  })

  /**
   * The check that would have caught the original defect on its own.
   *
   * A predicate the SQL engine cannot parse produces 0, and so does a segment
   * that genuinely matches nobody. The only way to tell them apart is to ask a
   * question whose answer is known to be non-zero.
   */
  it('counts a numeric condition instead of silently returning zero', async () => {
    const definition: SegmentDefinition = {
      match: 'all',
      conditions: [{ field: 'visit_count', operator: 'gte', value: 3 }],
    }

    const count = await countSegment(tenant.businessId, definition)

    // regular-a (12), regular-b (8), casual (3).
    expect(count).toBe(3)
  })

  it('narrows as the threshold rises, so the value is actually bound', async () => {
    const counts = await Promise.all(
      [0, 2, 4, 9, 20].map((threshold) =>
        countSegment(tenant.businessId, {
          match: 'all',
          conditions: [{ field: 'visit_count', operator: 'gte', value: threshold }],
        })
      )
    )

    /*
     * Visit counts are 12, 8, 3, 2, 1, 0 — so the thresholds 0, 2, 4, 9, 20
     * admit 6, 4, 2, 1 and 0 customers. Strictly non-increasing and not all the
     * same: a predicate that ignored its bound parameter would return one
     * constant for every threshold, which is exactly the shape of the bug.
     */
    expect(counts).toEqual([6, 4, 2, 1, 0])
  })

  it('compiles and binds a currency threshold', async () => {
    const count = await countSegment(tenant.businessId, {
      match: 'all',
      conditions: [{ field: 'lifetime_spend', operator: 'gte', value: 100 }],
    })
    // regular-a (240), regular-b (160).
    expect(count).toBe(2)
  })

  it('resolves a relative date window', async () => {
    const recent = await countSegment(tenant.businessId, {
      match: 'all',
      conditions: [{ field: 'last_visit', operator: 'within_days', value: 7 }],
    })
    // regular-a (1 day), regular-b (3 days).
    expect(recent).toBe(2)
  })

  it('includes never-seen customers in a "not seen in N days" segment', async () => {
    /*
     * The win-back case, and the one where getting it wrong is worst: a customer
     * who never came back is the customer a win-back campaign most needs to
     * reach, and `last_visit < now() - interval` excludes a null.
     */
    const lapsed = await countSegment(tenant.businessId, {
      match: 'all',
      conditions: [{ field: 'last_visit', operator: 'before_days', value: 30 }],
    })
    // casual (40 days), lapsed (200 days), never (null).
    expect(lapsed).toBe(3)
  })

  it('combines conditions with AND', async () => {
    const count = await countSegment(tenant.businessId, {
      match: 'all',
      conditions: [
        { field: 'visit_count', operator: 'gte', value: 3 },
        { field: 'lifetime_spend', operator: 'gte', value: 200 },
      ],
    })
    // Only regular-a satisfies both.
    expect(count).toBe(1)
  })

  it('combines conditions with OR', async () => {
    const count = await countSegment(tenant.businessId, {
      match: 'any',
      conditions: [
        { field: 'visit_count', operator: 'gte', value: 12 },
        { field: 'last_visit', operator: 'before_days', value: 100 },
      ],
    })
    // regular-a (12 visits) plus lapsed (200 days) plus never (null last_visit).
    expect(count).toBe(3)
  })

  it('resolves a boolean condition, which is the case that always worked', async () => {
    /*
     * Kept deliberately. `is_true` emits no parameter accessor, so this passed
     * throughout the outage — which is exactly why the outage looked like an
     * empty database instead of a broken query. A test that still passes when
     * everything around it is broken is worth naming as such.
     */
    const count = await countSegment(tenant.businessId, {
      match: 'all',
      conditions: [{ field: 'is_vip', operator: 'is_true' }],
    })
    expect(count).toBe(1)
  })

  it('returns the same rows through the id listing as through the count', async () => {
    const definition: SegmentDefinition = {
      match: 'all',
      conditions: [{ field: 'visit_count', operator: 'gte', value: 3 }],
    }

    const [count, ids] = await Promise.all([
      countSegment(tenant.businessId, definition),
      listSegmentCustomerIds(tenant.businessId, definition),
    ])

    // `passimo_segment_customer_ids` is a separate function with the same
    // `USING` binding, so it had the same defect and needs the same proof.
    expect(ids).toHaveLength(count)
    expect(count).toBeGreaterThan(0)
  })

  it('matches everybody for an empty definition, and only then', async () => {
    const all = await countSegment(tenant.businessId, { match: 'all', conditions: [] })
    expect(all).toBe(6)
  })

  /**
   * Every operator, executed.
   *
   * The gap this closes: the tests above pick operators one at a time, and the
   * ones nobody picked were broken. `in`, `not_in` and the tag predicates all
   * compiled to `= any((select array_agg(v) …))` — the *subquery* form of
   * `ANY`, applied to a single row of type `text[]`, which PostgreSQL refuses:
   *
   *     operator does not exist: text = text[]
   *
   * And because the resolver logged the failure and returned 0, the answer came
   * back looking exactly like "no customers match" — so the built-in VIP segment
   * read 0 against a workspace with 50 VIPs, and a merchant filtering by
   * language or tag saw an empty table and believed it.
   *
   * A unit test cannot catch this: the compiled SQL had the right shape, and the
   * PL/pgSQL functions were correct on their own. Only executing one against the
   * other does. So this asserts nothing about *which* rows come back — the cases
   * above do that — only that **every operator the UI can produce actually
   * runs**. A throw here is the failure; a count of zero is fine.
   */
  it('executes every operator the segment builder can produce', async () => {
    const samples: Array<{ field: SegmentField; operator: SegmentOperator; value?: unknown }> = [
      { field: 'name', operator: 'eq', value: 'Regular A' },
      { field: 'name', operator: 'neq', value: 'Regular A' },
      { field: 'visit_count', operator: 'gt', value: 1 },
      { field: 'visit_count', operator: 'gte', value: 1 },
      { field: 'visit_count', operator: 'lt', value: 99 },
      { field: 'visit_count', operator: 'lte', value: 99 },
      { field: 'email', operator: 'contains', value: 'passimo' },
      { field: 'email', operator: 'not_contains', value: 'nope' },
      { field: 'email', operator: 'starts_with', value: 'regular' },
      { field: 'locale', operator: 'in', value: ['en', 'es'] },
      { field: 'locale', operator: 'not_in', value: ['fr'] },
      { field: 'rfm_segment', operator: 'in', value: ['champion', 'loyal'] },
      { field: 'rfm_segment', operator: 'not_in', value: ['at_risk'] },
      { field: 'tag', operator: 'in', value: ['vip', 'regular'] },
      { field: 'tag', operator: 'not_in', value: ['lapsed'] },
      { field: 'is_vip', operator: 'is_true' },
      { field: 'is_vip', operator: 'is_false' },
      { field: 'phone', operator: 'is_set' },
      { field: 'phone', operator: 'is_not_set' },
      { field: 'last_visit', operator: 'within_days', value: 30 },
      { field: 'last_visit', operator: 'before_days', value: 30 },
      { field: 'birthday', operator: 'birthday_in_month' },
      { field: 'birthday', operator: 'birthday_today' },
      { field: 'birthday', operator: 'birthday_in_days', value: 7 },
      { field: 'balance', operator: 'gte', value: 1 },
      { field: 'reward_available', operator: 'is_true' },
      { field: 'tier_level', operator: 'gte', value: 1 },
    ]

    // Every operator in the vocabulary must appear above, or a new one could be
    // added to the UI and never executed by this test.
    const covered = new Set(samples.map((sample) => sample.operator))
    expect([...SEGMENT_OPERATORS].filter((operator) => !covered.has(operator))).toEqual([])

    const failures: string[] = []
    for (const sample of samples) {
      const definition: SegmentDefinition = {
        match: 'all',
        conditions: [{ field: sample.field, operator: sample.operator, value: sample.value } as never],
      }
      try {
        const count = await countSegment(tenant.businessId, definition)
        expect(Number.isFinite(count)).toBe(true)
        // The id listing runs a second function over the same predicate, so it
        // carries the same risk and needs the same proof.
        await listSegmentCustomerIds(tenant.businessId, definition, { limit: 10 })
      } catch (error) {
        failures.push(`${sample.field} ${sample.operator}: ${(error as Error).message}`)
      }
    }

    expect(failures, failures.join('\n')).toEqual([])
  })

  it('agrees between the count and the audience for every operator', async () => {
    /*
     * The number a merchant reads and the people a campaign reaches come from
     * two different database functions over one predicate. When they disagree,
     * the product lies quietly — a reach of 468 that sends to nobody.
     */
    const definitions: SegmentDefinition[] = [
      { match: 'all', conditions: [{ field: 'locale', operator: 'in', value: ['en', 'es'] }] },
      { match: 'any', conditions: [
        { field: 'is_vip', operator: 'is_true' },
        { field: 'rfm_segment', operator: 'in', value: ['champion'] },
      ] },
      { match: 'all', conditions: [{ field: 'tag', operator: 'in', value: ['vip'] }] },
    ]

    for (const definition of definitions) {
      const [count, ids] = await Promise.all([
        countSegment(tenant.businessId, definition),
        listSegmentCustomerIds(tenant.businessId, definition, { limit: 1000 }),
      ])
      expect(ids, JSON.stringify(definition)).toHaveLength(count)
      // And the ids must be usable — the previous bug returned `undefined`s.
      expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true)
    }
  })

  it('never lets a value reach the SQL text', async () => {
    /*
     * The safety property, verified against a live database rather than a string:
     * a payload that would be catastrophic as syntax has to come back as an
     * ordinary zero-match segment, with the customers table still present.
     */
    const malicious = "'; drop table customers; --"
    const compiled = compileSegment({
      match: 'all',
      conditions: [{ field: 'name', operator: 'eq', value: malicious }],
    })
    expect(compiled.sql).not.toContain('drop table')

    const count = await countSegment(tenant.businessId, {
      match: 'all',
      conditions: [{ field: 'name', operator: 'eq', value: malicious }],
    })
    expect(count).toBe(0)

    const { data } = await getDb()
      .from('customers')
      .select('id')
      .eq('business_id', tenant.businessId)
      .limit(1)
    expect(data?.length).toBe(1)
  })
})
