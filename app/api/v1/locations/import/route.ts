import { defineRoute } from '@/lib/api/handler'
import { importLocationsSchema } from '@/lib/api/wallet-schemas'
import { recordAudit } from '@/lib/audit'
import { measureLimit } from '@/lib/billing/entitlements'
import { unprocessable } from '@/lib/errors'
import { importLocations, type LocationInput } from '@/lib/wallet/locations'
import { scheduleBusinessWalletSync } from '@/lib/wallet/sync'

export const runtime = 'nodejs'

/**
 * Bulk location import.
 *
 * A chain arriving from a spreadsheet is the whole point: typing forty stores into
 * a form is how a migration stalls. The import is idempotent on `externalRef` (or
 * on name, when no ref is given), so re-uploading a corrected file updates rows
 * rather than doubling the estate — the single most common way this goes wrong.
 *
 * The plan cap is checked against the *resulting* count rather than per row, so a
 * merchant learns their 40-store file needs Business before any of it is written,
 * instead of getting 15 stores and an error.
 */
export const POST = defineRoute(
  {
    name: 'locations.import',
    auth: 'required',
    body: importLocationsSchema,
    businessIdFrom: { source: 'body', key: 'businessId' },
    permissions: ['locations:write'],
    feature: 'multi_location',
    rateLimit: 'dashboard',
  },
  async ({ body, business, actor, request }) => {
    const status = await measureLimit(business.businessId, 'locations')
    if (status.allowed !== null) {
      // Existing rows may be updated rather than added, so this is an upper bound.
      // Refusing on the upper bound is the honest call: telling a merchant an
      // import "might" exceed their plan and letting it half-apply is worse.
      const projected = status.used + body.locations.length
      if (projected > status.allowed) {
        throw unprocessable(
          `This file could create up to ${projected.toLocaleString()} locations and your plan includes ${status.allowed.toLocaleString()}. Upgrade first, or split the file.`
        )
      }
    }

    const result = await importLocations(
      business.businessId,
      body.locations as LocationInput[]
    )

    await recordAudit({
      businessId: business.businessId,
      actor,
      action: 'location.imported',
      resourceType: 'location',
      resourceId: business.businessId,
      summary: `Imported locations: ${result.created} created, ${result.updated} updated, ${result.errors.length} failed`,
      request,
    })

    if (result.created > 0 || result.updated > 0) {
      await scheduleBusinessWalletSync(business.businessId, 'locations_changed')
    }

    return result
  }
)
