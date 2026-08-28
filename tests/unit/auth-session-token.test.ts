import { describe, expect, it, vi } from 'vitest'
import {
  SESSION_COOKIE,
  decodeSessionToken,
  encodeSessionToken,
  sessionSecret,
} from '@/lib/auth/session-token'

const SECRET = 'a-test-signing-secret-long-enough-to-be-realistic'

function payload(overrides: Partial<{ s: string; u: string; e: number }> = {}) {
  return {
    s: 'opaque-session-secret',
    u: '11111111-2222-3333-4444-555555555555',
    e: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  }
}

/**
 * The session cookie's wire format.
 *
 * This is the only thing standing between "a cookie we issued" and "a cookie
 * anyone can type", and it runs in edge middleware where there is no database to
 * fall back on. Every test here is a forgery attempt.
 */
describe('session token', () => {
  it('round-trips a payload', async () => {
    const token = await encodeSessionToken(SECRET, payload())
    const decoded = await decodeSessionToken(SECRET, token)
    expect(decoded).toEqual(payload())
  })

  it('rejects a token signed with a different secret', async () => {
    const token = await encodeSessionToken('some-other-secret-entirely', payload())
    expect(await decodeSessionToken(SECRET, token)).toBeNull()
  })

  it('rejects a tampered payload', async () => {
    const token = await encodeSessionToken(SECRET, payload())
    const [version, body, signature] = token.split('.')

    // Re-encode the payload with a different user id, keeping the signature.
    const forged = Buffer.from(
      JSON.stringify(payload({ u: '99999999-9999-9999-9999-999999999999' })),
      'utf8'
    )
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')

    expect(await decodeSessionToken(SECRET, `${version}.${forged}.${signature}`)).toBeNull()
    expect(await decodeSessionToken(SECRET, `${version}.${body}.${signature}`)).not.toBeNull()
  })

  it('rejects a tampered signature', async () => {
    const token = await encodeSessionToken(SECRET, payload())
    const parts = token.split('.')
    parts[2] = parts[2]!.slice(0, -2) + (parts[2]!.endsWith('AA') ? 'BB' : 'AA')
    expect(await decodeSessionToken(SECRET, parts.join('.'))).toBeNull()
  })

  it('rejects an expired token even though the signature is valid', async () => {
    const token = await encodeSessionToken(
      SECRET,
      payload({ e: Math.floor(Date.now() / 1000) - 1 })
    )
    expect(await decodeSessionToken(SECRET, token)).toBeNull()
  })

  it('rejects a token from an unknown format version', async () => {
    const token = await encodeSessionToken(SECRET, payload())
    expect(await decodeSessionToken(SECRET, token.replace(/^v1\./, 'v2.'))).toBeNull()
  })

  it('rejects malformed input without throwing', async () => {
    for (const bad of [
      undefined,
      null,
      '',
      'nonsense',
      'v1.only-two-parts',
      'v1.a.b.c',
      'v1.!!!not-base64!!!.signature',
    ]) {
      expect(await decodeSessionToken(SECRET, bad as string)).toBeNull()
    }
  })

  it('rejects a validly signed token whose payload is the wrong shape', async () => {
    // A correctly signed cookie is not automatically a *session* cookie: the
    // fields still have to be there and be the right types.
    const token = await encodeSessionToken(SECRET, { hello: 'world' } as never)
    expect(await decodeSessionToken(SECRET, token)).toBeNull()

    const missingExpiry = await encodeSessionToken(SECRET, {
      s: 'secret',
      u: 'user',
    } as never)
    expect(await decodeSessionToken(SECRET, missingExpiry)).toBeNull()
  })

  it('names the cookie something recognisable and brand-correct', () => {
    expect(SESSION_COOKIE).toBe('passimo_session')
  })
})

describe('sessionSecret', () => {
  it('prefers AUTH_SESSION_SECRET and falls back to APP_TOKEN_SECRET', () => {
    vi.stubEnv('AUTH_SESSION_SECRET', 'primary-secret')
    vi.stubEnv('APP_TOKEN_SECRET', 'fallback-secret')
    expect(sessionSecret()).toBe('primary-secret')

    vi.stubEnv('AUTH_SESSION_SECRET', '')
    expect(sessionSecret()).toBe('fallback-secret')

    vi.unstubAllEnvs()
  })

  it('throws an actionable error when neither is set', () => {
    vi.stubEnv('AUTH_SESSION_SECRET', '')
    vi.stubEnv('APP_TOKEN_SECRET', '')
    expect(() => sessionSecret()).toThrow(/AUTH_SESSION_SECRET/)
    expect(() => sessionSecret()).toThrow(/openssl rand/)
    vi.unstubAllEnvs()
  })
})
