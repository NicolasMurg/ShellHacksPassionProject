import { distanceMeters } from './geo'
import type { Building, Entrance, LatLng } from './types'
import { inCampus, routeWalk, type CampusGraph } from './walkRouter'

// Your own drop-off pin: drag the car anywhere near the building and the trip goes there.

/** How far from the building a drop-off pin may go: from its address pin or any of its doors. */
export const PIN_REACH_M = 100
/** The zone id the pin's drop-off option uses. */
export const PIN_ZONE_ID = 'your-pin'

const M_PER_DEG_LAT = 111_320

/** A dragged pin kept within `reach` of the building (`anchors`: its address pin and doors). */
export function clampPin(anchors: LatLng[], p: LatLng, reach = PIN_REACH_M): { point: LatLng; moved: boolean } {
  let nearest: LatLng | undefined
  let nearestMeters = Infinity
  for (const a of anchors) {
    const d = distanceMeters(a, p)
    if (d < nearestMeters) {
      nearest = a
      nearestMeters = d
    }
  }
  if (!nearest || nearestMeters <= reach) return { point: p, moved: false }
  // Pulled straight back toward the closest part of the building, to just inside the edge.
  const t = (reach - 0.5) / nearestMeters
  return { point: { lat: nearest.lat + (p.lat - nearest.lat) * t, lng: nearest.lng + (p.lng - nearest.lng) * t }, moved: true }
}

/** The outline of where the pin may go (within `reach` of any anchor), to draw while dragging. */
export function reachArea(anchors: LatLng[], reach = PIN_REACH_M, steps = 72): LatLng[] {
  if (anchors.length === 0) return []
  const center = {
    lat: anchors.reduce((sum, a) => sum + a.lat, 0) / anchors.length,
    lng: anchors.reduce((sum, a) => sum + a.lng, 0) / anchors.length,
  }
  const mPerDegLng = M_PER_DEG_LAT * Math.cos((center.lat * Math.PI) / 180)
  const far = reach + Math.max(...anchors.map((a) => distanceMeters(center, a)))
  const within = (p: LatLng) => anchors.some((a) => distanceMeters(a, p) <= reach)
  return Array.from({ length: steps }, (_, i) => {
    const angle = (2 * Math.PI * i) / steps
    const at = (r: number) => ({
      lat: center.lat + (Math.sin(angle) * r) / M_PER_DEG_LAT,
      lng: center.lng + (Math.cos(angle) * r) / mPerDegLng,
    })
    // Walk in from outside until the ray reaches the allowed area.
    let r = far
    while (r > 0 && !within(at(r))) r -= 2
    return at(r)
  })
}

/**
 * From a drop-off pin, the door with the shortest walk (step-free doors when that's needed).
 * The walk uses the campus paths and any linked doorways, so a shortcut through a building
 * is taken when it's quicker.
 */
export function walkFromPin(
  graph: CampusGraph | undefined,
  entrances: Entrance[],
  pin: LatLng,
  stepFree: boolean,
): { entrance: Entrance; path: LatLng[]; meters: number; indoorMeters: number } | undefined {
  const usable = stepFree && entrances.some((e) => e.accessible) ? entrances.filter((e) => e.accessible) : entrances
  let best: ReturnType<typeof walkFromPin>
  for (const entrance of usable) {
    const route = graph && inCampus(graph, pin) ? routeWalk(graph, pin, entrance.location, { stepFree }) : undefined
    const walk = route
      ? { path: route.path, meters: route.meters, indoorMeters: route.indoorMeters }
      : { path: [pin, entrance.location], meters: distanceMeters(pin, entrance.location) * 1.3, indoorMeters: 0 }
    if (!best || walk.meters < best.meters) best = { entrance, ...walk }
  }
  return best
}

/** How far `p` is from a building: from its address pin or its closest door. */
const fromBuilding = (b: Building, p: LatLng) =>
  Math.min(distanceMeters(b.location, p), ...b.entrances.map((e) => distanceMeters(e.location, p)))

/**
 * Doors you placed on the grid that belong to `building`: within PIN_REACH_M of it, and closer to
 * it than to any other building. They count as its doors, so a drop-off can walk to one.
 */
export function placedDoorsAt(
  building: Building,
  buildings: Building[],
  placed: { id: string; label: string; location: LatLng }[],
): Entrance[] {
  return placed.flatMap((d) => {
    const here = fromBuilding(building, d.location)
    if (here > PIN_REACH_M || buildings.some((b) => b.id !== building.id && fromBuilding(b, d.location) < here)) return []
    return [{ id: `placed-${d.id}`, buildingId: building.id, label: `${d.label} (your door)`, location: d.location, accessible: false, rooms: [] }]
  })
}
