import 'server-only'
import { createHash, createHmac } from 'node:crypto'
import {
  StorageNotConfiguredError,
  assertSafeKey,
  type SignedUrl,
  type StorageDriver,
  type StoredObject,
} from '@/lib/storage/types'

/**
 * S3-compatible object storage.
 *
 * Speaks the S3 REST API with hand-written SigV4 rather than pulling in an SDK.
 * That is a deliberate trade:
 *
 *   + No dependency. `@aws-sdk/client-s3` and its transitive tree add tens of
 *     megabytes to an image whose entire purpose here is four HTTP verbs, and
 *     this application ships as a standalone bundle where every dependency is
 *     also a supply-chain surface.
 *   + Works unchanged against S3, Cloudflare R2, Backblaze B2, MinIO, DigitalOcean
 *     Spaces and Railway's own bucket offering, because SigV4 plus a custom
 *     endpoint is the whole compatibility story.
 *   − SigV4 has to be correct. It is ~70 lines, it is fully specified, and
 *     `tests/unit/s3-signing.test.ts` checks the canonical request and the signing
 *     key against AWS's published example vectors.
 *
 * Configuration (see .env.example):
 *   STORAGE_S3_BUCKET, STORAGE_S3_REGION, STORAGE_S3_ACCESS_KEY_ID,
 *   STORAGE_S3_SECRET_ACCESS_KEY, and STORAGE_S3_ENDPOINT for non-AWS providers.
 */
export class S3StorageDriver implements StorageDriver {
  readonly name = 's3' as const

  private get bucket(): string | null {
    return process.env.STORAGE_S3_BUCKET?.trim() || null
  }
  private get region(): string {
    return process.env.STORAGE_S3_REGION?.trim() || 'us-east-1'
  }
  private get accessKeyId(): string | null {
    return process.env.STORAGE_S3_ACCESS_KEY_ID?.trim() || null
  }
  private get secretAccessKey(): string | null {
    return process.env.STORAGE_S3_SECRET_ACCESS_KEY?.trim() || null
  }
  /** Custom endpoint for non-AWS providers, e.g. `https://<id>.r2.cloudflarestorage.com`. */
  private get endpoint(): string | null {
    return process.env.STORAGE_S3_ENDPOINT?.trim().replace(/\/$/, '') || null
  }
  /**
   * Public base URL for objects stored with `public: true` — a CDN or an R2
   * custom domain. Without one, public objects fall back to signed URLs, because
   * guessing a bucket's public hostname is how a deployment ends up serving
   * broken images.
   */
  private get publicBaseUrl(): string | null {
    return process.env.STORAGE_S3_PUBLIC_URL?.trim().replace(/\/$/, '') || null
  }

  isConfigured(): boolean {
    return Boolean(this.bucket && this.accessKeyId && this.secretAccessKey)
  }

  private requireConfig(): {
    bucket: string
    region: string
    accessKeyId: string
    secretAccessKey: string
    host: string
    baseUrl: string
  } {
    const { bucket, accessKeyId, secretAccessKey, region, endpoint } = this
    if (!bucket || !accessKeyId || !secretAccessKey) {
      throw new StorageNotConfiguredError(
        'set STORAGE_S3_BUCKET, STORAGE_S3_ACCESS_KEY_ID and STORAGE_S3_SECRET_ACCESS_KEY'
      )
    }

    /*
     * Path-style addressing (`endpoint/bucket/key`) for custom endpoints and
     * virtual-hosted style (`bucket.s3.region.amazonaws.com/key`) for AWS. Every
     * S3-compatible provider supports path style; AWS is deprecating it, so each
     * gets the form it actually wants.
     */
    const baseUrl = endpoint
      ? `${endpoint}/${bucket}`
      : `https://${bucket}.s3.${region}.amazonaws.com`

    return {
      bucket,
      region,
      accessKeyId,
      secretAccessKey,
      host: new URL(baseUrl).host,
      baseUrl,
    }
  }

