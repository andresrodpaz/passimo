import { describe, expect, it } from 'vitest'
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  burnPasswordTime,
  hashPassword,
  needsRehash,
  verifyPassword,
} from '@/lib/auth/password'

/**
 * Password hashing.
 *
 * This is the module that decides whether a leaked `app_users` table is a
 * catastrophe or an inconvenience, so the properties worth asserting are the
 * ones that would silently stop holding: that the stored value is not the
 * password, that two identical passwords do not produce identical hashes, and
 * that verification actually rejects.
 */
describe('hashPassword', () => {
  it('produces a self-describing scrypt record that contains no plaintext', async () => {
    const hash = await hashPassword('correct horse battery staple')

    const [algorithm, N, r, p, salt, digest] = hash.split('$')
    expect(algorithm).toBe('scrypt')
    expect(Number(N)).toBeGreaterThanOrEqual(32_768)
    expect(Number(r)).toBe(8)
    expect(Number(p)).toBe(1)
    expect(salt).toBeTruthy()
    expect(digest).toBeTruthy()

    expect(hash).not.toContain('correct horse')
  })

  it('salts, so the same password never stores the same value twice', async () => {
    const [a, b] = await Promise.all([
      hashPassword('the same password'),
      hashPassword('the same password'),
    ])
    expect(a).not.toBe(b)
    // Both must still verify — the salt travels with the hash.
    expect(await verifyPassword('the same password', a)).toBe(true)
    expect(await verifyPassword('the same password', b)).toBe(true)
  })

  it('rejects passwords below the documented minimum', async () => {
    await expect(hashPassword('short')).rejects.toThrow(/at least/)
  })

  it('rejects absurdly long input rather than hashing it', async () => {
    await expect(hashPassword('a'.repeat(MAX_PASSWORD_LENGTH + 1))).rejects.toThrow(/at most/)
  })

  it('accepts exactly the minimum length', async () => {
    const hash = await hashPassword('a'.repeat(MIN_PASSWORD_LENGTH))
    expect(await verifyPassword('a'.repeat(MIN_PASSWORD_LENGTH), hash)).toBe(true)
  })
})

describe('verifyPassword', () => {
  it('accepts the right password and rejects a near miss', async () => {
    const hash = await hashPassword('PassimoDemo2026!')
    expect(await verifyPassword('PassimoDemo2026!', hash)).toBe(true)
    expect(await verifyPassword('PassimoDemo2026', hash)).toBe(false)
    expect(await verifyPassword('passimodemo2026!', hash)).toBe(false)
    expect(await verifyPassword('', hash)).toBe(false)
  })

  it('normalises Unicode, so a password typed on a different keyboard still works', async () => {
    // U+00F1 (precomposed ñ) versus U+006E U+0303 (n + combining tilde). macOS and
    // Windows disagree about which one a keyboard emits; a Spanish-speaking
    // merchant must not be locked out by that.
    const composed = 'mi contraseña segura'
    const decomposed = 'mi contraseña segura'
    expect(composed).not.toBe(decomposed) // Different code points, same word.

    const hash = await hashPassword(composed)
    expect(await verifyPassword(decomposed, hash)).toBe(true)
  })

  it('returns false for a corrupt or foreign hash instead of throwing', async () => {
    // A 500 here would tell an attacker the row exists.
    expect(await verifyPassword('anything', '')).toBe(false)
    expect(await verifyPassword('anything', 'not-a-hash')).toBe(false)
    expect(await verifyPassword('anything', '$2b$10$abcdefghijklmnopqrstuv')).toBe(false)
    expect(await verifyPassword('anything', 'scrypt$notanumber$8$1$c2FsdA==$aGFzaA==')).toBe(false)
    expect(await verifyPassword('anything', 'scrypt$32768$8$1$$')).toBe(false)
  })
})

describe('needsRehash', () => {
  it('is false for a hash made with the current parameters', async () => {
    expect(needsRehash(await hashPassword('a password long enough'))).toBe(false)
  })

  it('is true for a weaker cost factor, so sign-in upgrades it', () => {
    expect(needsRehash('scrypt$16384$8$1$c2FsdA==$aGFzaA==')).toBe(true)
  })

  it('is true for anything it cannot parse', () => {
    expect(needsRehash('bcrypt$whatever')).toBe(true)
    expect(needsRehash('')).toBe(true)
  })
})

describe('burnPasswordTime', () => {
  it('resolves without throwing, so the no-such-user branch stays uniform', async () => {
    await expect(burnPasswordTime('whatever was typed')).resolves.toBeUndefined()
  })
})
