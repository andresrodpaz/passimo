import 'server-only'
import { query as runQuery } from '@/lib/db/pool'
import {
  columnType,
  findUniqueIndex,
  functionShape,
  resolveRelationship,
} from '@/lib/db/introspect'
import { parseSelect, type SelectEmbed, type SelectNode } from '@/lib/db/select'

/**
 * A small, explicit query builder over `pg`.
 *
 * It deliberately mirrors the fluent shape the application already speaks —
 * `.from('customers').select('id, name').eq('business_id', id).maybeSingle()` —
 * for one reason: that shape appears in roughly 460 places, and rewriting all
 * of them by hand as part of an infrastructure migration would mean 460
 * opportunities to drop a `business_id` filter in a multi-tenant product. The
 * call sites are the part of this system that has been reviewed and tested.
 * The transport underneath them is the part being replaced.
 *
 * What it is not: a general-purpose ORM. It covers exactly the operations this
 * product performs, compiles them to parameterised SQL, and throws on anything
 * it does not recognise rather than guessing.
 *
 * Safety properties, all enforced here rather than trusted at call sites:
 *
 *  - **Every value is a bound parameter.** Identifiers are validated against a
 *    strict pattern and quoted; there is no path from a value to SQL text.
 *  - **`update` and `delete` require a filter.** An unfiltered write on a
 *    multi-tenant table is the worst bug this product could ship, so it is a
 *    hard error rather than a code-review convention.
 *  - **Errors are returned, not thrown**, matching how every call site already
 *    handles `{ data, error }`.
 */

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

function quoteIdent(name: string): string {
  if (!IDENTIFIER.test(name)) {
    throw new Error(`Invalid SQL identifier: ${JSON.stringify(name)}`)
  }
  return `"${name}"`
}

export type DatabaseError = {
  message: string
  code: string | null
  details: string | null
  hint: string | null
}

/**
 * The result envelope every call site already destructures.
 *
 * `data` defaults to `any`, deliberately and with regret. The transport this
 * layer replaced was untyped: `data` arrived as `any` at all ~460 call sites,
 * which is why they narrow with explicit casts (`row.id as string`) and local
 * row types instead of relying on inference. Defaulting to `unknown` here would
 * be more correct in isolation and would produce several hundred type errors
 * whose only honest fix is generating types from the schema — a worthwhile
 * project, and not one to smuggle into an infrastructure migration.
 *
 * The generic is exposed so new code can opt in: `db.from<CustomerRow>(…)`
 * types `data` properly, and `lib/auth/users.ts` and `lib/auth/session.ts` do
 * exactly that with local row types.
 */
export type Result<T> = {
  data: T
  error: DatabaseError | null
  count: number | null
  status: number
}

function toDatabaseError(error: unknown): DatabaseError {
  const candidate = error as {
    message?: string
    code?: string
    detail?: string
    hint?: string
    constraint?: string
  }
  return {
    message: candidate?.message ?? 'Database error',
    code: candidate?.code ?? null,
    details: candidate?.detail ?? candidate?.constraint ?? null,
    hint: candidate?.hint ?? null,
  }
}

/**
 * `23505` — unique_violation. The code the product depends on most: every
 * `on conflict` path and every duplicate-email guard tests for it.
 */
const UNIQUE_VIOLATION = '23505'

/** Maps a PostgreSQL SQLSTATE to the HTTP status the API layer already expects. */
function statusForError(error: DatabaseError): number {
  switch (error.code) {
    case UNIQUE_VIOLATION: // duplicate key
    case '23P01': // exclusion violation
    case '23000': // integrity constraint violation
    case '23001': // restrict violation
    case '23503': // foreign key violation
    case '40001': // serialization failure
    case '40P01': // deadlock detected
      return 409
    case '23502': // not-null violation
    case '23514': // check violation
      return 422
    case '22P02': // invalid text representation — a malformed uuid or enum
    case '22003': // numeric out of range
    case '22007': // invalid datetime format
      return 400
    case '42501': // insufficient privilege
      return 403
    case '42P01': // undefined table — the schema is behind the code
    case '42883': // undefined function
      return 500
    case 'PGRST116': // our own "expected one row" marker
      return 406
    default:
      return 500
  }
}

// ---------------------------------------------------------------------------
// Parameter accumulation
// ---------------------------------------------------------------------------

class Params {
  readonly values: unknown[] = []

  /** Binds a value and returns its placeholder. */
  add(value: unknown, cast?: string): string {
    this.values.push(normalise(value))
    const placeholder = `$${this.values.length}`
    return cast ? `${placeholder}::${cast}` : placeholder
  }
}

/**
 * Converts a JavaScript value into something `pg` can bind, with no knowledge
 * of the destination column. Used for comparisons, where the column's own type
 * drives the cast.
 */
function normalise(value: unknown): unknown {
  if (value === undefined || value === null) return null
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value
  if (typeof value === 'object') return JSON.stringify(value)
  return value
}

