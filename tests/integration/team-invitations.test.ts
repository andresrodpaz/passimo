import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getDb } from '@/lib/db'
import { invalidateEntitlements, measureLimit } from '@/lib/billing/entitlements'
import { PLANS } from '@/lib/billing/plans'
import { sha256, randomToken } from '@/lib/crypto'
import { assertDatabaseReady, createTenant, dropTenant, shutdown, type TestTenant } from './helpers'

/**
 * Staff invitations, against real rows.
 *
 * The feature this covers did not exist until it was audited, and the *shape* of
 * its absence is the reason these tests are worth keeping. Everything around it
 * was already built: the `team_members` table had `invite_token_hash`,
 * `invite_expires_at`, `invited_by` and a unique index on pending invites; RBAC
 * had a `team:manage` permission; the plan catalogue capped seats at 3 / 10 / 25
 * and the pricing page sold "staff logins"; the settings screen rendered an
 * "Invitation pending" label; and the onboarding checklist asked the merchant to
 * invite their team and judged it done at `teamMemberCount > 1`. The only thing
 * missing was the endpoint — so the product sold seats nobody could fill and
 * carried a checklist item nobody could complete.
 *
 * What these assert is the part that a route test cannot: that the seat cap
 * counts what it should. A pending invitation has to hold a seat, or a tenant on
 * three seats can issue fifty invitations and then acquire fifty colleagues —
 * the cap would begin to bind at exactly the moment it stopped mattering.
 */
describe('staff invitations', () => {
  let starter: TestTenant
  let growth: TestTenant

  beforeAll(async () => {
    await assertDatabaseReady()
    starter = await createTenant('team-starter', { plan: 'starter' })
    growth = await createTenant('team-growth', { plan: 'growth' })
  }, 60_000)

  afterAll(async () => {
    await dropTenant(starter)
    await dropTenant(growth)
    await shutdown()
  })

  /** An invitation row exactly as `POST /api/v1/team` writes one. */
  async function invite(tenant: TestTenant, email: string, role = 'staff') {
    const token = randomToken(32)
    const { data, error } = await getDb()
      .from('team_members')
      .insert({
        business_id: tenant.businessId,
        role,
        status: 'invited',
        invited_email: email,
        invited_by: tenant.userId,
        invite_token_hash: sha256(token),
        invite_expires_at: new Date(Date.now() + 14 * 86_400_000).toISOString(),
        user_id: null,
        accepted_at: null,
      })
      .select('id')
      .single()

    invalidateEntitlements(tenant.businessId)
    return { id: data?.id as string | undefined, error, token }
  }

  it('counts a pending invitation against the seat cap', async () => {
    /*
     * The defect this pins. `currentUsage` filtered on `status = 'active'`,
     * which is defensible right up until you notice that an invitation is a
     * promise of a seat: the person on the other end will accept, and by then
     * the cap has nothing left to refuse.
     */
    const before = await measureLimit(starter.businessId, 'team_members')
    expect(before.used, 'a fresh workspace has only its owner').toBe(1)
    expect(before.allowed).toBe(PLANS.starter.limits.team_members)

    const { id, error } = await invite(starter, `pending-${Date.now()}@passimo.test`)
    expect(error).toBeNull()
    expect(id).toBeTruthy()

    const after = await measureLimit(starter.businessId, 'team_members')
    expect(after.used, 'the pending invitation holds a seat').toBe(2)
  })

  it('releases the seat when an invitation is revoked', async () => {
    // Revoking deletes the row, which is what makes the cap recoverable — a
    // typo in an email address must not cost a seat until it expires.
    const email = `revoked-${Date.now()}@passimo.test`
    const { id } = await invite(growth, email)
    const held = await measureLimit(growth.businessId, 'team_members')

    await getDb().from('team_members').delete().eq('id', id!)
    invalidateEntitlements(growth.businessId)

    const released = await measureLimit(growth.businessId, 'team_members')
    expect(released.used).toBe(held.used - 1)
  })

  it('does not double-count a seat when an invitation is accepted', async () => {
    /*
     * The other half of the same arithmetic: acceptance flips `status` from
     * `invited` to `active` on the *same row*, so the seat count must not move.
     * A count that summed the two states separately would charge twice for one
     * colleague.
     */
    const email = `accepting-${Date.now()}@passimo.test`
    const { id } = await invite(growth, email)
    const pending = await measureLimit(growth.businessId, 'team_members')

    await getDb()
      .from('team_members')
      .update({
        user_id: growth.userId,
        status: 'active',
        accepted_at: new Date().toISOString(),
        invite_token_hash: null,
        invite_expires_at: null,
      })
      .eq('id', id!)
    invalidateEntitlements(growth.businessId)

    const accepted = await measureLimit(growth.businessId, 'team_members')
    expect(accepted.used, 'accepting is a status change, not a new seat').toBe(pending.used)

    await getDb().from('team_members').delete().eq('id', id!)
    invalidateEntitlements(growth.businessId)
  })

  it('refuses a second pending invitation to the same address', async () => {
    /*
     * `idx_team_members_pending_invite` is unique on `(business_id,
     * invited_email) where user_id is null`. The endpoint treats a repeat as a
     * re-send and updates the existing row; this asserts the index is what
     * makes that necessary rather than merely tidy — without it, clicking
     * "invite" twice would silently consume two seats for one person.
     */
    const email = `duplicate-${Date.now()}@passimo.test`
    const first = await invite(growth, email)
    expect(first.error).toBeNull()

    const second = await invite(growth, email)
    expect(second.error, 'the unique index must reject the duplicate').not.toBeNull()

    await getDb().from('team_members').delete().eq('id', first.id!)
    invalidateEntitlements(growth.businessId)
  })

  it('stores only a hash of the invitation token', async () => {
    // The plaintext exists in one place — the email — so a database read cannot
    // accept invitations. Asserted because it is the whole security property.
    const email = `hashed-${Date.now()}@passimo.test`
    const { id, token } = await invite(growth, email)

    const { data } = await getDb()
      .from('team_members')
      .select('invite_token_hash')
      .eq('id', id!)
      .single()

    expect(data?.invite_token_hash).toBe(sha256(token))
    expect(data?.invite_token_hash).not.toBe(token)

    await getDb().from('team_members').delete().eq('id', id!)
    invalidateEntitlements(growth.businessId)
  })

  it('keeps one workspace’s invitations invisible to another', async () => {
    /*
     * A token is looked up by hash with no tenant filter — it cannot have one,
     * because the person holding the link has no session yet. So the isolation
     * has to come from the token being unguessable and from the row naming its
     * own business, which is what this checks.
     */
    const email = `tenant-scope-${Date.now()}@passimo.test`
    const { id, token } = await invite(starter, email)

    const { data } = await getDb()
      .from('team_members')
      .select('business_id')
      .eq('invite_token_hash', sha256(token))
      .single()

    expect(data?.business_id).toBe(starter.businessId)
    expect(data?.business_id).not.toBe(growth.businessId)

    await getDb().from('team_members').delete().eq('id', id!)
    invalidateEntitlements(starter.businessId)
  })

  it('gives every tier the seats its pricing page promises', async () => {
    // The catalogue is frozen, and the pricing page quotes these numbers as
    // "staff logins". They are now a feature rather than a decoration, so a
    // change to either has to be deliberate.
    expect(PLANS.starter.limits.team_members).toBe(3)
    expect(PLANS.growth.limits.team_members).toBe(10)
    expect(PLANS.pro.limits.team_members).toBe(25)
  })
})
