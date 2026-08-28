'use client'

import * as React from 'react'
import { useI18n } from '@/lib/i18n'

/**
 * Small client hooks that keep components free of render-time impurity.
 *
 * `Date.now()`, `localStorage` and feature detection are all impure or
 * browser-only. Reading them directly during render breaks hydration and
 * React's concurrent rendering guarantees, so they are captured once here
 * behind `useSyncExternalStore` / lazy state instead.
 */

/**
 * A shared clock.
 *
 * One interval for the whole app rather than one per component, exposed
 * through `useSyncExternalStore` so reading the time is not an impure render
 * or a setState-in-effect. The server snapshot is 0, which callers render as
 * an absolute date — so hydration always matches.
 */
const clock = (() => {
  let value = 0
  let timer: ReturnType<typeof setInterval> | null = null
  const listeners = new Set<() => void>()

  return {
    subscribe(listener: () => void) {
      if (value === 0) value = Date.now()
      listeners.add(listener)
      timer ??= setInterval(() => {
        value = Date.now()
        for (const notify of listeners) notify()
      }, 60_000)

      return () => {
        listeners.delete(listener)
        if (listeners.size === 0 && timer) {
          clearInterval(timer)
          timer = null
        }
      }
    },
    get: () => value,
  }
})()

export function useNow(): number {
  return React.useSyncExternalStore(clock.subscribe, clock.get, () => 0)
}

const noopSubscribe = () => () => {}

/** Reads a browser-only value without a hydration mismatch or a setState effect. */
export function useClientValue<T>(read: () => T, serverValue: T): T {
  return React.useSyncExternalStore(noopSubscribe, read, () => serverValue)
}

/** Persisted UI preference (active workspace, collapsed sidebar, …). */
export function useStoredValue(
  key: string,
  fallback: string | null = null
): [string | null, (value: string) => void] {
  const stored = React.useSyncExternalStore(
    (onChange) => {
      // Keeps multiple tabs in sync.
      window.addEventListener('storage', onChange)
      return () => window.removeEventListener('storage', onChange)
    },
    () => window.localStorage.getItem(key),
    () => fallback
  )

  const [override, setOverride] = React.useState<string | null>(null)

  const set = React.useCallback(
    (value: string) => {
      window.localStorage.setItem(key, value)
      setOverride(value)
    },
    [key]
  )

  return [override ?? stored, set]
}

/**
 * Relative time, in the viewer's language, that degrades to an absolute date
 * before hydration.
 *
 * The previous implementation assembled "3 days ago" by hand, which is wrong in
 * two separate ways once a second language exists: the words are English, and
 * the *shape* is English — Spanish puts the preposition first ("hace 3 días"),
 * so no amount of translating the noun would have produced a correct sentence.
 * `Intl.RelativeTimeFormat` knows both, including the "yesterday"/"ayer" special
 * case that `numeric: 'auto'` turns on.
 *
 * Still takes `now` from the shared clock rather than calling `Date.now()`, so
 * it stays pure during render and the server snapshot (0) is hydration-safe.
 */
export function useRelativeTime(): (iso: string | null, options?: { short?: boolean }) => string {
  const { t, tag, formatDate } = useI18n()
  const now = useNow()

  return React.useCallback(
    (iso, options = {}) => {
      if (!iso) return t('common.never')
      const at = new Date(iso).getTime()
      if (Number.isNaN(at)) return '—'
      // Before hydration there is no clock, so an absolute date is the only
      // answer that is identical on the server and the client.
      if (now === 0) return formatDate(iso)

      const seconds = (at - now) / 1000
      const formatter = new Intl.RelativeTimeFormat(tag, {
        numeric: 'auto',
        style: options.short ? 'narrow' : 'long',
      })

      for (const [unit, size] of RELATIVE_THRESHOLDS) {
        if (Math.abs(seconds) >= size) return formatter.format(Math.round(seconds / size), unit)
      }
      return formatter.format(Math.round(seconds), 'second')
    },
    [t, tag, formatDate, now]
  )
}

const RELATIVE_THRESHOLDS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 31_536_000],
  ['month', 2_592_000],
  ['week', 604_800],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
]
