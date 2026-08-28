/**
 * The storage contract.
 *
 * Passimo stores three kinds of object: merchant logos and campaign images
 * (public, cached, small), wallet assets derived from those, and GDPR export
 * bundles (private, sensitive, time-limited). Nothing in the product needs more
 * than put/get/delete plus a URL that expires.
 *
 * Keeping the interface that small is what makes it genuinely portable. The
 * previous implementation reached straight into a hosted provider's SDK from the
 * GDPR module, so "where do files live" was a decision baked into business
 * logic. Here it is one environment variable.
 */

export type StoredObject = {
  key: string
  size: number
  contentType: string
}

export type SignedUrl = {
  url: string
  expiresAt: string
}

export interface StorageDriver {
  /** Stable identifier for logs and the capability report. */
  readonly name: 'local' | 's3'

  /** False when the driver needs configuration it does not have. */
  isConfigured(): boolean

  put(input: {
    key: string
    body: Buffer
    contentType?: string
    /** Objects safe to serve without a signature (logos, campaign images). */
    public?: boolean
  }): Promise<StoredObject>

  get(key: string): Promise<{ body: Buffer; contentType: string } | null>

  delete(key: string): Promise<void>

  /**
   * A URL the recipient can open, valid for `ttlSeconds`.
   *
   * Time-limited rather than public for everything private. A GDPR export bundle
   * is the most sensitive artefact this system produces — it is one subject's
   * entire record — and it is delivered by email, so the link is going to sit in
   * a mailbox. It has to stop working.
   */
  signedUrl(key: string, ttlSeconds: number): Promise<SignedUrl>

  /** Public URL, for objects stored with `public: true`. */
  publicUrl(key: string): string
}

export class StorageNotConfiguredError extends Error {
  constructor(detail: string) {
    super(`Storage is not configured: ${detail}`)
    this.name = 'StorageNotConfiguredError'
  }
}

/**
 * Rejects keys that could escape their prefix or collide with a path segment.
 *
 * Applies to both drivers, not just the filesystem one: `..` in an S3 key is
 * legal but produces an object nobody can find again, and a leading slash
 * produces a silently different key than the one the caller recorded.
 */
const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._\-/]*$/

export function assertSafeKey(key: string): void {
  if (!SAFE_KEY.test(key) || key.includes('..') || key.includes('//')) {
    throw new Error(`Unsafe storage key: ${JSON.stringify(key)}`)
  }
}
