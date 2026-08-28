import { describe, expect, it } from 'vitest'
import {
  boundingBox,
  classifyTransition,
  coarsen,
  distanceMeters,
  formatDistance,
  isValidLatLng,
  isWithinRadius,
  nearestLocations,
} from '@/lib/wallet/geo'

/**
 * Geospatial primitives.
 *
 * Every proximity decision in the product reduces to these functions, and each of them
 * decides whether a real person's phone buzzes. The interesting cases are not the happy
 * path — they are the boundary, the antimeridian, the pole, and the phone sitting on a
 * table exactly on the fence line.
 */

// Real coordinates, so a wrong answer is recognisable rather than arbitrary.
const PUERTA_DEL_SOL = { lat: 40.4169, lng: -3.7035 }
const GRAN_VIA = { lat: 40.42, lng: -3.7025 }
const BARCELONA = { lat: 41.3874, lng: 2.1686 }

describe('distanceMeters', () => {
  it('is zero for the same point', () => {
    expect(distanceMeters(PUERTA_DEL_SOL, PUERTA_DEL_SOL)).toBe(0)
  })

  it('measures a short city walk to within a few metres', () => {
    // Sol to Gran Vía is ~350 m on foot; straight line is a little less.
    const metres = distanceMeters(PUERTA_DEL_SOL, GRAN_VIA)
    expect(metres).toBeGreaterThan(320)
    expect(metres).toBeLessThan(370)
  })

  it('measures a long distance against a known value', () => {
    // Madrid to Barcelona is 504 km great-circle. A haversine bug that swapped
    // latitude and longitude would still pass a short-distance test; this catches it.
    const km = distanceMeters(PUERTA_DEL_SOL, BARCELONA) / 1_000
    expect(km).toBeGreaterThan(500)
    expect(km).toBeLessThan(508)
  })

  it('is symmetric', () => {
    expect(distanceMeters(PUERTA_DEL_SOL, BARCELONA)).toBeCloseTo(
      distanceMeters(BARCELONA, PUERTA_DEL_SOL),
      6
    )
  })

  it('handles antipodal points without returning NaN', () => {
    const metres = distanceMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 180 })
    expect(Number.isFinite(metres)).toBe(true)
    // Half the circumference, ~20,015 km.
    expect(metres / 1_000).toBeGreaterThan(20_000)
  })

  it('measures across the antimeridian as a short hop, not a trip round the world', () => {
    // A naive implementation subtracting longitudes gives ~359° here and reports
    // 40,000 km for two points a few kilometres apart.
    const metres = distanceMeters({ lat: 0, lng: 179.98 }, { lat: 0, lng: -179.98 })
    expect(metres).toBeLessThan(5_000)
  })
})

describe('isValidLatLng', () => {
  it('accepts a real coordinate', () => {
    expect(isValidLatLng(PUERTA_DEL_SOL)).toBe(true)
  })

  it('rejects out-of-range, non-finite and non-numeric values', () => {
    expect(isValidLatLng({ lat: 91, lng: 0 })).toBe(false)
    expect(isValidLatLng({ lat: 0, lng: 181 })).toBe(false)
    expect(isValidLatLng({ lat: Number.NaN, lng: 0 })).toBe(false)
    expect(isValidLatLng({ lat: Infinity, lng: 0 })).toBe(false)
    expect(isValidLatLng({ lat: '40', lng: '-3' })).toBe(false)
    expect(isValidLatLng(null)).toBe(false)
    expect(isValidLatLng(undefined)).toBe(false)
  })

  it('accepts the extremes, which are legal coordinates', () => {
    expect(isValidLatLng({ lat: 90, lng: 180 })).toBe(true)
    expect(isValidLatLng({ lat: -90, lng: -180 })).toBe(true)
    expect(isValidLatLng({ lat: 0, lng: 0 })).toBe(true)
  })
})

describe('isWithinRadius', () => {
  it('includes a point inside and excludes one outside', () => {
    expect(isWithinRadius(GRAN_VIA, PUERTA_DEL_SOL, 500)).toBe(true)
    expect(isWithinRadius(GRAN_VIA, PUERTA_DEL_SOL, 100)).toBe(false)
  })

  it('treats a zero or negative radius as matching nothing', () => {
    // A merchant with geofencing off must not have every customer inside every fence.
    expect(isWithinRadius(PUERTA_DEL_SOL, PUERTA_DEL_SOL, 0)).toBe(false)
    expect(isWithinRadius(PUERTA_DEL_SOL, PUERTA_DEL_SOL, -10)).toBe(false)
  })
})

