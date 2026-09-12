import { z } from 'zod'
import { defineRoute } from '@/lib/api/handler'
import { getDb } from '@/lib/db'
import { forbidden, unprocessable } from '@/lib/errors'
import { recordAudit } from '@/lib/audit'
import { sha256 } from '@/lib/crypto'

export const runtime = 'nodejs'

const bodySchema = z.object({ token: z.string().min(20).max(200) })

/**
 * Accepting a staff invitation.
 *
 * Requires an authenticated session, and that is the whole security model: the
 * invitation names an email address, and the only way to prove you are that
 * address is to hold an account for it. The alternative — letting the token
 * alone create an account — would make a forwarded email a way into somebody
 * else's workspace.
 *
 * So the flow is: click the link → sign in or sign up → the page posts the
 * token. `/team/accept` handles the redirect, and the token survives it in the
 * URL rather than in a cookie.
 *
 * The token is compared as a hash. `invite_token_hash` holds `sha256(token)`
 * and the plaintext exists only in the email, so a database read cannot
 * accept invitations.
 */
export const POST = defineRoute(
  {
    name: 'team.accept',
    auth: 'required',
    body: bodySchema,
    rateLimit: 'auth',
  },
  async ({ body, actor, request }) => {
    if (!actor.id || !actor.email) throw forbidden('Sign in to accept this invitation.')

    const db = getDb()
    const { data: invite } = await db
      .from('team_members')
      .select('id, business_id, role, status, invited_email, invite_expires_at')
      .eq('invite_token_hash', sha256(body.token))
      .maybeSingle()

    /*
     * One message for every failure that is not "wrong account". An invalid
     * token, a revoked invitation and an expired one are indistinguishable to
     * the person holding the link, and distinguishing them would let someone
     * probe which tokens ever existed.
     */
    const invalid = forbidden('This invitation is no longer valid. Ask for a new one.')
    if (!invite || invite.status !== 'invited') throw invalid
    if (
      invite.invite_expires_at &&
      new Date(invite.invite_expires_at as string).getTime() < Date.now()
    ) {
      throw invalid
    }

    /*
     * The invited address has to match the session. Told plainly, because this
     * is the one failure the person can actually fix — and "invalid invitation"
     * would send them to ask for a new one that fails identically.
     */
    if ((invite.invited_email as string).toLowerCase() !== actor.email.toLowerCase()) {
      throw forbidden(
        `This invitation was sent to ${invite.invited_email}. Sign in with that account to accept it.`
      )
    }

    const { error } = await db
      .from('team_members')
      .update({
        user_id: actor.id,
        status: 'active',
        accepted_at: new Date().toISOString(),
        // Single use. The row keeps `invited_email` as the record of who was
        // asked; the token stops existing.
        invite_token_hash: null,
        invite_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', invite.id)
      .eq('status', 'invited')

    if (error) throw unprocessable(error.message)

    await recordAudit({
      businessId: invite.business_id as string,
      actor,
      action: 'team.invite_accepted',
      resourceType: 'team_member',
      resourceId: invite.id as string,
      summary: `${actor.email} joined as ${invite.role}`,
      request,
    })

    return { joined: true, businessId: invite.business_id, role: invite.role }
  }
)
