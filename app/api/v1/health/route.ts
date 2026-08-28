import { ping, query } from '@/lib/db'
import { env, capabilityReport } from '@/lib/env'
import { constantTimeEqual } from '@/lib/crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Health check.
 *
 *   GET /api/v1/health           liveness + database readiness
 *   GET /api/v1/health?detail=1  adds schema and capability state (needs CRON_SECRET)
 *
 * Railway polls this to decide whether a new deployment may take traffic, so what
 * it reports has to be *readiness*, not just "the process started". A container
 * that is running but cannot reach PostgreSQL must fail the check — otherwise a
 * bad deploy is promoted and every merchant sees errors instead of the previous
 * version continuing to serve.
 *
 * Deliberately outside `defineRoute`: no rate limiting (a health checker calls it
 * every few seconds by design), no session resolution, no request-id logging
 * noise. It also must not depend on anything that could itself be the thing that
 * is broken.
 *
 * The unauthenticated payload is minimal on purpose. Which integrations a
 * deployment has configured is not a secret worth much, but it is also not
 * something to hand to anyone who asks, so it sits behind the same shared secret
 * the scheduled jobs use.
 */
export async function GET(request: Request): Promise<Response> {
  const startedAt = Date.now()
  const database = await ping()

  const body: Record<string, unknown> = {
    status: database.ok ? 'ok' : 'degraded',
    service: 'passimo',
    /*
     * The commit, when the platform provides one. Railway sets
     * RAILWAY_GIT_COMMIT_SHA; this is how you answer "is the fix actually
     * deployed?" without guessing from behaviour.
     */
    version: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? process.env.APP_VERSION ?? 'dev',
    environment: env.isProduction ? 'production' : 'development',
    database: database.ok
      ? { reachable: true, latency_ms: database.latencyMs }
      : { reachable: false },
    checked_in_ms: Date.now() - startedAt,
  }

  if (wantsDetail(request)) {
    body.detail = await detail()
  }

  return Response.json(body, {
    /*
     * 503 when the database is unreachable. This is the value the whole endpoint
     * exists to return: it is what makes Railway hold a broken release back
     * rather than route traffic to it.
     */
    status: database.ok ? 200 : 503,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      // A health check is machine-readable state, never something a crawler or
      // an intermediary should hold on to.
      'X-Robots-Tag': 'noindex',
    },
  })
}

/** `HEAD` for the cheapest possible uptime probe. */
export async function HEAD(): Promise<Response> {
  const database = await ping()
  return new Response(null, {
    status: database.ok ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  })
}

function wantsDetail(request: Request): boolean {
  const url = new URL(request.url)
  if (url.searchParams.get('detail') !== '1') return false

  const expected = env.security.cronSecret
  if (!expected) return false

  const provided =
    request.headers.get('x-cron-secret') ??
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    ''

  return Boolean(provided) && constantTimeEqual(provided, expected)
}

async function detail(): Promise<Record<string, unknown>> {
  const [migrations, jobs] = await Promise.all([migrationState(), jobBacklog()])
  return {
    migrations,
    jobs,
    /*
     * Booleans only, never values. This is the same report Settings shows a
     * merchant, and it is the fastest way to answer "why are no emails going
     * out" on a deployment you cannot open a shell into.
     */
    capabilities: capabilityReport(),
    storage_driver: env.storage.driver,
    node: process.version,
    uptime_s: Math.round(process.uptime()),
  }
}

async function migrationState(): Promise<Record<string, unknown>> {
  try {
    const result = await query<{ count: number; latest: string | null; applied_at: string | null }>(
      `select count(*)::int          as count,
              max(name)              as latest,
              max(applied_at)::text  as applied_at
         from schema_migrations`
    )
    const row = result.rows[0]
    return { applied: row?.count ?? 0, latest: row?.latest ?? null, at: row?.applied_at ?? null }
  } catch (error) {
    // The ledger not existing *is* the answer: migrations have never run here.
    return { applied: null, error: (error as Error).message.slice(0, 120) }
  }
}

/**
 * Queue depth.
 *
 * Included because a silently stalled worker is the failure mode this
 * architecture is most exposed to: the app keeps answering requests perfectly
 * while campaigns, wallet syncs and analytics recomputes pile up unnoticed.
 */
async function jobBacklog(): Promise<Record<string, unknown>> {
  try {
    const result = await query<{ status: string; count: number }>(
      `select status, count(*)::int as count
         from jobs
        where status in ('pending', 'running', 'failed')
        group by status`
    )
    const counts: Record<string, number> = { pending: 0, running: 0, failed: 0 }
    for (const row of result.rows) counts[row.status] = row.count
    return counts
  } catch {
    return { unavailable: true }
  }
}
