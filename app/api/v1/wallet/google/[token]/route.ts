import { verifyToken } from '@/lib/crypto'
import { env } from '@/lib/env'
import { error } from '@/lib/http'
import { logger } from '@/lib/logger'
import { googleObjectId } from '@/lib/wallet/google-loyalty-jwt'
import { markGoogleWalletSaved } from '@/lib/wallet/google-sync'
import { walletService } from '@/lib/wallet/service'
import { isValidLatLng } from '@/lib/wallet/geo'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Redirects to Google Wallet's save flow with a signed JWT.
 *
 * The pass content — balance, tier, offers and the store locations that make it
 * surface when the customer is nearby — comes from the wallet service, the same
 * source the Apple route uses, so the two cards can never describe different
 * programs.
 *
 * Records the object id so the sync service can keep the balance live afterwards;
 * without this the card would freeze at its enrolment value.
 */
export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params

  const payload = verifyToken<{ c: string }>('card', token)
  if (!payload?.c) return error('This wallet link is invalid or has expired', 403, 'forbidden')

  const service = walletService()
  const issuerId = env.google.issuerId
  if (!issuerId || !service.provider('google')?.status().configured) {
    return error('Google Wallet is not configured', 503, 'not_configured')
  }

  try {
    // A customer saving from the card page has usually just granted location, so
    // the nearest store is ordered first — which matters because Google caps the
    // number of locations it accepts on one object.
    const artifact = await service.issue('google', payload.c, { near: positionFrom(request) })
    if (artifact.kind !== 'redirect') {
      return error('Could not generate the Google Wallet pass', 500, 'internal_error')
    }

    await markGoogleWalletSaved(payload.c, googleObjectId(payload.c, issuerId))

    return Response.redirect(artifact.url, 302)
  } catch (cause) {
    logger.error('wallet.google_save_failed', { customerId: payload.c, cause })
    return error('Could not generate the Google Wallet pass', 500, 'internal_error')
  }
}

function positionFrom(request: Request): { lat: number; lng: number } | null {
  const url = new URL(request.url)
  const candidate = {
    lat: Number(url.searchParams.get('lat')),
    lng: Number(url.searchParams.get('lng')),
  }
  return isValidLatLng(candidate) ? candidate : null
}