/**
 * Binds a value for a *known* column, which is what makes writes safe.
 *
 * The ambiguous case is a JavaScript array. `['email', 'sms']` is a valid value
 * for both a `text[]` column and a `jsonb` one, and `pg` guesses the former —
 * so an array written to `jsonb` would fail, and an object written to `text[]`
 * would fail differently. Asking the catalogue removes the guess:
 *
 *   - `json` / `jsonb`  → serialise to text, cast explicitly
 *   - array types       → pass the array through, cast to the element array type
 *   - everything else   → bind as-is
 *
 * The column being unknown (a view, a table added outside migrations) falls
 * back to the type-free path rather than failing, so an unusual write still
 * behaves the way it did before this layer existed.
 */
async function bindColumnValue(
  params: Params,
  table: string,
  column: string,
  value: unknown
): Promise<string> {
  if (value === undefined || value === null) return params.add(null)

  const type = await columnType(table, column)

  if (type && (type.name === 'json' || type.name === 'jsonb')) {
    const serialised =
      typeof value === 'string' ? value : JSON.stringify(value instanceof Date ? value.toISOString() : value)
    return params.add(serialised, type.name)
  }

  if (type?.isArray) {
    const array = Array.isArray(value) ? value : [value]
    return params.add(array, `${type.name}[]`)
  }

  return params.add(normalise(value))
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

type Operator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'like'
  | 'ilike'
  | 'is'
  | 'in'
  | 'contains'
  | 'containedBy'
  | 'overlaps'

type FilterNode =
  | { kind: 'op'; column: string; operator: Operator; value: unknown; negate: boolean }
  | { kind: 'group'; combinator: 'and' | 'or'; children: FilterNode[] }

const SQL_COMPARISON: Partial<Record<Operator, string>> = {
  eq: '=',
  neq: '<>',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
  like: 'like',
  ilike: 'ilike',
}

/**
 * Parses a PostgREST filter string such as
 * `name.ilike.%ana%,email.is.null` or
 * `and(business_id.eq.X,partner_id.eq.Y),and(business_id.eq.Y,partner_id.eq.X)`.
 *
 * Only reached from `.or()` / `.not()`. Values inside the string are extracted
 * and bound as parameters like any other, so a value containing SQL is inert —
 * but a value containing a comma or a parenthesis still changes the *shape* of
 * the filter, which is why the call sites that interpolate user input strip
 * those characters first.
 */
function parseFilterString(source: string, combinator: 'and' | 'or'): FilterNode {
  const children = splitFilterList(source).map(parseFilterTerm)
  if (children.length === 1) return children[0]!
  return { kind: 'group', combinator, children }
}

function splitFilterList(source: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const char of source) {
    if (char === '(') depth += 1
    else if (char === ')') depth -= 1
    if (char === ',' && depth === 0) {
      parts.push(current)
      current = ''
      continue
    }
    current += char
  }
  parts.push(current)
  if (depth !== 0) throw new Error(`Unbalanced parentheses in filter: ${source}`)
  return parts.map((part) => part.trim()).filter(Boolean)
}

function parseFilterTerm(term: string): FilterNode {
  const nested = /^(and|or|not\.and|not\.or)\((.*)\)$/is.exec(term)
  if (nested) {
    const keyword = nested[1]!.toLowerCase()
    const combinator = keyword.endsWith('or') ? 'or' : 'and'
    const group = parseFilterString(nested[2]!, combinator)
    if (keyword.startsWith('not.')) {
      // `not.and(...)` — represented as a negated group by wrapping it.
      return { kind: 'group', combinator: 'and', children: [negate(group)] }
    }
    return group
  }

  const firstDot = term.indexOf('.')
  if (firstDot === -1) throw new Error(`Malformed filter term: ${term}`)
  const column = term.slice(0, firstDot)
  let rest = term.slice(firstDot + 1)

  let negated = false
  if (rest.toLowerCase().startsWith('not.')) {
    negated = true
    rest = rest.slice(4)
  }

  const secondDot = rest.indexOf('.')
  if (secondDot === -1) throw new Error(`Malformed filter term: ${term}`)
  const operator = rest.slice(0, secondDot).toLowerCase()
  const rawValue = rest.slice(secondDot + 1)

  if (!isOperator(operator)) throw new Error(`Unsupported filter operator "${operator}" in: ${term}`)

  return {
    kind: 'op',
    column,
    operator,
    value: decodeFilterValue(operator, rawValue),
    negate: negated,
  }
}

function isOperator(value: string): value is Operator {
  return (
    value === 'eq' ||
    value === 'neq' ||
    value === 'gt' ||
    value === 'gte' ||
    value === 'lt' ||
    value === 'lte' ||
    value === 'like' ||
    value === 'ilike' ||
    value === 'is' ||
    value === 'in'
  )
}

function decodeFilterValue(operator: string, raw: string): unknown {
  if (operator === 'is') {
    const lowered = raw.toLowerCase()
    if (lowered === 'null') return null
    if (lowered === 'true') return true
    if (lowered === 'false') return false
    return raw
  }
  if (operator === 'in') {
    const inner = raw.replace(/^\(/, '').replace(/\)$/, '')
    return inner
      .split(',')
      .map((item) => item.trim().replace(/^"(.*)"$/, '$1'))
      .filter((item) => item.length > 0)
  }
  return raw
}

function negate(node: FilterNode): FilterNode {
  if (node.kind === 'op') return { ...node, negate: !node.negate }
  return {
    kind: 'group',
    combinator: node.combinator === 'and' ? 'or' : 'and',
    children: node.children.map(negate),
  }
}

