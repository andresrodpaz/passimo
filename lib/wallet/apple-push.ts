import 'server-only'
import jwt from 'jsonwebtoken'
import http2 from 'node:http2'
import { getDb } from '@/lib/db'
import { env } from '@/lib/env'
import { logger } from '@/lib/logger'

/**
 * APNs push for Apple Wallet pass updates.
 *
 * A pass update push carries no payload: it tells the device "re-fetch this
 * pass", and the device then calls our web service. Two fixes over the original
 * implementation: it now pushes to *every* device that registered the pass
 * (a customer may have an iPhone and a Watch), and it prunes tokens that APNs
 * reports as gone instead of retrying them forever.
 */

let cachedJwt: { token: string; issuedAt: number } | null = null

/** APNs rejects a provider token older than 1 hour and throttles frequent regeneration. */
function providerToken(): string | null {
  const keyP8 = env.apple.pushKeyP8
  const keyId = env.apple.pushKeyId
  const teamId = env.apple.teamId
  if (!keyP8 || !keyId || !teamId) return null

  const now = Math.floor(Date.now() / 1000)
  if (cachedJwt && now - cachedJwt.issuedAt < 2400) return cachedJwt.token

  const token = jwt.sign({ iss: teamId, iat: now }, keyP8, {
    algorithm: 'ES256',
    header: { alg: 'ES256', kid: keyId },
  })
  cachedJwt = { token, issuedAt: now }
  return token
}

function apnsHost(): string {
  return env.apple.pushProduction ? 'api.push.apple.com' : 'api.sandbox.push.apple.com'
}

type PushOutcome = { token: string; status: number; reason?: string }

/**
 * Wakes every device holding this customer's pass.
 *
 * Returns how many devices accepted the push. Callers use it to decide whether a
 * proximity notification was actually delivered — zero is the normal outcome for
 * a customer who never installed the pass, not a failure.
 */
export async function pushApplePassUpdate(
  customerId: string
): Promise<{ devices: number; attempted: number }> {
  const token = providerToken()
  const passTypeId = env.apple.passTypeId
  if (!token || !passTypeId) return { devices: 0, attempted: 0 }

  const admin = getDb()
  const { data: registrations } = await admin
    .from('wallet_registrations')
    .select('id, push_token')
    .eq('customer_id', customerId)
    .eq('platform', 'apple')

  // Fall back to the single legacy token column for passes registered before
  // the multi-device table existed.
  let deviceTokens = (registrations ?? [])
    .map((row) => row.push_token as string)
    .filter(Boolean)

  if (deviceTokens.length === 0) {
    const { data: customer } = await admin
      .from('customers')
      .select('apple_push_token')
      .eq('id', customerId)
      .maybeSingle()
    if (customer?.apple_push_token) deviceTokens = [customer.apple_push_token as string]
  }

  if (deviceTokens.length === 0) return { devices: 0, attempted: 0 }

  const client = http2.connect(`https://${apnsHost()}`)
  const outcomes: PushOutcome[] = []

  try {
    await Promise.all(
      deviceTokens.map(
        (deviceToken) =>
          new Promise<void>((resolve) => {
            const request = client.request({
              ':method': 'POST',
              ':path': `/3/device/${deviceToken}`,
              'apns-topic': passTypeId,
              'apns-push-type': 'background',
              'apns-priority': '5',
              authorization: `bearer ${token}`,
              'content-type': 'application/json',
            })

            let status = 0
            let body = ''
            const timer = setTimeout(() => {
              request.close()
              outcomes.push({ token: deviceToken, status: 0, reason: 'timeout' })
              resolve()
            }, 8000)

            request.setEncoding('utf8')
            request.on('response', (headers) => {
              status = Number(headers[':status'] ?? 0)
            })
            request.on('data', (chunk: string) => {
              body += chunk
            })
            request.on('error', (cause) => {
              clearTimeout(timer)
              outcomes.push({ token: deviceToken, status: 0, reason: String(cause) })
              resolve()
            })
            request.on('end', () => {
              clearTimeout(timer)
              let reason: string | undefined
              try {
                reason = body ? (JSON.parse(body) as { reason?: string }).reason : undefined
              } catch {
                reason = body || undefined
              }
              outcomes.push({ token: deviceToken, status, reason })
              resolve()
            })
            request.end(JSON.stringify({}))
          })
      )
    )
  } finally {
    client.close()
  }

  // 410 Gone / BadDeviceToken means the pass was deleted — stop pushing to it.
  const dead = outcomes
    .filter(
      (outcome) =>
        outcome.status === 410 ||
        outcome.reason === 'BadDeviceToken' ||
        outcome.reason === 'Unregistered'
    )
    .map((outcome) => outcome.token)

  if (dead.length > 0) {
    await admin.from('wallet_registrations').delete().in('push_token', dead)
    logger.info('wallet.pruned_dead_tokens', { customerId, count: dead.length })
  }

  const failures = outcomes.filter((outcome) => outcome.status !== 200)
  if (failures.length > 0) {
    logger.warn('wallet.apns_partial_failure', { customerId, failures })
  }

  return {
    devices: outcomes.filter((outcome) => outcome.status === 200).length,
    attempted: outcomes.length,
  }
}
