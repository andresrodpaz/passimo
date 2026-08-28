import { getDb } from '@/lib/db'
import { constantTimeEqual } from '@/lib/crypto'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Apple Wallet PassKit web service.
 *
 * Implements the protocol Apple calls after a pass is installed. Without it,
 * push updates silently do nothing — which is what the original integration
 * shipped: it pushed to a token that no endpoint ever registered.
 *
 * Routes handled (relative to `webServiceURL`):
 *   POST   /v1/devices/{device}/registrations/{passType}/{serial}
 *   DELETE /v1/devices/{device}/registrations/{passType}/{serial}
 *   GET    /v1/devices/{device}/registrations/{passType}?passesUpdatedSince=
 *   GET    /v1/passes/{passType}/{serial}
 *   POST   /v1/log
 *
 * @see https://developer.apple.com/documentation/walletpasses
 */

/** `ApplePass <token>` must match the per-pass secret embedded in the pass. */
async function authorizePass(request: Request, serial: string): Promise<boolean> {
  const header = request.headers.get('authorization') ?? ''
  if (!header.startsWith('ApplePass ')) return false
  const provided = header.slice('ApplePass '.length).trim()
  if (!provided) return false

  const admin = getDb()
  const { data } = await admin
    .from('customers')
    .select('wallet_auth_token')
    .eq('id', serial)
    .maybeSingle()

  const expected = data?.wallet_auth_token as string | undefined
  return Boolean(expected) && constantTimeEqual(provided, expected!)
}

export async function POST(
  request: Request,
  context: { params: Promise<{ path: string[] }> }
) {
  const { path } = await context.params

  // POST /v1/log — Apple's diagnostics channel. Recording these is the only
  // way to debug a pass that silently fails to update on a real device.
  if (path[0] === 'log') {
    const body = (await request.json().catch(() => ({}))) as { logs?: string[] }
    logger.info('wallet.apple_device_log', { logs: (body.logs ?? []).slice(0, 20) })
    return new Response(null, { status: 200 })
  }

  // POST /v1/devices/{device}/registrations/{passType}/{serial}
  if (path[0] === 'devices' && path[2] === 'registrations' && path.length === 5) {
    const [, deviceId, , passTypeId, serial] = path as [string, string, string, string, string]
    if (!(await authorizePass(request, serial))) {
      return new Response('Unauthorized', { status: 401 })
    }

    const body = (await request.json().catch(() => ({}))) as { pushToken?: string }
    if (!body.pushToken) return new Response('Bad Request', { status: 400 })

    const admin = getDb()
    const { data: customer } = await admin
      .from('customers')
      .select('business_id')
      .eq('id', serial)
      .maybeSingle()
    if (!customer) return new Response('Not Found', { status: 404 })

    const { data: existing } = await admin
      .from('wallet_registrations')
      .select('id')
      .eq('device_id', deviceId)
      .eq('serial_number', serial)
      .maybeSingle()

    await admin.from('wallet_registrations').upsert(
      {
        business_id: customer.business_id,
        customer_id: serial,
        platform: 'apple',
        device_id: deviceId,
        pass_type_id: passTypeId,
        serial_number: serial,
        push_token: body.pushToken,
      },
      { onConflict: 'device_id,serial_number' }
    )

    // Keep the legacy single-token column in sync for any older code path.
    await admin
      .from('customers')
      .update({ apple_push_token: body.pushToken, apple_device_library_id: deviceId })
      .eq('id', serial)

    // 200 = already registered, 201 = newly registered (Apple distinguishes).
    return new Response(null, { status: existing ? 200 : 201 })
  }

  return new Response('Not Found', { status: 404 })
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ path: string[] }> }
) {
  const { path } = await context.params

  if (path[0] === 'devices' && path[2] === 'registrations' && path.length === 5) {
    const [, deviceId, , , serial] = path as [string, string, string, string, string]
    if (!(await authorizePass(request, serial))) {
      return new Response('Unauthorized', { status: 401 })
    }

    const admin = getDb()
    await admin
      .from('wallet_registrations')
      .delete()
      .eq('device_id', deviceId)
      .eq('serial_number', serial)

    return new Response(null, { status: 200 })
  }

  return new Response('Not Found', { status: 404 })
}

export async function GET(
  request: Request,
  context: { params: Promise<{ path: string[] }> }
) {
  const { path } = await context.params
  const admin = getDb()

  // GET /v1/devices/{device}/registrations/{passType}?passesUpdatedSince=...
  if (path[0] === 'devices' && path[2] === 'registrations') {
    const deviceId = path[1]!
    const since = new URL(request.url).searchParams.get('passesUpdatedSince')

    const { data: registrations } = await admin
      .from('wallet_registrations')
      .select('serial_number, customers:customer_id (updated_at)')
      .eq('device_id', deviceId)
      .eq('platform', 'apple')

    const rows = (registrations ?? []).map((row) => ({
      serial: row.serial_number as string,
      updatedAt: (row.customers as unknown as { updated_at: string } | null)?.updated_at ?? null,
    }))

    const sinceMs = since ? Number(since) : 0
    const changed = rows.filter(
      (row) => !sinceMs || (row.updatedAt && new Date(row.updatedAt).getTime() > sinceMs)
    )

    if (changed.length === 0) return new Response(null, { status: 204 })

    const lastUpdated = Math.max(
      ...changed.map((row) => (row.updatedAt ? new Date(row.updatedAt).getTime() : Date.now()))
    )

    return Response.json({
      serialNumbers: changed.map((row) => row.serial),
      lastUpdated: String(lastUpdated),
    })
  }

  // GET /v1/passes/{passType}/{serial} — device re-fetching an updated pass.
  if (path[0] === 'passes' && path.length === 3) {
    const serial = path[2]!
    if (!(await authorizePass(request, serial))) {
      return new Response('Unauthorized', { status: 401 })
    }

    // Re-issue through the signed-token endpoint so pass building lives in one
    // place. A short TTL is enough: the device follows the redirect immediately.
    const { signToken } = await import('@/lib/crypto')
    const { env } = await import('@/lib/env')
    const token = signToken('card', { c: serial }, 300)
    return Response.redirect(`${env.appUrl}/api/v1/wallet/apple/${token}`, 302)
  }

  return new Response('Not Found', { status: 404 })
}
