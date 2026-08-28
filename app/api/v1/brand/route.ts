import { defineRoute } from '@/lib/api/handler'
import { businessIdSchema } from '@/lib/api/schemas'
import { brandKitPatchSchema, payloadOf } from '@/lib/api/wallet-schemas'
import { getBrandKit, updateBrandKit } from '@/lib/brand/store'
import { scheduleBusinessWalletSync } from '@/lib/wallet/sync'
import { recordAudit } from '@/lib/audit'
import { notFound } from '@/lib/errors'
import { storage } from '@/lib/storage'

export const runtime = 'nodejs'

/**
 * The merchant's brand kit.
 *
 * One identity, read by the wallet card, the public join page, the browser card,
 * transactional email and campaigns. Before this route existed the brand was
 * only editable through `PATCH /businesses/:id`, which knew about four of the
 * fourteen columns a brand actually has — so `description`, `secondary_color`,
 * `facebook` and `tiktok` were created by migration 21 and then unreachable.
 *
 * Why it is a route of its own rather than more fields on the business patch:
 * the business record is settings (currency, timezone, locale, billing email)
 * and the brand is identity. They are edited by different people on different
 * screens at different times, and a change to the brand has a consequence a
 * change to the timezone does not — it repaints every card already installed on
 * a customer's phone, which is why this route schedules a wallet sync and that
 * one does not.
 */

export const GET = defineRoute(
  {
    name: 'brand.read',
    auth: 'required',
    query: businessIdSchema,
    businessIdFrom: { source: 'query', key: 'businessId' },
    permissions: ['settings:read'],
    rateLimit: 'dashboard',
  },
  async ({ business }) => {
    const brand = await getBrandKit(business.businessId)
    if (!brand) throw notFound('Business')

    return {
      brand,
      /*
       * Whether an upload will actually work on this deployment. The logo field
       * renders a file picker when true and a URL field when false — a picker
       * that always fails is worse than asking for a link, because the merchant
       * blames their file.
       */
      uploads: { enabled: storage().isConfigured() },
    }
  }
)

/**
 * Fields whose change is visible on a card that is already in a wallet.
 *
 * A merchant who fixes their phone number does not need 4,000 devices woken up;
 * a merchant who changes their primary colour absolutely does, because until the
 * push lands their customers are holding the old brand.
 */
const AFFECTS_INSTALLED_PASSES = [
  'name',
  'logoUrl',
  'primaryColor',
  'accentColor',
  'textColor',
] as const

export const PATCH = defineRoute(
  {
    name: 'brand.update',
    auth: 'required',
    body: brandKitPatchSchema,
    businessIdFrom: { source: 'body', key: 'businessId' },
    permissions: ['settings:write'],
    rateLimit: 'dashboard',
  },
  async ({ body, business, actor, request }) => {
    const patch = payloadOf(body)
    const brand = await updateBrandKit(business.businessId, patch)
    if (!brand) throw notFound('Business')

    const changed = Object.keys(patch)

    await recordAudit({
      businessId: business.businessId,
      actor,
      action: 'brand.updated',
      resourceType: 'business',
      resourceId: business.businessId,
      summary: `Updated brand: ${changed.join(', ')}`,
      request,
    })

    if (AFFECTS_INSTALLED_PASSES.some((field) => field in patch)) {
      await scheduleBusinessWalletSync(business.businessId, 'settings_changed')
    }

    return { brand }
  }
)
