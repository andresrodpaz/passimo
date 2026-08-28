'use client'

import * as React from 'react'
import { ApiError, apiPost } from '@/lib/client/api'
import { newIdempotencyKey } from '@/lib/client/idempotency'
import {
  cacheCustomer,
  enqueueScan,
  flushQueue,
  getCachedCustomer,
  getQueueSnapshot,
  getServerQueueSnapshot,
  pruneCustomerCache,
  refreshQueueSnapshot,
  subscribeToQueue,
  type QueuedScan,
} from '@/lib/client/offline-queue'
import type { CounterCustomer } from '@/lib/scan/counter'
import type { ScanResolution } from '@/lib/scan/resolve'
import type { CheckinOutcome } from '@/lib/scan/checkin'

/**
 * The counter's scan brain.
 *
 * One function for the whole interaction — identify, credit, celebrate — with
 * the offline behaviour built in rather than bolted on. Callers get a result
 * either way and never have to reason about connectivity.
 *
 * Offline check-ins take the optimistic path: if we recognise the scanned code
 * from cache, the customer is served immediately and the credit is queued. The
 * merchant's queue keeps moving, which is the entire point.
 */

export type ScanResponse = {
  resolution: ScanResolution
  checkin: CheckinOutcome | null
  fulfilled: { code: string; rewardName: string } | null
}

export type ScanOutcome = ScanResponse & {
  /** Served from cache and queued for sync rather than confirmed by the server. */
  queued: boolean
}

export type CounterScan = {
  online: boolean
  /** Check-ins captured offline and still waiting to sync. */
  pending: number
  syncing: boolean
  /** Scans dropped during sync — surfaced so the merchant can re-do them. */
  abandoned: QueuedScan[]
  dismissAbandoned: () => void
  identify: (raw: string) => Promise<ScanOutcome>
  checkIn: (
    raw: string,
    options?: { amount?: number | null; decodeMs?: number }
  ) => Promise<ScanOutcome>
  sync: () => Promise<void>
}

export function useCounterScan(businessId: string | null): CounterScan {
  const [syncing, setSyncing] = React.useState(false)
  const [abandoned, setAbandoned] = React.useState<QueuedScan[]>([])

  // `navigator.onLine` is only trustworthy as a negative signal, so it seeds the
  // state and a failed request is what actually proves we are offline.
  const online = useOnlineStatus()

  // The queue lives in IndexedDB, which is an external system: read it through a
  // store subscription rather than copying it into component state.
  const pending = React.useSyncExternalStore(
    subscribeToQueue,
    getQueueSnapshot,
    getServerQueueSnapshot
  )

  React.useEffect(() => {
    if (!businessId) return
    void refreshQueueSnapshot(businessId)
  }, [businessId])

  const sync = React.useCallback(async () => {
    if (!businessId) return
    setSyncing(true)
    try {
      const result = await flushQueue(businessId, async (scan) => {
        try {
          await apiPost<ScanResponse>('/api/v1/scan', {
            businessId: scan.businessId,
            raw: scan.raw,
            action: 'checkin',
            trigger: scan.trigger,
            amount: scan.amount,
            idempotencyKey: scan.idempotencyKey,
            queuedAt: scan.queuedAt,
          })
        } catch (cause) {
          // A 4xx will never succeed on retry — the customer was deleted, the
          // plan lapsed, the staff member lost access. Rethrow it as permanent
          // so it stops blocking the visits queued behind it.
          if (cause instanceof ApiError && cause.status < 500 && cause.status !== 429) {
            throw Object.assign(new Error(cause.message), { permanent: true })
          }
          throw cause
        }
      })
      if (result.abandoned.length > 0) {
        setAbandoned((previous) => [...previous, ...result.abandoned])
      }
    } finally {
      setSyncing(false)
      await refreshQueueSnapshot(businessId)
    }
  }, [businessId])

  // Drain the backlog as soon as there is a connection again, and once on mount
  // so a device closed mid-outage recovers simply by being opened.
  //
  // Deferred past the commit rather than started inside it: the merchant's first
  // paint of the scanner must not wait on a backlog flush, and the camera opening
  // is far more urgent than yesterday's queued visits.
  React.useEffect(() => {
    if (!businessId || !online) return
    const timer = setTimeout(() => void sync(), 0)
    return () => clearTimeout(timer)
  }, [businessId, online, sync])

  React.useEffect(() => {
    void pruneCustomerCache()
  }, [])

  const identify = React.useCallback(
    async (raw: string): Promise<ScanOutcome> => {
      if (!businessId) throw new Error('No business selected')

      try {
        const response = await apiPost<ScanResponse>('/api/v1/scan', {
          businessId,
          raw,
          action: 'identify',
        })
        if (response.resolution.kind === 'customer') {
          void cacheCustomer(businessId, raw, response.resolution.customer)
        }
        return { ...response, queued: false }
      } catch (cause) {
        const cached = isOffline(cause) ? await getCachedCustomer(businessId, raw) : null
        if (cached) {
          return {
            resolution: { kind: 'customer', customer: cached },
            checkin: null,
            fulfilled: null,
            queued: true,
          }
        }
        throw cause
      }
    },
    [businessId]
  )

  const checkIn = React.useCallback(
    async (
      raw: string,
      options: { amount?: number | null; decodeMs?: number } = {}
    ): Promise<ScanOutcome> => {
      if (!businessId) throw new Error('No business selected')

      const amount = options.amount ?? null
      const trigger: 'visit' | 'purchase' = amount ? 'purchase' : 'visit'
      // Minted once per attempt and reused by the queued copy, so an online
      // failure followed by an offline replay still credits exactly once.
      const idempotencyKey = newIdempotencyKey(`scan-${raw.slice(0, 24)}`)

      try {
        const response = await apiPost<ScanResponse>('/api/v1/scan', {
          businessId,
          raw,
          action: 'checkin',
          trigger,
          amount,
          idempotencyKey,
          decodeMs: options.decodeMs,
        })
        if (response.resolution.kind === 'customer') {
          void cacheCustomer(businessId, raw, response.resolution.customer)
        }
        return { ...response, queued: false }
      } catch (cause) {
        if (!isOffline(cause)) throw cause

        // Offline. Queue the credit unconditionally — the visit happened, and
        // losing it is not an acceptable outcome.
        const cached = await getCachedCustomer(businessId, raw)
        await enqueueScan({
          businessId,
          raw,
          amount,
          trigger,
          idempotencyKey,
          customerLabel: cached?.displayName ?? null,
        })

        if (!cached) {
          // Recorded, but we cannot say who it was until the connection is back.
          throw new OfflineQueuedError()
        }

        return {
          resolution: { kind: 'customer', customer: cached },
          checkin: optimisticCheckin(cached, amount),
          fulfilled: null,
          queued: true,
        }
      }
    },
    [businessId]
  )

  return {
    online,
    pending,
    syncing,
    abandoned,
    dismissAbandoned: () => setAbandoned([]),
    identify,
    checkIn,
    sync,
  }
}

