import 'server-only'
import { createHmac, randomBytes, randomInt, timingSafeEqual, createHash } from 'node:crypto'
import { env } from '@/lib/env'

/** URL-safe base64 without padding. */
function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function fromB64url(input: string): Buffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(padded + '='.repeat((4 - (padded.length % 4)) % 4), 'base64')
}

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

export function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

/** Cryptographically strong random token, ~1.33 chars per byte. */
export function randomToken(bytes = 32): string {
  return b64url(randomBytes(bytes))
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no I/O/0/1 — read aloud safely

/** Human-friendly code (gift cards, referral codes, redemption PINs). */
export function randomCode(length = 8): string {
  let out = ''
  for (let i = 0; i < length; i += 1) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
  return out
}

export function randomNumericCode(length = 6): string {
  let out = ''
  for (let i = 0; i < length; i += 1) out += String(randomInt(10))
  return out
}

export type SignedPayload = Record<string, unknown>

/**
 * Compact signed token: `<purpose>.<payload>.<signature>`.
 *
 * Purpose-scoped so an unsubscribe token can never be replayed as a survey
 * token. Used for unsubscribe links, survey links, wallet auth and customer
 * self-service — anywhere we need a stateless capability URL.
 */
export function signToken(
  purpose: string,
  payload: SignedPayload,
  ttlSeconds: number
): string {
  const body = b64url(
    JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds })
  )
  const signature = b64url(
    createHmac('sha256', env.security.tokenSecret).update(`${purpose}.${body}`).digest()
  )
  return `${purpose}.${body}.${signature}`
}

export function verifyToken<T extends SignedPayload>(
  purpose: string,
  token: string
): (T & { exp: number }) | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [tokenPurpose, body, signature] = parts as [string, string, string]
  if (tokenPurpose !== purpose) return null

  const expected = b64url(
    createHmac('sha256', env.security.tokenSecret).update(`${purpose}.${body}`).digest()
  )
  if (!constantTimeEqual(signature, expected)) return null

  try {
    const parsed = JSON.parse(fromB64url(body).toString('utf8')) as T & { exp?: number }
    if (typeof parsed.exp !== 'number' || parsed.exp < Math.floor(Date.now() / 1000)) return null
    return parsed as T & { exp: number }
  } catch {
    return null
  }
}

/** HMAC signature for outbound webhooks (`sha256=<hex>`). */
export function webhookSignature(secret: string, timestamp: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`
}

export function verifyWebhookSignature(
  secret: string,
  timestamp: string,
  body: string,
  received: string,
  toleranceSeconds = 300
): boolean {
  const age = Math.abs(Date.now() / 1000 - Number(timestamp))
  if (!Number.isFinite(age) || age > toleranceSeconds) return false
  return constantTimeEqual(received, webhookSignature(secret, timestamp, body))
}
