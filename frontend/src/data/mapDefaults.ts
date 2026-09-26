import type { LatLng } from '../types'

export const CAMPUS_CENTER: LatLng = { lat: 25.7568, lng: -80.3743 }

/** Where the car starts when we don't have your GPS: main entrance off SW 8th St. */
export const CAMPUS_GATE: LatLng = { lat: 25.7619, lng: -80.3706 }

/** Where walk mode starts when you're not on campus (demo): PG5 Market Station garage. */
export const WALK_DEMO_START = { location: { lat: 25.7604, lng: -80.3722 } as LatLng, label: 'PG5 Market Station garage' }

