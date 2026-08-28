import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getDb } from '@/lib/db'
import { sha256, randomToken } from '@/lib/crypto'
import {
  EmailAlreadyRegisteredError,
  authenticate,
  consumeToken,
  createUser,
  deleteUser,
  findUserByEmail,
  issueToken,
  markEmailVerified,
  setPassword,
} from '@/lib/auth/users'
import { resolveSessionToken } from '@/lib/auth/session'
import { encodeSessionToken, sessionSecret } from '@/lib/auth/session-token'
import { assertDatabaseReady, shutdown } from './helpers'

/**
 * The account lifecycle, against the real tables.
 *
 * The cookie-writing half of `lib/auth/session.ts` needs a Next request scope, so
 * these tests build the session row and the signed token directly and then feed
 * them to `resolveSessionToken` — which is the function every authenticated
 * request actually calls. What is under test is the part that decides whether
 * someone is signed in, not the `Set-Cookie` header.
 */
describe('account lifecycle', () => {
  const created: string[] = []

  const email = () => `lifecycle-${Date.now().toString(36)}-${created.length}@passimo.test`

  async function makeUser(password = 'a-perfectly-fine-password') {
    const user = await createUser({ email: email(), password, emailVerified: true })
    created.push(user.id)
    return user
  }

  /** Creates a session row and returns the cookie value it corresponds to. */
  async function makeSession(userId: string, overrides: { expiresAt?: Date } = {}) {
    const secret = randomToken(32)
    const expiresAt = overrides.expiresAt ?? new Date(Date.now() + 86_400_000)

    const { data, error } = await getDb()
      .from('user_sessions')
      .insert({
        user_id: userId,
        token_hash: sha256(secret),
        expires_at: expiresAt.toISOString(),
      })
      .select('id')
      .single()

    if (error) throw new Error(error.message)

    const token = await encodeSessionToken(sessionSecret(), {
      s: secret,
      u: userId,
      e: Math.floor(expiresAt.getTime() / 1000),
    })

    return { sessionId: data.id as string, token, secret }
  }

  beforeAll(async () => {
    await assertDatabaseReady()
  })

  afterAll(async () => {
    for (const id of created) await deleteUser(id)
    await shutdown()
  })

  describe('registration', () => {
    it('creates an account whose stored password is a hash', async () => {
      const user = await makeUser('the original password')

      const { data } = await getDb()
        .from('app_users')
        .select('password_hash, email_verified_at, status')
        .eq('id', user.id)
        .single()

      expect(data.password_hash).toMatch(/^scrypt\$/)
      expect(data.password_hash).not.toContain('the original password')
      expect(data.status).toBe('active')
    })

    it('treats email as case-insensitive, so one person is one account', async () => {
      const address = `Case-${Date.now().toString(36)}@Passimo.Test`
      const user = await createUser({ email: address, password: 'password enough' })
      created.push(user.id)

      // Stored lowercased, and findable either way — `citext` plus normalisation.
      expect(user.email).toBe(address.toLowerCase())
      expect(await findUserByEmail(address.toUpperCase())).not.toBeNull()

      await expect(
        createUser({ email: address.toUpperCase(), password: 'another password' })
      ).rejects.toBeInstanceOf(EmailAlreadyRegisteredError)
    })
  })

  describe('authentication', () => {
    it('accepts the right password', async () => {
      const user = await makeUser('correct password here')
      const outcome = await authenticate(user.email, 'correct password here')

      expect(outcome.ok).toBe(true)
      if (outcome.ok) expect(outcome.user.id).toBe(user.id)
    })

    it('reports the same reason for a wrong password and an unknown address', async () => {
      const user = await makeUser('correct password here')

      const wrongPassword = await authenticate(user.email, 'not the password')
      const noSuchUser = await authenticate('nobody-here-at-all@passimo.test', 'anything at all')

      expect(wrongPassword).toEqual({ ok: false, reason: 'invalid_credentials' })
      expect(noSuchUser).toEqual({ ok: false, reason: 'invalid_credentials' })
    })

    it('locks an account after five failures and unlocks it on a password reset', async () => {
      const user = await makeUser('correct password here')

      for (let attempt = 0; attempt < 4; attempt += 1) {
        expect(await authenticate(user.email, 'wrong')).toEqual({
          ok: false,
          reason: 'invalid_credentials',
        })
      }

      // The fifth failure trips the lock.
      expect(await authenticate(user.email, 'wrong')).toEqual({ ok: false, reason: 'locked' })

      // And the *correct* password is refused while locked — otherwise the lock
      // would only slow down an attacker who already knew it.
      expect(await authenticate(user.email, 'correct password here')).toEqual({
        ok: false,
        reason: 'locked',
      })

      await setPassword(user.id, 'a brand new password')
      const after = await authenticate(user.email, 'a brand new password')
      expect(after.ok).toBe(true)
    })

    it('refuses a suspended account', async () => {
      const user = await makeUser('correct password here')
      await getDb().from('app_users').update({ status: 'suspended' }).eq('id', user.id)

      expect(await authenticate(user.email, 'correct password here')).toEqual({
        ok: false,
        reason: 'suspended',
      })
    })

    it('resets the failure counter after a success', async () => {
      const user = await makeUser('correct password here')
      await authenticate(user.email, 'wrong')
      await authenticate(user.email, 'correct password here')

      const { data } = await getDb()
        .from('app_users')
        .select('failed_login_count, locked_until, last_login_at')
        .eq('id', user.id)
        .single()

      expect(data.failed_login_count).toBe(0)
      expect(data.locked_until).toBeNull()
      expect(data.last_login_at).toBeTruthy()
    })
  })

  describe('sessions', () => {
    it('resolves a live session to its user', async () => {
      const user = await makeUser()
      const { token, sessionId } = await makeSession(user.id)

      const session = await resolveSessionToken(token)
      expect(session?.sessionId).toBe(sessionId)
      expect(session?.user.id).toBe(user.id)
      expect(session?.user.email).toBe(user.email)
    })

    it('refuses a revoked session even though the signature is valid', async () => {
      const user = await makeUser()
      const { token, sessionId } = await makeSession(user.id)

      expect(await resolveSessionToken(token)).not.toBeNull()

      await getDb()
        .from('user_sessions')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', sessionId)

      // This is the property a stateless token cannot provide.
      expect(await resolveSessionToken(token)).toBeNull()
    })

    it('refuses a session whose row has expired', async () => {
      const user = await makeUser()
      const { token } = await makeSession(user.id, { expiresAt: new Date(Date.now() + 60_000) })
      expect(await resolveSessionToken(token)).not.toBeNull()

      /*
       * Expire the row, not the signed token. The signature still says the cookie
       * is valid for another minute, so this is specifically checking that the
       * database is the authority on session lifetime — the signature alone must
       * never be enough.
       */
      await getDb()
        .from('user_sessions')
        .update({ expires_at: new Date(Date.now() - 1_000).toISOString() })
        .eq('user_id', user.id)

      expect(await resolveSessionToken(token)).toBeNull()
    })

    it('refuses a session belonging to a suspended account', async () => {
      const user = await makeUser()
      const { token } = await makeSession(user.id)

      await getDb().from('app_users').update({ status: 'suspended' }).eq('id', user.id)
      expect(await resolveSessionToken(token)).toBeNull()
    })

    it('refuses a signed token whose session row does not exist', async () => {
      const user = await makeUser()
      const orphan = await encodeSessionToken(sessionSecret(), {
        s: randomToken(32),
        u: user.id,
        e: Math.floor((Date.now() + 86_400_000) / 1000),
      })
      expect(await resolveSessionToken(orphan)).toBeNull()
    })

    it('stores only the hash of the session secret', async () => {
      const user = await makeUser()
      const { secret } = await makeSession(user.id)

      const { data } = await getDb()
        .from('user_sessions')
        .select('token_hash')
        .eq('user_id', user.id)
        .limit(1)
        .single()

      expect(data.token_hash).toBe(sha256(secret))
      expect(data.token_hash).not.toBe(secret)
    })
  })

  describe('single-use tokens', () => {
    it('issues, consumes once, and refuses the replay', async () => {
      const user = await makeUser()
      const { token } = await issueToken({ userId: user.id, purpose: 'password_reset' })

      const first = await consumeToken('password_reset', token)
      expect(first?.userId).toBe(user.id)

      const second = await consumeToken('password_reset', token)
      expect(second).toBeNull()
    })

    it('scopes a token to its purpose', async () => {
      const user = await makeUser()
      const { token } = await issueToken({ userId: user.id, purpose: 'password_reset' })

      // A reset link must not double as an email confirmation.
      expect(await consumeToken('email_verification', token)).toBeNull()
      expect(await consumeToken('password_reset', token)).not.toBeNull()
    })

    it('invalidates the previous token when a new one is issued', async () => {
      const user = await makeUser()
      const first = await issueToken({ userId: user.id, purpose: 'password_reset' })
      const second = await issueToken({ userId: user.id, purpose: 'password_reset' })

      // "Send me another link" must not leave the old one live.
      expect(await consumeToken('password_reset', first.token)).toBeNull()
      expect(await consumeToken('password_reset', second.token)).not.toBeNull()
    })

    it('refuses an expired token', async () => {
      const user = await makeUser()
      const { token } = await issueToken({ userId: user.id, purpose: 'email_verification' })

      await getDb()
        .from('user_tokens')
        .update({ expires_at: new Date(Date.now() - 1_000).toISOString() })
        .eq('user_id', user.id)

      expect(await consumeToken('email_verification', token)).toBeNull()
    })

    it('stores only the hash', async () => {
      const user = await makeUser()
      const { token } = await issueToken({ userId: user.id, purpose: 'email_verification' })

      const { data } = await getDb()
        .from('user_tokens')
        .select('token_hash')
        .eq('user_id', user.id)
        .is('consumed_at', null)
        .single()

      expect(data.token_hash).toBe(sha256(token))
    })

    it('marks the address verified exactly once', async () => {
      const user = await createUser({ email: email(), password: 'a fine password' })
      created.push(user.id)
      expect(user.emailVerifiedAt).toBeNull()

      await markEmailVerified(user.id)
      const { data: first } = await getDb()
        .from('app_users')
        .select('email_verified_at')
        .eq('id', user.id)
        .single()
      expect(first.email_verified_at).toBeTruthy()

      // A second call must not move the timestamp — "verified when" is a fact.
      await markEmailVerified(user.id)
      const { data: second } = await getDb()
        .from('app_users')
        .select('email_verified_at')
        .eq('id', user.id)
        .single()
      expect(second.email_verified_at).toBe(first.email_verified_at)
    })
  })

  describe('deletion', () => {
    it('cascades to sessions and tokens', async () => {
      const user = await createUser({ email: email(), password: 'a fine password' })
      await makeSession(user.id)
      await issueToken({ userId: user.id, purpose: 'password_reset' })

      await deleteUser(user.id)

      const sessions = await getDb()
        .from('user_sessions')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
      const tokens = await getDb()
        .from('user_tokens')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)

      expect(sessions.count).toBe(0)
      expect(tokens.count).toBe(0)
    })
  })
})
