import 'server-only'
import jwt from 'jsonwebtoken'
import { env } from '@/lib/env'
import { notConfigured } from '@/lib/errors'

type ServiceAccount = {
  client_email: string
  private_key: string
}

function parseServiceAccount(): ServiceAccount {
  const raw = env.google.serviceAccountJson
  if (!raw) throw notConfigured('Google Wallet')
  let parsed: ServiceAccount
  try {
    parsed = JSON.parse(raw) as ServiceAccount
  } catch {
    throw notConfigured('Google Wallet (service account JSON is malformed)')
  }
  if (!parsed.client_email || !parsed.private_key) {
    throw notConfigured('Google Wallet (service account is missing client_email/private_key)')
  }
  return {
    client_email: parsed.client_email,
    private_key: parsed.private_key.replace(/\\n/g, '\n'),
  }
}

/**
 * Builds a "Save to Google Wallet" JWT.
 *
 * `origins` must list the exact origin the save button is served from, or
 * Google rejects the request — a common and confusing failure in production.
 *
 * @see https://developers.google.com/wallet/generic/web/prerequisites
 */
export function createGoogleWalletSaveJwt(payload: Record<string, unknown>): string {
  const account = parseServiceAccount()
  return jwt.sign(
    {
      iss: account.client_email,
      aud: 'google',
      typ: 'savetowallet',
      iat: Math.floor(Date.now() / 1000),
      origins: [env.appUrl],
      payload,
    },
    account.private_key,
    { algorithm: 'RS256' }
  )
}
