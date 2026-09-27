import { bearing, centroid, distanceMeters, offset, orientedRect, type LatLng } from './geo'

// Turns brush strokes painted on the map into one zone outline: the outline
// around everything painted (convex hull), widened by the brush radius.

/** Half the painted line's width on the ground at street zoom (the brush is ~22 px). */
const BRUSH_RADIUS_M = 3

type XY = { x: number; y: number }

/** Flat meters around `origin`; accurate enough at campus scale. */
function toXY(origin: LatLng, p: LatLng): XY {
  return {
    x: distanceMeters(origin, { lat: origin.lat, lng: p.lng }) * Math.sign(p.lng - origin.lng),
    y: distanceMeters(origin, { lat: p.lat, lng: origin.lng }) * Math.sign(p.lat - origin.lat),
  }
}

const cross = (o: XY, a: XY, b: XY) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)

/** Convex hull (monotone chain), returned counter-clockwise. */
function hull(points: { xy: XY; p: LatLng }[]) {
  const sorted = [...points].sort((a, b) => a.xy.x - b.xy.x || a.xy.y - b.xy.y)
  const build = (list: typeof sorted) => {
    const out: typeof sorted = []
    for (const q of list) {
      while (out.length >= 2 && cross(out[out.length - 2]!.xy, out[out.length - 1]!.xy, q.xy) <= 0) out.pop()
      out.push(q)
    }
    out.pop()
    return out
  }
  return [...build(sorted), ...build([...sorted].reverse())]
}

/** The zone outline for everything painted so far, or undefined if nothing is painted. */
export function paintedArea(strokes: LatLng[][]): LatLng[] | undefined {
  const points = strokes.flat()
  if (points.length === 0) return undefined
  const origin = points[0]!
  const outline = hull(points.map((p) => ({ xy: toXY(origin, p), p })))

  // A tap or a straight line has no area yet: use a brush-wide strip around it.
  if (outline.length < 3) {
    const ends = outline.length === 2 ? outline.map((o) => o.p) : [origin, origin]
    const length = distanceMeters(ends[0]!, ends[1]!)
    return orientedRect(centroid(ends), length + 2 * BRUSH_RADIUS_M, 2 * BRUSH_RADIUS_M, length > 0 ? bearing(ends[0]!, ends[1]!) : 0)
  }

  // Push every corner outward so the outline covers the brush's full width.
  const middle = centroid(outline.map((o) => o.p))
  return outline.map(({ p }) => {
    const d = distanceMeters(middle, p) || 1
    const { x, y } = toXY(middle, p)
    return offset(p, (x / d) * BRUSH_RADIUS_M, (y / d) * BRUSH_RADIUS_M)
  })
}

/** Whether a point lies inside a polygon (ray casting). */
export function insidePolygon(p: LatLng, polygon: LatLng[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!
    const b = polygon[j]!
    if (a.lat > p.lat !== b.lat > p.lat && p.lng < ((b.lng - a.lng) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lng) inside = !inside
  }
  return inside
}
