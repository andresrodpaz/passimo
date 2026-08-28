import 'server-only'
import { logger } from '@/lib/logger'
import { notConfigured } from '@/lib/errors'
import { createAppleWalletProvider } from '@/lib/wallet/providers/apple'
import { createGoogleWalletProvider } from '@/lib/wallet/providers/google'
import { buildPassContent } from '@/lib/wallet/pass-content'
import { getWalletSettings } from '@/lib/wallet/settings'
import { recordWalletEvent } from '@/lib/wallet/events'
import type { ProviderAttempt } from '@/lib/wallet/sync-state'
import type { LatLng } from '@/lib/wallet/geo'
import type {
  PassArtifact,
  ProviderStatus,
  WalletNotificationPayload,
  WalletPassContent,
  WalletProvider,
  WalletProviderId,
} from '@/lib/wallet/types'

/**
 * The wallet service.
 *
 * The one entry point for "give this customer their card", "the card changed" and
 * "tell this customer something through their card". Providers are injected, so:
 *
 *   * the whole stack is testable with fakes and no credentials, which is the
 *     situation this repository ships in and therefore the situation that has to
 *     work;
 *   * adding a third wallet vendor is a new file plus one registry entry, not a
 *     search for every `if (apple)` in the codebase;
 *   * a provider that is not configured is *absent* rather than failing — the card
 *     page shows one button instead of two, which is exactly right for a merchant
 *     who has only completed Apple's onboarding.
 *
 * Every method is safe to call with no credentials at all. That is the design
 * requirement: the product must be complete and exercisable before Apple and
 * Google approve anyone's account, with only the credential values missing.
 */

export type WalletServiceDeps = {
  providers: WalletProvider[]
}

export type WalletService = {
  providers(): WalletProvider[]
  provider(id: WalletProviderId): WalletProvider | null
  status(): ProviderStatus[]
  /** True when at least one provider can issue passes. */
  isAnyConfigured(): boolean

  /** Builds the current content of a customer's card. */
  content(customerId: string, options?: { near?: LatLng | null }): Promise<WalletPassContent | null>

  /** Issues an installable pass for one provider. */
  issue(
    providerId: WalletProviderId,
    customerId: string,
    options?: { near?: LatLng | null }
  ): Promise<PassArtifact>

  /**
   * Pushes the current state to every installed pass for a customer.
   *
   * Reports per provider, *including failures*, so a Google outage does not hide
   * an Apple success — and so the caller can record which vendor is stale and
   * retry only that one. `options.providers` narrows the push to exactly that
   * set, which is what a retry job passes.
   */
  sync(
    customerId: string,
    options?: { reason?: string; providers?: WalletProviderId[] }
  ): Promise<{
    apple: number
    google: number
    skipped: boolean
    businessId: string | null
    attempts: ProviderAttempt[]
  }>

  /** Delivers a proximity notification through whichever wallets are installed. */
  notify(input: {
    customerId: string
    title: string
    message: string
    emoji?: string | null
    ctaLabel?: string | null
    ctaUrl?: string | null
    expiresAt?: string | null
    locationId?: string | null
    campaignId?: string | null
    ruleId?: string | null
  }): Promise<{ delivered: WalletProviderId[]; content: WalletPassContent | null }>
}