  async put(input: {
    key: string
    body: Buffer
    contentType?: string
    public?: boolean
  }): Promise<StoredObject> {
    assertSafeKey(input.key)
    const config = this.requireConfig()
    const contentType = input.contentType ?? 'application/octet-stream'

    const url = `${config.baseUrl}/${encodeKey(input.key)}`
    const payloadHash = sha256Hex(input.body)

    const headers: Record<string, string> = {
      host: config.host,
      'content-type': contentType,
      'x-amz-content-sha256': payloadHash,
    }
    if (input.public) headers['x-amz-acl'] = 'public-read'

    const signed = signRequest({
      method: 'PUT',
      url,
      headers,
      payloadHash,
      region: config.region,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    })

    const response = await fetch(url, {
      method: 'PUT',
      headers: signed,
      body: new Uint8Array(input.body),
    })

    if (!response.ok) {
      throw new Error(
        `S3 upload failed (${response.status}): ${(await response.text()).slice(0, 300)}`
      )
    }

    return { key: input.key, size: input.body.byteLength, contentType }
  }

  async get(key: string): Promise<{ body: Buffer; contentType: string } | null> {
    assertSafeKey(key)
    const config = this.requireConfig()
    const url = `${config.baseUrl}/${encodeKey(key)}`
    const payloadHash = sha256Hex(Buffer.alloc(0))

    const signed = signRequest({
      method: 'GET',
      url,
      headers: { host: config.host, 'x-amz-content-sha256': payloadHash },
      payloadHash,
      region: config.region,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    })

    const response = await fetch(url, { headers: signed })
    if (response.status === 404) return null
    if (!response.ok) {
      throw new Error(`S3 get failed (${response.status})`)
    }

    return {
      body: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get('content-type') ?? 'application/octet-stream',
    }
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key)
    const config = this.requireConfig()
    const url = `${config.baseUrl}/${encodeKey(key)}`
    const payloadHash = sha256Hex(Buffer.alloc(0))

    const signed = signRequest({
      method: 'DELETE',
      url,
      headers: { host: config.host, 'x-amz-content-sha256': payloadHash },
      payloadHash,
      region: config.region,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    })

    const response = await fetch(url, { method: 'DELETE', headers: signed })
    // 404 is success for a delete: the object is not there, which is the goal.
    if (!response.ok && response.status !== 404) {
      throw new Error(`S3 delete failed (${response.status})`)
    }
  }

  async signedUrl(key: string, ttlSeconds: number): Promise<SignedUrl> {
    assertSafeKey(key)
    const config = this.requireConfig()

    /*
     * SigV4 caps a presigned URL at seven days. A GDPR export asks for exactly
     * seven, so clamping rather than erroring keeps that flow working at the
     * limit instead of one second past it.
     */
    const ttl = Math.min(Math.max(1, Math.floor(ttlSeconds)), 604_800)

    const url = presignUrl({
      method: 'GET',
      url: `${config.baseUrl}/${encodeKey(key)}`,
      host: config.host,
      region: config.region,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      expiresIn: ttl,
    })

    return { url, expiresAt: new Date(Date.now() + ttl * 1000).toISOString() }
  }

  publicUrl(key: string): string {
    assertSafeKey(key)
    const base = this.publicBaseUrl
    if (base) return `${base}/${encodeKey(key)}`
    return `${this.requireConfig().baseUrl}/${encodeKey(key)}`
  }
}

// ---------------------------------------------------------------------------
// SigV4
// ---------------------------------------------------------------------------

const SERVICE = 's3'
const ALGORITHM = 'AWS4-HMAC-SHA256'

function sha256Hex(input: Buffer | string): string {
  return createHash('sha256').update(input).digest('hex')
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest()
}

/**
 * Percent-encodes a key for a URL path, keeping `/` as a separator.
 *
 * `encodeURIComponent` would escape the slashes and turn `logos/abc.png` into one
 * object literally named with a slash in it; `encodeURI` would leave `+` and `?`
 * unescaped, which SigV4 canonicalisation then disagrees with.
 */
function encodeKey(key: string): string {
  return key
    .split('/')
    .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (c) =>
      `%${c.charCodeAt(0).toString(16).toUpperCase()}`
    ))
    .join('/')
}

