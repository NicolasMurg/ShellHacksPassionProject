import { useSyncExternalStore } from 'react'
import { distanceToBoundaryRoads } from '../grid'
import { areaOf, initialMotion, stepMotion, type Area, type Fix, type Motion } from '../motion'
import { inCampus, surroundings, type CampusGraph } from '../walkRouter'

/** Half the width of the big boundary roads (6 lanes plus a median on Tamiami Trail). */
const BOUNDARY_ROAD_HALF_WIDTH_M = 30

/**
 * What's under a fix. The big roads around campus aren't in the footpath data (only their
 * sidewalks are), so the grid's edges, which are those roads' centerlines, cover them.
 */
export function areaAt(p: { lat: number; lng: number }, graph?: CampusGraph): Area {
  if (distanceToBoundaryRoads(p) <= BOUNDARY_ROAD_HALF_WIDTH_M) return 'road'
  return graph && inCampus(graph, p) ? areaOf(surroundings(graph, p)) : 'unknown'
}

// The current travel mode, shared by the map, the planner, navigation and Preferences.
// Fed from the GPS fixes the app already collects (no extra location tracking), kept
// only in memory on this device.

let motion: Motion = initialMotion
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
const snapshot = () => motion

/** Feed one GPS fix. On campus, the map says whether you're on a footpath, a campus drive or a road. */
export function recordFix(fix: Fix, graph?: CampusGraph): Motion {
  const next = stepMotion(motion, fix, areaAt(fix, graph))
  if (next === motion) return motion
  motion = next
  notify()
  return motion
}

/** Start measuring walking pace from zero (e.g. when a trip starts). */
export function resetWalked() {
  motion = { ...motion, walked: { meters: 0, seconds: 0 } }
  notify()
}

export function useMotion(): Motion {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}
