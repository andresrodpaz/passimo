'use client'

/**
 * Client-generated idempotency keys.
 *
 * The point-of-sale runs on café wifi. A tap that appears to fail is tapped
 * again, and without a stable key the customer gets awarded twice. Each key is
 * generated once per user intent and reused across retries of that same intent.
 *
 * Kept out of component modules so the randomness and clock reads happen in a
 * plain function rather than inside a render.
 */

let counter = 0

export function newIdempotencyKey(prefix: string): string {
  counter += 1
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10)
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}-${random}`
}
