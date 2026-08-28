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

export { QueryBuilder }
export type { DatabaseError, Result }
export { transaction, ping, closePool, getPool, query } from '@/lib/db/pool'
export { UNIQUE_VIOLATION } from '@/lib/db/query'
export { resetIntrospectionCache } from '@/lib/db/introspect'
