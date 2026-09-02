import {
  SEGMENT_FIELDS,
  isGroup,
  type SegmentCondition,
  type SegmentDefinition,
} from '@/lib/segments/definition'

/**
 * Compiles a segment definition into a SQL predicate plus a JSON parameter
 * array, executed by the `passimo_segment_*` functions.
 *
 * Safety model — there is no path from merchant input into SQL text:
 *   1. Column names come from the `SEGMENT_FIELDS` allow-list, never from input.
 *   2. Operators are matched against a closed set; anything unknown compiles to
 *      a constant.
 *   3. Every value is emitted as a `$1 -> N` JSON accessor with an explicit
 *      cast, so values are data, never syntax.
 *
 * The compiled predicate is deterministic, which makes it straightforward to
 * unit-test the exact SQL a definition produces.
 *
 * ## Why the accessor is `$1` and not `p_params`
 *
 * This was a real, total, silent failure of the segmentation feature.
 *
 * The four SQL functions in migration `000010` take the parameter array as a
 * PL/pgSQL argument called `p_params` and hand it to the predicate with
 * `EXECUTE ... USING p_params`. `USING` binds it as **`$1`**. `EXECUTE` performs
 * no variable substitution on the query text — the string goes to the SQL engine,
 * which has never heard of a PL/pgSQL local — so a predicate that says `p_params`
 * fails with `column "p_params" does not exist`.
 *
 * The compiler emitted `p_params`, matching the argument name rather than the
 * placeholder. So:
 *
 *   - every condition carrying a *value* produced a predicate that errored;
 *   - `resolveSegmentDefinition`'s callers log and return `0` / `[]` on error,
 *     because a failed segment must never break a campaign screen;
 *   - so every such segment matched **nobody**, with no error surfaced.
 *
 * What that looked like from the outside: the preview counted 0 against a
 * database with 331 matching customers, "At risk", "Lost", "New this month" and
 * "Reward ready" all read 0 on the dashboard, and every segmented campaign
 * reported a reach of zero. The only segments that worked were the ones built
 * from value-less operators — `is_true`, `is_set` — because those emit no
 * accessor at all, which is precisely why "VIP" looked fine and made the rest
 * look like an empty database rather than a broken query.
 *
 * Fixed here rather than in SQL because the functions are already correct: they
 * bind one parameter and the placeholder for the first bound parameter is `$1`.
 * Changing four applied migrations to accommodate a wrong accessor would be
 * fixing the wrong end, and applied migrations are checksummed.
 */

/**
 * The placeholder the parameter array arrives under.
 *
 * Named rather than inlined so the reason lives in one place, and so a test can
 * assert the emitted SQL contains no reference to the PL/pgSQL argument name.
 */
const PARAMS = '$1'

export type CompiledSegment = {
  /** SQL fragment valid in a WHERE clause against `customers c`. */
  sql: string
  /** Values referenced positionally by the fragment. */
  params: unknown[]
}

type Cast = 'text' | 'numeric' | 'int' | 'boolean' | 'timestamptz' | 'text[]'

class ParamBag {
  readonly values: unknown[] = []

  add(value: unknown, cast: Cast): string {
    const index = this.values.length
    this.values.push(value)
    if (cast === 'text[]') {
      return `(select coalesce(array_agg(v), array[]::text[]) from jsonb_array_elements_text(${PARAMS} -> ${index}) as v)`
    }
    return `((${PARAMS} ->> ${index})::${cast})`
  }
}

export function compileSegment(definition: SegmentDefinition): CompiledSegment {
  const bag = new ParamBag()
  const sql = compileGroup(definition, bag)
  return { sql, params: bag.values }
}

function compileGroup(group: SegmentDefinition, bag: ParamBag): string {
  const conditions = group?.conditions ?? []
  if (conditions.length === 0) return 'true'
  const joiner = group.match === 'any' ? ' or ' : ' and '
  const parts = conditions.map((node) =>
    isGroup(node) ? compileGroup(node, bag) : compileCondition(node, bag)
  )
  return `(${parts.join(joiner)})`
}