export function createWalletService(deps: WalletServiceDeps): WalletService {
  const registry = new Map<WalletProviderId, WalletProvider>(
    deps.providers.map((provider) => [provider.id, provider])
  )

  const configured = (): WalletProvider[] =>
    [...registry.values()].filter((provider) => provider.status().configured)

  return {
    providers: () => [...registry.values()],
    provider: (id) => registry.get(id) ?? null,
    status: () => [...registry.values()].map((provider) => provider.status()),
    isAnyConfigured: () => configured().length > 0,

    content: (customerId, options = {}) => buildPassContent(customerId, { near: options.near }),

    async issue(providerId, customerId, options = {}) {
      const provider = registry.get(providerId)
      if (!provider) throw notConfigured(`${providerId} wallet`)
      if (!provider.status().configured) throw notConfigured(provider.status().label)

      const content = await buildPassContent(customerId, { near: options.near })
      if (!content) throw notConfigured('Wallet pass (customer not found)')

      const artifact = await provider.issue(content)

      await recordWalletEvent({
        businessId: content.businessId,
        customerId: content.customerId,
        type: 'pass_installed',
        platform: providerId,
        metadata: { locations: content.relevantLocations.length },
      })

      return artifact
    },

    async sync(customerId, options = {}) {
      const empty = { apple: 0, google: 0, skipped: true, businessId: null, attempts: [] }

      const content = await buildPassContent(customerId)
      if (!content) return empty

      const settings = await getWalletSettings(content.businessId)
      // A merchant who switched automatic updates off means it: some businesses
      // deliberately want a card that only changes when the customer looks at it.
      if (!settings.automaticPassUpdates) return { ...empty, businessId: content.businessId }

      const targets = options.providers
        ? configured().filter((provider) => options.providers!.includes(provider.id))
        : configured()

      /*
       * `allSettled`, not `all`: the whole point is that one vendor rejecting
       * must not discard the other's result. What changed is what happens to the
       * rejection — it used to become a log line and nothing else, so a customer
       * whose Google pass failed to update kept a wrong balance indefinitely and
       * nobody, including us, knew.
       */
      const results = await Promise.allSettled(
        targets.map(async (provider) => ({
          id: provider.id,
          ...(await provider.update(content)),
        }))
      )

      let apple = 0
      let google = 0
      const attempts: ProviderAttempt[] = results.map((result, index) => {
        const provider = targets[index]!
        if (result.status !== 'fulfilled') {
          const error =
            result.reason instanceof Error ? result.reason.message : String(result.reason)
          logger.warn('wallet.sync_provider_failed', { customer_id: customerId, provider: provider.id, error })
          return { provider: provider.id, ok: false, devices: 0, error }
        }
        if (result.value.id === 'apple') apple = result.value.devices
        if (result.value.id === 'google') google = result.value.devices
        return { provider: provider.id, ok: true, devices: result.value.devices }
      })

      if (apple + google > 0) {
        await recordWalletEvent({
          businessId: content.businessId,
          customerId,
          type: 'pass_updated',
          metadata: { apple, google, reason: options.reason ?? 'balance_change' },
        })
      }

      return { apple, google, skipped: false, businessId: content.businessId, attempts }
    },

    async notify(input) {
      const content = await buildPassContent(input.customerId)
      if (!content) return { delivered: [], content: null }

      const location = input.locationId
        ? (content.relevantLocations.find((candidate) => candidate.id === input.locationId) ?? null)
        : null

      /*
       * Apple has no message primitive: the lock-screen line a customer sees is
       * the pass's own `relevantText`. So the campaign copy is written into the
       * content *before* the provider is asked to deliver, and Apple's `notify`
       * re-issues and pushes. Google, which does have messages, reads the same
       * fields directly. One payload, two very different delivery mechanisms —
       * which is exactly what the provider boundary is for.
       */
      const decorated: WalletPassContent = location
        ? {
            ...content,
            relevantLocations: content.relevantLocations.map((candidate) =>
              candidate.id === location.id
                ? {
                    ...candidate,
                    relevantText: input.emoji
                      ? `${input.emoji} ${input.message}`
                      : input.message,
                  }
                : candidate
            ),
          }
        : content

      const payload: WalletNotificationPayload = {
        content: decorated,
        title: input.title,
        message: input.message,
        emoji: input.emoji ?? null,
        ctaLabel: input.ctaLabel ?? null,
        ctaUrl: input.ctaUrl ?? null,
        expiresAt: input.expiresAt ?? null,
        location,
      }

      const outcomes = await Promise.allSettled(
        configured().map(async (provider) => ({
          id: provider.id,
          ...(await provider.notify(payload)),
        }))
      )

      const delivered: WalletProviderId[] = []
      for (const outcome of outcomes) {
        if (outcome.status === 'fulfilled' && outcome.value.delivered) {
          delivered.push(outcome.value.id)
        }
      }

      return { delivered, content: decorated }
    },
  }
}

/**
 * The default service, wired to the real providers.
 *
 * A module-level singleton because provider construction is free and the status
 * they report is derived from the environment on each read — there is no state to
 * stale. Tests build their own with `createWalletService`.
 */
let singleton: WalletService | null = null

export function walletService(): WalletService {
  singleton ??= createWalletService({
    providers: [createAppleWalletProvider(), createGoogleWalletProvider()],
  })
  return singleton
}
