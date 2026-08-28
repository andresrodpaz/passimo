import { verifyToken } from '@/lib/crypto'
import { error } from '@/lib/http'
import { logger } from '@/lib/logger'
import { isValidLatLng } from '@/lib/wallet/geo'
import { walletService } from '@/lib/wallet/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Serves the `.pkpass` file.
 *
 * The URL carries a signed, expiring capability token rather than a customer id:
 * an earlier version keyed off the raw UUID, which meant anyone who guessed or
 * harvested an id could download a pass containing that customer's name.
 *
 * Pass content comes from the wallet service, so the locations, offers and tier a
 * customer sees here are identical to what a Google Wallet user sees.
 */
export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params

  const payload = verifyToken<{ c: string }>('card', token)
  if (!payload?.c) return error('This wallet link is invalid or has expired', 403, 'forbidden')

  const service = walletService()
  if (!service.provider('apple')?.status().configured) {
    return error('Apple Wallet is not configured', 503, 'not_configured')
  }

  try {
    // When the card page has already asked for location, the nearest store is
    // ordered first — Apple embeds at most ten, and for a chain the ten that
    // matter are the ten near the customer.
    const artifact = await service.issue('apple', payload.c, { near: positionFrom(request) })
    if (artifact.kind !== 'file') {
      return error('Could not generate the wallet pass', 500, 'internal_error')
    }

    return new Response(artifact.body as BodyInit, {
      headers: {
        'Content-Type': artifact.contentType,
        'Content-Disposition': `attachment; filename="${artifact.filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (cause) {
    logger.error('wallet.apple_generation_failed', { customerId: payload.c, cause })
    return error('Could not generate the wallet pass', 500, 'internal_error')
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