function compileCondition(condition: SegmentCondition, bag: ParamBag): string {
  const field = SEGMENT_FIELDS[condition.field]
  if (!field) return 'true'
  if (field.type === 'derived') return compileDerived(condition, bag)

  const column = `c.${field.column}`
  const { operator, value } = condition

  switch (operator) {
    case 'is_true':
      return `${column} is true`
    case 'is_false':
      return `coalesce(${column}, false) is false`
    case 'is_set':
      return `${column} is not null`
    case 'is_not_set':
      return `${column} is null`

    case 'within_days':
      return `${column} >= now() - make_interval(days => ${bag.add(toInt(value, 30), 'int')})`
    case 'before_days':
      // "Not seen in N days" must include people never seen at all, otherwise
      // win-back campaigns silently skip the customers who need them most.
      return `(${column} is null or ${column} < now() - make_interval(days => ${bag.add(toInt(value, 30), 'int')}))`

    case 'birthday_in_month':
      return `(${column} is not null and extract(month from ${column}) = extract(month from now()))`
    case 'birthday_today':
      return `(${column} is not null and extract(month from ${column}) = extract(month from now()) and extract(day from ${column}) = extract(day from now()))`
    case 'birthday_in_days': {
      const days = bag.add(toInt(value, 0), 'int')
      return `(${column} is not null and to_char(${column}, 'MM-DD') = to_char(now() + make_interval(days => ${days}), 'MM-DD'))`
    }

    case 'contains':
      return `${column}::text ilike '%' || ${bag.add(String(value ?? ''), 'text')} || '%'`
    case 'not_contains':
      return `coalesce(${column}::text, '') not ilike '%' || ${bag.add(String(value ?? ''), 'text')} || '%'`
    case 'starts_with':
      return `${column}::text ilike ${bag.add(String(value ?? ''), 'text')} || '%'`

    case 'in': {
      const list = toArray(value).map(String)
      if (list.length === 0) return 'false'
      return `${column}::text = any(${bag.add(list, 'text[]')})`
    }
    case 'not_in': {
      const list = toArray(value).map(String)
      if (list.length === 0) return 'true'
      return `(${column} is null or ${column}::text <> all(${bag.add(list, 'text[]')}))`
    }

    case 'neq':
      return `${column} is distinct from ${bag.add(coerce(field.type, value), castFor(field.type))}`
    case 'gt':
      return `${column} > ${bag.add(coerce(field.type, value), castFor(field.type))}`
    case 'gte':
      return `${column} >= ${bag.add(coerce(field.type, value), castFor(field.type))}`
    case 'lt':
      return `${column} < ${bag.add(coerce(field.type, value), castFor(field.type))}`
    case 'lte':
      return `${column} <= ${bag.add(coerce(field.type, value), castFor(field.type))}`
    case 'eq':
    default:
      return `${column} = ${bag.add(coerce(field.type, value), castFor(field.type))}`
  }
}

/** Derived fields resolve through a correlated subquery, all kept in one place. */
function compileDerived(condition: SegmentCondition, bag: ParamBag): string {
  const { field, operator, value } = condition

  if (field === 'tag') {
    const list = toArray(value).map(String)
    if (list.length === 0) return operator === 'not_in' || operator === 'neq' ? 'true' : 'false'
    const predicate = `exists (
      select 1 from customer_tags ct
      join tags t on t.id = ct.tag_id
      where ct.customer_id = c.id and t.name = any(${bag.add(list, 'text[]')})
    )`
    return operator === 'not_in' || operator === 'neq' ? `not ${predicate}` : predicate
  }

  if (field === 'balance') {
    return `coalesce((select max(a.balance) from loyalty_accounts a where a.customer_id = c.id), 0) ${comparatorFor(operator)} ${bag.add(toNumber(value, 0), 'numeric')}`
  }

  if (field === 'tier_level') {
    return `coalesce((
      select max(t.level) from loyalty_accounts a
      join program_tiers t on t.id = a.tier_id
      where a.customer_id = c.id
    ), 0) ${comparatorFor(operator)} ${bag.add(toInt(value, 0), 'int')}`
  }

  if (field === 'reward_available') {
    const predicate = `exists (
      select 1 from loyalty_accounts a
      join loyalty_programs p on p.id = a.program_id
      where a.customer_id = c.id
        and p.goal_amount is not null
        and a.balance >= p.goal_amount
    )`
    return operator === 'is_false' ? `not ${predicate}` : predicate
  }

  return 'true'
}

function comparatorFor(operator: SegmentCondition['operator']): string {
  switch (operator) {
    case 'gt':
      return '>'
    case 'gte':
      return '>='
    case 'lt':
      return '<'
    case 'lte':
      return '<='
    case 'neq':
      return '<>'
    default:
      return '='
  }
}

function castFor(type: string): Cast {
  if (type === 'number') return 'numeric'
  if (type === 'boolean') return 'boolean'
  if (type === 'datetime') return 'timestamptz'
  return 'text'
}

function coerce(type: string, value: unknown): unknown {
  if (type === 'number') return toNumber(value, 0)
  if (type === 'boolean') return value === true || value === 'true'
  return value ?? null
}

function toInt(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function toNumber(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function toArray(value: unknown): Array<string | number> {
  if (Array.isArray(value)) return value as Array<string | number>
  if (value === undefined || value === null || value === '') return []
  return [value as string | number]
}
