import 'server-only'
import { readFileSync } from 'node:fs'

/**
 * Centralised, validated environment access.
 *
 * Rules:
 * - Required variables fail fast at first use with an actionable message.
 * - Optional variables return `null` so callers can degrade gracefully
 *   (e.g. email disabled when Resend is not configured) instead of crashing.
 * - Nothing here is read at module scope, so builds never break on a missing
 *   secret; failures happen at request time on the code path that needs it.
 */

class MissingEnvError extends Error {
  constructor(name: string, hint?: string) {
    super(
      `Missing required environment variable ${name}.` +
        (hint ? ` ${hint}` : '') +
        ' See .env.example.'
    )
    this.name = 'MissingEnvError'
  }
}

function required(name: string, hint?: string): string {
  const value = process.env[name]
  if (!value || value.trim() === '') throw new MissingEnvError(name, hint)
  return value.trim()
}

function optional(name: string): string | null {
  const value = process.env[name]
  if (!value || value.trim() === '') return null
  return value.trim()
}

function bool(name: string, fallback = false): boolean {
  const value = optional(name)
  if (value === null) return fallback
  return value === 'true' || value === '1' || value === 'yes'
}

function int(name: string, fallback: number): number {
  const value = optional(name)
  if (value === null) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

/** First non-empty value among several names. Used for supported aliases. */
function firstOf(...names: string[]): string | null {
  for (const name of names) {
    const value = optional(name)
    if (value) return value
  }
  return null
}

/** PEM values are commonly stored with literal `\n`; normalise them. */
function pem(...names: string[]): string | null {
  const value = firstOf(...names)
  return value ? value.replace(/\\n/g, '\n') : null
}

/**
 * A certificate or key supplied either inline or as a path on disk.
 *
 * Both shapes are real deployment targets and neither is a fallback for the
 * other: Vercel and Fly hold secrets as environment values, while Docker,
 * Kubernetes and most on-premise installs mount them as files. Supporting only
 * inline PEM would force operators to inline a mounted secret by hand, which is
 * how private keys end up in shell history.
 *
 * A path that cannot be read returns `null` rather than throwing, so a
 * misconfigured certificate reports "Apple Wallet is not configured" — an
 * actionable 503 on the pass route — instead of crashing unrelated requests.
 */
const fileCache = new Map<string, string | null>()

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function pemOrFile(inlineNames: string[], pathNames: string[]): string | null {
  const inline = pem(...inlineNames)
  if (inline) return inline

  const path = firstOf(...pathNames)
  if (!path) return null

  if (fileCache.has(path)) return fileCache.get(path) ?? null
  let contents: string | null = null
  try {
    contents = readFileSync(path, 'utf8')
  } catch {
    contents = null
  }
  fileCache.set(path, contents)
  return contents
}

export const env = {
  get isProduction(): boolean {
    return process.env.NODE_ENV === 'production'
  },
  get appUrl(): string {
    const explicit = optional('NEXT_PUBLIC_APP_URL')
    if (explicit) return explicit.replace(/\/$/, '')
    const vercel = optional('VERCEL_URL')
    if (vercel) return `https://${vercel}`
    return 'http://localhost:3000'
  },

  /**
   * PostgreSQL.
   *
   * One variable, because that is the entire coupling to the database host.
   * Locally it points at the container in `docker-compose.yml`; on Railway it is
   * the value injected when a PostgreSQL service is attached; on any other
   * provider it is whatever they hand out. Nothing else in the application knows
   * where the database is.
   */
  database: {
    get url(): string {
      return required(
        'DATABASE_URL',
        'Development: `pnpm db:up` then postgresql://passimo:passimo@127.0.0.1:5433/passimo. ' +
          'Production: attach a PostgreSQL service in Railway.'
      )
    },
    /** `disable` | `require` | `verify`. Unset means "infer from the host". */
    get sslMode(): string | null {
      return optional('DATABASE_SSL')
    },
    get poolMax(): number {
      return int('DATABASE_POOL_MAX', 10)
    },
  },

  /**
   * Object storage for logos, campaign images, wallet assets and GDPR exports.
   *
   * `local` writes to disk — correct in development, and correct in production
   * whenever the platform provides a persistent volume. `s3` targets any
   * S3-compatible bucket. See docs/INFRASTRUCTURE.md for which to pick.
   */
  storage: {
    get driver(): 'local' | 's3' {
      return optional('STORAGE_DRIVER')?.toLowerCase() === 's3' ? 's3' : 'local'
    },
    get localDir(): string {
      return optional('STORAGE_LOCAL_DIR') ?? '.uploads'
    },
    get bucket(): string | null {
      return optional('STORAGE_S3_BUCKET')
    },
    get isConfigured(): boolean {
      if (this.driver === 'local') return true
      return Boolean(
        this.bucket &&
          optional('STORAGE_S3_ACCESS_KEY_ID') &&
          optional('STORAGE_S3_SECRET_ACCESS_KEY')
      )
    },
  },

  /**
   * Where a human can reach a human.
   *
   * Both optional, and both *absent by default on purpose*. Until a mailbox
   * exists, rendering `mailto:hello@passimo.app` puts a link on the pricing page
   * and in the footer that silently goes nowhere — the worst kind of broken,
   * because the sender believes they have made contact. The UI hides the link
   * rather than offering a channel that does not answer.
   *
   * Not `NEXT_PUBLIC_`: these are read server-side and passed to the components
   * that need them, so the addresses are not sitting in the client bundle for a
   * scraper to harvest.
   */
  contact: {
    get support(): string | null {
      return optional('SUPPORT_EMAIL')
    },
    get sales(): string | null {
      return optional('SALES_EMAIL') ?? optional('SUPPORT_EMAIL')
    },
  },

  security: {
    /** Signing key for unsubscribe links, survey links and wallet auth tokens. */
    get tokenSecret(): string {
      return required(
        'APP_TOKEN_SECRET',
        'Generate with: openssl rand -base64 48'
      )
    },
    /**
     * Signing key for session cookies.
     *
     * Falls back to `APP_TOKEN_SECRET` so an existing deployment does not have to
     * mint a second secret to keep working. Rotating either one invalidates every
     * outstanding session — which is the intended emergency control.
     */
    get sessionSecret(): string {
      return (
        optional('AUTH_SESSION_SECRET') ??
        required(
          'APP_TOKEN_SECRET',
          'AUTH_SESSION_SECRET is preferred. Generate with: openssl rand -base64 48'
        )
      )
    },
    get cronSecret(): string | null {
      return optional('CRON_SECRET')
    },
    get walletWebhookSecret(): string | null {
      return optional('APPLE_WALLET_WEBHOOK_SECRET')
    },
  },

  email: {
    get apiKey(): string | null {
      return optional('RESEND_API_KEY')
    },
    get from(): string {
      return optional('RESEND_FROM_EMAIL') ?? 'Passimo <onboarding@resend.dev>'
    },
    get replyTo(): string | null {
      return optional('RESEND_REPLY_TO')
    },
  },

  sms: {
    get accountSid(): string | null {
      return optional('TWILIO_ACCOUNT_SID')
    },
    get authToken(): string | null {
      return optional('TWILIO_AUTH_TOKEN')
    },
    get from(): string | null {
      return optional('TWILIO_SMS_FROM')
    },
  },

  whatsapp: {
    get phoneNumberId(): string | null {
      return optional('WHATSAPP_PHONE_NUMBER_ID')
    },
    get accessToken(): string | null {
      return optional('WHATSAPP_ACCESS_TOKEN')
    },
    get apiVersion(): string {
      return optional('WHATSAPP_API_VERSION') ?? 'v21.0'
    },
  },

  webPush: {
    get publicKey(): string | null {
      return optional('NEXT_PUBLIC_VAPID_PUBLIC_KEY')
    },
    get privateKey(): string | null {
      return optional('VAPID_PRIVATE_KEY')
    },
    get subject(): string {
      /*
       * VAPID requires a contact so a push service can reach the sender about a
       * misbehaving subscription. Prefer the configured support address; the
       * literal fallback is only reached when web push is enabled and neither is
       * set, and it is better than an empty subject (which some push services
       * reject outright).
       */
      const support = optional('SUPPORT_EMAIL')
      return optional('VAPID_SUBJECT') ?? (support ? `mailto:${support}` : 'mailto:support@passimo.app')
    },
  },

  /**
   * Apple Wallet.
   *
   * Certificates may be supplied inline (`*_PEM`) or as mounted file paths
   * (`*_PATH`). `APPLE_TEAM_ID` is the documented name; `APPLE_TEAM_IDENTIFIER`
   * is accepted because earlier deployments of this app used it and silently
   * breaking their passes on upgrade is not an acceptable trade.
   */
  apple: {
    get teamId(): string | null {
      return firstOf('APPLE_TEAM_ID', 'APPLE_TEAM_IDENTIFIER')
    },
    get passTypeId(): string | null {
      return optional('APPLE_PASS_TYPE_IDENTIFIER')
    },
    get wwdrCert(): string | null {
      return pemOrFile(['APPLE_WWDR_CERT_PEM'], ['APPLE_WWDR_CERTIFICATE_PATH'])
    },
    get signerCert(): string | null {
      return pemOrFile(
        ['APPLE_SIGNER_CERT_PEM', 'APPLE_SIGNING_CERTIFICATE_PEM'],
        ['APPLE_SIGNING_CERTIFICATE_PATH']
      )
    },
    get signerKey(): string | null {
      return pemOrFile(
        ['APPLE_SIGNER_KEY_PEM', 'APPLE_SIGNING_PRIVATE_KEY_PEM'],
        ['APPLE_SIGNING_PRIVATE_KEY_PATH']
      )
    },
    get signerKeyPassphrase(): string | null {
      return firstOf('APPLE_SIGNING_KEY_PASSWORD', 'APPLE_SIGNER_KEY_PASSPHRASE')
    },
    get pushKeyP8(): string | null {
      return pemOrFile(['APPLE_PUSH_KEY_P8'], ['APPLE_PUSH_KEY_PATH'])
    },
    get pushKeyId(): string | null {
      return optional('APPLE_PUSH_KEY_ID')
    },
    get pushProduction(): boolean {
      return bool('APNS_PRODUCTION', false)
    },
    /**
     * `organizationName` on the pass. Falls back per-business at render time —
     * a merchant's own name is always the better label — so this is only the
     * value used when a business has not set one.
     */
    get organizationName(): string | null {
      return optional('APPLE_WALLET_ORGANIZATION_NAME')
    },
    /**
     * The URL devices call to fetch pass updates. Derived from `appUrl` by
     * default, because getting these two out of sync is the single most common
     * reason a pass installs and then never updates again.
     */
    get webServiceUrl(): string {
      const explicit = optional('APPLE_WALLET_WEB_SERVICE_URL')
      return (explicit ?? `${env.appUrl}/api/v1/wallet/apple`).replace(/\/$/, '')
    },
    /**
     * Shared fallback authentication token for the pass web service.
     *
     * Per-customer tokens are generated and stored on `customers`; this exists
     * only for operators who front the web service with a gateway that expects a
     * fixed credential.
     */
    get webServiceAuthToken(): string | null {
      return optional('APPLE_WALLET_AUTH_TOKEN')
    },
    get isConfigured(): boolean {
      return Boolean(
        this.teamId && this.passTypeId && this.wwdrCert && this.signerCert && this.signerKey
      )
    },
    /** Pass updates need APNs on top of signing. */
    get isPushConfigured(): boolean {
      return Boolean(this.pushKeyP8 && this.pushKeyId && this.teamId && this.passTypeId)
    },
  },

  /**
   * Google Wallet.
   *
   * Credentials arrive in one of two shapes: the whole service-account JSON
   * blob (what the Cloud console downloads) or the two fields from it that we
   * actually use. Both are supported so an operator never has to reformat a
   * secret to satisfy us.
   */
  google: {
    get issuerId(): string | null {
      return optional('GOOGLE_WALLET_ISSUER_ID')
    },
    get projectId(): string | null {
      return optional('GOOGLE_WALLET_PROJECT_ID')
    },
    get serviceAccountJson(): string | null {
      return optional('GOOGLE_WALLET_SERVICE_ACCOUNT_JSON')
    },
    get serviceAccountEmail(): string | null {
      const explicit = optional('GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL')
      if (explicit) return explicit
      const parsed = parseJson<{ client_email?: string }>(this.serviceAccountJson)
      return parsed?.client_email ?? null
    },
    get privateKey(): string | null {
      const explicit = pemOrFile(['GOOGLE_WALLET_PRIVATE_KEY'], ['GOOGLE_WALLET_PRIVATE_KEY_PATH'])
      if (explicit) return explicit
      const parsed = parseJson<{ private_key?: string }>(this.serviceAccountJson)
      return parsed?.private_key ? parsed.private_key.replace(/\\n/g, '\n') : null
    },
    get isConfigured(): boolean {
      return Boolean(this.issuerId && this.serviceAccountEmail && this.privateKey)
    },
  },

  /**
   * Google Maps platform, used for geocoding merchant addresses and looking up
   * places. Each product has its own key in most Google projects, so a single
   * `GOOGLE_MAPS_API_KEY` is accepted as the fallback for all three rather than
   * demanding three copies of the same value.
   */
  maps: {
    get mapsApiKey(): string | null {
      return optional('GOOGLE_MAPS_API_KEY')
    },
    get geocodingApiKey(): string | null {
      return firstOf('GOOGLE_GEOCODING_API_KEY', 'GOOGLE_MAPS_API_KEY')
    },
    get placesApiKey(): string | null {
      return firstOf('GOOGLE_PLACES_API_KEY', 'GOOGLE_MAPS_API_KEY')
    },
    /**
     * Deployment-level kill switch for every geofence evaluation.
     *
     * Merchant-level toggles live in `wallet_settings`, per the product rule
     * that behaviour is configured in the dashboard. This exists for the
     * operator: a way to stop all location processing platform-wide during an
     * incident without editing tenant data.
     */
    get geofencingEnabled(): boolean {
      return bool('GOOGLE_GEOFENCING_ENABLED', true)
    },
    get isGeocodingConfigured(): boolean {
      return Boolean(this.geocodingApiKey)
    },
  },

  ai: {
    get apiKey(): string | null {
      return optional('ANTHROPIC_API_KEY')
    },
    get model(): string {
      return optional('ANTHROPIC_MODEL') ?? 'claude-sonnet-5'
    },
    get fastModel(): string {
      return optional('ANTHROPIC_FAST_MODEL') ?? 'claude-haiku-4-5-20251001'
    },
    get isConfigured(): boolean {
      return Boolean(this.apiKey)
    },
  },

  stripe: {
    get secretKey(): string | null {
      return optional('STRIPE_SECRET_KEY')
    },
    get webhookSecret(): string | null {
      return optional('STRIPE_WEBHOOK_SECRET')
    },
    get publishableKey(): string | null {
      return optional('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY')
    },
    get isConfigured(): boolean {
      return Boolean(this.secretKey)
    },
  },

  limits: {
    /** Max customers processed per campaign batch job. */
    get campaignBatchSize(): number {
      return int('CAMPAIGN_BATCH_SIZE', 200)
    },
    /** Max jobs claimed by a single worker invocation. */
    get workerBatchSize(): number {
      return int('WORKER_BATCH_SIZE', 50)
    },
    get maxLogoBytes(): number {
      return int('MAX_LOGO_BYTES', 2 * 1024 * 1024)
    },
    get maxImportRows(): number {
      return int('MAX_IMPORT_ROWS', 20000)
    },
  },
} as const

/**
 * Reports configuration health so the dashboard can tell merchants exactly
 * which capability is switched off and why.
 */
export function capabilityReport() {
  return {
    email: Boolean(env.email.apiKey),
    sms: Boolean(env.sms.accountSid && env.sms.authToken && env.sms.from),
    whatsapp: Boolean(env.whatsapp.phoneNumberId && env.whatsapp.accessToken),
    webPush: Boolean(env.webPush.publicKey && env.webPush.privateKey),
    appleWallet: env.apple.isConfigured,
    applePush: env.apple.isPushConfigured,
    googleWallet: env.google.isConfigured,
    /*
     * Proximity works without Google Maps: a merchant can type coordinates, and
     * both wallets take it from there. Geocoding only removes that typing, so it
     * is reported separately rather than gating the feature.
     */
    walletProximity:
      env.maps.geofencingEnabled && (env.apple.isConfigured || env.google.isConfigured),
    geocoding: env.maps.isGeocodingConfigured,
    maps: Boolean(env.maps.mapsApiKey),
    ai: env.ai.isConfigured,
    billing: env.stripe.isConfigured,
    storage: env.storage.isConfigured,
  }
}

export type CapabilityReport = ReturnType<typeof capabilityReport>
