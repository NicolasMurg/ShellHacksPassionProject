import type { LatLng } from './types'

const EARTH_RADIUS_M = 6_371_000
const toRad = (deg: number) => (deg * Math.PI) / 180
const toDeg = (rad: number) => (rad * 180) / Math.PI

/** Straight-line distance in meters. */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h))
}

/** Compass heading (0-360) from a to b, used to point Street View at a spot. */
export function bearing(a: LatLng, b: LatLng): number {
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat))
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng))
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

/** Shift a point by meters east/north. Fine for the small distances on a campus. */
export function offset(p: LatLng, eastM: number, northM: number): LatLng {
  return {
    lat: p.lat + toDeg(northM / EARTH_RADIUS_M),
    lng: p.lng + toDeg(eastM / (EARTH_RADIUS_M * Math.cos(toRad(p.lat)))),
  }
}

/** A rectangle centered on a point, e.g. a curb zone. */
export function rect(center: LatLng, widthM: number, heightM: number): LatLng[] {
  const w = widthM / 2
  const h = heightM / 2
  return [offset(center, -w, h), offset(center, w, h), offset(center, w, -h), offset(center, -w, -h)]
}

/** A rectangle centered on a point and rotated to a compass bearing (e.g. along a road). */
export function orientedRect(center: LatLng, lengthM: number, widthM: number, bearingDeg: number): LatLng[] {
  const t = toRad(bearingDeg)
  const along = { e: Math.sin(t), n: Math.cos(t) } // unit vector along the road
  const across = { e: along.n, n: -along.e }
  const l = lengthM / 2
  const w = widthM / 2
  return [
    [l, w],
    [l, -w],
    [-l, -w],
    [-l, w],
  ].map(([a, c]) => offset(center, a * along.e + c * across.e, a * along.n + c * across.n))
}

export function centroid(points: LatLng[]): LatLng {
  const n = points.length || 1
  return {
    lat: points.reduce((s, p) => s + p.lat, 0) / n,
    lng: points.reduce((s, p) => s + p.lng, 0) / n,
  }
}

/** Shortest distance in meters from a point to a polyline. */
export function distanceToPath(p: LatLng, path: LatLng[]): number {
  if (path.length === 0) return Infinity
  if (path.length === 1) return distanceMeters(p, path[0])
  // Project to local meters around p, then do point-to-segment math.
  const toXY = (q: LatLng) => ({
    x: toRad(q.lng - p.lng) * EARTH_RADIUS_M * Math.cos(toRad(p.lat)),
    y: toRad(q.lat - p.lat) * EARTH_RADIUS_M,
  })
  let best = Infinity
  for (let i = 0; i < path.length - 1; i++) {
    const a = toXY(path[i])
    const b = toXY(path[i + 1])
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len2 = dx * dx + dy * dy
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / len2))
    best = Math.min(best, Math.hypot(a.x + t * dx, a.y + t * dy))
  }
  return best
}

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
    const a = toXY(path[i])
    const b = toXY(path[i + 1])
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
    const seg = distanceMeters(path[i - 1], path[i])
    if (left <= seg && seg > 0) {
      const t = left / seg
      return {
        lat: path[i - 1].lat + (path[i].lat - path[i - 1].lat) * t,
        lng: path[i - 1].lng + (path[i].lng - path[i - 1].lng) * t,
      }
    }
    left -= seg
  }
  return path[path.length - 1]
}

/** Split a path at `meters` along it into [traveled, ahead]. */
export function splitPath(path: LatLng[], meters: number): [LatLng[], LatLng[]] {
  if (path.length < 2) return [[], path]
  const cut = pointAlong(path, meters)
  let left = Math.max(0, meters)
  for (let i = 1; i < path.length; i++) {
    const seg = distanceMeters(path[i - 1], path[i])
    if (left <= seg) return [[...path.slice(0, i), cut], [cut, ...path.slice(i)]]
    left -= seg
  }
  return [path, [path[path.length - 1]]]
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.max(5, Math.round(meters / 5) * 5)} m`
  return `${(meters / 1000).toFixed(1)} km`
}

export function formatWalk(seconds: number): string {
  if (seconds < 60) return `${Math.max(10, Math.round(seconds / 10) * 10)} sec walk`
  return `${Math.round(seconds / 60)} min walk`
}
