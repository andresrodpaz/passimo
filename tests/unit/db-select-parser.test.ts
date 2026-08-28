import { describe, expect, it } from 'vitest'
import { hasEmbeds, parseSelect, type SelectEmbed } from '@/lib/db/select'

/**
 * The `select()` string parser.
 *
 * Every one of the ~300 `select(…)` calls in the product goes through here, and
 * a parser that silently drops a column produces a screen with a blank field
 * rather than an error. So the cases that matter are the ones where "silently
 * wrong" is possible: nested parentheses, aliases, and the embed forms.
 *
 * The strings asserted here are taken from real call sites.
 */
describe('parseSelect', () => {
  it('parses a plain column list', () => {
    expect(parseSelect('id, name, created_at')).toEqual([
      { kind: 'column', name: 'id', alias: null },
      { kind: 'column', name: 'name', alias: null },
      { kind: 'column', name: 'created_at', alias: null },
    ])
  })

  it('parses the wildcard', () => {
    expect(parseSelect('*')).toEqual([{ kind: 'column', name: '*', alias: null }])
  })

  it('tolerates the whitespace real call sites contain', () => {
    expect(parseSelect('  id ,name,  slug  ')).toEqual([
      { kind: 'column', name: 'id', alias: null },
      { kind: 'column', name: 'name', alias: null },
      { kind: 'column', name: 'slug', alias: null },
    ])
  })

  it('parses a column alias', () => {
    expect(parseSelect('total:lifetime_spend')).toEqual([
      { kind: 'column', name: 'lifetime_spend', alias: 'total' },
    ])
  })

  it('parses a to-one embed named by its foreign-key column', () => {
    // From app/api/v1/loyalty/earn/route.ts
    const nodes = parseSelect('id, code, expires_at, rewards:reward_id (name)')
    expect(nodes).toHaveLength(4)

    const embed = nodes[3] as SelectEmbed
    expect(embed.kind).toBe('embed')
    expect(embed.table).toBe('rewards')
    expect(embed.alias).toBe('rewards')
    expect(embed.localColumn).toBe('reward_id')
    expect(embed.inner).toBe(false)
    expect(embed.children).toEqual([{ kind: 'column', name: 'name', alias: null }])
  })

  it('parses an embed with no explicit column', () => {
    // From app/api/v1/public/card/[token]/route.ts
    const nodes = parseSelect('current_period_end, membership_plans(name, perks, earn_multiplier)')
    const embed = nodes[1] as SelectEmbed
    expect(embed.table).toBe('membership_plans')
    expect(embed.localColumn).toBeNull()
    expect(embed.children.map((child) => (child as { name: string }).name)).toEqual([
      'name',
      'perks',
      'earn_multiplier',
    ])
  })

  it('parses the !inner hint', () => {
    // From lib/customers/service.ts — the tag filter depends on this being inner.
    const nodes = parseSelect('customer_id, tags!inner(name)')
    const embed = nodes[1] as SelectEmbed
    expect(embed.table).toBe('tags')
    expect(embed.inner).toBe(true)
  })

  it('parses a wildcard inside an embed', () => {
    // From lib/automations/engine.ts
    const nodes = parseSelect('*, automations:automation_id (*)')
    expect(nodes[0]).toEqual({ kind: 'column', name: '*', alias: null })
    const embed = nodes[1] as SelectEmbed
    expect(embed.children).toEqual([{ kind: 'column', name: '*', alias: null }])
  })

  it('does not split on commas inside an embed', () => {
    const nodes = parseSelect(
      'balance, loyalty_programs:program_id (is_default), program_tiers:tier_id (level)'
    )
    expect(nodes).toHaveLength(3)
    expect((nodes[1] as SelectEmbed).table).toBe('loyalty_programs')
    expect((nodes[2] as SelectEmbed).table).toBe('program_tiers')
  })

  it('parses a nested embed', () => {
    const nodes = parseSelect('id, memberships:membership_id (id, membership_plans:plan_id (name))')
    const outer = nodes[1] as SelectEmbed
    expect(outer.table).toBe('memberships')
    const inner = outer.children[1] as SelectEmbed
    expect(inner.kind).toBe('embed')
    expect(inner.table).toBe('membership_plans')
    expect(inner.localColumn).toBe('plan_id')
  })

  it('rejects an unbalanced select string rather than guessing', () => {
    expect(() => parseSelect('id, rewards:reward_id (name')).toThrow(/unbalanced/i)
  })

  it('rejects an empty embed', () => {
    expect(() => parseSelect('id, rewards:reward_id ()')).toThrow(/empty embed/i)
  })

  it('rejects an unsupported embed hint instead of ignoring it', () => {
    expect(() => parseSelect('id, tags!wrong(name)')).toThrow(/unsupported embed hint/i)
  })

  it('rejects an identifier that is not one', () => {
    // A defence against interpolation reaching a select string.
    expect(() => parseSelect('id, name; drop table customers')).toThrow(/bad column/i)
    expect(() => parseSelect('id, 1=1')).toThrow(/bad column/i)
  })
})

describe('hasEmbeds', () => {
  it('distinguishes a plain projection from one needing a join', () => {
    expect(hasEmbeds(parseSelect('id, name'))).toBe(false)
    expect(hasEmbeds(parseSelect('id, rewards:reward_id (name)'))).toBe(true)
  })
})
