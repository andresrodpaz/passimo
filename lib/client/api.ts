'use client'

import useSWR, { mutate as globalMutate, type SWRConfiguration } from 'swr'

/**
 * Client data layer.
 *
 * One fetcher, one error shape, one cache. Components never construct URLs or
 * unwrap error envelopes themselves, which is how "loading and error states
 * everywhere" stays achievable rather than aspirational.
 */

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details?: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }

  /** True when retrying the same request could plausibly succeed. */
  get isRetryable(): boolean {
    return this.status >= 500 || this.status === 429
  }
}

type ErrorEnvelope = {
  error?: { code?: string; message?: string; details?: unknown }
}

async function parse(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return { error: { code: 'invalid_response', message: text.slice(0, 200) } }
  }
}

export async function apiFetch<T = unknown>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const response = await fetch(path.startsWith('/') ? path : `/api/v1/${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
    credentials: 'same-origin',
  })

  const payload = await parse(response)

  if (!response.ok) {
    const envelope = payload as ErrorEnvelope
    throw new ApiError(
      response.status,
      envelope?.error?.code ?? 'unknown',
      envelope?.error?.message ?? `Request failed (${response.status})`,
      envelope?.error?.details
    )
  }

  return payload as T
}

export const apiGet = <T>(path: string) => apiFetch<T>(path)

export const apiPost = <T>(path: string, body: unknown) =>
  apiFetch<T>(path, { method: 'POST', body: JSON.stringify(body) })

export const apiPatch = <T>(path: string, body: unknown) =>
  apiFetch<T>(path, { method: 'PATCH', body: JSON.stringify(body) })

export const apiPut = <T>(path: string, body: unknown) =>
  apiFetch<T>(path, { method: 'PUT', body: JSON.stringify(body) })

/**
 * `DELETE` with an optional body.
 *
 * Several endpoints archive by id and are scoped by `businessId`, and both travel in
 * the body so the tenant scope goes through the same `businessIdFrom` path as every
 * other write. A bodyless DELETE would have to put the tenant in the query string —
 * a second convention for the same thing, and the one most likely to be forgotten.
 */
export const apiDelete = <T>(path: string, body?: unknown) =>
  apiFetch<T>(path, {
    method: 'DELETE',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

const DEFAULT_CONFIG: SWRConfiguration = {
  revalidateOnFocus: false,
  shouldRetryOnError: (error: unknown) =>
    error instanceof ApiError ? error.isRetryable : true,
  errorRetryCount: 2,
  // Collapses the request storms that happen when several widgets on a page
  // want the same resource.
  dedupingInterval: 3000,
}

/** `key` of null skips the request — the idiomatic way to wait on a dependency. */
export function useApi<T>(key: string | null, config?: SWRConfiguration) {
  const { data, error, isLoading, isValidating, mutate } = useSWR<T, ApiError>(
    key,
    (url: string) => apiGet<T>(url),
    { ...DEFAULT_CONFIG, ...config }
  )
  return { data, error, isLoading, isValidating, mutate }
}

/** Revalidate every cached key that starts with a prefix. */
export function revalidate(prefix: string) {
  return globalMutate(
    (key) => typeof key === 'string' && key.startsWith(prefix),
    undefined,
    { revalidate: true }
  )
}

/** Builds a query string, dropping empty values so URLs stay stable cache keys. */
export function query(params: Record<string, string | number | boolean | undefined | null>) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    search.set(key, String(value))
  }
  const text = search.toString()
  return text ? `?${text}` : ''
}
