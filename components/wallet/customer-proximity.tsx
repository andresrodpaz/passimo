'use client'

import * as React from 'react'
import { Clock, Loader2, MapPin, Navigation, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { apiFetch, apiPost, query } from '@/lib/client/api'
import { useI18n } from '@/lib/i18n'
import { formatDistance } from '@/lib/wallet/geo'

/**
 * Nearby stores and offers, on the customer's own card page.
 *
 * This is web geofencing, and it exists for the large majority of enrolled customers
 * who never install a wallet pass — roughly half of everyone who joins. Without it,
 * proximity would be a feature only iPhone-and-Android-wallet users receive, which
 * would make it a vendor feature rather than a product one.
 *
 * Three deliberate choices about consent and privacy, because this is the one place in
 * the product that asks a member of the public for their location:
 *
 *   1. **Nothing happens until they tap.** No `watchPosition` on mount, no permission
 *      prompt on page load. The button states what it is for, and the copy states
 *      what we keep, *before* the browser dialog appears. A prompt that arrives
 *      unexplained is refused, and a refusal is permanent for that origin.
 *
 *   2. **One reading, not a trail.** `getCurrentPosition`, not `watchPosition`. The
 *      question is "which of these shops is nearest right now", which one reading
 *      answers. A continuous watch would drain their battery to tell us something we
 *      did not ask.
 *
 *   3. **A refusal is not a dead end.** Denying location shows every store, unsorted,
 *      with a line that says that is fine. The list is the point; the sorting is a
 *      convenience.
 */

type NearbyResponse = {
  locations: Array<{
    id: string
    name: string
    address: string | null
    city: string | null
    distanceMeters: number | null
    isOpen: boolean
    phone: string | null
  }>
  offers: Array<{
    id: string
    name: string
    title: string
    message: string
    emoji: string | null
  }>
}

type State =
  | { kind: 'idle' }
  | { kind: 'locating' }
  | { kind: 'ready'; data: NearbyResponse; located: boolean }
  | { kind: 'denied'; data: NearbyResponse | null }

export function CustomerProximity({ token }: { token: string }) {
  const { t, locale } = useI18n()
  const [state, setState] = React.useState<State>({ kind: 'idle' })

  // The unlocated list, fetched on mount: "where can I use this card" is worth
  // answering before anyone is asked for anything.
  React.useEffect(() => {
    let cancelled = false
    apiFetch<NearbyResponse>(`/api/v1/public/proximity${query({ token })}`)
      .then((data) => {
        if (!cancelled) setState({ kind: 'ready', data, located: false })
      })
      .catch(() => {
        // A card whose business has no locations is normal; the section simply
        // does not render.
        if (!cancelled) setState({ kind: 'idle' })
      })
    return () => {
      cancelled = true
    }
  }, [token])

  const locate = React.useCallback(() => {
    if (!('geolocation' in navigator)) return
    setState((current) =>
      current.kind === 'ready' ? { kind: 'locating' } : { kind: 'locating' }
    )

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude, accuracy } = position.coords
        try {
          // Two calls: the list to render, and the geofence report that lets the
          // merchant's campaigns fire. Kept separate because the first is a read that
          // must never have side effects — opening this page cannot be allowed to
          // trigger a notification.
          const [data] = await Promise.all([
            apiFetch<NearbyResponse>(
              `/api/v1/public/proximity${query({ token, lat: latitude, lng: longitude })}`
            ),
            apiPost('/api/v1/public/proximity', {
              token,
              lat: latitude,
              lng: longitude,
              accuracyMeters: Math.round(accuracy),
              platform: 'web',
            }).catch(() => undefined),
          ])
          setState({ kind: 'ready', data, located: true })
        } catch {
          setState((current) => ({
            kind: 'denied',
            data: current.kind === 'ready' ? current.data : null,
          }))
        }
      },
      () =>
        setState((current) => ({
          kind: 'denied',
          data: current.kind === 'ready' ? current.data : null,
        })),
      { enableHighAccuracy: false, timeout: 8_000, maximumAge: 60_000 }
    )
  }, [token])

  const data = state.kind === 'ready' ? state.data : state.kind === 'denied' ? state.data : null
  if (!data || data.locations.length === 0) return null

  const located = state.kind === 'ready' && state.located

  return (
    <>
      {data.offers.length > 0 && (
        <section className="rounded-xl border border-primary/30 bg-primary/5 p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="size-4 text-primary" aria-hidden />
            {t('card.offers')}
          </h2>
          <ul className="mt-3 space-y-2">
            {data.offers.map((offer) => (
              <li key={offer.id} className="rounded-lg bg-background p-3">
                <p className="flex items-start gap-2 text-sm font-medium">
                  {offer.emoji && (
                    <span aria-hidden className="leading-none">
                      {offer.emoji}
                    </span>
                  )}
                  {offer.title}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">{offer.message}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-xl border bg-card p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <MapPin className="size-4 text-muted-foreground" aria-hidden />
          {t('card.nearby')}
        </h2>

        <ul className="mt-3 space-y-2">
          {data.locations.map((location) => (
            <li key={location.id} className="rounded-lg bg-muted/40 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{location.name}</p>
                  {(location.address || location.city) && (
                    <p className="truncate text-xs text-muted-foreground">
                      {[location.address, location.city].filter(Boolean).join(', ')}
                    </p>
                  )}
                </div>

                <div className="shrink-0 text-right">
                  {location.distanceMeters !== null && (
                    <p className="text-xs font-medium tabular-nums">
                      {t('card.nearbyDistance', {
                        distance: formatDistance(location.distanceMeters, locale),
                      })}
                    </p>
                  )}
                  <p
                    className={
                      location.isOpen
                        ? 'mt-0.5 flex items-center justify-end gap-1 text-[11px] text-emerald-600 dark:text-emerald-400'
                        : 'mt-0.5 flex items-center justify-end gap-1 text-[11px] text-muted-foreground'
                    }
                  >
                    <Clock className="size-3" aria-hidden />
                    {location.isOpen ? t('card.nearbyOpen') : t('card.nearbyClosed')}
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ul>

        {!located && state.kind !== 'denied' && (
          <div className="mt-3">
            <Button
              variant="outline"
              className="w-full gap-2"
              onClick={locate}
              disabled={state.kind === 'locating'}
            >
              {state.kind === 'locating' ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Navigation className="size-4" aria-hidden />
              )}
              {t('card.enableLocation')}
            </Button>
            {/* What we do with it, stated before the browser prompt appears. */}
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              {t('card.enableLocationBody')}
            </p>
          </div>
        )}

        {state.kind === 'denied' && (
          <p className="mt-3 text-[11px] text-muted-foreground">{t('card.locationDenied')}</p>
        )}
      </section>
    </>
  )
}