// ---------------------------------------------------------------------------
// Compilation context
// ---------------------------------------------------------------------------

type EmbedPlan = {
  alias: string
  inner: boolean
  sql: string
  jsonColumn: string
}

type OrderTerm = {
  column: string
  ascending: boolean
  nullsFirst: boolean | null
}

type Mutation =
  | { kind: 'select' }
  | { kind: 'insert'; rows: Record<string, unknown>[] }
  | { kind: 'update'; patch: Record<string, unknown> }
  | {
      kind: 'upsert'
      rows: Record<string, unknown>[]
      onConflict: string[]
      ignoreDuplicates: boolean
    }
  | { kind: 'delete' }

type Cardinality = 'many' | 'one' | 'maybe'

const BASE_ALIAS = '__base'

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * `Row` is the shape of a single row; `Data` is what awaiting the builder
 * resolves to.
 *
 * They are separate because the cardinality is chosen *after* the projection:
 * `select('…')` yields `Row[]`, and `.single()` / `.maybeSingle()` narrow the
 * same builder to `Row | null`. Keeping both parameters is what preserves
 * contextual typing at the call sites — without it, `(data ?? []).map((row) => …)`
 * loses the parameter type and every one of those callbacks becomes an implicit
 * `any`.
 */
/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- see the note on `Result` above: `any` matches what the replaced transport delivered to ~460 call sites; narrowing it belongs in a schema-typegen change, not here. */
export class QueryBuilder<Row = any, Data = Row[] | null>
  implements PromiseLike<Result<Data>>
{
  private mutation: Mutation = { kind: 'select' }
  private selectSource: string | null = null
  private readonly filters: FilterNode[] = []
  private readonly orders: OrderTerm[] = []
  private limitValue: number | null = null
  private offsetValue: number | null = null
  private cardinality: Cardinality = 'many'
  private wantCount = false
  private headOnly = false

  constructor(private readonly table: string) {
    quoteIdent(table)
  }

  // -- projection -----------------------------------------------------------

  select(
    columns = '*',
    options?: { count?: 'exact' | 'planned' | 'estimated'; head?: boolean }
  ): this {
    this.selectSource = columns
    if (options?.count) this.wantCount = true
    if (options?.head) this.headOnly = true
    return this
  }

  // -- mutations ------------------------------------------------------------

  insert(values: Record<string, unknown> | Record<string, unknown>[]): this {
    this.mutation = { kind: 'insert', rows: Array.isArray(values) ? values : [values] }
    return this
  }

  update(patch: Record<string, unknown>, options?: { count?: 'exact' }): this {
    this.mutation = { kind: 'update', patch }
    if (options?.count) this.wantCount = true
    return this
  }

  upsert(
    values: Record<string, unknown> | Record<string, unknown>[],
    options?: { onConflict?: string; ignoreDuplicates?: boolean; count?: 'exact' }
  ): this {
    this.mutation = {
      kind: 'upsert',
      rows: Array.isArray(values) ? values : [values],
      onConflict: (options?.onConflict ?? '')
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean),
      ignoreDuplicates: options?.ignoreDuplicates ?? false,
    }
    if (options?.count) this.wantCount = true
    return this
  }

  delete(options?: { count?: 'exact' }): this {
    this.mutation = { kind: 'delete' }
    if (options?.count) this.wantCount = true
    return this
  }

  // -- filters --------------------------------------------------------------

  private push(column: string, operator: Operator, value: unknown, negate = false): this {
    this.filters.push({ kind: 'op', column, operator, value, negate })
    return this
  }

  eq(column: string, value: unknown): this {
    return this.push(column, 'eq', value)
  }
  neq(column: string, value: unknown): this {
    return this.push(column, 'neq', value)
  }
  gt(column: string, value: unknown): this {
    return this.push(column, 'gt', value)
  }
  gte(column: string, value: unknown): this {
    return this.push(column, 'gte', value)
  }
  lt(column: string, value: unknown): this {
    return this.push(column, 'lt', value)
  }
  lte(column: string, value: unknown): this {
    return this.push(column, 'lte', value)
  }
  like(column: string, pattern: string): this {
    return this.push(column, 'like', pattern)
  }
  ilike(column: string, pattern: string): this {
    return this.push(column, 'ilike', pattern)
  }
  is(column: string, value: null | boolean): this {
    return this.push(column, 'is', value)
  }
  in(column: string, values: readonly unknown[]): this {
    return this.push(column, 'in', [...values])
  }
  contains(column: string, value: unknown): this {
    return this.push(column, 'contains', value)
  }
  containedBy(column: string, value: unknown): this {
    return this.push(column, 'containedBy', value)
  }
  overlaps(column: string, value: unknown): this {
    return this.push(column, 'overlaps', value)
  }

  /** `not('comment', 'is', null)` — the negation of any supported operator. */
  not(column: string, operator: string, value: unknown): this {
    if (!isOperator(operator)) throw new Error(`Unsupported operator in not(): ${operator}`)
    return this.push(column, operator, value, true)
  }

  /** `or('a.eq.1,b.is.null')` — PostgREST filter-string syntax. */
  or(filterString: string): this {
    this.filters.push(parseFilterString(filterString, 'or'))
    return this
  }

  /** `and('a.eq.1,b.eq.2')`, for symmetry with `or`. */
  and(filterString: string): this {
    this.filters.push(parseFilterString(filterString, 'and'))
    return this
  }

  /** `match({ business_id: id, status: 'active' })` — equality on every key. */
  match(criteria: Record<string, unknown>): this {
    for (const [column, value] of Object.entries(criteria)) this.eq(column, value)
    return this
  }

  // -- ordering and slicing -------------------------------------------------

  order(
    column: string,
    options?: { ascending?: boolean; nullsFirst?: boolean }
  ): this {
    this.orders.push({
      column,
      ascending: options?.ascending ?? true,
      nullsFirst: options?.nullsFirst ?? null,
    })
    return this
  }

  limit(count: number): this {
    this.limitValue = count
    return this
  }

  /** Inclusive on both ends, matching the REST semantics the callers assume. */
  range(from: number, to: number): this {
    this.offsetValue = from
    this.limitValue = Math.max(0, to - from + 1)
    return this
  }

  /**
   * Exactly one row, or an error.
   *
   * The optional type argument is the narrowest place to state a row's shape —
   * `maybeSingle<CustomerRow>()` types the one result the caller is about to
   * destructure without asking `from()` to describe the whole table.
   */
  single<T = Row>(): QueryBuilder<T, T | null> {
    this.cardinality = 'one'
    return this as unknown as QueryBuilder<T, T | null>
  }

  /** At most one row: none is `null`, more than one is an error. */
  maybeSingle<T = Row>(): QueryBuilder<T, T | null> {
    this.cardinality = 'maybe'
    return this as unknown as QueryBuilder<T, T | null>
  }

  // -- execution ------------------------------------------------------------

  then<R1 = Result<Data>, R2 = never>(
    onfulfilled?: ((value: Result<Data>) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null
  ): PromiseLike<R1 | R2> {
    return this.execute().then(onfulfilled, onrejected)
  }

  catch<R = never>(onrejected?: ((reason: unknown) => R | PromiseLike<R>) | null) {
    return this.execute().catch(onrejected)
  }

  finally(onfinally?: (() => void) | null) {
    return this.execute().finally(onfinally)
  }

  private async execute(): Promise<Result<Data>> {
    try {
      return await this.run()
    } catch (error) {
      const dbError = toDatabaseError(error)
      return {
        data: null as Data,
        error: dbError,
        count: null,
        status: statusForError(dbError),
      }
    }
  }

  private async run(): Promise<Result<Data>> {
    const params = new Params()
    const compiled = await this.compile(params)

    const result = await runQuery(compiled.sql, params.values)

    if (this.headOnly) {
      const total = compiled.countFromRows
        ? Number(result.rows[0]?.__count ?? 0)
        : result.rowCount ?? 0
      return { data: null as Data, error: null, count: total, status: 200 }
    }

    let rows = result.rows as Record<string, unknown>[]

    // `count: 'exact'` on a select rides along as a window function so the page
    // and its total come from one scan; on a write it is the affected row count.
    let count: number | null = null
    if (this.wantCount) {
      if (this.mutation.kind === 'select') {
        count = rows.length > 0 ? Number(rows[0]!.__count ?? 0) : 0
      } else {
        count = result.rowCount ?? 0
      }
    }

    if (compiled.stripCountColumn) {
      // The window-function total rides along on every row; strip it before the
      // caller sees a column that is not in their select list.
      rows = rows.map((row) => {
        const copy = { ...row }
        delete copy.__count
        return copy
      })
    }

    // A write with no `.select()` returns no rows, exactly as before.
    if (!compiled.returnsRows) {
      return { data: null as Data, error: null, count, status: 200 }
    }

    if (this.cardinality === 'one' || this.cardinality === 'maybe') {
      if (rows.length > 1) {
        return {
          data: null as Data,
          error: {
            message: `Expected a single row but found ${rows.length}`,
            code: 'PGRST116',
            details: null,
            hint: 'Add a filter that identifies exactly one row.',
          },
          count,
          status: 406,
        }
      }
      if (rows.length === 0) {
        if (this.cardinality === 'maybe') {
          return { data: null as Data, error: null, count, status: 200 }
        }
        return {
          data: null as Data,
          error: {
            message: 'Expected a single row but found none',
            code: 'PGRST116',
            details: null,
            hint: null,
          },
          count,
          status: 406,
        }
      }
      return { data: rows[0] as Data, error: null, count, status: 200 }
    }

    return { data: rows as Data, error: null, count, status: 200 }
  }

  // -- SQL compilation ------------------------------------------------------

  private async compile(params: Params): Promise<{
    sql: string
    returnsRows: boolean
    stripCountColumn: boolean
    countFromRows: boolean
  }> {
    switch (this.mutation.kind) {
      case 'select':
        return this.compileSelect(params)
      case 'insert':
      case 'upsert':
        return this.compileInsert(params)
      case 'update':
        return this.compileUpdate(params)
      case 'delete':
        return this.compileDelete(params)
    }
  }

  private async compileSelect(params: Params): Promise<{
    sql: string
    returnsRows: boolean
    stripCountColumn: boolean
    countFromRows: boolean
  }> {
    const nodes = parseSelect(this.selectSource ?? '*')
    const embeds = await this.planEmbeds(nodes, params)
    const where = await this.compileWhere(params, embeds)

    const from = `${quoteIdent(this.table)} as ${quoteIdent(BASE_ALIAS)}`
    const joins = embeds.map((embed) => embed.sql).join('\n')

    if (this.headOnly) {
      const sql = [
        `select count(*)::bigint as __count`,
        `from ${from}`,
        joins,
        where,
      ]
        .filter(Boolean)
        .join('\n')
      return { sql, returnsRows: false, stripCountColumn: false, countFromRows: true }
    }

    const projection = this.compileProjection(nodes, embeds)
    if (this.wantCount) projection.push('count(*) over () as __count')

    const sql = [
      `select ${projection.join(', ')}`,
      `from ${from}`,
      joins,
      where,
      this.compileOrderBy(),
      this.compileLimitOffset(params),
    ]
      .filter(Boolean)
      .join('\n')

    return {
      sql,
      returnsRows: true,
      stripCountColumn: this.wantCount,
      countFromRows: false,
    }
  }

  private compileProjection(nodes: SelectNode[], embeds: EmbedPlan[]): string[] {
    const projection: string[] = []

    for (const node of nodes) {
      if (node.kind === 'column') {
        if (node.name === '*') {
          projection.push(`${quoteIdent(BASE_ALIAS)}.*`)
        } else {
          const reference = `${quoteIdent(BASE_ALIAS)}.${quoteIdent(node.name)}`
          projection.push(node.alias ? `${reference} as ${quoteIdent(node.alias)}` : reference)
        }
        continue
      }
      const plan = embeds.find((embed) => embed.alias === node.alias)!
      projection.push(
        `${quoteIdent(plan.alias)}.${quoteIdent(plan.jsonColumn)} as ${quoteIdent(node.alias)}`
      )
    }

    return projection
  }

  /**
   * Turns each embedded resource into a lateral join.
   *
   * Lateral rather than a correlated scalar subquery so that a filter or an
   * order on an embedded column — `.eq('tags.name', 'vip')` — can reference the
   * joined alias in the outer statement, which is the whole point of `!inner`.
   */
  private async planEmbeds(nodes: SelectNode[], params: Params): Promise<EmbedPlan[]> {
    const plans: EmbedPlan[] = []

    for (const node of nodes) {
      if (node.kind !== 'embed') continue
      plans.push(await this.planEmbed(this.table, BASE_ALIAS, node, params))
    }

    return plans
  }

  private async planEmbed(
    baseTable: string,
    baseAlias: string,
    node: SelectEmbed,
    params: Params
  ): Promise<EmbedPlan> {
    const relationship = await resolveRelationship(baseTable, node.table, node.localColumn)
    const inner = quoteIdent(`__e_${node.alias}`)
    const jsonColumn = '__json'

    if (relationship.kind === 'to-many' && node.inner) {
      throw new Error(
        `select('${node.table}!inner(…)') is a one-to-many embed; ` +
          'filter the related table in its own query instead.'
      )
    }

    const nestedPlans: EmbedPlan[] = []
    for (const child of node.children) {
      if (child.kind === 'embed') {
        nestedPlans.push(await this.planEmbed(node.table, `__e_${node.alias}`, child, params))
      }
    }

    const objectSql = this.compileEmbedObject(`__e_${node.alias}`, node.children, nestedPlans)
    const joinCondition =
      `${quoteIdent(`__e_${node.alias}`)}.${quoteIdent(relationship.targetColumn)} = ` +
      `${quoteIdent(baseAlias)}.${quoteIdent(relationship.localColumn)}`
    const nestedJoins = nestedPlans.map((plan) => plan.sql).join('\n')

    const body =
      relationship.kind === 'to-one'
        ? [
            `select ${quoteIdent(`__e_${node.alias}`)}.*, ${objectSql} as ${quoteIdent(jsonColumn)}`,
            `from ${quoteIdent(node.table)} as ${inner}`,
            nestedJoins,
            `where ${joinCondition}`,
            'limit 1',
          ]
        : [
            `select coalesce(json_agg(${objectSql}), '[]'::json) as ${quoteIdent(jsonColumn)}`,
            `from ${quoteIdent(node.table)} as ${inner}`,
            nestedJoins,
            `where ${joinCondition}`,
          ]

    const keyword = node.inner ? 'join lateral' : 'left join lateral'
    const sql = `${keyword} (\n${body.filter(Boolean).join('\n')}\n) as ${quoteIdent(node.alias)} on true`

    return { alias: node.alias, inner: node.inner, sql, jsonColumn }
  }

  private compileEmbedObject(
    alias: string,
    children: SelectNode[],
    nested: EmbedPlan[]
  ): string {
    const wildcard = children.some((child) => child.kind === 'column' && child.name === '*')

    if (wildcard && nested.length === 0) {
      return `to_jsonb(${quoteIdent(alias)})`
    }

    const pairs: string[] = []
    for (const child of children) {
      if (child.kind === 'column') {
        if (child.name === '*') continue
        const key = child.alias ?? child.name
        pairs.push(`'${key}', ${quoteIdent(alias)}.${quoteIdent(child.name)}`)
        continue
      }
      const plan = nested.find((item) => item.alias === child.alias)!
      pairs.push(`'${child.alias}', ${quoteIdent(plan.alias)}.${quoteIdent(plan.jsonColumn)}`)
    }

    const object = pairs.length > 0 ? `json_build_object(${pairs.join(', ')})` : `'{}'::json`

    // `*` alongside explicit nested embeds: merge the row with the nested keys.
    if (wildcard) {
      return `(to_jsonb(${quoteIdent(alias)}) || ${object}::jsonb)::json`
    }
    return object
  }

  private async compileInsert(params: Params): Promise<{
    sql: string
    returnsRows: boolean
    stripCountColumn: boolean
    countFromRows: boolean
  }> {
    const mutation = this.mutation as
      | Extract<Mutation, { kind: 'insert' }>
      | Extract<Mutation, { kind: 'upsert' }>

    if (mutation.rows.length === 0) {
      // Nothing to write. Emit a statement that returns no rows rather than
      // invalid SQL, so a caller looping over an empty batch is a no-op.
      return {
        sql: 'select null where false',
        returnsRows: this.selectSource !== null,
        stripCountColumn: false,
        countFromRows: false,
      }
    }

    // Union of keys across rows: a batch may legitimately omit optional columns
    // on some rows, and every row must supply the same column list to one
    // multi-row VALUES clause.
    const columns = [...new Set(mutation.rows.flatMap((row) => Object.keys(row)))]
    if (columns.length === 0) {
      throw new Error(`insert into ${this.table} received a row with no columns`)
    }

    const tuples: string[] = []
    for (const row of mutation.rows) {
      const cells: string[] = []
      for (const column of columns) {
        cells.push(
          column in row ? await bindColumnValue(params, this.table, column, row[column]) : 'default'
        )
      }
      tuples.push(`(${cells.join(', ')})`)
    }

    const parts = [
      `insert into ${quoteIdent(this.table)} (${columns.map(quoteIdent).join(', ')})`,
      `values ${tuples.join(', ')}`,
    ]

    if (mutation.kind === 'upsert') {
      const target = await this.compileConflictTarget(mutation.onConflict)

      if (mutation.ignoreDuplicates) {
        parts.push(`on conflict${target} do nothing`)
      } else {
        const conflictColumns = new Set(mutation.onConflict)
        const assignments = columns
          .filter((column) => !conflictColumns.has(column))
          .map((column) => `${quoteIdent(column)} = excluded.${quoteIdent(column)}`)

        if (assignments.length === 0) {
          /*
           * Every supplied column is part of the conflict target — for example
           * `upsert({ business_id }, { onConflict: 'business_id' })`, which the
           * settings code uses to mean "ensure a row exists". There is nothing
           * to change, but `do nothing` would return no row, and callers chain
           * `.select()` onto this to read what is now there. Re-assigning the
           * key to itself makes the row a result row without altering it.
           */
          const key = mutation.onConflict[0] ?? columns[0]!
          parts.push(
            `on conflict${target} do update set ${quoteIdent(key)} = excluded.${quoteIdent(key)}`
          )
        } else {
          parts.push(`on conflict${target} do update set ${assignments.join(', ')}`)
        }
      }
    }

    const returning = this.compileReturning()
    if (returning) parts.push(returning)

    return {
      sql: parts.join('\n'),
      returnsRows: Boolean(returning),
      stripCountColumn: false,
      countFromRows: false,
    }
  }

  /**
   * Builds the `ON CONFLICT (…)` target, including a partial index's predicate.
   *
   * This is the part that is easy to get wrong and fails loudly when you do.
   * Several of the schema's uniqueness rules are conditional — one row per
   * non-null `idempotency_key`, one team membership per business and user *where a
   * user exists* — and PostgreSQL will not match a bare `ON CONFLICT (columns)`
   * against a partial index. Restating the predicate is what makes
   * `upsert({…}, { onConflict: 'idempotency_key' })` resolve to
   * `idx_jobs_idempotency` instead of raising 42P10.
   *
   * A conflict target naming no known unique index is a hard error rather than a
   * silently degraded insert: `upsert` means "make sure this row exists once",
   * and without a uniqueness rule to hang that on it means nothing.
   */
  private async compileConflictTarget(columns: string[]): Promise<string> {
    // No explicit target: PostgreSQL infers from any unique constraint, which is
    // what the caller asked for by omitting one.
    if (columns.length === 0) return ''

    const index = await findUniqueIndex(this.table, columns)

    if (!index) {
      throw new Error(
        `upsert on "${this.table}" targets (${columns.join(', ')}), but no unique index ` +
          'covers those columns. Add one in a migration, or use insert().'
      )
    }

    const list = `(${index.columns.map(quoteIdent).join(', ')})`
    return index.predicate ? ` ${list} where ${index.predicate}` : ` ${list}`
  }

  private async compileUpdate(params: Params): Promise<{
    sql: string
    returnsRows: boolean
    stripCountColumn: boolean
    countFromRows: boolean
  }> {
    const mutation = this.mutation as Extract<Mutation, { kind: 'update' }>
    const entries = Object.entries(mutation.patch)
    if (entries.length === 0) throw new Error(`update on ${this.table} received an empty patch`)

    this.assertFiltered('update')

    const assignments: string[] = []
    for (const [column, value] of entries) {
      assignments.push(
        `${quoteIdent(column)} = ${await bindColumnValue(params, this.table, column, value)}`
      )
    }

    const where = await this.compileWhere(params, [])
    const returning = this.compileReturning()

    const sql = [
      `update ${quoteIdent(this.table)} as ${quoteIdent(BASE_ALIAS)}`,
      `set ${assignments.join(', ')}`,
      where,
      returning,
    ]
      .filter(Boolean)
      .join('\n')

    return {
      sql,
      returnsRows: Boolean(returning),
      stripCountColumn: false,
      countFromRows: false,
    }
  }

  private async compileDelete(params: Params): Promise<{
    sql: string
    returnsRows: boolean
    stripCountColumn: boolean
    countFromRows: boolean
  }> {
    this.assertFiltered('delete')

    const where = await this.compileWhere(params, [])
    const returning = this.compileReturning()

    const sql = [
      `delete from ${quoteIdent(this.table)} as ${quoteIdent(BASE_ALIAS)}`,
      where,
      returning,
    ]
      .filter(Boolean)
      .join('\n')

    return {
      sql,
      returnsRows: Boolean(returning),
      stripCountColumn: false,
      countFromRows: false,
    }
  }

  /**
   * Refuses an `update` or `delete` with no `where` clause.
   *
   * This product is multi-tenant: an unfiltered write is not a slow query, it is
   * every merchant's data at once. The cost of the guard is that a deliberate
   * whole-table operation has to say so (`.neq('id', ZERO_UUID)` or a migration);
   * the benefit is that no future refactor can drop the last filter silently.
   */
  private assertFiltered(operation: string): void {
    if (this.filters.length === 0) {
      throw new Error(
        `Refusing to ${operation} every row of "${this.table}": no filter was applied. ` +
          'Add a filter, or perform the bulk operation in a migration.'
      )
    }
  }

  private compileReturning(): string {
    if (this.selectSource === null) return ''
    const nodes = parseSelect(this.selectSource)
    if (nodes.some((node) => node.kind === 'embed')) {
      throw new Error(
        `Embedded selects are not supported in a write's returning clause (${this.table}). ` +
          'Write first, then read.'
      )
    }
    const columns = nodes.map((node) => {
      const column = node as Extract<SelectNode, { kind: 'column' }>
      if (column.name === '*') return '*'
      return column.alias
        ? `${quoteIdent(column.name)} as ${quoteIdent(column.alias)}`
        : quoteIdent(column.name)
    })
    return `returning ${columns.join(', ')}`
  }

  private async compileWhere(params: Params, embeds: EmbedPlan[]): Promise<string> {
    if (this.filters.length === 0) return ''
    const clauses: string[] = []
    for (const filter of this.filters) {
      clauses.push(await this.compileFilter(filter, params, embeds))
    }
    return `where ${clauses.join(' and ')}`
  }

  private async compileFilter(
    node: FilterNode,
    params: Params,
    embeds: EmbedPlan[]
  ): Promise<string> {
    if (node.kind === 'group') {
      const parts: string[] = []
      for (const child of node.children) {
        parts.push(await this.compileFilter(child, params, embeds))
      }
      return `(${parts.join(node.combinator === 'or' ? ' or ' : ' and ')})`
    }

    const target = this.resolveColumn(node.column, embeds)
    const predicate = await this.compileOperator(target, node, params)
    return node.negate ? `not (${predicate})` : predicate
  }

  /** Resolves `column` or `embed.column` to a qualified SQL reference. */
  private resolveColumn(
    reference: string,
    embeds: EmbedPlan[]
  ): { sql: string; table: string; column: string } {
    const dot = reference.indexOf('.')
    if (dot === -1) {
      return {
        sql: `${quoteIdent(BASE_ALIAS)}.${quoteIdent(reference)}`,
        table: this.table,
        column: reference,
      }
    }

    const alias = reference.slice(0, dot)
    const column = reference.slice(dot + 1)
    const embed = embeds.find((item) => item.alias === alias)
    if (!embed) {
      throw new Error(
        `Filter on "${reference}" refers to an embedded resource that is not in the select list. ` +
          `Add ${alias}!inner(…) to select().`
      )
    }
    return { sql: `${quoteIdent(alias)}.${quoteIdent(column)}`, table: alias, column }
  }

  private async compileOperator(
    target: { sql: string; table: string; column: string },
    node: Extract<FilterNode, { kind: 'op' }>,
    params: Params
  ): Promise<string> {
    const { operator, value } = node

    if (operator === 'is') {
      if (value === null) return `${target.sql} is null`
      return `${target.sql} is ${value ? 'true' : 'false'}`
    }

    if (operator === 'eq' && value === null) return `${target.sql} is null`
    if (operator === 'neq' && value === null) return `${target.sql} is not null`

    if (operator === 'in') {
      const values = (value as unknown[]) ?? []
      if (values.length === 0) return 'false'
      const type = await columnType(target.table, target.column)
      /*
       * `= any($1::uuid[])` rather than a generated `in ($1, $2, …$20000)`:
       * one parameter instead of twenty thousand (Postgres caps at 65535), and
       * the explicit cast is what keeps the index in play — bound as `text[]`
       * against a `uuid` column, Postgres would either error or seq-scan.
       */
      const cast = type && !type.isArray ? `${type.name}[]` : undefined
      return `${target.sql} = any(${params.add(values, cast)})`
    }

    if (operator === 'contains' || operator === 'containedBy' || operator === 'overlaps') {
      const type = await columnType(target.table, target.column)
      const symbol = operator === 'contains' ? '@>' : operator === 'containedBy' ? '<@' : '&&'
      if (type?.isArray) {
        return `${target.sql} ${symbol} ${params.add(value, `${type.name}[]`)}`
      }
      const jsonType = type?.name === 'json' ? 'jsonb' : (type?.name ?? 'jsonb')
      const left = type?.name === 'json' ? `${target.sql}::jsonb` : target.sql
      return `${left} ${symbol} ${params.add(value, jsonType)}`
    }

    const comparison = SQL_COMPARISON[operator]
    if (!comparison) throw new Error(`Unsupported operator: ${operator}`)

    const type = await columnType(target.table, target.column)

    /*
     * Pattern matching needs a text operand. `phone` is text and `email` is
     * `citext` (already case-insensitive, so `ilike` on it is redundant but
     * harmless), while customer search also runs `ilike` across columns that are
     * not textual on every schema. Casting the *column* rather than the pattern
     * keeps the semantics the caller intended.
     */
    if ((operator === 'like' || operator === 'ilike') && type && !isTextual(type.name)) {
      return `${target.sql}::text ${comparison} ${params.add(value)}`
    }

    return `${target.sql} ${comparison} ${params.add(value)}`
  }

  private compileOrderBy(): string {
    if (this.orders.length === 0) return ''
    const terms = this.orders.map((order) => {
      const dot = order.column.indexOf('.')
      const reference =
        dot === -1
          ? `${quoteIdent(BASE_ALIAS)}.${quoteIdent(order.column)}`
          : `${quoteIdent(order.column.slice(0, dot))}.${quoteIdent(order.column.slice(dot + 1))}`
      const direction = order.ascending ? 'asc' : 'desc'
      const nulls =
        order.nullsFirst === null ? '' : order.nullsFirst ? ' nulls first' : ' nulls last'
      return `${reference} ${direction}${nulls}`
    })
    return `order by ${terms.join(', ')}`
  }

  private compileLimitOffset(params: Params): string {
    const parts: string[] = []
    if (this.limitValue !== null) parts.push(`limit ${params.add(this.limitValue)}`)
    if (this.offsetValue !== null) parts.push(`offset ${params.add(this.offsetValue)}`)
    return parts.join(' ')
  }
}

