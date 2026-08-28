/**
 * The session cookie's wire format.
 *
 * Deliberately in its own module with no Node built-ins and no `server-only`
 * marker, because two very different runtimes need it: edge middleware (which
 * has Web Crypto and no database) and the Node server (which has both).
 *
 * Format: `v1.<base64url payload>.<base64url hmac>`
 *
 * The payload carries the session's opaque secret, the user id and an expiry.
 * The HMAC proves *we* issued the cookie, which is what lets middleware make a
 * redirect decision without touching the database — a forged or tampered cookie
 * fails the signature check in microseconds.
 *
 * The signature alone is **not** authorisation. It says "this cookie is one of
 * ours and has not expired"; it cannot say "this session has not been revoked"
 * or "this account still exists". Every server-side authorisation decision
 * therefore re-checks the session against `user_sessions` (see
 * `lib/auth/session.ts`). Middleware's job is only to keep signed-out visitors
 * off the dashboard, and to stop signed-in ones landing back on the login form.
 */

export const SESSION_COOKIE = 'passimo_session'

const VERSION = 'v1'

export type SessionTokenPayload = {
  /** Opaque per-session secret; its SHA-256 is the stored lookup key. */
  s: string
  /** User id, so middleware and logs have it without a query. */
  u: string
  /** Absolute expiry, seconds since the epoch. */
  e: number
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

const encoder = new TextEncoder()

const keyCache = new Map<string, Promise<CryptoKey>>()

function hmacKey(secret: string): Promise<CryptoKey> {
  const cached = keyCache.get(secret)
  if (cached) return cached
  const key = crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  )
  keyCache.set(secret, key)
  return key
}

async function sign(secret: string, body: string): Promise<string> {
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(body))
  return toBase64Url(new Uint8Array(signature))
}

export async function encodeSessionToken(
  secret: string,
  payload: SessionTokenPayload
): Promise<string> {
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)))
  const signature = await sign(secret, `${VERSION}.${body}`)
  return `${VERSION}.${body}.${signature}`
}

/**
 * Verifies the signature and expiry, returning the payload or `null`.
 *
 * `crypto.subtle.verify` is constant-time, which matters here: a timing oracle
 * on the signature comparison would let an attacker forge a cookie one byte at
 * a time.
 */
export async function decodeSessionToken(
  secret: string,
  token: string | undefined | null
): Promise<SessionTokenPayload | null> {
  if (!token) return null

  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [version, body, signature] = parts as [string, string, string]
  if (version !== VERSION) return null

  let valid: boolean
  try {
    valid = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(secret),
      fromBase64Url(signature),
      encoder.encode(`${version}.${body}`)
    )
  } catch {
    return null
  }
  if (!valid) return null

  try {
    const parsed = JSON.parse(new TextDecoder().decode(fromBase64Url(body))) as SessionTokenPayload
    if (typeof parsed.s !== 'string' || typeof parsed.u !== 'string' || typeof parsed.e !== 'number') {
      return null
    }
    if (parsed.e <= Math.floor(Date.now() / 1000)) return null
    return parsed
  } catch {
    return null
  }
}

/**
 * The signing secret, resolved the same way in both runtimes.
 *
 * `AUTH_SESSION_SECRET` is the documented name. `APP_TOKEN_SECRET` is accepted
 * as a fallback so an existing deployment that already has one strong secret
 * does not have to generate a second one to keep working — the two are used for
 * different purposes and never interchangeably within a single token, because
 * every token carries a purpose or version prefix in its signed body.
 */
export function sessionSecret(): string {
  const secret = process.env.AUTH_SESSION_SECRET?.trim() || process.env.APP_TOKEN_SECRET?.trim()
  if (!secret) {
    throw new Error(
      'Missing required environment variable AUTH_SESSION_SECRET (or APP_TOKEN_SECRET). ' +
        'Generate with: openssl rand -base64 48. See .env.example.'
    )
  }
  return secret
}