describe('boundingBox', () => {
  it('fully contains the circle it describes', () => {
    const box = boundingBox(PUERTA_DEL_SOL, 500)
    // Every point on the circle must be inside the box, or the SQL pre-filter would
    // silently drop stores the exact distance check would have matched.
    for (const bearing of [0, 45, 90, 135, 180, 225, 270, 315]) {
      const radians = (bearing * Math.PI) / 180
      const point = {
        lat: PUERTA_DEL_SOL.lat + (500 / 111_320) * Math.cos(radians),
        lng:
          PUERTA_DEL_SOL.lng +
          (500 / (111_320 * Math.cos((PUERTA_DEL_SOL.lat * Math.PI) / 180))) * Math.sin(radians),
      }
      expect(point.lat).toBeGreaterThanOrEqual(box.minLat)
      expect(point.lat).toBeLessThanOrEqual(box.maxLat)
      expect(point.lng).toBeGreaterThanOrEqual(box.minLng)
      expect(point.lng).toBeLessThanOrEqual(box.maxLng)
    }
  })

  it('widens with latitude, because a degree of longitude shrinks', () => {
    const madrid = boundingBox(PUERTA_DEL_SOL, 1_000)
    const reykjavik = boundingBox({ lat: 64.1466, lng: -21.9426 }, 1_000)
    expect(reykjavik.maxLng - reykjavik.minLng).toBeGreaterThan(madrid.maxLng - madrid.minLng)
  })

  it('degenerates safely at the pole instead of returning NaN', () => {
    const box = boundingBox({ lat: 90, lng: 0 }, 1_000)
    expect(Number.isFinite(box.minLng)).toBe(true)
    expect(Number.isFinite(box.maxLng)).toBe(true)
    expect(box.maxLat).toBeLessThanOrEqual(90)
  })

  it('never produces coordinates outside the legal range', () => {
    const box = boundingBox({ lat: -89.99, lng: 179.99 }, 100_000)
    expect(box.minLat).toBeGreaterThanOrEqual(-90)
    expect(box.maxLat).toBeLessThanOrEqual(90)
    expect(box.minLng).toBeGreaterThanOrEqual(-180)
    expect(box.maxLng).toBeLessThanOrEqual(180)
  })
})

describe('nearestLocations', () => {
  const stores = [
    { id: 'far', lat: BARCELONA.lat, lng: BARCELONA.lng, radius: 200 },
    { id: 'near', lat: GRAN_VIA.lat, lng: GRAN_VIA.lng, radius: 500 },
    { id: 'here', lat: PUERTA_DEL_SOL.lat, lng: PUERTA_DEL_SOL.lng, radius: 100 },
  ]

  it('sorts nearest first', () => {
    const matches = nearestLocations(PUERTA_DEL_SOL, stores)
    expect(matches.map((match) => match.target.id)).toEqual(['here', 'near', 'far'])
  })

  it('returns every candidate, not only those in range', () => {
    // Both answers are needed: "am I at a store" and "which store is closest".
    // Filtering here would make the second question unanswerable.
    expect(nearestLocations(PUERTA_DEL_SOL, stores, { radiusMeters: 50 })).toHaveLength(3)
  })

  it('marks inside using a per-target radius when given a function', () => {
    const matches = nearestLocations(PUERTA_DEL_SOL, stores, {
      radiusMeters: (target) => target.radius,
    })
    const inside = matches.filter((match) => match.inside).map((match) => match.target.id)
    // 'near' is ~350 m away with a 500 m radius; 'here' is 0 m with 100 m.
    expect(inside).toEqual(['here', 'near'])
  })

  it('honours a limit', () => {
    expect(nearestLocations(PUERTA_DEL_SOL, stores, { limit: 2 })).toHaveLength(2)
  })

  it('skips candidates with unusable coordinates', () => {
    const matches = nearestLocations(PUERTA_DEL_SOL, [
      ...stores,
      { id: 'broken', lat: Number.NaN, lng: 0, radius: 100 },
    ])
    expect(matches.map((match) => match.target.id)).not.toContain('broken')
  })

  it('returns nothing for an empty candidate list', () => {
    expect(nearestLocations(PUERTA_DEL_SOL, [])).toEqual([])
  })
})

