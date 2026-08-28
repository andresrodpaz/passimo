import { createHash } from 'node:crypto'
import { defineRoute } from '@/lib/api/handler'
import { businessIdSchema } from '@/lib/api/schemas'
import { badRequest, payloadTooLarge, unprocessable } from '@/lib/errors'
import { checkLogo, MAX_LOGO_BYTES } from '@/lib/brand/logo'
import { storage, storageKeys } from '@/lib/storage'
import { updateBrandKit } from '@/lib/brand/store'
import { scheduleBusinessWalletSync } from '@/lib/wallet/sync'
import { recordAudit } from '@/lib/audit'

export const runtime = 'nodejs'

/**
 * Logo upload.
 *
 * The product rule this exists to satisfy is blunt: *a merchant must be able to
 * put their own logo on their customers' loyalty card without a developer.*
 * Before this route, `businesses.logo_url` could only be set to a URL the
 * merchant already had hosted somewhere, and `storageKeys.businessLogo` — the
 * key layout for exactly this file — was written and never called by anything.
 * The Brand screen offered a text field for a URL, which is a developer's answer
 * to a café owner's question.
 *
 * Three decisions worth stating:
 *
 *   * **The bytes decide the type, not the client.** A multipart part's
 *     `Content-Type` is written by whoever posted it. This route sniffs the magic
 *     number and stores the type it found, because the file is later served back
 *     from our own origin with that type on it.
 *   * **The key is a content hash.** Public objects are served `immutable` and
 *     end up cached by Apple, Google and every mail client, none of which we can
 *     purge. A stable `logo.png` would mean a merchant who changes their logo
 *     keeps showing the old one on installed cards.
 *   * **The old object is not deleted.** A pass generated an hour ago still
 *     references it, and reclaiming a few kilobytes is not worth a broken image
 *     on a customer's phone. Orphans are a housekeeping problem, not a request
 *     path problem.
 *
 * Written with `raw: false` but no `body` schema: the wrapper only reads the body
 * when a schema asks it to, so `request.formData()` here still sees the stream.
 */
export const POST = defineRoute(
  {
    name: 'brand.logo.upload',
    auth: 'required',
    query: businessIdSchema,
    businessIdFrom: { source: 'query', key: 'businessId' },
    permissions: ['settings:write'],
    rateLimit: 'upload',
  },
  async ({ request, business, actor }) => {
    const driver = storage()
    if (!driver.isConfigured()) {
      throw unprocessable('File storage is not configured on this deployment')
    }

    /*
     * Check the declared length before reading. A 40 MB body still costs the
     * transfer, but refusing it here avoids buffering it into the process, which
     * is what turns a large upload into a memory incident rather than a 413.
     */
    const declared = Number(request.headers.get('content-length') ?? 0)
    if (declared > MAX_LOGO_BYTES * 2) throw payloadTooLarge()

    let form: FormData
    try {
      form = await request.formData()
    } catch {
      throw badRequest('Expected a multipart form upload')
    }

    const file = form.get('file')
    if (!(file instanceof Blob)) throw badRequest('Missing "file" part')
    if (file.size > MAX_LOGO_BYTES) throw payloadTooLarge()

    const bytes = new Uint8Array(await file.arrayBuffer())
    const check = checkLogo(bytes)
    if (!check.ok) {
      // The reason travels as a code so the dashboard can say it in the
      // merchant's language rather than echoing an English sentence from an API.
      throw unprocessable(`Logo rejected: ${check.reason}`, { reason: check.reason })
    }

    const fingerprint = createHash('sha256').update(bytes).digest('hex').slice(0, 16)
    const key = storageKeys.businessLogo(business.businessId, fingerprint, check.format.extension)

    await driver.put({
      key,
      body: Buffer.from(bytes),
      contentType: check.format.mime,
      // Public: a wallet pass and an email client fetch this with no session and
      // no way to carry a signature.
      public: true,
    })

    const logoUrl = driver.publicUrl(key)
    const brand = await updateBrandKit(business.businessId, { logoUrl })

    await recordAudit({
      businessId: business.businessId,
      actor,
      action: 'brand.logo_uploaded',
      resourceType: 'business',
      resourceId: business.businessId,
      summary: `Uploaded logo (${check.format.mime}, ${bytes.byteLength} bytes)`,
      request,
    })

    // Every installed card carries this image. A merchant who changes their logo
    // and sees the old one on their own phone concludes the product is broken.
    await scheduleBusinessWalletSync(business.businessId, 'settings_changed')

    return { logoUrl, brand }
  }
)
