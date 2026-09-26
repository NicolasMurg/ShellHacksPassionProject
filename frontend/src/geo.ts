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

export function formatWalk(seconds: number): string {
  if (seconds < 60) return `${Math.max(10, Math.round(seconds / 10) * 10)} sec walk`
  return `${Math.round(seconds / 60)} min walk`
}
