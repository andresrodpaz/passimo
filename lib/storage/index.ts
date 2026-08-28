import 'server-only'
import { LocalStorageDriver } from '@/lib/storage/local'
import { S3StorageDriver } from '@/lib/storage/s3'
import { logger } from '@/lib/logger'
import type { StorageDriver } from '@/lib/storage/types'

/**
 * Driver selection.
 *
 * `STORAGE_DRIVER=local` (default) or `s3`. One variable, chosen at the edge of
 * the system, so no business logic anywhere in the product knows or cares where
 * a file physically lives.
 *
 * The default is `local` rather than "whichever is configured", because an
 * implicit fallback is how a production deployment quietly starts writing to a
 * container filesystem that vanishes on the next deploy. Choosing `s3` and
 * misconfiguring it fails loudly; not choosing it does not silently happen.
 */

let cached: StorageDriver | null = null

export function storage(): StorageDriver {
  if (cached) return cached

  const requested = process.env.STORAGE_DRIVER?.trim().toLowerCase() ?? 'local'

  if (requested === 's3') {
    const driver = new S3StorageDriver()
    if (!driver.isConfigured()) {
      /*
       * Warn and continue with the local driver rather than throwing at module
       * load. Uploads are not on the critical path for a merchant serving
       * customers, and taking the whole application down because a logo cannot
       * be stored is the wrong trade — the capability report surfaces it, and
       * `put` will report a clear error when someone actually uploads.
       */
      logger.error('storage.s3_not_configured', {
        detail: 'STORAGE_DRIVER=s3 but bucket or credentials are missing; using local disk',
      })
      cached = new LocalStorageDriver()
      return cached
    }
    cached = driver
    return cached
  }

  if (requested !== 'local') {
    logger.warn('storage.unknown_driver', { requested, using: 'local' })
  }

  cached = new LocalStorageDriver()
  return cached
}

/** Test seam. */
export function resetStorage(): void {
  cached = null
}

/**
 * Key layout. Centralised so the shape of the bucket is one decision rather than
 * a convention scattered across upload sites, and so every key is tenant-scoped
 * — an object path that does not name its business is an object nobody can
 * safely delete when that business leaves.
 */
export const storageKeys = {
  /**
   * A merchant logo, keyed by its own content.
   *
   * The `fingerprint` is a short digest of the bytes, and it is not decoration.
   * Public objects are served with `Cache-Control: immutable` and appear inside
   * wallet passes and email, where the caches are Apple's, Google's and every
   * mail client's — none of which we can purge. A fixed `logo.png` key means a
   * merchant who replaces their logo keeps showing the old one on their
   * customers' cards, possibly for a year, with no way to force a refresh.
   * Changing the key changes the URL, which is the only invalidation that
   * actually works across all of them.
   */
  businessLogo: (businessId: string, fingerprint: string, extension: string) =>
    `businesses/${businessId}/logo-${fingerprint}.${extension}`,
  /**
   * The card's hero/strip image — Apple's `strip.png`, Google's `heroImage`.
   *
   * Content-fingerprinted for exactly the reason the logo is: it is embedded in
   * installed passes behind caches we do not control.
   */
  businessHero: (businessId: string, fingerprint: string, extension: string) =>
    `businesses/${businessId}/hero-${fingerprint}.${extension}`,
  campaignImage: (businessId: string, campaignId: string, extension: string) =>
    `businesses/${businessId}/campaigns/${campaignId}.${extension}`,
  walletAsset: (businessId: string, name: string) =>
    `businesses/${businessId}/wallet/${name}`,
  gdprExport: (businessId: string, requestId: string) =>
    `gdpr-exports/${businessId}/${requestId}.json`,
  customerImport: (businessId: string, importId: string) =>
    `businesses/${businessId}/imports/${importId}.csv`,
} as const

export type { StorageDriver, StoredObject, SignedUrl } from '@/lib/storage/types'
export { StorageNotConfiguredError, assertSafeKey } from '@/lib/storage/types'
