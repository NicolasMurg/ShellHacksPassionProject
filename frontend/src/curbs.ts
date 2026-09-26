import { CAMPUS_GATE } from './data/campus'
import { bearing, orientedRect } from './geo'
import type { Building, Entrance, LatLng, Zone } from './types'

// Automatic curb generation: for each entrance, find the closest point on a
// road a car can actually reach. We ask Google for a DRIVING route to the door;
// Google snaps the destination to the nearest drivable road, so the route's end
// point is exactly that curb.
//
// The backend should own this (Routes API computeRoutes, same idea) and store
// the results. Until then the frontend runs it and caches results locally.

const CURB_LENGTH_M = 20
const CURB_WIDTH_M = 6

type CurbFix = { stopPoint: LatLng; roadBearing: number }

function cacheKey(e: Entrance) {
  return `doorstep.curb.v1.${e.id}.${e.location.lat.toFixed(6)},${e.location.lng.toFixed(6)}`
}

function readCache(e: Entrance): CurbFix | undefined {
  try {
    const raw = localStorage.getItem(cacheKey(e))
    return raw ? (JSON.parse(raw) as CurbFix) : undefined
  } catch {
    return undefined
  }
}

function writeCache(e: Entrance, fix: CurbFix) {
  try {
    localStorage.setItem(cacheKey(e), JSON.stringify(fix))
  } catch {
    // ignore: we'll just recompute next time
  }
}

async function findCurb(service: google.maps.DirectionsService, e: Entrance): Promise<CurbFix> {
  const cached = readCache(e)
  if (cached) return cached

  const res = await service.route({ origin: CAMPUS_GATE, destination: e.location, travelMode: google.maps.TravelMode.DRIVING })
  const leg = res.routes[0]?.legs[0]
  const path = res.routes[0]?.overview_path ?? []
  if (!leg?.end_location) throw new Error(`No drivable road near ${e.label}`)

  const stopPoint = leg.end_location.toJSON()
  // Direction of the road at the curb, so the zone lines up with the street.
  const prev = path.length >= 2 ? path[path.length - 2].toJSON() : CAMPUS_GATE
  const fix = { stopPoint, roadBearing: bearing(prev, stopPoint) }
  writeCache(e, fix)
  return fix
}

export function curbZone(building: Building, e: Entrance, fix: CurbFix): Zone {
  return {
    id: `gen-${e.id}`,
    buildingId: building.id,
    entranceId: e.id,
    source: 'generated',
    name: 'Nearest curb',
    kinds: ['dropoff', 'pickup'],
    polygon: orientedRect(fix.stopPoint, CURB_LENGTH_M, CURB_WIDTH_M, fix.roadBearing),
    stopPoint: fix.stopPoint,
    ownerId: null,
  }
}

/**
 * Generates a curb zone for every entrance that doesn't already have one.
 * Calls onZone as each finishes so the map fills in progressively.
 */
export async function generateCurbs(
  service: google.maps.DirectionsService,
  buildings: Building[],
  skipEntranceIds: Set<string>,
  onZone: (z: Zone) => void,
  isCancelled: () => boolean,
) {
  for (const b of buildings) {
    for (const e of b.entrances) {
      if (isCancelled()) return
      if (skipEntranceIds.has(e.id)) continue
      try {
        const cached = readCache(e)
        const fix = cached ?? (await findCurb(service, e))
        if (!cached) await new Promise((r) => setTimeout(r, 120)) // stay under Google's rate limit
        if (!isCancelled()) onZone(curbZone(b, e, fix))
      } catch (err) {
        console.warn(`Couldn't generate a curb for ${e.id}:`, err)
      }
    }
  }
}
