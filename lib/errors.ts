/**
 * Typed application errors.
 *
 * Every error carries a stable machine-readable `code` so clients (and our own
 * UI) can branch on behaviour without string-matching prose, plus a `status`
 * used by the API layer. `expose` marks messages that are safe to return to an
 * untrusted caller; everything else is replaced with a generic message and only
 * the full detail is logged server-side.
 */

export type ErrorCode =
  | 'bad_request'
  | 'validation_failed'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'gone'
  | 'unprocessable'
  | 'payment_required'
  | 'rate_limited'
  | 'payload_too_large'
  | 'not_configured'
  | 'upstream_failed'
  | 'internal_error'

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  bad_request: 400,
  validation_failed: 422,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  gone: 410,
  unprocessable: 422,
  /* "Your plan cannot do this", as distinct from 403's "your role cannot". */
  payment_required: 402,
  rate_limited: 429,
  payload_too_large: 413,
  not_configured: 503,
  upstream_failed: 502,
  internal_error: 500,
}

export class AppError extends Error {
  readonly code: ErrorCode
  readonly status: number
  readonly details?: unknown
  readonly expose: boolean
  readonly headers?: Record<string, string>

  constructor(
    code: ErrorCode,
    message: string,
    options: { details?: unknown; expose?: boolean; headers?: Record<string, string>; cause?: unknown } = {}
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = 'AppError'
    this.code = code
    this.status = STATUS_BY_CODE[code]
    this.details = options.details
    this.expose = options.expose ?? code !== 'internal_error'
    this.headers = options.headers
  }
}

export const badRequest = (message = 'Invalid request', details?: unknown) =>
  new AppError('bad_request', message, { details })

export const validationFailed = (details: unknown, message = 'Validation failed') =>
  new AppError('validation_failed', message, { details })

export const unauthorized = (message = 'Authentication required') =>
  new AppError('unauthorized', message)

export const forbidden = (message = 'You do not have access to this resource') =>
  new AppError('forbidden', message)

export const notFound = (resource = 'Resource') =>
  new AppError('not_found', `${resource} not found`)

export const conflict = (message: string, details?: unknown) =>
  new AppError('conflict', message, { details })

export const unprocessable = (message: string, details?: unknown) =>
  new AppError('unprocessable', message, { details })

/** The caller is authenticated and authorised, but their plan does not allow this. */
export const paymentRequired = (message: string, details?: unknown) =>
  new AppError('payment_required', message, { details })

export const rateLimited = (retryAfterSeconds: number, message = 'Too many requests') =>
  new AppError('rate_limited', message, {
    headers: { 'Retry-After': String(Math.max(1, Math.ceil(retryAfterSeconds))) },
    details: { retry_after_seconds: Math.max(1, Math.ceil(retryAfterSeconds)) },
  })

export const payloadTooLarge = (message = 'Payload too large') =>
  new AppError('payload_too_large', message)

export const notConfigured = (capability: string) =>
  new AppError(
    'not_configured',
    `${capability} is not configured on this deployment`,
    { details: { capability } }
  )

export const upstreamFailed = (service: string, cause?: unknown) =>
  new AppError('upstream_failed', `${service} request failed`, { cause, details: { service } })

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError
}

/** Normalises anything thrown into an AppError without losing the cause. */
export function toAppError(value: unknown): AppError {
  if (isAppError(value)) return value
  if (value instanceof Error) {
    /*
     * A missing environment variable is a deployment problem an operator can
     * fix, not a bug in the request. Reporting it as 500 buries it in the
     * noise of genuine internal errors and tells the caller nothing; 503 with
     * the variable named is actionable, and the message is safe to expose
     * because it contains a variable name, never its value.
     */
    if (value.name === 'MissingEnvError') {
      return new AppError('not_configured', value.message, { cause: value, expose: true })
    }
    return new AppError('internal_error', value.message, { cause: value, expose: false })
  }
  return new AppError('internal_error', 'Unexpected error', { cause: value, expose: false })
}