function isTextual(type: string): boolean {
  return type === 'text' || type === 'citext' || type === 'varchar' || type === 'bpchar' || type === 'name'
}

// ---------------------------------------------------------------------------
// RPC
// ---------------------------------------------------------------------------

/**
 * Calls a database function.
 *
 * The product keeps its transactional logic — earning points, redeeming a
 * reward, claiming a job, rate limiting — in `plpgsql` functions, because those
 * are the operations that must be atomic under concurrency. That design is
 * unchanged by the move off the previous provider; only the transport is.
 *
 * Arguments are passed by name so a function gaining a parameter with a default
 * does not shift the meaning of every existing call.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- as above.
export async function rpc<T = any>(
  name: string,
  args: Record<string, unknown> = {}
): Promise<Result<T>> {
  try {
    const shape = await functionShape(name)
    const params = new Params()

    const entries = Object.entries(args)
    const argumentList = entries
      .map(([key, value]) => `${quoteIdent(key)} => ${params.add(jsonSafe(value))}`)
      .join(', ')

    const call = `${quoteIdent(name)}(${argumentList})`
    const sql = shape.returnsSet || shape.returnsComposite
      ? `select * from ${call}`
      : `select ${call} as value`

    const result = await runQuery(sql, params.values)

    if (shape.returnsVoid) {
      return { data: null as T, error: null, count: null, status: 200 }
    }

    if (shape.returnsSet) {
      if (shape.returnsComposite) {
        return { data: result.rows as T, error: null, count: null, status: 200 }
      }
      // `returns setof <scalar>` — hand back bare values, not one-key objects.
      const key = result.fields[0]?.name
      const values = key ? result.rows.map((row) => (row as Record<string, unknown>)[key]) : []
      return { data: values as T, error: null, count: null, status: 200 }
    }

    if (shape.returnsComposite) {
      return { data: (result.rows[0] ?? null) as T, error: null, count: null, status: 200 }
    }

    const value = (result.rows[0] as Record<string, unknown> | undefined)?.value ?? null
    return { data: value as T, error: null, count: null, status: 200 }
  } catch (error) {
    const dbError = toDatabaseError(error)
    return { data: null as T, error: dbError, count: null, status: statusForError(dbError) }
  }
}

/**
 * `jsonb` parameters must arrive as text.
 *
 * `pg` cannot tell a JSON object destined for a `jsonb` argument from a
 * composite value, and passing by name means we do not know the declared
 * parameter types. Serialising objects and arrays covers every `p_event`,
 * `p_awards` and `p_params` argument in the product; scalars pass through so
 * uuids and integers keep their natural binding.
 */
function jsonSafe(value: unknown): unknown {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') return JSON.stringify(value)
  return value
}

export { UNIQUE_VIOLATION }
