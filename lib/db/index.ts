import 'server-only'
import { QueryBuilder, rpc, type DatabaseError, type Result } from '@/lib/db/query'

/**
 * The application's database entry point.
 *
 * Every server-side read and write in Passimo goes through here. It talks to a
 * plain PostgreSQL server over `DATABASE_URL` — a local container in
 * development, Railway PostgreSQL in production — with no vendor SDK in the
 * path. Swapping hosting providers is a change to one environment variable.
 *
 * Authorisation is *not* enforced at this layer. It is enforced above it: every
 * route resolves an actor and a business context through `lib/auth/context.ts`
 * before it reaches the database, and every tenant-scoped query filters on
 * `business_id`. That is the same contract the product had before this layer
 * existed, and it is deliberately explicit — a query with no tenant filter is
 * visible in the code rather than hidden behind a policy that may or may not be
 * attached to the table.
 */

/* eslint-disable @typescript-eslint/no-explicit-any --
 * The row type defaults to `any` to match the shape the previous transport
 * delivered at every existing call site; see the note on `Result` in
 * lib/db/query.ts. Both generics are exposed so new code opts into real types.
 */
export type Database = {
  from: <Row = any>(table: string) => QueryBuilder<Row>
  rpc: <T = any>(name: string, args?: Record<string, unknown>) => Promise<Result<T>>
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export const db: Database = {
  from: (table) => new QueryBuilder(table),
  rpc,
}

/**
 * Returns the database handle.
 *
 * A function rather than a bare export so that no module-scope work happens at
 * import time: a build must not need `DATABASE_URL`, and a missing one must
 * surface on the request that needs the database rather than at boot.
 */
export function getDb(): Database {
  return db
}

/**
 * Reads a list of ids out of an RPC result, whatever shape PostgreSQL chose.
 *
 * This exists because of a bug that produced no error and no failing test, and
 * quietly broke three revenue features at once.
 *
 * `passimo_segment_customer_ids` is declared `returns table (id uuid)`. A
 * `returns table` with **one** column is not a composite type in the catalogue —
 * PostgreSQL flattens it to `returns setof uuid` (`prorettype = uuid`,
 * `typtype = 'b'`). `rpc()` is right to hand those back as bare values rather
 * than one-key objects, and it does. But three call sites read the result as
 * `rows.map((row) => row.id)`, which on an array of strings yields an array of
 * `undefined` — and `.in('id', [undefined, …])` matches nothing.
 *
 * What that looked like in the product:
 *
 *   * **Customers → filter by segment** returned an empty list while the
 *     segments screen, which counts through a different function, said 468.
 *   * **A segment-targeted campaign** reported a reach of 468 and then sent to
 *     nobody, because the fan-out resolves recipients through the ids function.
 *   * **Birthday and anniversary automations** found no one, every day, for the
 *     same reason.
 *
 * None of those raise. The count and the audience come from two different
 * database functions, so the number a merchant sees stays right while the thing
 * it describes is empty — which is why this is a helper rather than three fixed
 * lines: the next single-column `returns table` will do it again.
 *
 * Accepts both shapes deliberately, so a caller cannot be wrong about which one
 * a given function produces.
 */
export function idsFrom(data: unknown): string[] {
  if (!Array.isArray(data)) return []

  const ids: string[] = []
  for (const row of data) {
    if (typeof row === 'string') {
      ids.push(row)
      continue
    }
    if (row && typeof row === 'object') {
      const value = (row as Record<string, unknown>).id
      if (typeof value === 'string') ids.push(value)
    }
  }
  return ids
}

export { QueryBuilder }
export type { DatabaseError, Result }
export { transaction, ping, closePool, getPool, query } from '@/lib/db/pool'
export { UNIQUE_VIOLATION } from '@/lib/db/query'
export { resetIntrospectionCache } from '@/lib/db/introspect'
