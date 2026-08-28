import { storage } from '@/lib/storage'
import { LocalStorageDriver, verifyStorageToken } from '@/lib/storage/local'
import { assertSafeKey } from '@/lib/storage/types'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'

/**
 * Serves objects held by the local storage driver.
 *
 * Only reachable for that driver: with S3 the signed URL points at the bucket
 * and this route is never in the path, which is the point — an object store
 * should not be proxied through the application.
 *
 * Two access modes, and the distinction is the whole security model here:
 *
 *   * A `token` query parameter is an HMAC over the key and an expiry. Required
 *     for anything private, and the *only* way to read a GDPR export.
 *   * No token serves the object only if it was stored as public — merchant
 *     logos and campaign images, which appear in emails and wallet passes where
 *     a signature could not survive.
 *
 * Written as a raw handler rather than through `defineRoute` because it returns
 * bytes with cache headers, and the wrapper is built for JSON.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ key: string[] }> }
): Promise<Response> {
  const { key: segments } = await context.params
  const key = segments.join('/')

  try {
    assertSafeKey(key)
  } catch {
    return new Response('Not found', { status: 404 })
  }

  const driver = storage()
  if (!(driver instanceof LocalStorageDriver)) {
    /*
     * A signed URL issued while the local driver was active, opened after the
     * deployment switched to S3. 404 rather than a redirect: the object is not
     * here, and guessing a bucket URL for it would leak the layout.
     */
    return new Response('Not found', { status: 404 })
  }

  const url = new URL(request.url)
  const token = url.searchParams.get('token')

  const object = await driver.get(key)
  if (!object) return new Response('Not found', { status: 404 })

  const isPublic = (await driver.metadata(key))?.public === true

  if (!isPublic) {
    if (!token || !verifyStorageToken(key, token)) {
      logger.warn('files.unauthorised_access', { key: key.slice(0, 120) })
      return new Response('Unauthorized', { status: 401 })
    }
  }

  return new Response(new Uint8Array(object.body), {
    status: 200,
    headers: {
      'Content-Type': object.contentType,
      'Content-Length': String(object.body.byteLength),
      /*
       * Public objects are content-addressed in practice (a logo changes key when
       * it changes), so a long immutable cache is safe and keeps logos out of the
       * request path for wallet passes and email clients. Private objects are
       * never cached by anything in between.
       */
      'Cache-Control': isPublic
        ? 'public, max-age=31536000, immutable'
        : 'private, no-store',
      // Never let a stored file be interpreted as a document on our origin.
      'Content-Disposition': isPublic ? 'inline' : `attachment; filename="${basename(key)}"`,
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

function basename(key: string): string {
  return key.split('/').pop()?.replace(/["\\]/g, '') ?? 'download'
}

export const dynamic = 'force-dynamic'
