import 'server-only'
import { getDb } from '@/lib/db'
import { UNIQUE_VIOLATION } from '@/lib/db/query'
import { randomToken, sha256 } from '@/lib/crypto'
import { hashPassword, needsRehash, verifyPassword, burnPasswordTime } from '@/lib/auth/password'
import { logger } from '@/lib/logger'

/**
 * The user account store.
 *
 * Accounts live in `app_users`, a table this application owns and migrates like
 * any other. That is the whole point of the move off a hosted auth service: an
 * account is a row, a password reset is a row, a session is a row, and all three
 * are visible in the same database as the business they belong to — so a signup
 * can provision a workspace in one transaction, and an operator debugging "I
 * can't log in" has one place to look.
 */

export type UserRecord = {
  id: string
  email: string
  fullName: string | null
  locale: string
  status: 'active' | 'suspended' | 'deleted'
  emailVerifiedAt: string | null
  lastLoginAt: string | null
}

type UserRow = {
  id: string
  email: string
  full_name: string | null
  locale: string
  status: string
  email_verified_at: string | null
  last_login_at: string | null
  password_hash: string
  failed_login_count: number
  locked_until: string | null
}

const PUBLIC_COLUMNS = 'id, email, full_name, locale, status, email_verified_at, last_login_at'
const ALL_COLUMNS = `${PUBLIC_COLUMNS}, password_hash, failed_login_count, locked_until`

function toRecord(row: UserRow | Record<string, unknown>): UserRecord {
  const value = row as UserRow
  return {
    id: value.id,
    email: value.email,
    fullName: value.full_name ?? null,
    locale: value.locale ?? 'es',
    status: (value.status as UserRecord['status']) ?? 'active',
    emailVerifiedAt: value.email_verified_at ?? null,
    lastLoginAt: value.last_login_at ?? null,
  }
}

export class EmailAlreadyRegisteredError extends Error {
  constructor() {
    super('An account with this email already exists')
    this.name = 'EmailAlreadyRegisteredError'
  }
}

/**
 * Creates an account.
 *
 * `email` is `citext` and uniquely indexed, so the duplicate check is the
 * database's, not a read-then-write race that two simultaneous signups would
 * both pass.
 */
export async function createUser(input: {
  email: string
  password: string
  fullName?: string | null
  locale?: string
  /** Set when the address is already trusted — the demo seed, an admin invite. */
  emailVerified?: boolean
  metadata?: Record<string, unknown>
}): Promise<UserRecord> {
  const passwordHash = await hashPassword(input.password)

  const { data, error } = await getDb()
    .from('app_users')
    .insert({
      email: input.email.trim().toLowerCase(),
      password_hash: passwordHash,
      full_name: input.fullName ?? null,
      locale: input.locale ?? 'es',
      email_verified_at: input.emailVerified ? new Date().toISOString() : null,
      metadata: input.metadata ?? {},
    })
    .select(PUBLIC_COLUMNS)
    .single()

  if (error) {
    if (error.code === UNIQUE_VIOLATION) throw new EmailAlreadyRegisteredError()
    throw new Error(error.message)
  }

  return toRecord(data as unknown as UserRow)
}

export async function findUserByEmail(email: string): Promise<UserRecord | null> {
  const { data } = await getDb()
    .from('app_users')
    .select(PUBLIC_COLUMNS)
    .eq('email', email.trim().toLowerCase())
    .maybeSingle()
  return data ? toRecord(data as unknown as UserRow) : null
}

export async function findUserById(id: string): Promise<UserRecord | null> {
  const { data } = await getDb()
    .from('app_users')
    .select(PUBLIC_COLUMNS)
    .eq('id', id)
    .maybeSingle()
  return data ? toRecord(data as unknown as UserRow) : null
}

export async function deleteUser(id: string): Promise<void> {
  await getDb().from('app_users').delete().eq('id', id)
}

/*
 * Online-guessing controls.
 *
 * Route-level rate limiting already caps attempts per IP. This caps them per
 * *account*, which is the axis that matters when the attempts come from a
 * botnet: five wrong passwords locks the account for fifteen minutes. Short
 * enough that a merchant who mistyped their password is not locked out of their
 * own business for the evening; long enough that an online attack against one
 * account moves at twenty guesses an hour.
 */
const MAX_FAILED_ATTEMPTS = 5
const LOCKOUT_MINUTES = 15

export type AuthenticationOutcome =
  | { ok: true; user: UserRecord }
  | { ok: false; reason: 'invalid_credentials' | 'locked' | 'suspended' }

/**
 * Verifies an email and password.
 *
 * Every failure path takes roughly the same time and reports the same reason to
 * the caller for the two cases an attacker could learn from ("no such account"
 * and "wrong password" both come back as `invalid_credentials`). `locked` and
 * `suspended` are distinguishable only because the attacker has already proven
 * they know the address, and telling the legitimate owner why they cannot get in
 * is worth more than the residual signal.
 */
