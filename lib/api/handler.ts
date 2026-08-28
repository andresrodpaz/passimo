import 'server-only'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { errorResponse, json } from '@/lib/http'
import {
  AppError,
  badRequest,
  notConfigured,
  payloadTooLarge,
  rateLimited,
  toAppError,
  unauthorized,
  validationFailed,
} from '@/lib/errors'
import { logger } from '@/lib/logger'
import {
  RATE_LIMITS,
  checkRateLimit,
  clientIp,
  rateLimitHeaders,
  type RateLimitName,
} from '@/lib/rate-limit'
import {
  requireBusinessAccess,
  requirePermission,
  resolveActor,
  type Actor,
  type BusinessContext,
} from '@/lib/auth/context'
import type { Permission } from '@/lib/auth/rbac'
import { env } from '@/lib/env'
import { constantTimeEqual } from '@/lib/crypto'
import { requireFeature } from '@/lib/billing/entitlements'
import type { Feature } from '@/lib/billing/plans'

const MAX_BODY_BYTES = 1_000_000 // 1 MB; the logo endpoint opts into more.

export type RouteContext<Params> = {
  params: Promise<Params>
}

type AuthMode = 'required' | 'optional' | 'none' | 'cron'

export type HandlerArgs<TBody, TQuery, TParams> = {
  request: Request
  body: TBody
  query: TQuery
  params: TParams
  requestId: string
  /** Present whenever auth mode is `required`. */
  actor: Actor
  /** Present whenever `businessIdFrom` resolved a business. */
  business: BusinessContext
  log: ReturnType<typeof logger.child>
}

export type DefineRouteOptions<
  TBodySchema extends z.ZodTypeAny | undefined,
  TQuerySchema extends z.ZodTypeAny | undefined,
  TParamsSchema extends z.ZodTypeAny | undefined,
> = {
  /** Short stable name used in logs and rate-limit buckets. */
  name: string
  auth?: AuthMode
  body?: TBodySchema
  query?: TQuerySchema
  params?: TParamsSchema
  rateLimit?: RateLimitName | false
  /**
   * Where to find the business this call acts on. When set, the handler
   * resolves the actor's role and enforces `permissions` before running.
   */
  businessIdFrom?:
    | { source: 'body'; key: string }
    | { source: 'query'; key: string }
    | { source: 'params'; key: string }
  permissions?: Permission[]
  /**
   * Plan capability the caller's business must have. Checked after
   * `permissions`, so a viewer on Pro is told about their role and an owner on
   * Free is told about their plan — never the wrong one.
   *
   * Requires `businessIdFrom`; a feature has no meaning without a business.
   */
  feature?: Feature
  /** Refuse the request unless the named capability is configured. */
  requires?: () => boolean
  requiresLabel?: string
  maxBodyBytes?: number
  /** Marks the route as returning a non-JSON body (handler returns Response). */
  raw?: boolean
}

type Infer<T> = T extends z.ZodTypeAny ? z.infer<T> : undefined

/**
 * Wraps a route handler with the cross-cutting concerns every endpoint needs.
 *
 * Order matters and is deliberate:
 *   1. request id + logger        (so every later failure is traceable)
 *   2. rate limit                 (cheapest rejection first)
 *   3. auth                       (before any parsing that touches the DB)
 *   4. schema validation          (body / query / params)
 *   5. business + permission      (needs parsed input to know the target)
 *   6. plan entitlement           (403 before 402: role first, then plan)
 *   7. handler
 *
 * The handler may return a `Response` (raw) or any JSON-serialisable value.
 */
export function defineRoute<
  TBodySchema extends z.ZodTypeAny | undefined = undefined,
  TQuerySchema extends z.ZodTypeAny | undefined = undefined,
  TParamsSchema extends z.ZodTypeAny | undefined = undefined,
