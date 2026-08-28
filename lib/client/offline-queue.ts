'use client'

/**
 * Offline counter support.
 *
 * A café's wifi drops. The queue does not. A scan captured with no connection is
 * written to IndexedDB and replayed when the network returns, and because every
 * queued scan carries the idempotency key it was created with, replaying is
 * safe no matter how many times it happens — the server credits exactly once.
 *
 * The customer cache is the other half: a scan can only be *served* offline if
 * we already know who that code belongs to, so every successful identification
 * is cached and reused when the lookup cannot be made.
 *
 * IndexedDB rather than localStorage because this holds money-adjacent records
 * that must survive a tab crash, and because writing them must not block the
 * frame that is showing the confirmation.
 */

import type { CounterCustomer } from '@/lib/scan/counter'

const DB_NAME = 'passimo-counter'
const DB_VERSION = 1
const SCANS = 'scans'
const CUSTOMERS = 'customers'

/** A cached identification older than this is not trusted for a check-in. */
const CUSTOMER_CACHE_TTL_MS = 24 * 60 * 60 * 1000

/** Give up on a scan that has failed this many times, and tell the merchant. */
const MAX_ATTEMPTS = 8

export type QueuedScan = {
  id?: number
  businessId: string
  raw: string
  amount: number | null
  trigger: 'visit' | 'purchase'
  idempotencyKey: string
  queuedAt: string
  attempts: number
  lastError: string | null
  /** Shown in the pending list so staff recognise whose visit is waiting. */
  customerLabel: string | null
}

type CachedCustomer = {
  key: string
  businessId: string
  customer: CounterCustomer
  cachedAt: number
}

// -----------------------------------------------------------------------------
// Storage
// -----------------------------------------------------------------------------

let dbPromise: Promise<IDBDatabase | null> | null = null

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)

  dbPromise ??= new Promise<IDBDatabase | null>((resolve) => {
    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION)
    } catch {
      // Safari in private mode throws rather than returning an error event.
      resolve(null)
      return
    }

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(SCANS)) {
        // Auto-increment keys give us replay in capture order for free, which is
        // what makes a queued sequence of visits land in the order they happened.
        const store = db.createObjectStore(SCANS, { keyPath: 'id', autoIncrement: true })
        store.createIndex('businessId', 'businessId')
      }
      if (!db.objectStoreNames.contains(CUSTOMERS)) {
        db.createObjectStore(CUSTOMERS, { keyPath: 'key' })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
    request.onblocked = () => resolve(null)
  })

  return dbPromise
}

function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) {
          resolve(null)
          return
        }
        try {
          const transaction = db.transaction(store, mode)
          const request = run(transaction.objectStore(store))
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => resolve(null)
          transaction.onabort = () => resolve(null)
        } catch {
          resolve(null)
        }
      })
  )
}

// -----------------------------------------------------------------------------
// Queue
// -----------------------------------------------------------------------------

export async function enqueueScan(
  scan: Omit<QueuedScan, 'id' | 'attempts' | 'lastError' | 'queuedAt'> &
    Partial<Pick<QueuedScan, 'queuedAt'>>
): Promise<void> {
  await tx(SCANS, 'readwrite', (store) =>
    store.add({
      ...scan,
      queuedAt: scan.queuedAt ?? new Date().toISOString(),
      attempts: 0,
      lastError: null,
    })
  )
  notify()
}

export async function listQueuedScans(businessId: string): Promise<QueuedScan[]> {
  const all = await tx<QueuedScan[]>(SCANS, 'readonly', (store) => store.getAll())
  return (all ?? []).filter((scan) => scan.businessId === businessId)
}

export async function countQueuedScans(businessId: string): Promise<number> {
  return (await listQueuedScans(businessId)).length
}

async function removeScan(id: number): Promise<void> {
  await tx(SCANS, 'readwrite', (store) => store.delete(id) as unknown as IDBRequest<undefined>)
}

async function markAttempt(scan: QueuedScan, error: string): Promise<void> {
  if (scan.id == null) return
  await tx(SCANS, 'readwrite', (store) =>
    store.put({ ...scan, attempts: scan.attempts + 1, lastError: error })
  )
}

export type FlushResult = {
  sent: number
  failed: number
  /** Scans dropped after too many attempts — the merchant should be told. */
  abandoned: QueuedScan[]
}

export type FlushDecision = 'abandon' | 'retry'

/**
 * What to do with a queued scan that failed to sync.
 *
 * Split out from `flushQueue` because this is the decision that can silently
 * lose a merchant's revenue, and it is the one part of the queue that can be
 * tested without a browser. Getting it wrong in either direction is bad: drop
 * too eagerly and a real visit disappears; retry forever and one poisoned
 * record blocks every visit queued behind it.
 */