describe('coarsen', () => {
  it('rounds to roughly the requested precision', () => {
    const coarse = coarsen(PUERTA_DEL_SOL, 100)
    expect(distanceMeters(PUERTA_DEL_SOL, coarse)).toBeLessThan(120)
  })

  it('is stable: coarsening twice changes nothing', () => {
    // The stored value is replaced on every report, so an unstable rounding would
    // make a stationary device look like it was moving.
    const once = coarsen(PUERTA_DEL_SOL)
    expect(coarsen(once)).toEqual(once)
  })

  it('maps nearby points to the same cell, which is the privacy property', () => {
    const a = coarsen({ lat: 40.41690, lng: -3.70350 })
    const b = coarsen({ lat: 40.41692, lng: -3.70352 })
    expect(a).toEqual(b)
  })

  it('does not blow up near the poles', () => {
    const coarse = coarsen({ lat: 89.999, lng: 10 })
    expect(Number.isFinite(coarse.lat)).toBe(true)
    expect(Number.isFinite(coarse.lng)).toBe(true)
  })
})

describe('classifyTransition', () => {
  const base = { radiusMeters: 200, dwellMinutes: 0 }

  it('fires entry only on a genuine crossing', () => {
    expect(classifyTransition({ ...base, distanceMeters: 100, wasInside: false })).toBe('enter')
    // Already inside: a steady state, not a new event. Firing here would send a
    // notification on every position report the phone volunteers.
    expect(classifyTransition({ ...base, distanceMeters: 100, wasInside: true })).toBe('inside')
  })

  it('reports outside without an event when it was never inside', () => {
    expect(classifyTransition({ ...base, distanceMeters: 900, wasInside: false })).toBe('outside')
  })

  it('requires clearing the hysteresis band to call an exit', () => {
    // A device on a table at 210 m with a 200 m fence would otherwise oscillate
    // in and out dozens of times an hour, each one a notification.
    expect(
      classifyTransition({ ...base, distanceMeters: 210, wasInside: true, hysteresisMeters: 25 })
    ).toBe('inside')
    expect(
      classifyTransition({ ...base, distanceMeters: 240, wasInside: true, hysteresisMeters: 25 })
    ).toBe('exit')
  })

  it('does not apply hysteresis to entry, so a fence is not silently wider', () => {
    expect(
      classifyTransition({ ...base, distanceMeters: 210, wasInside: false, hysteresisMeters: 25 })
    ).toBe('outside')
  })

  it('fires dwell once the threshold has elapsed', () => {
    const now = new Date('2026-07-30T12:00:00Z')
    const enteredAt = new Date('2026-07-30T11:50:00Z')

    expect(
      classifyTransition({
        ...base,
        distanceMeters: 50,
        wasInside: true,
        enteredAt,
        dwellMinutes: 5,
        now,
      })
    ).toBe('dwell')

    expect(
      classifyTransition({
        ...base,
        distanceMeters: 50,
        wasInside: true,
        enteredAt,
        dwellMinutes: 30,
        now,
      })
    ).toBe('inside')
  })

  it('never reports dwell without an entry time to measure from', () => {
    expect(
      classifyTransition({
        ...base,
        distanceMeters: 50,
        wasInside: true,
        enteredAt: null,
        dwellMinutes: 5,
      })
    ).toBe('inside')
  })

  it('never reports dwell on the same report as the entry', () => {
    // The dwell clock starts now; a merchant asking for "after 5 minutes inside"
    // must not have it fire at the door.
    const now = new Date('2026-07-30T12:00:00Z')
    expect(
      classifyTransition({
        ...base,
        distanceMeters: 50,
        wasInside: false,
        enteredAt: now,
        dwellMinutes: 5,
        now,
      })
    ).toBe('enter')
  })
})

describe('formatDistance', () => {
  it('rounds metres to the nearest ten, which is all the accuracy there is', () => {
    expect(formatDistance(123)).toBe('120 m')
    expect(formatDistance(0)).toBe('0 m')
  })

  it('switches to kilometres above a thousand metres', () => {
    expect(formatDistance(1_400, 'en')).toBe('1.4 km')
    expect(formatDistance(24_000, 'en')).toBe('24 km')
  })

  it('renders a placeholder rather than NaN for unusable input', () => {
    expect(formatDistance(Number.NaN)).toBe('—')
    expect(formatDistance(-5)).toBe('—')
  })
})
