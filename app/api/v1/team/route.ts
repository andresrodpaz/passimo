import { z } from 'zod'
import { defineRoute } from '@/lib/api/handler'
import { getDb } from '@/lib/db'
import { conflict, forbidden, notFound, unprocessable } from '@/lib/errors'
import { recordAudit } from '@/lib/audit'
import { requireWithinLimit } from '@/lib/billing/entitlements'
import { randomToken, sha256 } from '@/lib/crypto'
import { ROLES } from '@/lib/auth/rbac'
import { sendTransactionalEmail } from '@/lib/messaging/transactional'
import { getBusinessLocale } from '@/lib/i18n/business'
import { createTranslator } from '@/lib/i18n/translate'
import { env } from '@/lib/env'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'

/**
 * Staff invitations.
 *
 * This endpoint is the missing half of a feature the rest of the product had
 * already fully assumed. Before it existed:
 *
 *  - `team_members` carried `invited_email`, `invited_by`, `invite_token_hash`
 *    and `invite_expires_at`, plus a unique index on pending invites per
 *    business — a schema designed for invitations
 *  - `lib/auth/rbac.ts` defined a `team:manage` permission
 *  - `lib/billing/plans.ts` capped seats at 3 / 10 / 25, and the pricing page
 *    sold "staff logins" on all three tiers
 *  - the settings screen rendered a roster with a "Invitation pending" label
 *  - the onboarding checklist asked the merchant to invite their team, and
 *    judged the step complete at `teamMemberCount > 1`
 *
 * and the only row ever written was the owner's, at signup. So a merchant paid
 * for seats they could not fill, and carried a checklist item that could never
 * be completed, pointing at a settings page where the thing did not exist. The
 * gap was in the application layer only, which is why closing it is this small.
 *
 * An invite is a real row from the moment it is created, with `status`
 * `'invited'` and no `user_id`. That matters for the seat cap: a pending invite
 * holds a seat (see `currentUsage` in `lib/billing/entitlements.ts`), because a
 * cap that only counted accepted members would let a Starter tenant issue fifty
 * invitations and then acquire fifty colleagues.
 */

const INVITE_TTL_DAYS = 14

/**
 * Roles that can be handed out. `owner` is excluded deliberately: there is
 * exactly one owner, it is set at signup, and transferring it is a different
 * operation with different consequences than adding a colleague.
 */
const ASSIGNABLE_ROLES = ROLES.filter((role) => role !== 'owner')

const inviteSchema = z.object({
  businessId: z.string().uuid(),
  email: z.string().email().max(320),
  role: z.enum(ASSIGNABLE_ROLES as [string, ...string[]]),
  displayName: z.string().min(1).max(120).optional(),
})

const removeSchema = z.object({
  businessId: z.string().uuid(),
  memberId: z.string().uuid(),
})

const updateSchema = z.object({
  businessId: z.string().uuid(),
  memberId: z.string().uuid(),
  role: z.enum(ASSIGNABLE_ROLES as [string, ...string[]]),
})

const listQuery = z.object({ businessId: z.string().uuid() })

export const GET = defineRoute(
  {
    name: 'team.list',
    auth: 'required',
    query: listQuery,
    businessIdFrom: { source: 'query', key: 'businessId' },
    permissions: ['team:manage'],
    rateLimit: 'dashboard',
  },
  async ({ business }) => {
    const [members, seats] = await Promise.all([
      getDb()
        .from('team_members')
        .select(
          'id, user_id, role, status, display_name, invited_email, invite_expires_at, last_active_at, accepted_at, created_at'
        )
        .eq('business_id', business.businessId)
        .order('created_at', { ascending: true }),
      /*
       * The seat status ships with the roster so the invite form can be
       * disabled — and say why — before the merchant types an address, rather
       * than accepting the invitation and then refusing it.
       */
      requireWithinLimit(business.businessId, 'team_members', 0),
    ])

    return {
      members: members.data ?? [],
      seats: { used: seats.used, allowed: seats.allowed },
      assignableRoles: ASSIGNABLE_ROLES,
    }
  }
)

