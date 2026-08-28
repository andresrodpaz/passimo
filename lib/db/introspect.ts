import 'server-only'
import { query } from '@/lib/db/pool'

/**
 * Foreign-key introspection, used to resolve embedded selects.
 *
 * The query layer accepts the same `select('a, b, related:fk_col (x, y)')`
 * shape the application already uses in ~460 call sites. Turning the embed into
 * SQL needs to know which columns join the two tables, and the database already
 * knows: every one of those relationships is a declared foreign key.
 *
 * Reading it from the catalogue rather than hard-coding a table map means an
 * embed added in future works without touching this file, and a typo in a
 * column name fails loudly at the call site instead of silently returning null.
 *
 * Loaded once per process and cached. The set of foreign keys changes only when
 * a migration runs, which restarts the process on every deployment target we
 * support.
 */

export type ForeignKey = {
  /** Table holding the referencing column. */
  table: string
  column: string
  /** Table being referenced. */
  foreignTable: string
  foreignColumn: string
}

export type PrimaryKey = { table: string; columns: string[] }

export type ColumnType = {
  /** Type name as PostgreSQL reports it: `uuid`, `text`, `jsonb`, `timestamptz`… */
  name: string
  /** True for `text[]`, `uuid[]` and friends. */
  isArray: boolean
}

export type UniqueIndex = {
  table: string
  name: string
  columns: string[]
  /** `WHERE` predicate for a partial index, or null. */
  predicate: string | null
}

type Catalogue = {
  foreignKeys: ForeignKey[]
  primaryKeys: Map<string, string[]>
  columns: Map<string, Map<string, ColumnType>>
  uniqueIndexes: UniqueIndex[]
}

let cache: Promise<Catalogue> | null = null

const FOREIGN_KEY_SQL = `
  select
    src_tbl.relname   as table_name,
    src_col.attname   as column_name,
    tgt_tbl.relname   as foreign_table_name,
    tgt_col.attname   as foreign_column_name
  from pg_constraint c
  join pg_class     src_tbl on src_tbl.oid = c.conrelid
  join pg_namespace src_ns  on src_ns.oid = src_tbl.relnamespace
  join pg_class     tgt_tbl on tgt_tbl.oid = c.confrelid
  join pg_namespace tgt_ns  on tgt_ns.oid = tgt_tbl.relnamespace
  join unnest(c.conkey)  with ordinality as k(attnum, ord) on true
  join unnest(c.confkey) with ordinality as f(attnum, ord) on f.ord = k.ord
  join pg_attribute src_col on src_col.attrelid = c.conrelid and src_col.attnum = k.attnum
  join pg_attribute tgt_col on tgt_col.attrelid = c.confrelid and tgt_col.attnum = f.attnum
  where c.contype = 'f'
    and src_ns.nspname = 'public'
    and tgt_ns.nspname = 'public'
`

const PRIMARY_KEY_SQL = `
  select
    tbl.relname   as table_name,
    col.attname   as column_name,
    k.ord         as ordinal
  from pg_constraint c
  join pg_class     tbl on tbl.oid = c.conrelid
  join pg_namespace ns  on ns.oid = tbl.relnamespace
  join unnest(c.conkey) with ordinality as k(attnum, ord) on true
  join pg_attribute col on col.attrelid = c.conrelid and col.attnum = k.attnum
  where c.contype = 'p'
    and ns.nspname = 'public'
  order by tbl.relname, k.ord
`

/*
 * Column types drive two things the query layer cannot guess: the cast on an
 * `in (…)` array parameter (`= any($1::uuid[])` keeps the index; `::text[]`
 * silently discards it), and whether `contains` means the jsonb `@>` or the
 * array one.
 */
const COLUMN_SQL = `
  select
    tbl.relname                        as table_name,
    col.attname                        as column_name,
    coalesce(elem.typname, base.typname) as type_name,
    (base.typcategory = 'A')           as is_array
  from pg_attribute col
  join pg_class     tbl  on tbl.oid = col.attrelid
  join pg_namespace ns   on ns.oid = tbl.relnamespace
  join pg_type      base on base.oid = col.atttypid
  left join pg_type elem on elem.oid = base.typelem and base.typcategory = 'A'
  where ns.nspname = 'public'
    and tbl.relkind in ('r', 'v', 'm', 'p')
    and col.attnum > 0
    and not col.attisdropped
`

/*
 * Unique indexes, including their `WHERE` predicate.
 *
 * The predicate is the point. Several of this schema's uniqueness rules are
 * conditional — one default location *per business*, one row per non-null
 * `idempotency_key`, one membership per business and user where the user exists
 * (rows with a null user id are pending invitations, and a business may have
 * many). PostgreSQL expresses those as partial unique indexes, and an
 * `ON CONFLICT (cols)` that omits the matching predicate does not resolve to
 * them: it fails with 42P10, "no unique or exclusion constraint matching the ON
 * CONFLICT specification". Reading the predicate here is what lets `upsert`
 * target them correctly.
 */