export function decideFlushOutcome(cause: unknown, attempts: number): FlushDecision {
  const permanent =
    typeof cause === 'object' && cause !== null && 'permanent' in cause
      ? Boolean((cause as { permanent?: unknown }).permanent)
      : false

  // A 4xx will never succeed on retry — the customer was deleted, the plan
  // lapsed, the staff member lost access.
  if (permanent) return 'abandon'
  return attempts + 1 >= MAX_ATTEMPTS ? 'abandon' : 'retry'
}

/**
 * Replays queued scans oldest-first.
 *
 * `send` must reject to indicate failure. A rejection carrying `permanent: true`
 * (a 4xx: deleted customer, revoked access) drops the scan, because retrying it
 * forever would block every visit queued behind it. Anything else is treated as
 * "the network is still bad" and left in place.
 *
 * Stops at the first transient failure rather than hammering a dead connection
 * with the whole backlog.
 */
export async function flushQueue(
  businessId: string,
  send: (scan: QueuedScan) => Promise<void>
): Promise<FlushResult> {
  const queued = (await listQueuedScans(businessId)).sort((a, b) => (a.id ?? 0) - (b.id ?? 0))
  const result: FlushResult = { sent: 0, failed: 0, abandoned: [] }

  for (const scan of queued) {
    try {
      await send(scan)
      if (scan.id != null) await removeScan(scan.id)
      result.sent += 1
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Sync failed'

      if (decideFlushOutcome(cause, scan.attempts) === 'abandon') {
        if (scan.id != null) await removeScan(scan.id)
        result.abandoned.push({ ...scan, lastError: message })
        // A poisoned record is dropped and the queue keeps draining, so one bad
        // scan cannot hold up every visit behind it.
        continue
      }

      await markAttempt(scan, message)
      result.failed += 1
      // Still offline: stop here and keep the rest of the backlog intact rather
      // than burning every record's attempt counter against a dead connection.
      break
    }
  }

  notify()
  return result
}

// -----------------------------------------------------------------------------
// Customer cache
// -----------------------------------------------------------------------------

function cacheKey(businessId: string, raw: string): string {
  return `${businessId}::${raw.trim()}`
}

/**
 * Caches an identification against both the scanned string and the customer id,
 * so a customer identified by a typed phone number is still recognised when
 * their wallet pass is scanned offline later.
 */
export async function cacheCustomer(
  businessId: string,
  raw: string,
  customer: CounterCustomer
): Promise<void> {
  const cachedAt = Date.now()
  const entries: CachedCustomer[] = [
    { key: cacheKey(businessId, raw), businessId, customer, cachedAt },
    { key: cacheKey(businessId, customer.id), businessId, customer, cachedAt },
  ]
  await Promise.all(entries.map((entry) => tx(CUSTOMERS, 'readwrite', (store) => store.put(entry))))
}

export async function getCachedCustomer(
  businessId: string,
  raw: string
): Promise<CounterCustomer | null> {
  const entry = await tx<CachedCustomer | undefined>(CUSTOMERS, 'readonly', (store) =>
    store.get(cacheKey(businessId, raw))
  )
  if (!entry) return null
  // Stale balances are worse than no balances: staff would quote a wrong number.
  if (Date.now() - entry.cachedAt > CUSTOMER_CACHE_TTL_MS) return null
  return entry.customer
}

/** Bounded so a long-lived counter device does not grow without limit. */
export async function pruneCustomerCache(max = 500): Promise<void> {
  const all = await tx<CachedCustomer[]>(CUSTOMERS, 'readonly', (store) => store.getAll())
  if (!all || all.length <= max) return

  const stale = all
    .sort((a, b) => b.cachedAt - a.cachedAt)
    .slice(max)
    .map((entry) => entry.key)

  await Promise.all(
    stale.map((key) =>
      tx(CUSTOMERS, 'readwrite', (store) => store.delete(key) as unknown as IDBRequest<undefined>)
    )
  )
}

// -----------------------------------------------------------------------------
// Reactive snapshot
// -----------------------------------------------------------------------------

/**
 * The queue is an external system, so React reads it through
 * `useSyncExternalStore` rather than mirroring it into component state. That
 * keeps the pending count correct across every scanner mounted at once and
 * avoids a render cascade on each enqueue.
 *
 * The snapshot is a cached number because `getSnapshot` must be synchronous and
 * return a stable value, while IndexedDB is asynchronous.
 */
let snapshot = 0
let snapshotBusinessId: string | null = null

const listeners = new Set<() => void>()

function notify(): void {
  if (snapshotBusinessId) void refreshQueueSnapshot(snapshotBusinessId)
  else for (const listener of listeners) listener()
}

/** Recomputes the cached pending count and notifies subscribers if it changed. */
export async function refreshQueueSnapshot(businessId: string): Promise<void> {
  snapshotBusinessId = businessId
  const count = (await listQueuedScans(businessId)).length
  if (count === snapshot) return
  snapshot = count
  for (const listener of listeners) listener()
}

export function getQueueSnapshot(): number {
  return snapshot
}

/** Server render has nothing queued, and must not touch IndexedDB. */
export function getServerQueueSnapshot(): number {
  return 0
}

export function subscribeToQueue(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
