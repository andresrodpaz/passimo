import 'server-only'
import { Pool, types, type PoolClient, type QueryResult, type QueryResultRow } from 'pg'
import { logger } from '@/lib/logger'

/**
 * The single PostgreSQL connection pool for the process.
 *
 * Passimo talks to a plain PostgreSQL server — local in development, Railway
 * PostgreSQL in production — through `DATABASE_URL`. There is no vendor client
 * in front of it, so everything the application knows about the database it
 * knows from this file and the migrations in `db/migrations`.
 */

/*
 * Keep `numeric` as a string→number conversion rather than pg's default of
 * returning it as a string.
 *
 * Money in this schema is stored in integer cents (`*_cents` columns), so the
 * remaining `numeric` columns are ratios, multipliers and scores — churn risk,
 * earn multipliers, RFM values. Every consumer of those treats them as numbers,
 * and the old vendor client delivered them as numbers, so leaving them as
 * strings would silently turn arithmetic into string concatenation on paths that
 * no test would flag.
 *
 * Precision: these are all values well inside a double's exact range. The
 * integer-cents columns are `bigint`, handled separately below.
 */
types.setTypeParser(types.builtins.NUMERIC, (value) => Number.parseFloat(value))

/*
 * `int8`/`bigint` likewise. Counts and cent amounts exceed neither
 * Number.MAX_SAFE_INTEGER nor any merchant's lifetime revenue; a bigint that
 * genuinely overflows a double would be a bug elsewhere, and returning a string
 * here would break every `+` in the analytics layer instead of surfacing it.
 */
types.setTypeParser(types.builtins.INT8, (value) => {
  const parsed = Number.parseInt(value, 10)
  return Number.isSafeInteger(parsed) ? parsed : value
})

/*
 * `timestamptz` and `timestamp` as ISO strings rather than JS Date objects.
 *
 * Every consumer in the application either passes these straight to JSON or
 * calls `new Date(value)` on them, and the whole codebase is typed as
 * `string | null` for date columns because that is what the previous transport
 * delivered. Returning Date objects here would typecheck fine and then
 * serialise differently in one direction (API responses) and compare
 * differently in another (`a > b` on Dates is fine, on mixed Date/string is
 * not). One representation, chosen deliberately.
 */
const isoParser = (value: string) => new Date(value).toISOString()
types.setTypeParser(types.builtins.TIMESTAMPTZ, isoParser)
types.setTypeParser(types.builtins.TIMESTAMP, isoParser)

/** `date` columns (birthdays, period boundaries) stay as plain `YYYY-MM-DD`. */
types.setTypeParser(types.builtins.DATE, (value) => value)

let pool: Pool | null = null
let shutdownHooked = false

function connectionString(): string {
  const url = process.env.DATABASE_URL?.trim()
  if (!url) {
    throw new Error(
      'Missing required environment variable DATABASE_URL. ' +
        'Development: postgresql://passimo:passimo@localhost:5432/passimo ' +
        '(`docker compose up -d postgres` provides it). ' +
        'Production: the value Railway injects when a PostgreSQL service is attached. ' +
        'See .env.example.'
    )
  }
  return url
}

/**
 * TLS policy.
 *
 * Managed providers (Railway, Neon, RDS) terminate TLS with certificates that
 * are not in Node's trust store for the internal hostnames they hand out, so
 * `rejectUnauthorized: true` fails against a perfectly healthy database. Local
 * development has no TLS at all. Both are handled by the URL's own parameters
 * plus this default, and `DATABASE_SSL` exists for the deployment that has a
 * proper CA and wants verification.
 */
function sslConfig(url: string): { rejectUnauthorized: boolean } | false {
  const explicit = process.env.DATABASE_SSL?.trim().toLowerCase()
  if (explicit === 'disable' || explicit === 'false') return false
  if (explicit === 'verify' || explicit === 'strict') return { rejectUnauthorized: true }
  if (explicit === 'require' || explicit === 'true') return { rejectUnauthorized: false }

  if (/[?&]sslmode=disable/.test(url)) return false
  if (/[?&]sslmode=/.test(url)) return { rejectUnauthorized: false }

  const isLocal = /@(localhost|127\.0\.0\.1|\[::1\]|host\.docker\.internal|postgres)[:/]/.test(url)
  return isLocal ? false : { rejectUnauthorized: false }
}

