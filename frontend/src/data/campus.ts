import type { Building, LatLng, Zone } from '../types'
import campus from './fiuCampus.json'

// FIU Modesto A. Maidique Campus (MMC).
//
// Buildings come from FIU's official campus map and doors from OpenStreetMap,
// combined by scripts/build-campus.ts into fiuCampus.json (re-run it to refresh).
// Curb zones are generated automatically for every door (see curbs.ts).

export const CAMPUS_CENTER: LatLng = { lat: 25.7568, lng: -80.3743 }

/** Where the car starts when we don't have your GPS (demo): the Information Center at the main entrance. */
export const CAMPUS_GATE: LatLng = { lat: 25.759961, lng: -80.376451 }

/** Where walk mode starts when you're not on campus (demo). */
export const WALK_DEMO_START = { location: { lat: 25.760203, lng: -80.371623 } as LatLng, label: 'PG5 Market Station' }

/**
 * OpenStreetMap doesn't say which FIU doors have stairs, so every door is
 * assumed step-free. List door ids here (see fiuCampus.json) that have stairs.
 */
const STAIRS_OVERRIDES = new Set<string>([])

export const BUILDINGS: Building[] = (campus.buildings as Building[]).map((b) => ({
  ...b,
  entrances: b.entrances.map((e) => (STAIRS_OVERRIDES.has(e.id) ? { ...e, accessible: false } : e)),
}))

/**
 * Zones the design team drew or adjusted by hand. A design zone for an
 * entrance replaces the generated one. Empty = use generated curbs everywhere.
 */
export const DESIGN_ZONES: Zone[] = []
