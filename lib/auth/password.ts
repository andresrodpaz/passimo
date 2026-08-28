import 'server-only'
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number }
) => Promise<Buffer>

/**
 * Password hashing.
 *
 * scrypt from Node's standard library, rather than a native bcrypt or argon2
 * binding. The reasoning is deployment, not cryptography: this application ships
 * as a standalone Next.js bundle to Railway and to Docker, and a native addon is
 * the single most common cause of "works locally, fails in the container" —
 * mismatched glibc, missing build toolchain in the runner stage, prebuilt
 * binaries absent for the platform. scrypt is memory-hard, it is what NIST and
 * OWASP both list as acceptable, and it has no build step.
 *
 * Stored format is self-describing:
 *
 *   scrypt$<N>$<r>$<p>$<salt base64>$<hash base64>
 *
 * The parameters travel with the hash, so raising the cost factor later is a
 * one-line change that leaves every existing password verifiable and lets
 * `needsRehash` upgrade them transparently on next sign-in.
 */

/*
 * N = 2^15 with r = 8 costs ~32 MB and roughly 100 ms on a small container
 * vCPU — the range OWASP recommends, and comfortably above the point where
 * offline cracking of a leaked hash stops being cheap. `maxmem` is set above the
 * requirement because Node's 32 MB default would reject exactly this
 * configuration.
 */
const PARAMS = { N: 32_768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 } as const
const KEY_LENGTH = 64
const SALT_BYTES = 16

export const MIN_PASSWORD_LENGTH = 10
export const MAX_PASSWORD_LENGTH = 200

export async function hashPassword(password: string): Promise<string> {
  assertLength(password)
  const salt = randomBytes(SALT_BYTES)
  const derived = await scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, PARAMS)
  return [
    'scrypt',
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$')
}

/**
 * Verifies a password against a stored hash.
 *
 * Returns `false` for an unparseable or unknown-algorithm hash rather than
 * throwing: a corrupt row must fail the sign-in, not 500 the endpoint and
 * reveal that the account exists.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false

  const N = Number.parseInt(parts[1]!, 10)
  const r = Number.parseInt(parts[2]!, 10)
  const p = Number.parseInt(parts[3]!, 10)
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false

  let salt: Buffer
  let expected: Buffer
  try {
    salt = Buffer.from(parts[4]!, 'base64')
    expected = Buffer.from(parts[5]!, 'base64')
  } catch {
    return false
  }
  if (salt.length === 0 || expected.length === 0) return false

  let derived: Buffer
  try {
    derived = await scrypt(password.normalize('NFKC'), salt, expected.length, {
      N,
      r,
      p,
      maxmem: PARAMS.maxmem,
    })
  } catch {
    // Parameters outside what this build of Node will allocate. Treated as a
    // failed verification so the endpoint stays uniform.
    return false
  }

  return derived.length === expected.length && timingSafeEqual(derived, expected)
}

/** True when a stored hash was made with weaker parameters than we now use. */
export function needsRehash(stored: string): boolean {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return true
  return Number.parseInt(parts[1]!, 10) < PARAMS.N
}

function assertLength(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    /*
     * An upper bound is a denial-of-service control, not a security policy:
     * scrypt's cost is independent of input length, but hashing a 10 MB body on
     * every sign-in attempt is not.
     */
    throw new Error(`Password must be at most ${MAX_PASSWORD_LENGTH} characters`)
  }
}

/**
 * A deliberate constant-cost dummy verification.
 *
 * Sign-in must take the same time whether or not the email exists, or the
 * endpoint becomes an account-enumeration oracle that no amount of identical
 * error copy can close. Called on the "no such user" branch.
 */
let dummyHash: Promise<string> | null = null

export async function burnPasswordTime(password: string): Promise<void> {
  // Built on first use, not at import: a 100 ms scrypt at module load would be
  // paid by every cold start, including requests that never touch a password.
  dummyHash ??= hashPassword('passimo-timing-equaliser-not-a-real-password')
  await verifyPassword(password, await dummyHash)
}
