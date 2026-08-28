import { z } from 'zod'
import { cookies } from 'next/headers'
import {
  endImpersonation,
  requirePlatformAdmin,
  startImpersonation,
} from '@/lib/auth/platform-admin'
import { listImpersonations } from '@/lib/admin/platform'
import { errorResponse, json } from '@/lib/http'
import { badRequest, notFound, toAppError } from '@/lib/errors'
import { getDb } from '@/lib/db'
import { recordAudit } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Impersonation — viewing a merchant's dashboard as support.
 *
 * The most dangerous button in the product, so every control it has is deliberate:
 *
 *   * **A reason is mandatory** and stored. Requiring a sentence converts "I looked
 *     at a customer's data" into something auditable, and makes casual use feel like
 *     what it is.
 *   * **It expires** after an hour, checked against the clock on every use rather
 *     than trusted from the cookie. A forgotten session cannot be resumed next week.
 *   * **The merchant is told.** The impersonation is written to *their* audit log,
 *     not only ours. Support access a customer cannot see is not support, it is
 *     surveillance.
 *   * **It is read-only by construction.** The cookie names a business; it does not
 *     mint a merchant session or elevate the admin's tenant permissions. Writes
 *     still go through `requireBusinessAccess`, which the admin does not satisfy —
 *     so the console can show what a merchant sees without being able to act as
 *     them.
 */

export const IMPERSONATION_COOKIE = 'passimo_impersonation'

export async function GET() {
  try {
    await requirePlatformAdmin()
    return json({ impersonations: await listImpersonations(50) })
  } catch (caught) {
    return errorResponse(toAppError(caught))
  }
}

const startSchema = z.object({
  businessId: z.string().uuid(),
  reason: z.string().trim().min(8).max(300),
})

export async function POST(request: Request) {
  try {
    const admin = await requirePlatformAdmin()

    const body = startSchema.safeParse(await request.json().catch(() => ({})))
    if (!body.success) {
      throw badRequest('A business and a reason of at least 8 characters are required')
    }

    const client = getDb()
    const { data: business } = await client
      .from('businesses')
      .select('id, name')
      .eq('id', body.data.businessId)
      .maybeSingle()
    if (!business) throw notFound('Business')

    const session = await startImpersonation({
      admin,
      businessId: body.data.businessId,
      reason: body.data.reason,
      request,
    })

    // Visible to the merchant, in their own log.
    await recordAudit({
      businessId: body.data.businessId,
      actor: {
        kind: 'user',
        id: admin.userId,
        email: admin.email,
        scopedBusinessId: null,
        apiKeyId: null,
      },
      action: 'admin.impersonation_started',
      resourceType: 'business',
      resourceId: body.data.businessId,
      summary: `Platform support viewed this workspace: ${body.data.reason}`,
      request,
    })

    const store = await cookies()
    store.set(IMPERSONATION_COOKIE, `${session.id}:${body.data.businessId}`, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      // Matches the grant's own TTL so the cookie cannot outlive the record that
      // authorises it.
      maxAge: 60 * 60,
    })

    return json({
      impersonation: session,
      business: { id: business.id, name: business.name },
    })
  } catch (caught) {
    return errorResponse(toAppError(caught))
  }
}

export async function DELETE() {
  try {
    const admin = await requirePlatformAdmin()
    const store = await cookies()
    const raw = store.get(IMPERSONATION_COOKIE)?.value

    if (raw) {
      const [id] = raw.split(':')
      if (id) await endImpersonation(id, admin.userId)
    }

    store.delete(IMPERSONATION_COOKIE)
    return json({ ok: true })
  } catch (caught) {
    return errorResponse(toAppError(caught))
  }
}
