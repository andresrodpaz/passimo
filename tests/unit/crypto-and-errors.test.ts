import { describe, expect, it, vi } from 'vitest'
import {
  constantTimeEqual,
  randomCode,
  randomNumericCode,
  randomToken,
  sha256,
  signToken,
  verifyToken,
  verifyWebhookSignature,
  webhookSignature,
} from '@/lib/crypto'
import { AppError, isAppError, notFound, rateLimited, toAppError } from '@/lib/errors'

describe('randomCode', () => {
  it('produces a code of the requested length', () => {
    expect(randomCode(8)).toHaveLength(8)
  })

  it('avoids visually ambiguous characters', () => {
    // Codes get read aloud across a counter; I/O/0/1 cause mistakes.
    const sample = Array.from({ length: 200 }, () => randomCode(12)).join('')
    expect(sample).not.toMatch(/[IO01]/)
  })

  it('does not repeat', () => {
    const codes = new Set(Array.from({ length: 500 }, () => randomCode(10)))
    expect(codes.size).toBe(500)
  })

  it('produces digits only for numeric codes', () => {
    expect(randomNumericCode(6)).toMatch(/^\d{6}$/)
  })

  it('produces url-safe tokens', () => {
    expect(randomToken(24)).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})

describe('signToken / verifyToken', () => {
  it('round-trips a payload', () => {
    const token = signToken('card', { c: 'customer-1' }, 3600)
    expect(verifyToken<{ c: string }>('card', token)?.c).toBe('customer-1')
  })

  it('rejects a token signed for a different purpose', () => {
    // An unsubscribe link must never be replayable as a card link.
    const token = signToken('unsubscribe', { c: 'customer-1' }, 3600)
    expect(verifyToken('card', token)).toBeNull()
  })

  it('rejects a tampered payload', () => {
    const token = signToken('card', { c: 'customer-1' }, 3600)
    const [purpose, , signature] = token.split('.')
    const forged = Buffer.from(JSON.stringify({ c: 'customer-2', exp: 9999999999 }))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    expect(verifyToken('card', `${purpose}.${forged}.${signature}`)).toBeNull()
  })

  it('rejects an expired token', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const token = signToken('card', { c: 'customer-1' }, 60)
    vi.setSystemTime(new Date('2026-01-01T00:02:00Z'))
    expect(verifyToken('card', token)).toBeNull()
    vi.useRealTimers()
  })

  it('rejects malformed input', () => {
    expect(verifyToken('card', 'garbage')).toBeNull()
    expect(verifyToken('card', 'a.b')).toBeNull()
  })
})

describe('constantTimeEqual', () => {
  it('matches identical strings', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true)
  })

  it('rejects different strings and different lengths without throwing', () => {
    expect(constantTimeEqual('abc', 'abd')).toBe(false)
    expect(constantTimeEqual('abc', 'abcd')).toBe(false)
  })
})

describe('sha256', () => {
  it('is stable and hex-encoded', () => {
    expect(sha256('fid_test')).toMatch(/^[0-9a-f]{64}$/)
    expect(sha256('fid_test')).toBe(sha256('fid_test'))
  })
})

describe('webhook signatures', () => {
  it('verifies a correctly signed payload', () => {
    const timestamp = String(Math.floor(Date.now() / 1000))
    const body = JSON.stringify({ event: 'loyalty.earned' })
    const signature = webhookSignature('secret', timestamp, body)
    expect(verifyWebhookSignature('secret', timestamp, body, signature)).toBe(true)
  })

  it('rejects a signature made with the wrong secret', () => {
    const timestamp = String(Math.floor(Date.now() / 1000))
    const body = '{}'
    const signature = webhookSignature('other-secret', timestamp, body)
    expect(verifyWebhookSignature('secret', timestamp, body, signature)).toBe(false)
  })

  it('rejects a replayed old timestamp', () => {
    const old = String(Math.floor(Date.now() / 1000) - 3600)
    const body = '{}'
    const signature = webhookSignature('secret', old, body)
    expect(verifyWebhookSignature('secret', old, body, signature)).toBe(false)
  })
})

describe('errors', () => {
  it('maps codes to the right HTTP status', () => {
    expect(notFound('Customer').status).toBe(404)
    expect(rateLimited(30).status).toBe(429)
    expect(new AppError('forbidden', 'nope').status).toBe(403)
  })

  it('includes a Retry-After header when rate limited', () => {
    expect(rateLimited(42).headers?.['Retry-After']).toBe('42')
  })

  it('marks internal errors as not exposable', () => {
    expect(new AppError('internal_error', 'stack details').expose).toBe(false)
    expect(new AppError('bad_request', 'missing field').expose).toBe(true)
  })

  it('normalises unknown throwables', () => {
    const fromString = toAppError('boom')
    expect(isAppError(fromString)).toBe(true)
    expect(fromString.status).toBe(500)
    expect(fromString.expose).toBe(false)

    const fromError = toAppError(new Error('kaboom'))
    expect(fromError.message).toBe('kaboom')
    expect(fromError.expose).toBe(false)
  })

  it('passes an AppError through unchanged', () => {
    const original = notFound('Reward')
    expect(toAppError(original)).toBe(original)
  })
})
