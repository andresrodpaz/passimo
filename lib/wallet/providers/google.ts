import 'server-only'
import { env } from '@/lib/env'
import { buildGoogleWalletSaveJwt } from '@/lib/wallet/google-loyalty-jwt'
import { addGoogleWalletMessage, syncGoogleWalletObject } from '@/lib/wallet/google-sync'
import type {
  PassArtifact,
  ProviderStatus,
  WalletNotificationPayload,
  WalletPassContent,
  WalletProvider,
} from '@/lib/wallet/types'

/**
 * The Google Wallet provider.
 *
 * Google's save flow is a redirect rather than a file: we mint a signed JWT and
 * send the customer to `pay.google.com/gp/v/save/<jwt>`, which is why `issue`
 * returns a `redirect` artifact where Apple returns a `file`. Keeping that
 * difference inside the provider is the entire reason the interface exists — the
 * card page renders one button per configured provider and knows nothing about
 * either mechanism.
 *
 * Google is the more capable of the two for notifications: object messages carry
 * arbitrary copy and can alert the device, so a merchant's campaign title and
 * message arrive verbatim. On Apple the same campaign becomes the pass's
 * `relevantText`.
 */

const SAVE_URL = 'https://pay.google.com/gp/v/save'

export function createGoogleWalletProvider(): WalletProvider {
  return {
    id: 'google',

    status(): ProviderStatus {
      const missing: string[] = []
      if (!env.google.issuerId) missing.push('GOOGLE_WALLET_ISSUER_ID')
      if (!env.google.serviceAccountEmail) missing.push('GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL')
      if (!env.google.privateKey) missing.push('GOOGLE_WALLET_PRIVATE_KEY')

      return {
        id: 'google',
        label: 'Google Wallet',
        configured: env.google.isConfigured,
        // Google needs no separate push credential: the same service account that
        // issues objects can message them.
        pushConfigured: env.google.isConfigured,
        supports: {
          geofencedRelevance: true,
          lockScreenSuggestions: true,
          // Google Wallet has no iBeacon equivalent for loyalty objects.
          beacons: false,
          pushUpdates: true,
          richNotifications: true,
        },
        missing,
      }
    },

    async issue(content: WalletPassContent): Promise<PassArtifact> {
      const token = buildGoogleWalletSaveJwt(content)
      return { kind: 'redirect', url: `${SAVE_URL}/${token}` }
    },

    async update(content: WalletPassContent): Promise<{ devices: number }> {
      const { synced } = await syncGoogleWalletObject(content)
      // Google reports the object, not the devices holding it. One object is one
      // customer's card, so "synced" is the honest count.
      return { devices: synced ? 1 : 0 }
    },

    async notify(input: WalletNotificationPayload): Promise<{ delivered: boolean }> {
      // Sync first so the message lands on a card that already shows the right
      // balance and locations. A notification about a reward on a pass still
      // showing yesterday's total is worse than no notification.
      await syncGoogleWalletObject(input.content)

      const header = input.emoji ? `${input.emoji} ${input.title}` : input.title
      return addGoogleWalletMessage({
        customerId: input.content.customerId,
        header,
        body: input.message,
        expiresAt: input.expiresAt,
      })
    },
  }
}
