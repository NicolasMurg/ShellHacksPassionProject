import type { GeoPoint, RouteRestriction } from '@prisma/client';
import { distanceToPath, type LatLng } from '../../../shared/geo';
const asLatLng = (point: GeoPoint): LatLng => ({ lat: point.coordinates[1]!, lng: point.coordinates[0]! });

function intersects(a: LatLng, b: LatLng, c: LatLng, d: LatLng) {
  const cross = (p: LatLng, q: LatLng, r: LatLng) => (q.lng - p.lng) * (r.lat - p.lat) - (q.lat - p.lat) * (r.lng - p.lng);
  return cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0;
}
function inside(p: LatLng, polygon: LatLng[]) {
  let contained = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!, b = polygon[j]!;
    if ((a.lat > p.lat) !== (b.lat > p.lat) && p.lng < (b.lng - a.lng) * (p.lat - a.lat) / (b.lat - a.lat) + a.lng) contained = !contained;
  }
  return contained;
}
/** Check both crossings and proximity, including the interior of an area report. */
export function touchesRestriction(path: GeoPoint[], restriction: Pick<RouteRestriction, 'points' | 'geometryType'>) {
  const route = path.map(asLatLng), points = restriction.points.map(asLatLng);
  if (!points.length || !route.length) return false;
  if (restriction.geometryType === 'AREA' && route.some(p => inside(p, points))) return true;
  const boundary = restriction.geometryType === 'AREA' ? [...points, points[0]!] : points;
  if (route.some(p => distanceToPath(p, boundary) < 12) || boundary.some(p => distanceToPath(p, route) < 12)) return true;
  for (let i = 1; i < route.length; i++) for (let j = 1; j < boundary.length; j++) {
    if (intersects(route[i - 1]!, route[i]!, boundary[j - 1]!, boundary[j]!)) return true;
  }
  return false;
}