const UNIQUE_INDEX_SQL = `
  select
    t.relname                                      as table_name,
    i.relname                                      as index_name,
    -- Cast to text: the catalogue's own "name" type has no array parser
    -- registered in the driver, so name[] arrives as an unparsed literal string.
    array(
      select a.attname::text
        from unnest(x.indkey) with ordinality as k(attnum, ord)
        join pg_attribute a on a.attrelid = x.indrelid and a.attnum = k.attnum
       order by k.ord
    )                                              as columns,
    pg_get_expr(x.indpred, x.indrelid)             as predicate
  from pg_index x
  join pg_class     i on i.oid = x.indexrelid
  join pg_class     t on t.oid = x.indrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public'
    and x.indisunique
    and x.indislive
`

async function load(): Promise<Catalogue> {
  const [fks, pks, cols, uniques] = await Promise.all([
    query<{
      table_name: string
      column_name: string
      foreign_table_name: string
      foreign_column_name: string
    }>(FOREIGN_KEY_SQL),
    query<{ table_name: string; column_name: string }>(PRIMARY_KEY_SQL),
    query<{ table_name: string; column_name: string; type_name: string; is_array: boolean }>(
      COLUMN_SQL
    ),
    query<{
      table_name: string
      index_name: string
      columns: string[]
      predicate: string | null
    }>(UNIQUE_INDEX_SQL),
  ])

  const primaryKeys = new Map<string, string[]>()
  for (const row of pks.rows) {
    const existing = primaryKeys.get(row.table_name)
    if (existing) existing.push(row.column_name)
    else primaryKeys.set(row.table_name, [row.column_name])
  }

  const columns = new Map<string, Map<string, ColumnType>>()
  for (const row of cols.rows) {
    let table = columns.get(row.table_name)
    if (!table) {
      table = new Map()
      columns.set(row.table_name, table)
    }
    table.set(row.column_name, { name: row.type_name, isArray: row.is_array })
  }

  return {
    foreignKeys: fks.rows.map((row) => ({
      table: row.table_name,
      column: row.column_name,
      foreignTable: row.foreign_table_name,
      foreignColumn: row.foreign_column_name,
    })),
    primaryKeys,
    columns,
    uniqueIndexes: uniques.rows.map((row) => ({
      table: row.table_name,
      name: row.index_name,
      columns: row.columns.filter(Boolean),
      predicate: row.predicate,
    })),
  }
}

function catalogue(): Promise<Catalogue> {
  if (!cache) {
    cache = load().catch((error) => {
      // Do not cache a failure: the first request during startup may race the
      // database becoming reachable, and a cached rejection would poison the
      // process for its whole lifetime.
      cache = null
      throw error
    })
  }
  return cache
}

/** Drops the cached catalogue. Used by the migration runner and by tests. */
export function resetIntrospectionCache(): void {
  cache = null
  functionCache.clear()
}

/** The declared type of a column, or `null` when the table is unknown to us. */
export async function columnType(table: string, column: string): Promise<ColumnType | null> {
  return (await catalogue()).columns.get(table)?.get(column) ?? null
}

/** Column names of a table, used to filter `insert` payloads and detect typos. */
export async function tableColumns(table: string): Promise<Set<string> | null> {
  const columns = (await catalogue()).columns.get(table)
  return columns ? new Set(columns.keys()) : null
}

/**
 * How a database function returns its result.
 *
 * The product's SQL functions come in four shapes — `returns jsonb`,
 * `returns table (…)`, `returns setof <table>` and plain scalars — and each one
 * has to be unwrapped differently to hand callers the value they expect. The
 * catalogue is the only place that knows which is which.
 */
export type FunctionShape = {
  /** `returns setof` / `returns table` — the caller gets an array. */
  returnsSet: boolean
  /** A row type: the caller gets objects rather than bare values. */
  returnsComposite: boolean
  /** `returns void` — the caller gets `null`. */
  returnsVoid: boolean
}

const functionCache = new Map<string, Promise<FunctionShape>>()