export async function authenticate(
  email: string,
  password: string
): Promise<AuthenticationOutcome> {
  const normalised = email.trim().toLowerCase()

  const { data } = await getDb()
    .from('app_users')
    .select(ALL_COLUMNS)
    .eq('email', normalised)
    .maybeSingle()

  const row = data as unknown as UserRow | null

  if (!row) {
    // Same cost as a real verification, so response time does not disclose
    // whether the address is registered.
    await burnPasswordTime(password)
    return { ok: false, reason: 'invalid_credentials' }
  }

  if (row.status === 'suspended' || row.status === 'deleted') {
    await burnPasswordTime(password)
    return { ok: false, reason: 'suspended' }
  }

  if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
    await burnPasswordTime(password)
    return { ok: false, reason: 'locked' }
  }

  const matches = await verifyPassword(password, row.password_hash)

  if (!matches) {
    const attempts = (row.failed_login_count ?? 0) + 1
    const lock =
      attempts >= MAX_FAILED_ATTEMPTS
        ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000).toISOString()
        : null

    await getDb()
      .from('app_users')
      .update({
        failed_login_count: attempts,
        locked_until: lock,
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id)

    if (lock) logger.warn('auth.account_locked', { user_id: row.id, attempts })
    return { ok: false, reason: attempts >= MAX_FAILED_ATTEMPTS ? 'locked' : 'invalid_credentials' }
  }

  const patch: Record<string, unknown> = {
    failed_login_count: 0,
    locked_until: null,
    last_login_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  // Transparent cost-factor upgrade: the only moment we hold the plaintext.
  if (needsRehash(row.password_hash)) {
    patch.password_hash = await hashPassword(password)
  }

  await getDb().from('app_users').update(patch).eq('id', row.id)

  return { ok: true, user: toRecord({ ...row, last_login_at: patch.last_login_at as string }) }
}

/** Replaces a password and clears any lockout. Callers must have proven identity. */
export async function setPassword(userId: string, password: string): Promise<void> {
  const passwordHash = await hashPassword(password)
  const { error } = await getDb()
    .from('app_users')
    .update({
      password_hash: passwordHash,
      failed_login_count: 0,
      locked_until: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId)
  if (error) throw new Error(error.message)
}

export async function markEmailVerified(userId: string): Promise<void> {
  await getDb()
    .from('app_users')
    .update({ email_verified_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', userId)
    .is('email_verified_at', null)
}

// ---------------------------------------------------------------------------
// Single-use tokens: email verification and password reset
// ---------------------------------------------------------------------------

export type TokenPurpose = 'email_verification' | 'password_reset'

const TOKEN_TTL_MINUTES: Record<TokenPurpose, number> = {
  // Long enough to survive a merchant finishing onboarding and coming back to
  // the email tomorrow.
  email_verification: 60 * 24 * 3,
  // Short by design: a reset link sitting in an inbox is a live credential.
  password_reset: 60,
}

/**
 * Issues a single-use token and returns the *plaintext* half.
 *
 * Only the SHA-256 is stored. A leaked database backup therefore contains no
 * usable reset links, which is the same reason API keys are stored hashed.
 */
export async function issueToken(input: {
  userId: string
  purpose: TokenPurpose
  metadata?: Record<string, unknown>
}): Promise<{ token: string; expiresAt: string }> {
  const token = randomToken(32)
  const expiresAt = new Date(
    Date.now() + TOKEN_TTL_MINUTES[input.purpose] * 60_000
  ).toISOString()

  /*
   * Invalidate the account's outstanding tokens of the same purpose first.
   * Otherwise "send me another reset link" leaves the previous one live, and a
   * merchant who requested a reset because they suspected a compromise would
   * still have a valid link sitting in a mailbox someone else can read.
   */
  await getDb()
    .from('user_tokens')
    .update({ consumed_at: new Date().toISOString() })
    .eq('user_id', input.userId)
    .eq('purpose', input.purpose)
    .is('consumed_at', null)

  const { error } = await getDb().from('user_tokens').insert({
    user_id: input.userId,
    purpose: input.purpose,
    token_hash: sha256(token),
    expires_at: expiresAt,
    metadata: input.metadata ?? {},
  })
  if (error) throw new Error(error.message)

  return { token, expiresAt }
}

export type ConsumedToken = { userId: string; metadata: Record<string, unknown> }

/**
 * Consumes a token, returning the account it belongs to.
 *
 * The `consumed_at is null` filter on the update is what makes it single-use
 * under concurrency: two simultaneous clicks on the same reset link produce one
 * update of one row, and the loser gets `null`.
 */
export async function consumeToken(
  purpose: TokenPurpose,
  token: string
): Promise<ConsumedToken | null> {
  const { data } = await getDb()
    .from('user_tokens')
    .update({ consumed_at: new Date().toISOString() })
    .eq('token_hash', sha256(token))
    .eq('purpose', purpose)
    .is('consumed_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('user_id, metadata')
    .maybeSingle()

  if (!data) return null

  const row = data as unknown as { user_id: string; metadata: Record<string, unknown> | null }
  return { userId: row.user_id, metadata: row.metadata ?? {} }
}

/** Housekeeping for the daily job: consumed and expired tokens have no value. */
export async function purgeExpiredTokens(): Promise<number> {
  const { count } = await getDb()
    .from('user_tokens')
    .delete({ count: 'exact' })
    .lt('expires_at', new Date(Date.now() - 7 * 86_400_000).toISOString())
  return count ?? 0
}
