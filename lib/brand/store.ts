import 'server-only'
import { getDb } from '@/lib/db'
import {
  BRAND_KIT_COLUMNS,
  brandKitUpdate,
  mapBrandKit,
  type BrandKit,
  type BrandKitPatch,
} from '@/lib/brand/kit'

/**
 * Reads and writes the brand kit.
 *
 * The brand lives on `businesses` rather than in a table of its own, because it
 * *is* the business: name, logo and colours were already columns there and
 * splitting them out would have created the second source of truth migration 21
 * existed to remove.
 */

export async function getBrandKit(businessId: string): Promise<BrandKit | null> {
  const admin = getDb()
  const { data, error } = await admin
    .from('businesses')
    .select(BRAND_KIT_COLUMNS)
    .eq('id', businessId)
    .maybeSingle()

  if (error) throw error
  if (!data) return null
  return mapBrandKit(data)
}

export async function updateBrandKit(
  businessId: string,
  patch: BrandKitPatch
): Promise<BrandKit | null> {
  const update = brandKitUpdate(patch)

  // An empty patch is a no-op, not an error: the designer autosaves and can
  // legitimately have nothing to send.
  if (Object.keys(update).length > 0) {
    const admin = getDb()
    const { error } = await admin.from('businesses').update(update).eq('id', businessId)
    if (error) throw error
  }

  return getBrandKit(businessId)
}
