import 'server-only'
import { mkdir, readFile, unlink, writeFile, stat } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { env } from '@/lib/env'
import { signToken, verifyToken } from '@/lib/crypto'
import { assertSafeKey, type SignedUrl, type StorageDriver, type StoredObject } from '@/lib/storage/types'

/**
 * Filesystem storage.
 *
 * The default, and the right default. In development it means uploads work with
 * no accounts, no keys and no network. In production it is a legitimate choice
 * whenever the platform provides a persistent volume — Railway does, and for a
 * product whose entire object corpus is a few hundred logos, a mounted disk is
 * simpler and cheaper than an object store.
 *
 * It is *not* the right choice on ephemeral filesystems (a scaled-out
 * deployment, or Railway without a volume attached), because each replica would
 * hold a different subset of the files. `docs/INFRASTRUCTURE.md` states that
 * plainly, and `lib/storage/s3.ts` is the answer when it applies.
 *
 * Signed URLs are real signatures, not obscurity: the token is an HMAC over the
 * key and an expiry, verified by the download route.
 */
export class LocalStorageDriver implements StorageDriver {
  readonly name = 'local' as const

  private readonly root: string

  constructor(root?: string) {
    this.root = resolve(process.cwd(), root ?? process.env.STORAGE_LOCAL_DIR?.trim() ?? '.uploads')
  }

  isConfigured(): boolean {
    return true
  }

  /**
   * Resolves a key to an absolute path, refusing anything outside the root.
   *
   * `assertSafeKey` already rejects `..`, but this is the check that actually
   * matters: it compares resolved paths, so a key that finds some other way out
   * (a symlink, an encoding trick, a future change to the pattern) still cannot
   * read `/etc/passwd`.
   */
  private pathFor(key: string): string {
    assertSafeKey(key)
    const path = resolve(this.root, key)
    if (path !== this.root && !path.startsWith(this.root + sep)) {
      throw new Error(`Storage key escapes the storage root: ${JSON.stringify(key)}`)
    }
    return path
  }

  async put(input: {
    key: string
    body: Buffer
    contentType?: string
    public?: boolean
  }): Promise<StoredObject> {
    const path = this.pathFor(input.key)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, input.body)

    /*
     * The content type is stored beside the object rather than guessed from the
     * extension on the way out. A logo uploaded as `logo` with no extension
     * still has to be served as `image/png`, and a bundle written as `.json` by
     * one code path and `.txt` by another must not change type.
     */
    await writeFile(`${path}.meta`, JSON.stringify({
      contentType: input.contentType ?? 'application/octet-stream',
      public: input.public ?? false,
    }))

    return {
      key: input.key,
      size: input.body.byteLength,
      contentType: input.contentType ?? 'application/octet-stream',
    }
  }

  async get(key: string): Promise<{ body: Buffer; contentType: string } | null> {
    const path = this.pathFor(key)
    try {
      const [body, meta] = await Promise.all([
        readFile(path),
        readFile(`${path}.meta`, 'utf8').catch(() => null),
      ])
      const parsed = meta ? (JSON.parse(meta) as { contentType?: string }) : null
      return { body, contentType: parsed?.contentType ?? 'application/octet-stream' }
    } catch {
      return null
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.pathFor(key))
      return true
    } catch {
      return false
    }
  }

  /**
   * The sidecar record written by `put`: content type and whether the object may
   * be served without a signature. Read by the download route to decide between
   * "cache this forever" and "prove you were given a link".
   */
  async metadata(key: string): Promise<{ contentType: string; public: boolean } | null> {
    try {
      const raw = await readFile(`${this.pathFor(key)}.meta`, 'utf8')
      const parsed = JSON.parse(raw) as { contentType?: string; public?: boolean }
      return {
        contentType: parsed.contentType ?? 'application/octet-stream',
        public: parsed.public === true,
      }
    } catch {
      return null
    }
  }

  async delete(key: string): Promise<void> {
    const path = this.pathFor(key)
    await Promise.all([
      unlink(path).catch(() => undefined),
      unlink(`${path}.meta`).catch(() => undefined),
    ])
  }

  async signedUrl(key: string, ttlSeconds: number): Promise<SignedUrl> {
    assertSafeKey(key)
    const token = signToken(STORAGE_TOKEN_PURPOSE, { key }, ttlSeconds)
    return {
      url: `${env.appUrl}/api/v1/files/${key}?token=${encodeURIComponent(token)}`,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    }
  }

  publicUrl(key: string): string {
    assertSafeKey(key)
    return `${env.appUrl}/api/v1/files/${key}`
  }
}

/**
 * Purpose scoping, so a storage token can never be replayed as an unsubscribe or
 * survey token — the same discipline every other capability URL in the product
 * follows.
 */
export const STORAGE_TOKEN_PURPOSE = 'storage'

/** Verifies a download token against the key it was issued for. */
export function verifyStorageToken(key: string, token: string): boolean {
  const payload = verifyToken<{ key: string }>(STORAGE_TOKEN_PURPOSE, token)
  return payload?.key === key
}

export { join as joinStoragePath }
