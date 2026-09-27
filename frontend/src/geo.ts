export * from '../../shared/geo'

// Frontend-only helpers for in-app navigation (tracking where you are along a route).
import { distanceMeters, type LatLng } from '../../shared/geo'

const EARTH_RADIUS_M = 6_371_000
const toRad = (deg: number) => (deg * Math.PI) / 180

/**
 * Where a point sits along a path: how far along it (meters from the start),
 * how far off it (meters), and which segment it's on.
 */
export function projectOnPath(p: LatLng, path: LatLng[]): { along: number; off: number; segment: number } {
  if (path.length < 2) return { along: 0, off: path[0] ? distanceMeters(p, path[0]) : Infinity, segment: 0 }
  const toXY = (q: LatLng) => ({
    x: toRad(q.lng - p.lng) * EARTH_RADIUS_M * Math.cos(toRad(p.lat)),
    y: toRad(q.lat - p.lat) * EARTH_RADIUS_M,
  })
  let best = { along: 0, off: Infinity, segment: 0 }
  let walked = 0
  for (let i = 0; i < path.length - 1; i++) {
    const a = toXY(path[i]!)
    const b = toXY(path[i + 1]!)
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.hypot(dx, dy)
    const t = len === 0 ? 0 : Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / (len * len)))
    const off = Math.hypot(a.x + t * dx, a.y + t * dy)
    if (off < best.off) best = { along: walked + t * len, off, segment: i }
    walked += len
  }
  return best
}

/** The point `meters` along a path (clamped to its ends). */
export function pointAlong(path: LatLng[], meters: number): LatLng {
  if (path.length === 0) return { lat: 0, lng: 0 }
  let left = Math.max(0, meters)
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!
    const b = path[i]!
    const seg = distanceMeters(a, b)
    if (left <= seg && seg > 0) {
      const t = left / seg
      return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t }
    }
    left -= seg
  }
  return path[path.length - 1]!
}

/** Split a path at `meters` along it into [traveled, ahead]. */
export function splitPath(path: LatLng[], meters: number): [LatLng[], LatLng[]] {
  if (path.length < 2) return [[], path]
  const cut = pointAlong(path, meters)
  let left = Math.max(0, meters)
  for (let i = 1; i < path.length; i++) {
    const seg = distanceMeters(path[i - 1]!, path[i]!)
    if (left <= seg) return [[...path.slice(0, i), cut], [cut, ...path.slice(i)]]
    left -= seg
  }
  return [path, [path[path.length - 1]!]]
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.max(5, Math.round(meters / 5) * 5)} m`
  return `${(meters / 1000).toFixed(1)} km`
}
