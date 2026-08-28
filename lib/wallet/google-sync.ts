import 'server-only'
import jwt from 'jsonwebtoken'
import { getDb } from '@/lib/db'
import { env } from '@/lib/env'
import { logger } from '@/lib/logger'
import { buildGoogleLoyaltyObject, googleObjectId } from '@/lib/wallet/google-loyalty-jwt'
import type { WalletPassContent, WalletSettings } from '@/lib/wallet/types'

/**
 * Google Wallet object synchronisation.
 *
 * The original integration only ever generated a "save" link: after the card was
 * added, the balance shown in Google Wallet never changed again. Real-time updates
 * are the whole point of a digital card, so this patches the loyalty object
 * through the Wallet REST API whenever the balance, the locations or the offers
 * move.
 *
 * Unlike Apple, Google *does* have a message primitive: `addMessage` pushes a
 * titled body onto the object, which Wallet surfaces as a notification. That is
 * why proximity notifications read differently on the two platforms and why the
 * provider interface has a `notify` at all.
 */

const WALLET_API = 'https://walletobjects.googleapis.com/walletobjects/v1'
const SCOPE = 'https://www.googleapis.com/auth/wallet_object.issuer'

let cachedToken: { value: string; expiresAt: number } | null = null

async function accessToken(): Promise<string | null> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value

  const clientEmail = env.google.serviceAccountEmail
  const privateKey = env.google.privateKey
  if (!clientEmail || !privateKey) return null

  const now = Math.floor(Date.now() / 1000)
  const assertion = jwt.sign(
    {
      iss: clientEmail,
      scope: SCOPE,
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    },
    privateKey,
    { algorithm: 'RS256' }
  )

  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
      signal: AbortSignal.timeout(10_000),
    })
    const payload = (await response.json()) as { access_token?: string; expires_in?: number }
    if (!response.ok || !payload.access_token) {
      logger.error('wallet.google_token_failed', { status: response.status })
      return null
    }
    cachedToken = {
      value: payload.access_token,
      expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000,
    }
    return cachedToken.value
  } catch (cause) {
    logger.error('wallet.google_token_error', { cause })
    return null
  }
}

/** The object id, but only for a customer who actually installed the pass. */
async function installedObjectId(customerId: string): Promise<string | null> {
  const admin = getDb()
  const { data } = await admin
    .from('customers')
    .select('google_wallet_object_id, google_wallet_saved_at')
    .eq('id', customerId)
    .maybeSingle()

  if (!data?.google_wallet_saved_at) return null
  return (
    (data.google_wallet_object_id as string) ??
    googleObjectId(customerId, env.google.issuerId ?? 'issuer')
  )
}

/**
 * Pushes the current card state to an installed Google Wallet object.
 *
 * Patches the whole object rather than only the points, so a location the merchant
 * added this morning reaches an already-installed pass. Patching only the balance
 * — as this used to — is why Google users never saw new stores.
 */
export async function syncGoogleWalletObject(
  content: WalletPassContent,
  options: { settings?: WalletSettings } = {}
): Promise<{ synced: boolean }> {
  if (!env.google.isConfigured) return { synced: false }

  const objectId = await installedObjectId(content.customerId)
  if (!objectId) return { synced: false }

  const token = await accessToken()
  if (!token) return { synced: false }

  const object = buildGoogleLoyaltyObject(content, { settings: options.settings })
  // `id` and `classId` are immutable; including them in a PATCH is rejected.
  const patch = { ...object }
  delete patch.id
  delete patch.classId

  try {
    const response = await fetch(`${WALLET_API}/loyaltyObject/${encodeURIComponent(objectId)}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
      signal: AbortSignal.timeout(10_000),
    })

    if (!response.ok) {
      logger.warn('wallet.google_patch_failed', {
        status: response.status,
        body: (await response.text()).slice(0, 300),
      })
      return { synced: false }
    }
    return { synced: true }
  } catch (cause) {
    logger.error('wallet.google_patch_error', { cause })
    return { synced: false }
  }
}

/**
 * Pushes a notification onto an installed Google Wallet object.
 *
 * Google surfaces object messages as wallet notifications, which is the closest
 * either vendor gets to "send this customer a message about this card".
 * `TEXT_AND_NOTIFY` is what makes the device actually alert; plain `TEXT` writes a
 * message the customer only sees if they open the pass — a silent failure that
 * looks identical in the API response.
 */
export async function addGoogleWalletMessage(input: {
  customerId: string
  header: string
  body: string
  /** Wallet stops displaying the message after this instant. */
  expiresAt?: string | null
}): Promise<{ delivered: boolean }> {
  if (!env.google.isConfigured) return { delivered: false }

  const objectId = await installedObjectId(input.customerId)
  if (!objectId) return { delivered: false }

  const token = await accessToken()
  if (!token) return { delivered: false }

  try {
    const response = await fetch(
      `${WALLET_API}/loyaltyObject/${encodeURIComponent(objectId)}/addMessage`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            header: input.header.slice(0, 60),
            body: input.body.slice(0, 500),
            id: `msg-${Date.now()}`,
            messageType: 'TEXT_AND_NOTIFY',
            ...(input.expiresAt ? { displayInterval: { end: { date: input.expiresAt } } } : {}),
          },
        }),
        signal: AbortSignal.timeout(10_000),
      }
    )

    if (!response.ok) {
      logger.warn('wallet.google_message_failed', {
        status: response.status,
        body: (await response.text()).slice(0, 300),
      })
      return { delivered: false }
    }
    return { delivered: true }
  } catch (cause) {
    logger.error('wallet.google_message_error', { cause })
    return { delivered: false }
  }
}

/** Records that the customer added the pass, enabling future updates. */
export async function markGoogleWalletSaved(customerId: string, objectId: string): Promise<void> {
  const admin = getDb()
  await admin
    .from('customers')
    .update({
      google_wallet_object_id: objectId,
      google_wallet_saved_at: new Date().toISOString(),
    })
    .eq('id', customerId)
}