/**
 * Thrown when a scan was safely queued but we cannot show who it was.
 *
 * Deliberately an error, not a silent success: the merchant must know the visit
 * is recorded *and* that the balance on screen cannot be trusted yet.
 */
export class OfflineQueuedError extends Error {
  constructor() {
    super('Saved. It will sync when you are back online.')
    this.name = 'OfflineQueuedError'
  }
}

// -----------------------------------------------------------------------------

/**
 * A failed fetch — as opposed to a rejected request.
 *
 * `ApiError` means the server answered, so the connection is fine and the
 * problem is real. Anything else (`TypeError: Failed to fetch`, an aborted
 * request) means we never got there, which is what we treat as offline.
 */
function isOffline(cause: unknown): boolean {
  if (cause instanceof ApiError) return false
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  return cause instanceof TypeError || cause instanceof DOMException
}

function useOnlineStatus(): boolean {
  return React.useSyncExternalStore(
    (listener) => {
      window.addEventListener('online', listener)
      window.addEventListener('offline', listener)
      return () => {
        window.removeEventListener('online', listener)
        window.removeEventListener('offline', listener)
      }
    },
    () => navigator.onLine,
    () => true
  )
}

/**
 * The screen to show for an offline check-in.
 *
 * Assumes one unit on the default programme, which is what the overwhelming
 * majority of stamp cards award per visit. Spend-based and multiplier rules
 * cannot be evaluated on the device, so the confirmation is marked as queued and
 * the server's numbers win on sync.
 */
function optimisticCheckin(customer: CounterCustomer, amount: number | null): CheckinOutcome {
  const program = customer.programs[0]
  if (!program) {
    return { duplicate: false, totalAwarded: 0, awards: [], rewardUnlocked: false, skipped: [] }
  }

  const balance = program.balance + 1
  const rewardAvailable = program.goal != null && balance >= program.goal

  return {
    duplicate: false,
    totalAwarded: 1,
    awards: [
      {
        programId: program.programId,
        programName: program.name,
        unitSingular: program.unitSingular,
        unitPlural: program.unitPlural,
        amount: 1,
        balance,
        goalAmount: program.goal,
        progressPercent:
          program.goal && program.goal > 0
            ? Math.min(100, Math.round((balance / program.goal) * 100))
            : 0,
        rewardAvailable,
        tierChanged: false,
      },
    ],
    rewardUnlocked: rewardAvailable,
    skipped: amount
      ? [{ ruleName: 'Spend rules', reason: 'Will be applied when this scan syncs' }]
      : [],
  }
}
