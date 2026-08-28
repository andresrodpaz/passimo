/**
 * Which vendor's copy of a card is behind, and what to do about it.
 *
 * `walletService.sync()` pushes to Apple and Google concurrently. When one
 * throws and the other succeeds, the old code logged a warning and returned two
 * numbers — losing the only fact worth keeping: *which* vendor is now showing a
 * stale balance. A Google outage was indistinguishable from a customer who never
 * installed a Google pass, and nothing retried.
 *
 * This is the pure reducer over one sync attempt. It answers three questions:
 * what state is each provider in, which of them should be retried, and when.
 * Kept free of database access and of the wallet service so the retry policy — the part
 * that decides whether a customer's card ever catches up — is unit-testable.
 */

export type WalletProviderId = 'apple' | 'google'

export type SyncStatus = 'synced' | 'stale' | 'abandoned'

export type ProviderAttempt = {
  provider: WalletProviderId
  ok: boolean
  /** Devices reached. Zero with `ok` is a customer who never installed a pass. */
  devices: number
  error?: string | null
}

export type ProviderState = {
  provider: WalletProviderId
  status: SyncStatus
  attempts: number
  lastError: string | null
}

/**
 * How many consecutive failures before a vendor is left alone.
 *
 * Bounded deliberately. A pass that cannot be updated after five tries is not
 * going to be fixed by a sixth, and an unbounded retry on a revoked certificate
 * would push the same doomed job at Apple forever. The row stays `abandoned` and
 * visible rather than being deleted, so a merchant asking "why is my card
 * wrong?" has an answer.
 */
export const MAX_SYNC_ATTEMPTS = 5

/**
 * Exponential backoff, in seconds, from the attempt number.
 *
 * Starts at a minute — a wallet push that failed on a transient network error
 * usually succeeds on the next one — and caps at an hour so a long outage does
 * not turn into a retry storm the moment it ends.
 */
export function retryDelaySeconds(attempts: number): number {
  return Math.min(3_600, 60 * 2 ** Math.max(0, attempts - 1))
}

/**
 * Folds one attempt into the stored state for that provider.
 *
 * A success always resets: the point of the counter is consecutive failures, and
 * carrying an old count forward would abandon a provider that has been working
 * fine for a week.
 */
export function reduceProviderState(
  previous: ProviderState | null,
  attempt: ProviderAttempt
): ProviderState {
  const attempts = attempt.ok ? 0 : (previous?.attempts ?? 0) + 1

  if (attempt.ok) {
    return { provider: attempt.provider, status: 'synced', attempts: 0, lastError: null }
  }

  return {
    provider: attempt.provider,
    status: attempts >= MAX_SYNC_ATTEMPTS ? 'abandoned' : 'stale',
    attempts,
    lastError: attempt.error ?? 'unknown error',
  }
}

export type SyncPlan = {
  states: ProviderState[]
  /** Providers worth trying again, and how long to wait first. */
  retry: Array<{ provider: WalletProviderId; delaySeconds: number }>
  /** True when at least one vendor is knowingly behind. */
  degraded: boolean
}

/**
 * Turns a set of attempts into the state to persist and the work to queue.
 *
 * The important property: a partial failure is *neither* a success nor an
 * exception. The request that triggered the sync — a scan at the counter —
 * completes normally, one vendor is recorded as stale, and only that vendor is
 * retried. Throwing would fail a check-in for a background push; swallowing
 * would leave a customer looking at a wrong balance forever.
 */
export function planSync(
  attempts: ProviderAttempt[],
  previous: ProviderState[] = []
): SyncPlan {
  const previousByProvider = new Map(previous.map((state) => [state.provider, state]))

  const states = attempts.map((attempt) =>
    reduceProviderState(previousByProvider.get(attempt.provider) ?? null, attempt)
  )

  const retry = states
    .filter((state) => state.status === 'stale')
    .map((state) => ({
      provider: state.provider,
      delaySeconds: retryDelaySeconds(state.attempts),
    }))

  return {
    states,
    retry,
    degraded: states.some((state) => state.status !== 'synced'),
  }
}