function amzDate(now = new Date()): { long: string; short: string } {
  const long = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  return { long, short: long.slice(0, 8) }
}

function signingKey(input: {
  secretAccessKey: string
  dateStamp: string
  region: string
}): Buffer {
  const dateKey = hmac(`AWS4${input.secretAccessKey}`, input.dateStamp)
  const regionKey = hmac(dateKey, input.region)
  const serviceKey = hmac(regionKey, SERVICE)
  return hmac(serviceKey, 'aws4_request')
}

/** Signs a request with `Authorization`, for PUT/GET/DELETE. */
function signRequest(input: {
  method: string
  url: string
  headers: Record<string, string>
  payloadHash: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  now?: Date
}): Record<string, string> {
  const { long, short } = amzDate(input.now)
  const parsed = new URL(input.url)

  const headers: Record<string, string> = { ...input.headers, 'x-amz-date': long }

  const sortedNames = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort()
  const canonicalHeaders = sortedNames
    .map((name) => `${name}:${String(headers[findKey(headers, name)!]).trim()}\n`)
    .join('')
  const signedHeaders = sortedNames.join(';')

  const canonicalRequest = [
    input.method,
    parsed.pathname,
    canonicalQuery(parsed),
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join('\n')

  const scope = `${short}/${input.region}/${SERVICE}/aws4_request`
  const stringToSign = [ALGORITHM, long, scope, sha256Hex(canonicalRequest)].join('\n')

  const signature = createHmac(
    'sha256',
    signingKey({ secretAccessKey: input.secretAccessKey, dateStamp: short, region: input.region })
  )
    .update(stringToSign, 'utf8')
    .digest('hex')

  return {
    ...headers,
    Authorization:
      `${ALGORITHM} Credential=${input.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  }
}

/** Builds a presigned URL, for links handed to a browser or an email client. */
function presignUrl(input: {
  method: string
  url: string
  host: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  expiresIn: number
  now?: Date
}): string {
  const { long, short } = amzDate(input.now)
  const parsed = new URL(input.url)
  const scope = `${short}/${input.region}/${SERVICE}/aws4_request`

  parsed.searchParams.set('X-Amz-Algorithm', ALGORITHM)
  parsed.searchParams.set('X-Amz-Credential', `${input.accessKeyId}/${scope}`)
  parsed.searchParams.set('X-Amz-Date', long)
  parsed.searchParams.set('X-Amz-Expires', String(input.expiresIn))
  parsed.searchParams.set('X-Amz-SignedHeaders', 'host')

  const canonicalRequest = [
    input.method,
    parsed.pathname,
    canonicalQuery(parsed),
    `host:${input.host}\n`,
    'host',
    // The literal string, not a hash: presigned URLs carry no body.
    'UNSIGNED-PAYLOAD',
  ].join('\n')

  const stringToSign = [ALGORITHM, long, scope, sha256Hex(canonicalRequest)].join('\n')

  const signature = createHmac(
    'sha256',
    signingKey({ secretAccessKey: input.secretAccessKey, dateStamp: short, region: input.region })
  )
    .update(stringToSign, 'utf8')
    .digest('hex')

  parsed.searchParams.set('X-Amz-Signature', signature)
  return parsed.toString()
}

/**
 * Canonical query string: parameters sorted by name, each key and value
 * percent-encoded with RFC 3986 rules. `URLSearchParams.toString()` uses form
 * encoding (space as `+`), which SigV4 rejects.
 */
function canonicalQuery(url: URL): string {
  const pairs: Array<[string, string]> = []
  url.searchParams.forEach((value, key) => pairs.push([key, value]))
  pairs.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])))
  return pairs
    .map(([key, value]) => `${rfc3986(key)}=${rfc3986(value)}`)
    .join('&')
}

function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  )
}

function findKey(record: Record<string, string>, lowered: string): string | undefined {
  return Object.keys(record).find((key) => key.toLowerCase() === lowered)
}

/** Exported for the signing tests, which check against AWS's published vectors. */
export const __sigv4 = { signRequest, presignUrl, signingKey, canonicalQuery, encodeKey, sha256Hex }
