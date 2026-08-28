import { describe, expect, it } from 'vitest'
import { decideFlushOutcome } from '@/lib/client/offline-queue'

/**
 * The offline queue's drop-or-retry decision.
 *
 * This is the one place in the product where a merchant's revenue can vanish
 * silently. Dropping too eagerly loses a visit the customer actually made;
 * retrying forever lets one poisoned record block every visit queued behind it.
 * Both directions are pinned here.
 */

describe('decideFlushOutcome', () => {
  it('retries an ordinary network failure', () => {
    // The overwhelmingly common case: the café wifi is still down.
    expect(decideFlushOutcome(new TypeError('Failed to fetch'), 0)).toBe('retry')
  })

  it('keeps retrying across several failed attempts', () => {
    expect(decideFlushOutcome(new Error('offline'), 3)).toBe('retry')
    expect(decideFlushOutcome(new Error('offline'), 6)).toBe('retry')
  })

  it('abandons a scan the server has permanently rejected', () => {
    // A 4xx cannot succeed on retry, and must not block the queue behind it.
    const cause = Object.assign(new Error('Customer not found'), { permanent: true })
    expect(decideFlushOutcome(cause, 0)).toBe('abandon')
  })

  it('does not treat a merely-flagged-false cause as permanent', () => {
    const cause = Object.assign(new Error('server error'), { permanent: false })
    expect(decideFlushOutcome(cause, 0)).toBe('retry')
  })

  it('gives up once attempts are exhausted, so the queue can drain', () => {
    // The 8th attempt is the last one.
    expect(decideFlushOutcome(new Error('offline'), 6)).toBe('retry')
    expect(decideFlushOutcome(new Error('offline'), 7)).toBe('abandon')
    expect(decideFlushOutcome(new Error('offline'), 20)).toBe('abandon')
  })

  it('handles a thrown non-error without crashing the sync', () => {
    // A rejected promise can carry anything at all.
    expect(decideFlushOutcome('a string', 0)).toBe('retry')
    expect(decideFlushOutcome(null, 0)).toBe('retry')
    expect(decideFlushOutcome(undefined, 0)).toBe('retry')
    expect(decideFlushOutcome({ permanent: true }, 0)).toBe('abandon')
  })
})
