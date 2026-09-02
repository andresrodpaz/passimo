import { describe, expect, it } from 'vitest'
import { compileSegment } from '@/lib/segments/compile'
import { describeSegment, segmentDefinitionSchema } from '@/lib/segments/definition'

/**
 * Segment compilation turns merchant-authored filters into SQL. The safety
 * property under test is that *no* merchant input ever reaches the SQL string:
 * values are always emitted as indexed JSON parameter accessors.
 */

describe('compileSegment', () => {
  it('compiles an empty definition to a permissive predicate', () => {
    const compiled = compileSegment({ match: 'all', conditions: [] })
    expect(compiled.sql).toBe('true')
    expect(compiled.params).toEqual([])
  })

  it('emits values as bound parameters, never inline', () => {
    const compiled = compileSegment({
      match: 'all',
      conditions: [{ field: 'email', operator: 'contains', value: "o'brien" }],
    })
    expect(compiled.sql).not.toContain("o'brien")
    expect(compiled.sql).toContain('$1 ->> 0')
    expect(compiled.params).toEqual(["o'brien"])
  })

  it('cannot be escaped by a SQL-injection payload in a value', () => {
    const malicious = "'; drop table customers; --"
    const compiled = compileSegment({
      match: 'all',
      conditions: [{ field: 'name', operator: 'eq', value: malicious }],
    })
    expect(compiled.sql).not.toContain('drop table')
    expect(compiled.params).toEqual([malicious])
  })

  it('joins conditions with AND for "all" and OR for "any"', () => {
    const all = compileSegment({
      match: 'all',
      conditions: [
        { field: 'is_vip', operator: 'is_true' },
        { field: 'visit_count', operator: 'gte', value: 5 },
      ],
    })
    expect(all.sql).toContain(' and ')

    const any = compileSegment({
      match: 'any',
      conditions: [
        { field: 'is_vip', operator: 'is_true' },
        { field: 'visit_count', operator: 'gte', value: 5 },
      ],
    })
    expect(any.sql).toContain(' or ')
  })

  it('treats "never visited" as satisfying a before_days filter', () => {
    // A win-back segment that silently skipped customers with no recorded visit
    // would miss exactly the people it exists to reach.
    const compiled = compileSegment({
      match: 'all',
      conditions: [{ field: 'last_visit', operator: 'before_days', value: 30 }],
    })
    expect(compiled.sql).toContain('c.last_visit is null')
  })

  it('compiles nested groups', () => {
    const compiled = compileSegment({
      match: 'all',
      conditions: [
        { field: 'is_vip', operator: 'is_true' },
        {
          match: 'any',
          conditions: [
            { field: 'visit_count', operator: 'gte', value: 10 },
            { field: 'lifetime_spend', operator: 'gte', value: 200 },
          ],
        },
      ],
    })
    expect(compiled.sql).toContain(' or ')
    expect(compiled.params).toEqual([10, 200])
  })

  it('compiles an "in" list to an array parameter', () => {
    const compiled = compileSegment({
      match: 'all',
      conditions: [{ field: 'rfm_segment', operator: 'in', value: ['champion', 'loyal'] }],
    })
    expect(compiled.sql).toContain('jsonb_array_elements_text')
    expect(compiled.params).toEqual([['champion', 'loyal']])
  })

  it('compiles an empty "in" list to a predicate that matches nobody', () => {
    const compiled = compileSegment({
      match: 'all',
      conditions: [{ field: 'rfm_segment', operator: 'in', value: [] }],
    })
    expect(compiled.sql).toBe('(false)')
  })

  it('compiles derived fields to correlated subqueries', () => {
    const compiled = compileSegment({
      match: 'all',
      conditions: [{ field: 'reward_available', operator: 'is_true' }],
    })
    expect(compiled.sql).toContain('loyalty_accounts')
    expect(compiled.sql).toContain('goal_amount')
  })

  it('compiles tag membership through the join table', () => {
    const compiled = compileSegment({
      match: 'all',
      conditions: [{ field: 'tag', operator: 'in', value: ['regular'] }],
    })
    expect(compiled.sql).toContain('customer_tags')
    expect(compiled.params).toEqual([['regular']])
  })

  /**
   * The accessor has to be the *placeholder*, not the PL/pgSQL argument name.
   *
   * `passimo_segment_count` and its three siblings bind the parameter array with
   * `EXECUTE ... USING p_params`, which makes it `$1`. `EXECUTE` does no variable
   * substitution on the query text, so a predicate saying `p_params` fails with
   * `column "p_params" does not exist` — and every caller logs that and returns
   * 0 or [] rather than breaking a campaign screen. The result was segmentation
   * that matched nobody, in total silence: the preview read 0 against 331
   * matching customers, and every segmented campaign reached zero recipients.
   *
   * No test on the compiler's output *shape* could catch that, because the shape
   * was fine. Only naming the placeholder can.
   */
  it('references the bound parameter as $1, never the PL/pgSQL argument name', () => {
    const compiled = compileSegment({
      match: 'all',
      conditions: [
        { field: 'visit_count', operator: 'gte', value: 2 },
        { field: 'rfm_segment', operator: 'in', value: ['champion', 'loyal'] },
      ],
    })

    expect(compiled.sql).not.toContain('p_params')
    expect(compiled.sql).toContain('$1 ->> 0')
    // A list value takes the `->` path, which had the same defect.
    expect(compiled.sql).toContain('$1 -> 1')
  })

  it('emits every value-carrying operator through the $1 accessor', () => {
    /*
     * Value-less operators (`is_true`, `is_set`) emit no accessor, which is why
     * the "VIP" system segment kept working while every other one returned
     * nobody — and why the failure read as an empty database rather than a broken
     * query. This walks the operators that *do* carry a value so a future
     * accessor added to one of them cannot regress alone.
     */
    const cases: Array<[string, unknown]> = [
      ['gte', 2],
      ['lte', 5],
      ['eq', 3],
      ['within_days', 30],
      ['before_days', 90],
    ]

    for (const [operator, value] of cases) {
      const compiled = compileSegment({
        match: 'all',
        conditions: [
          { field: operator === 'within_days' || operator === 'before_days' ? 'last_visit' : 'visit_count', operator, value },
        ],
      } as never)
      expect(compiled.sql, `operator ${operator}`).not.toContain('p_params')
      expect(compiled.sql, `operator ${operator}`).toContain('$1')
      expect(compiled.params, `operator ${operator}`).toEqual([value])
    }
  })

  it('numbers parameters sequentially across the whole tree', () => {
    const compiled = compileSegment({
      match: 'all',
      conditions: [
        { field: 'visit_count', operator: 'gte', value: 1 },
        { field: 'lifetime_spend', operator: 'gte', value: 2 },
        { field: 'churn_risk', operator: 'lte', value: 3 },
      ],
    })
    expect(compiled.params).toEqual([1, 2, 3])
    expect(compiled.sql).toContain('$1 ->> 0')
    expect(compiled.sql).toContain('$1 ->> 1')
    expect(compiled.sql).toContain('$1 ->> 2')
  })
})

describe('segmentDefinitionSchema', () => {
  it('accepts a valid definition and applies defaults', () => {
    const parsed = segmentDefinitionSchema.parse({ conditions: [] })
    expect(parsed.match).toBe('all')
  })

  it('rejects a field outside the allow-list', () => {
    const result = segmentDefinitionSchema.safeParse({
      match: 'all',
      conditions: [{ field: 'password_hash', operator: 'eq', value: 'x' }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects an unknown operator', () => {
    const result = segmentDefinitionSchema.safeParse({
      match: 'all',
      conditions: [{ field: 'email', operator: 'drop_table', value: 'x' }],
    })
    expect(result.success).toBe(false)
  })
})

describe('describeSegment', () => {
  it('describes an empty segment as everyone', () => {
    expect(describeSegment({ match: 'all', conditions: [] })).toBe('All customers')
  })

  it('produces readable prose a merchant can verify', () => {
    const summary = describeSegment({
      match: 'all',
      conditions: [
        { field: 'last_visit', operator: 'before_days', value: 30 },
        { field: 'is_vip', operator: 'is_true' },
      ],
    })
    expect(summary).toBe('Last visit more than 30 days ago and VIP is yes')
  })
})
