import 'server-only'
import { env } from '@/lib/env'
import { logger } from '@/lib/logger'
import { buildLoyaltyPkPass } from '@/lib/wallet/apple-pass'
import { pushApplePassUpdate } from '@/lib/wallet/apple-push'
import type {
  PassArtifact,
  ProviderStatus,
  WalletNotificationPayload,
  WalletPassContent,
  WalletProvider,
} from '@/lib/wallet/types'

/**
 * The Apple Wallet provider.
 *
 * Everything Apple-specific about *delivery* lives here; everything Apple-specific
 * about *rendering* lives in `apple-pass.ts`. The split matters because delivery is
 * where the interesting constraint is:
 *
 * **Apple has no push message.** A pass update push carries no payload — it tells
 * the device "re-fetch this pass", and the device then calls our web service. The
 * notification a customer sees on their lock screen is the pass's own
 * `relevantText`, rendered by iOS when the device enters one of the pass's
 * locations. So `notify()` does not send a message: it writes the message *into*
 * the pass and asks the device to re-read it. Understanding that is the difference
 * between working proximity notifications and a week of debugging silent pushes.
 */

export function createAppleWalletProvider(): WalletProvider {
  return {
    id: 'apple',

    status(): ProviderStatus {
      const missing: string[] = []
      if (!env.apple.teamId) missing.push('APPLE_TEAM_ID')
      if (!env.apple.passTypeId) missing.push('APPLE_PASS_TYPE_IDENTIFIER')
      if (!env.apple.wwdrCert) missing.push('APPLE_WWDR_CERTIFICATE_PATH')
      if (!env.apple.signerCert) missing.push('APPLE_SIGNING_CERTIFICATE_PATH')
      if (!env.apple.signerKey) missing.push('APPLE_SIGNING_PRIVATE_KEY_PATH')

      const pushMissing: string[] = []
      if (!env.apple.pushKeyP8) pushMissing.push('APPLE_PUSH_KEY_P8')
      if (!env.apple.pushKeyId) pushMissing.push('APPLE_PUSH_KEY_ID')

      return {
        id: 'apple',
        label: 'Apple Wallet',
        configured: env.apple.isConfigured,
        pushConfigured: env.apple.isPushConfigured,
        supports: {
          geofencedRelevance: true,
          lockScreenSuggestions: true,
          beacons: true,
          pushUpdates: true,
          // iOS renders the pass's own relevantText; we cannot push arbitrary
          // notification copy the way a native app can.
          richNotifications: false,
        },
        missing: [...missing, ...(env.apple.isConfigured ? pushMissing : [])],
      }
    },

    async issue(content: WalletPassContent): Promise<PassArtifact> {
      const buffer = await buildLoyaltyPkPass(content)
      return {
        kind: 'file',
        contentType: 'application/vnd.apple.pkpass',
        filename: `${slug(content.organizationName)}.pkpass`,
        body: new Uint8Array(buffer),
      }
    },

    async update(content: WalletPassContent): Promise<{ devices: number }> {
      if (!env.apple.isPushConfigured) return { devices: 0 }
      const result = await pushApplePassUpdate(content.customerId)
      return { devices: result.devices }
    },

    async notify(input: WalletNotificationPayload): Promise<{ delivered: boolean }> {
      /*
       * The caller has already written the campaign copy into the location's
       * `relevantText` on the content it passed us, so re-issuing and pushing is
       * literally the delivery mechanism. If the customer has no registered
       * device there is nothing to wake, and that is a normal outcome — most
       * customers who join never install the pass — so it is not logged as an
       * error.
       */
      if (!env.apple.isPushConfigured) return { delivered: false }
      try {
        const { devices } = await pushApplePassUpdate(input.content.customerId)
        return { delivered: devices > 0 }
      } catch (cause) {
        logger.warn('wallet.apple_notify_failed', {
          customer_id: input.content.customerId,
          cause,
        })
        return { delivered: false }
      }
    },
  }
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'loyalty'
  )
}