function int(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function getPool(): Pool {
  if (pool) return pool

  const url = connectionString()

  pool = new Pool({
    connectionString: url,
    ssl: sslConfig(url),
    /*
     * Serverless and container runtimes both punish a large pool: Next.js may
     * hold several instances of this process, and each one multiplies the
     * connection count against a database whose `max_connections` is usually
     * 100. Ten per instance leaves room for the migration runner and a psql
     * session during an incident.
     */
    max: int('DATABASE_POOL_MAX', 10),
    idleTimeoutMillis: int('DATABASE_POOL_IDLE_MS', 30_000),
    /*
     * Fail fast rather than hanging a request for the platform's default TCP
     * timeout when the database is unreachable — an actionable 503 beats a
     * request that the load balancer eventually kills.
     */
    connectionTimeoutMillis: int('DATABASE_CONNECT_TIMEOUT_MS', 10_000),
    /*
     * Kills a query that has stopped making progress. Set above the slowest
     * legitimate statement in the product (the analytics recompute) so that a
     * timeout genuinely means "stuck", not "big".
     */
    statement_timeout: int('DATABASE_STATEMENT_TIMEOUT_MS', 30_000),
    application_name: 'passimo',
  })

  /*
   * A pool-level error is an idle client dying — a database restart, a failover,
   * a network blip. `pg` emits it on the pool rather than on any request, and an
   * unhandled 'error' event on an EventEmitter terminates the process. Logging
   * it keeps a routine failover from taking the app down; the pool replaces the
   * client on the next checkout.
   */
  pool.on('error', (error) => {
    logger.error('db.pool_error', { error: error.message })
  })

  if (!shutdownHooked) {
    shutdownHooked = true
    for (const signal of ['SIGTERM', 'SIGINT'] as const) {
      process.once(signal, () => {
        void closePool()
      })
    }
  }

  return pool
}

/** Closes the pool. Called on SIGTERM so Railway's rolling deploys drain cleanly. */
export async function closePool(): Promise<void> {
  const current = pool
  if (!current) return
  pool = null
  try {
    await current.end()
  } catch (error) {
    logger.warn('db.pool_close_failed', { error: (error as Error).message })
  }
}

const SLOW_QUERY_MS = int('DATABASE_SLOW_QUERY_MS', 500)

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = []
): Promise<QueryResult<T>> {
  const startedAt = Date.now()
  try {
    return await getPool().query<T>(text, values)
  } finally {
    const elapsed = Date.now() - startedAt
    if (elapsed >= SLOW_QUERY_MS) {
      // The statement, never the parameters: values carry customer PII.
      logger.warn('db.slow_query', { ms: elapsed, sql: text.replace(/\s+/g, ' ').slice(0, 400) })
    }
  }
}

/**
 * Runs `fn` inside a transaction, committing on return and rolling back on
 * throw.
 *
 * Most of the product's multi-statement work already lives in `plpgsql`
 * functions (which are atomic by definition), so this is for the handful of
 * application-level sequences — signup provisioning, customer import batches —
 * where a partial result would leave a tenant in a state they cannot retry out
 * of.
 */
export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect()
  try {
    await client.query('begin')
    const result = await fn(client)
    await client.query('commit')
    return result
  } catch (error) {
    try {
      await client.query('rollback')
    } catch (rollbackError) {
      logger.error('db.rollback_failed', { error: (rollbackError as Error).message })
    }
    throw error
  } finally {
    client.release()
  }
}

/** Liveness probe for the health endpoint. Cheap, and touches a real connection. */
export async function ping(): Promise<{ ok: true; latencyMs: number } | { ok: false; error: string }> {
  const startedAt = Date.now()
  try {
    await query('select 1 as ok')
    return { ok: true, latencyMs: Date.now() - startedAt }
  } catch (error) {
    return { ok: false, error: (error as Error).message }
  }
}
