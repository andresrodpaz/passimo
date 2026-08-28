import QRCode from 'qrcode'
import { error } from '@/lib/http'
import { env } from '@/lib/env'

export const runtime = 'nodejs'

/**
 * QR code renderer.
 *
 * Server-rendered PNG so merchants can download something print-ready, and so
 * the code appears instantly rather than after a client bundle loads.
 *
 * Only encodes URLs on this deployment's own origin: an open QR generator is a
 * free phishing-image host that would eventually get the domain blocklisted.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const data = params.get('data')
  const size = Math.min(2048, Math.max(128, Number(params.get('size') ?? 512)))
  const download = params.get('download') === '1'

  if (!data) return error('Missing data parameter', 400)

  let target: URL
  try {
    target = new URL(data)
  } catch {
    return error('data must be an absolute URL', 400)
  }

  const allowedOrigin = new URL(env.appUrl).origin
  if (target.origin !== allowedOrigin) {
    return error('QR codes can only be generated for this application', 403, 'forbidden')
  }

  const png = await QRCode.toBuffer(target.toString(), {
    type: 'png',
    width: size,
    // High correction survives being printed, laminated and scanned in a
    // badly lit café.
    errorCorrectionLevel: 'H',
    margin: 2,
    color: { dark: '#000000ff', light: '#ffffffff' },
  })

  return new Response(new Uint8Array(png), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400, immutable',
      ...(download ? { 'Content-Disposition': 'attachment; filename="qr-code.png"' } : {}),
    },
  })
}
