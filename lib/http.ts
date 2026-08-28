import { toAppError } from '@/lib/errors'

export type JsonInit = ResponseInit & { requestId?: string }

export function json(data: unknown, init?: JsonInit): Response {
  const headers = new Headers(init?.headers)
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json; charset=utf-8')
  if (init?.requestId) headers.set('X-Request-Id', init.requestId)
  return new Response(JSON.stringify(data), { ...init, headers })
}

export function noContent(requestId?: string): Response {
  const headers = new Headers()
  if (requestId) headers.set('X-Request-Id', requestId)
  return new Response(null, { status: 204, headers })
}

/**
 * Renders any thrown value as a stable JSON error envelope.
 * Non-exposable messages are collapsed so internals never leak to clients.
 */
export function errorResponse(value: unknown, requestId?: string): Response {
  const err = toAppError(value)
  const headers = new Headers(err.headers)
  return json(
    {
      error: {
        code: err.code,
        message: err.expose ? err.message : 'Something went wrong on our side',
        ...(err.expose && err.details !== undefined ? { details: err.details } : {}),
        ...(requestId ? { request_id: requestId } : {}),
      },
    },
    { status: err.status, headers, requestId }
  )
}

/**
 * Plain error envelope for the few routes that bypass the API handler
 * (wallet binary endpoints, redirects).
 */
export function error(message: string, status = 400, code = 'bad_request'): Response {
  return json({ error: { code, message } }, { status })
}