export function functionShape(name: string): Promise<FunctionShape> {
  const cached = functionCache.get(name)
  if (cached) return cached

  const promise = query<{
    proretset: boolean
    is_composite: boolean
    is_void: boolean
  }>(
    `select p.proretset,
            (t.typtype = 'c' or p.prorettype = 'record'::regtype) as is_composite,
            (p.prorettype = 'void'::regtype)                      as is_void
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       join pg_type      t on t.oid = p.prorettype
      where n.nspname = 'public' and p.proname = $1
      limit 1`,
    [name]
  )
    .then((result) => {
      const row = result.rows[0]
      if (!row) {
        throw new Error(
          `Database function ${name}() does not exist. Run \`pnpm db:migrate\` — ` +
            'the schema is behind the application.'
        )
      }
      return {
        returnsSet: row.proretset,
        returnsComposite: row.is_composite,
        returnsVoid: row.is_void,
      }
    })
    .catch((error) => {
      functionCache.delete(name)
      throw error
    })

  functionCache.set(name, promise)
  return promise
}

export type Relationship =
  | { kind: 'to-one'; localColumn: string; targetTable: string; targetColumn: string }
  | { kind: 'to-many'; localColumn: string; targetTable: string; targetColumn: string }

/**
 * Resolves how `baseTable` reaches `targetTable`.
 *
 * `localColumn` disambiguates when more than one foreign key connects the two
 * (for example `businesses` and `partner_business_id`), which is exactly what
 * the `alias:column (…)` form in a select string is for.
 */
export async function resolveRelationship(
  baseTable: string,
  targetTable: string,
  localColumn: string | null
): Promise<Relationship> {
  const { foreignKeys } = await catalogue()

  // Forward: base holds the referencing column. Produces a single object.
  const forward = foreignKeys.filter(
    (fk) =>
      fk.table === baseTable &&
      fk.foreignTable === targetTable &&
      (localColumn === null || fk.column === localColumn)
  )

  if (forward.length === 1) {
    const fk = forward[0]!
    return {
      kind: 'to-one',
      localColumn: fk.column,
      targetTable,
      targetColumn: fk.foreignColumn,
    }
  }

  if (forward.length > 1) {
    throw new Error(
      `Ambiguous embed: ${baseTable} has ${forward.length} foreign keys to ${targetTable} ` +
        `(${forward.map((fk) => fk.column).join(', ')}). ` +
        `Disambiguate with select('${targetTable}:<column> (…)').`
    )
  }

  // Reverse: target holds the referencing column. Produces an array.
  const reverse = foreignKeys.filter(
    (fk) =>
      fk.table === targetTable &&
      fk.foreignTable === baseTable &&
      (localColumn === null || fk.column === localColumn)
  )

  if (reverse.length === 1) {
    const fk = reverse[0]!
    return {
      kind: 'to-many',
      localColumn: fk.foreignColumn,
      targetTable,
      targetColumn: fk.column,
    }
  }

  if (reverse.length > 1) {
    throw new Error(
      `Ambiguous embed: ${targetTable} has ${reverse.length} foreign keys back to ${baseTable}. ` +
        `Disambiguate with select('${targetTable}:<column> (…)').`
    )
  }

  /*
   * A relationship declared only by the FK column's name and not by a
   * constraint. Falling back to "join the named column to the target's primary
   * key" keeps a legitimate embed working on a table that predates its
   * constraint, and the error below fires only when even that is impossible.
   */
  if (localColumn) {
    const targetPk = (await catalogue()).primaryKeys.get(targetTable)
    if (targetPk && targetPk.length === 1) {
      return {
        kind: 'to-one',
        localColumn,
        targetTable,
        targetColumn: targetPk[0]!,
      }
    }
  }

  throw new Error(
    `No foreign key relates ${baseTable} to ${targetTable}` +
      (localColumn ? ` through ${localColumn}` : '') +
      '. Embedded selects require a declared foreign key.'
  )
}

/** Columns of a table's primary key, used to make `upsert` conflict targets explicit. */
export async function primaryKeyColumns(table: string): Promise<string[]> {
  return (await catalogue()).primaryKeys.get(table) ?? []
}

/**
 * Finds the unique index an `upsert` conflict target refers to.
 *
 * Matched on the column *set*, not the order, because `onConflict:
 * 'business_id,user_id'` and an index on `(user_id, business_id)` describe the
 * same constraint and a caller should not have to know which order the migration
 * used.
 *
 * When more than one index covers the same columns and they differ only by
 * predicate, the non-partial one wins; otherwise the first partial one, ordered
 * by index name so the generated SQL for a given schema never varies between
 * processes.
 */
export async function findUniqueIndex(
  table: string,
  columns: string[]
): Promise<UniqueIndex | null> {
  if (columns.length === 0) return null
  const wanted = [...columns].sort().join(',')

  const candidates = (await catalogue()).uniqueIndexes
    .filter(
      (index) => index.table === table && [...index.columns].sort().join(',') === wanted
    )
    .sort((a, b) => {
      if ((a.predicate === null) !== (b.predicate === null)) return a.predicate === null ? -1 : 1
      return a.name.localeCompare(b.name)
    })

  return candidates[0] ?? null
}