export const POST = defineRoute(
  {
    name: 'team.invite',
    auth: 'required',
    body: inviteSchema,
    businessIdFrom: { source: 'body', key: 'businessId' },
    permissions: ['team:manage'],
    rateLimit: 'dashboard',
  },
  async ({ body, business, actor, request }) => {
    // Before anything else: a seat has to exist. `402` with a suggested plan.
    await requireWithinLimit(business.businessId, 'team_members')

    const db = getDb()
    const email = body.email.trim().toLowerCase()

    /*
     * Two separate collisions, two different answers. Someone already on the
     * roster is a no-op the merchant should be told about plainly; a pending
     * invitation to the same address is a re-send, and the unique index would
     * reject the insert anyway.
     */
    const { data: existing } = await db
      .from('team_members')
      .select('id, status, user_id')
      .eq('business_id', business.businessId)
      .eq('invited_email', email)
      .maybeSingle()

    if (existing?.status === 'active') {
      throw conflict('That person is already on your team.')
    }

    const token = randomToken(32)
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000).toISOString()

    const row = {
      business_id: business.businessId,
      role: body.role,
      status: 'invited',
      invited_email: email,
      invited_by: actor.id,
      invite_token_hash: sha256(token),
      invite_expires_at: expiresAt,
      display_name: body.displayName ?? null,
      user_id: null,
      accepted_at: null,
    }

    // A resend replaces the outstanding token rather than adding a second row —
    // the old link stops working, which is the behaviour a merchant expects
    // when they click "invite again".
    const { data: member, error } = existing
      ? await db
          .from('team_members')
          .update(row)
          .eq('id', existing.id)
          .eq('business_id', business.businessId)
          .select('id, role, status, invited_email, invite_expires_at')
          .single()
      : await db
          .from('team_members')
          .insert(row)
          .select('id, role, status, invited_email, invite_expires_at')
          .single()

    if (error || !member) throw unprocessable(error?.message ?? 'Could not create the invitation')

    await recordAudit({
      businessId: business.businessId,
      actor,
      action: 'team.invited',
      resourceType: 'team_member',
      resourceId: member.id as string,
      summary: `Invited ${email} as ${body.role}`,
      request,
    })

    /*
     * The email is best-effort and the invitation is already real, so a
     * deployment with no email provider does not lose the invite — it returns
     * the link for the merchant to pass on themselves. Failing the whole
     * request would make staff invitations impossible on a deployment that has
     * deliberately not configured Resend.
     */
    const url = `${env.appUrl}/team/accept?token=${encodeURIComponent(token)}`
    const locale = await getBusinessLocale(business.businessId)
    const t = createTranslator(locale)

    const delivery = await sendTransactionalEmail({
      to: email,
      businessId: business.businessId,
      subject: t('team.emails.invite.subject'),
      body: t('team.emails.invite.body'),
      ctaLabel: t('team.emails.invite.cta'),
      ctaUrl: url,
    }).catch((cause: unknown) => {
      logger.warn('team.invite_email_failed', { cause })
      return { ok: false as const, error: 'send_failed' }
    })

    return {
      member,
      email_sent: delivery.ok,
      /* Returned only when we could not send it, so it is never a second copy
         of a link that already reached the invitee's inbox. */
      invite_url: delivery.ok ? null : url,
    }
  }
)

export const PATCH = defineRoute(
  {
    name: 'team.update_role',
    auth: 'required',
    body: updateSchema,
    businessIdFrom: { source: 'body', key: 'businessId' },
    permissions: ['team:manage'],
    rateLimit: 'dashboard',
  },
  async ({ body, business, actor, request }) => {
    const db = getDb()
    const { data: member } = await db
      .from('team_members')
      .select('id, role, invited_email, display_name')
      .eq('id', body.memberId)
      .eq('business_id', business.businessId)
      .maybeSingle()

    if (!member) throw notFound('Team member')
    // The owner's role is not editable here for the same reason it is not
    // assignable: it is the account's anchor, not a permission level.
    if (member.role === 'owner') throw forbidden('The owner’s role cannot be changed.')

    const { error } = await db
      .from('team_members')
      .update({ role: body.role, updated_at: new Date().toISOString() })
      .eq('id', body.memberId)
      .eq('business_id', business.businessId)

    if (error) throw unprocessable(error.message)

    await recordAudit({
      businessId: business.businessId,
      actor,
      action: 'team.role_changed',
      resourceType: 'team_member',
      resourceId: body.memberId,
      summary: `${member.display_name ?? member.invited_email ?? 'A member'}: ${member.role} → ${body.role}`,
      request,
    })

    return { updated: true }
  }
)

export const DELETE = defineRoute(
  {
    name: 'team.remove',
    auth: 'required',
    body: removeSchema,
    businessIdFrom: { source: 'body', key: 'businessId' },
    permissions: ['team:manage'],
    rateLimit: 'dashboard',
  },
  async ({ body, business, actor, request }) => {
    const db = getDb()
    const { data: member } = await db
      .from('team_members')
      .select('id, role, status, invited_email, display_name')
      .eq('id', body.memberId)
      .eq('business_id', business.businessId)
      .maybeSingle()

    if (!member) throw notFound('Team member')
    /*
     * Removing the owner would leave a workspace nobody can administer, and the
     * seat cap makes that unrecoverable on a full plan. Deleting the *workspace*
     * is a separate, deliberate operation.
     */
    if (member.role === 'owner') throw forbidden('The owner cannot be removed from the workspace.')

    const { error } = await db
      .from('team_members')
      .delete()
      .eq('id', body.memberId)
      .eq('business_id', business.businessId)

    if (error) throw unprocessable(error.message)

    await recordAudit({
      businessId: business.businessId,
      actor,
      action: member.status === 'invited' ? 'team.invite_revoked' : 'team.removed',
      resourceType: 'team_member',
      resourceId: body.memberId,
      summary: `Removed ${member.display_name ?? member.invited_email ?? 'a member'}`,
      request,
    })

    return { removed: true }
  }
)