>(
  options: DefineRouteOptions<TBodySchema, TQuerySchema, TParamsSchema>,
  handler: (
    args: HandlerArgs<Infer<TBodySchema>, Infer<TQuerySchema>, Infer<TParamsSchema>>
  ) => Promise<Response | unknown>
) {
  return async function route(
    request: Request,
    context?: RouteContext<Record<string, string>>
  ): Promise<Response> {
    const requestId = request.headers.get('x-request-id') ?? randomUUID()
    const startedAt = Date.now()
    const log = logger.child({ route: options.name, request_id: requestId })
    let extraHeaders: Record<string, string> = {}

    try {
      if (options.requires && !options.requires()) {
        throw notConfigured(options.requiresLabel ?? options.name)
      }

      const authMode: AuthMode = options.auth ?? 'required'

      if (authMode === 'cron') {
        assertCronRequest(request)
      }

      // 2. Rate limit ------------------------------------------------------
      if (options.rateLimit !== false && authMode !== 'cron') {
        const ruleName: RateLimitName =
          options.rateLimit ?? (authMode === 'none' ? 'publicRelaxed' : 'dashboard')
        const identity =
          request.headers.get('authorization')?.slice(-24) ?? clientIp(request)
        const result = await checkRateLimit(`${options.name}`, identity, RATE_LIMITS[ruleName])
        extraHeaders = rateLimitHeaders(result)
        if (!result.allowed) throw rateLimited(result.retryAfterSeconds)
      }

      // 3. Auth ------------------------------------------------------------
      let actor: Actor = {
        kind: 'system',
        id: null,
        email: null,
        scopedBusinessId: null,
        apiKeyId: null,
      }
      if (authMode === 'required') {
        actor = await resolveActor(request)
      } else if (authMode === 'optional') {
        actor = await resolveActor(request).catch(() => actor)
      }

      // 4. Validation -------------------------------------------------------
      const params = options.params
        ? parseWith(options.params, await (context?.params ?? Promise.resolve({})), 'params')
        : ((await (context?.params ?? Promise.resolve({}))) as Infer<TParamsSchema>)

      const query = options.query
        ? parseWith(
            options.query,
            Object.fromEntries(new URL(request.url).searchParams),
            'query'
          )
        : (undefined as Infer<TQuerySchema>)

      const body = options.body
        ? parseWith(
            options.body,
            await readJsonBody(request, options.maxBodyBytes ?? MAX_BODY_BYTES),
            'body'
          )
        : (undefined as Infer<TBodySchema>)

      // 5. Business scope + permissions -------------------------------------
      let business = {} as BusinessContext
      if (options.businessIdFrom) {
        const { source, key } = options.businessIdFrom
        const bag =
          source === 'body'
            ? (body as Record<string, unknown> | undefined)
            : source === 'query'
              ? (query as Record<string, unknown> | undefined)
              : (params as Record<string, unknown> | undefined)
        const businessId = bag?.[key]
        if (typeof businessId !== 'string' || businessId.length === 0) {
          throw badRequest(`Missing ${key} in request ${source}`)
        }
        business = await requireBusinessAccess(actor, businessId)
        for (const permission of options.permissions ?? []) {
          requirePermission(business, permission)
        }
        if (options.feature) {
          await requireFeature(business.businessId, options.feature)
        }
      }

      // 6. Handler -----------------------------------------------------------
      const result = await handler({
        request,
        body: body as Infer<TBodySchema>,
        query: query as Infer<TQuerySchema>,
        params: params as Infer<TParamsSchema>,
        requestId,
        actor,
        business,
        log,
      })

      const response =
        result instanceof Response
          ? withHeaders(result, { ...extraHeaders, 'X-Request-Id': requestId })
          : json(result ?? { ok: true }, { headers: extraHeaders, requestId })

      log.info('request.completed', {
        status: response.status,
        duration_ms: Date.now() - startedAt,
        actor: actor.kind,
      })
      return response
    } catch (caught) {
      const err = toAppError(caught)
      const level = err.status >= 500 ? 'error' : 'warn'
      log[level]('request.failed', {
        code: err.code,
        status: err.status,
        duration_ms: Date.now() - startedAt,
        message: err.message,
        ...(err.status >= 500 ? { cause: err.cause ?? err } : {}),
      })
      return withHeaders(errorResponse(err, requestId), extraHeaders)
    }
  }
}

function withHeaders(response: Response, headers: Record<string, string>): Response {
  if (Object.keys(headers).length === 0) return response
  const merged = new Headers(response.headers)
  for (const [key, value] of Object.entries(headers)) merged.set(key, value)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: merged,
  })
}

function parseWith<T extends z.ZodTypeAny>(schema: T, value: unknown, where: string): z.infer<T> {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw validationFailed(
      result.error.issues.map((issue) => ({
        path: [where, ...issue.path.map(String)].join('.'),
        message: issue.message,
        code: issue.code,
      })),
      `Invalid request ${where}`
    )
  }
  return result.data
}

async function readJsonBody(request: Request, maxBytes: number): Promise<unknown> {
  const declared = request.headers.get('content-length')
  if (declared && Number(declared) > maxBytes) throw payloadTooLarge()

  const text = await request.text()
  if (Buffer.byteLength(text, 'utf8') > maxBytes) throw payloadTooLarge()
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    throw badRequest('Request body must be valid JSON')
  }
}

/** Shared secret guard for scheduled jobs. */
export function assertCronRequest(request: Request): void {
  const expected = env.security.cronSecret
  if (!expected) throw notConfigured('Scheduled jobs (CRON_SECRET)')
  const provided =
    request.headers.get('x-cron-secret') ??
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    ''
  if (!provided || !constantTimeEqual(provided, expected)) {
    throw unauthorized('Invalid cron secret')
  }
}

export { AppError }
