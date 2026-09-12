import { describe, expect, it } from 'vitest'
import { compileSegment } from '@/lib/segments/compile'
import { describeSegment } from '@/lib/segments/definition'
import type { SegmentCondition } from '@/lib/segments/definition'

/**
 * Operator-level coverage for segment compilation and description.
 *
 * A segment is the audience of a campaign. A wrong predicate sends the wrong
 * message to the wrong people at real cost, and a description that does not
 * match its filter means the merchant approved something else entirely. Both
 * halves are pinned here, operator by operator.
 */

describe('compileSegment — derived fields', () => {
  it('matches customers carrying any of a set of tags', () => {
    const compiled = compileSegment({
      match: 'all',
      conditions: [{ field: 'tag', operator: 'in', value: ['vip', 'regular'] }],
    })
    expect(compiled.sql).toContain('customer_tags')
    expect(compiled.sql).toMatch(/^\(?exists/)
    expect(compiled.params).toEqual([['vip', 'regular']])
  })

  it('negates the tag predicate for not_in', () => {
    const compiled = compileSegment({
      match: 'all',
      conditions: [{ field: 'tag', operator: 'not_in', value: ['lapsed'] }],
    })
    expect(compiled.sql).toMatch(/^\(?not exists/)
  })

  it('collapses an empty tag list to a constant instead of invalid SQL', () => {
    expect(
      compileSegment({ match: 'all', conditions: [{ field: 'tag', operator: 'in', value: [] }] })
        .sql
    ).toMatch(/^\(?false\)?$/)
    expect(
      compileSegment({
        match: 'all',
        conditions: [{ field: 'tag', operator: 'not_in', value: [] }],
      }).sql
    ).toMatch(/^\(?true\)?$/)
  })

  it('compares balance against the best account, defaulting to zero', () => {
    const compiled = compileSegment({
      match: 'all',
      conditions: [{ field: 'balance', operator: 'gte', value: 5 }],
    })
    expect(compiled.sql).toContain('loyalty_accounts')
    expect(compiled.sql).toContain('>=')
    expect(compiled.params).toEqual([5])
  })

  it('compares tier by level, so renaming a tier cannot break a segment', () => {
    const compiled = compileSegment({
      match: 'all',
      conditions: [{ field: 'tier_level', operator: 'gt', value: 2 }],
    })
    expect(compiled.sql).toContain('program_tiers')
    expect(compiled.params).toEqual([2])
  })

  it('resolves reward availability against each program goal', () => {
    const positive = compileSegment({
      match: 'all',
      conditions: [{ field: 'reward_available', operator: 'is_true' }],
    })
    expect(positive.sql).toMatch(/^\(?exists/)
    expect(positive.sql).toContain('a.balance >= p.goal_amount')

    const negative = compileSegment({
      match: 'all',
      conditions: [{ field: 'reward_available', operator: 'is_false' }],
    })
    expect(negative.sql).toMatch(/^\(?not exists/)
  })
})

describe('compileSegment — comparison operators', () => {
  const operators = [
    ['gt', '>'],
    ['gte', '>='],
    ['lt', '<'],
    ['lte', '<='],
  ] as const

  it.each(operators)('compiles %s to %s with a bound parameter', (operator, sql) => {
    const compiled = compileSegment({
      match: 'all',
      conditions: [{ field: 'visit_count', operator, value: 3 }],
    })
    expect(compiled.sql).toContain(` ${sql} `)
    expect(compiled.params).toEqual([3])
  })

  it('uses `is distinct from` for neq so nulls are not silently excluded', () => {
    // A plain `<>` drops NULL rows, which is never what a merchant means by
    // "segment is not champion".
    const compiled = compileSegment({
      match: 'all',
      conditions: [{ field: 'rfm_segment', operator: 'neq', value: 'champion' }],
    })
    expect(compiled.sql).toContain('is distinct from')
  })

  it('matches list membership without inlining the values', () => {
    const compiled = compileSegment({
      match: 'all',
      conditions: [{ field: 'rfm_segment', operator: 'in', value: ['champion', 'loyal'] }],
    })
    expect(compiled.sql).toContain('= any(')
    expect(compiled.sql).not.toContain('champion')
  })

  /**
   * `= any()` has two forms and only one of them works here.
   *
   * This assertion exists because the test above passed against SQL that
   * PostgreSQL refused to run. `x = any(y)` is the *array* form when `y` is an
   * array expression and the *subquery* form when `y` is a parenthesised
   * SELECT — the choice is syntactic. The compiler used to emit
   * `any((select array_agg(v) …))`, which is the subquery form applied to one
   * row of type `text[]`, so the planner answered:
   *
   *     operator does not exist: text = text[]
   *
   * Nothing surfaced, because `countSegment` logged the failure and returned 0.
   * Every "is one of" condition therefore reported *no matching customers*: the
   * built-in VIP segment read 0 against 50 VIPs, and a merchant filtering by
   * language or tag saw an empty table and believed it.
   *
   * So the shape is pinned, on every operator that builds a list.
   */
  it('uses the array-constructor form of any(), not the subquery form', () => {
    const listOperators: Array<{ field: 'rfm_segment' | 'tag'; operator: 'in' | 'not_in' }> = [
      { field: 'rfm_segment', operator: 'in' },
      { field: 'rfm_segment', operator: 'not_in' },
      { field: 'tag', operator: 'in' },
      { field: 'tag', operator: 'not_in' },
    ]

    for (const { field, operator } of listOperators) {
      const compiled = compileSegment({
        match: 'all',
        conditions: [{ field, operator, value: ['champion', 'loyal'] }],
      })

      expect(compiled.sql, `${field} ${operator} builds an array constructor`).toContain(
        'array(select v from jsonb_array_elements_text('
      )
      // The exact text that failed. `(select array_agg(…))` inside any()/all()
      // is the subquery form and does not type-check against a scalar column.
      expect(compiled.sql, `${field} ${operator} must not use a scalar subquery`).not.toContain(
        'select coalesce(array_agg('
      )
    }
  })

  it('treats a null column as satisfying not_in', () => {
    const compiled = compileSegment({
      match: 'all',
      conditions: [{ field: 'rfm_segment', operator: 'not_in', value: ['at_risk'] }],
    })
    expect(compiled.sql).toContain('is null or')
  })

  it('anchors starts_with and keeps the wildcard out of the parameter', () => {
    const compiled = compileSegment({
      match: 'all',
      conditions: [{ field: 'email', operator: 'starts_with', value: 'ana' }],
    })
    expect(compiled.sql).toContain("|| '%'")
    expect(compiled.params).toEqual(['ana'])
  })

  it('coerces a non-numeric value to zero rather than emitting invalid SQL', () => {
    const compiled = compileSegment({
      match: 'all',
      conditions: [{ field: 'visit_count', operator: 'gte', value: 'many' }],
    })
    expect(compiled.params).toEqual([0])
  })
})

describe('describeSegment', () => {
  it('describes an empty definition as everyone', () => {
    expect(describeSegment({ match: 'all', conditions: [] })).toBe('All customers')
  })

  it('joins with and / or to match the group operator', () => {
    const conditions = [
      { field: 'is_vip', operator: 'is_true' },
      { field: 'visit_count', operator: 'gte', value: 5 },
    ] as SegmentCondition[]

    expect(describeSegment({ match: 'all', conditions })).toContain(' and ')
    expect(describeSegment({ match: 'any', conditions })).toContain(' or ')
  })

  it('parenthesises a nested group so precedence is visible', () => {
    const description = describeSegment({
      match: 'all',
      conditions: [
        { field: 'is_vip', operator: 'is_true' } as SegmentCondition,
        {
          match: 'any',
          conditions: [
            { field: 'visit_count', operator: 'gte', value: 5 },
            { field: 'lifetime_spend', operator: 'gte', value: 100 },
          ] as SegmentCondition[],
        },
      ],
    })
    expect(description).toMatch(/\(.+ or .+\)/)
  })

  it('renders every operator in plain language, never a raw enum', () => {
    const cases: Array<[SegmentCondition, string]> = [
      [{ field: 'is_vip', operator: 'is_true' }, 'is yes'],
      [{ field: 'is_vip', operator: 'is_false' }, 'is no'],
      [{ field: 'phone', operator: 'is_set' }, 'is set'],
      [{ field: 'phone', operator: 'is_not_set' }, 'is empty'],
      [{ field: 'last_visit', operator: 'within_days', value: 30 }, 'in the last 30 days'],
      [{ field: 'last_visit', operator: 'before_days', value: 90 }, 'more than 90 days ago'],
      [{ field: 'birthday', operator: 'birthday_in_month' }, 'this month'],
      [{ field: 'birthday', operator: 'birthday_today' }, 'today'],
      [{ field: 'birthday', operator: 'birthday_in_days', value: 7 }, 'in 7 days'],
      [{ field: 'rfm_segment', operator: 'in', value: ['a', 'b'] }, 'is one of a, b'],
      [{ field: 'rfm_segment', operator: 'not_in', value: ['a'] }, 'is none of a'],
      [{ field: 'email', operator: 'contains', value: 'gmail' }, 'contains "gmail"'],
      [{ field: 'email', operator: 'not_contains', value: 'test' }, 'does not contain "test"'],
      [{ field: 'email', operator: 'starts_with', value: 'ana' }, 'starts with "ana"'],
      [{ field: 'visit_count', operator: 'gt', value: 5 }, '> 5'],
      [{ field: 'visit_count', operator: 'gte', value: 5 }, '≥ 5'],
      [{ field: 'visit_count', operator: 'lt', value: 5 }, '< 5'],
      [{ field: 'visit_count', operator: 'lte', value: 5 }, '≤ 5'],
      [{ field: 'rfm_segment', operator: 'neq', value: 'new' }, 'is not new'],
      [{ field: 'rfm_segment', operator: 'eq', value: 'new' }, 'is new'],
    ] as Array<[SegmentCondition, string]>

    for (const [condition, expected] of cases) {
      const description = describeSegment({ match: 'all', conditions: [condition] })
      expect(description, JSON.stringify(condition)).toContain(expected)
    }
  })
})
