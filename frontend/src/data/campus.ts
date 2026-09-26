import { rect } from '../geo'
import type { Building, LatLng, TripKind, Zone } from '../types'

// FIU Modesto A. Maidique Campus (MMC): default buildings and drop-off/pickup
// zones drawn by our design team.
//
// Coordinates are APPROXIMATE placeholders. Check every building, curb and
// entrance on the map / Street View (or in person) and correct them. This data
// should move to the backend seed once the API is up.

export const CAMPUS_CENTER: LatLng = { lat: 25.7568, lng: -80.3743 }

export const BUILDINGS: Building[] = [
  { id: 'gc', code: 'GC', name: 'Graham Center', location: { lat: 25.75625, lng: -80.37318 } },
  { id: 'gl', code: 'GL', name: 'Green Library', location: { lat: 25.75735, lng: -80.37375 } },
  { id: 'pc', code: 'PC', name: 'Primera Casa', location: { lat: 25.7553, lng: -80.3731 } },
  { id: 'dm', code: 'DM', name: 'Deuxième Maison', location: { lat: 25.7562, lng: -80.3755 } },
  { id: 'rb', code: 'RB', name: 'Ryder Business Building', location: { lat: 25.75955, lng: -80.37335 } },
  { id: 'obc', code: 'OBC', name: 'Ocean Bank Convocation Center', location: { lat: 25.7585, lng: -80.3789 } },
]

type ZoneSeed = {
  id: string
  buildingId: string
  name: string
  stop: LatLng
  /** Curb zone size in meters (east-west × north-south). */
  size?: [number, number]
  kinds?: TripKind[]
  entrance: [label: string, location: LatLng, accessible: boolean]
  rooms?: string[]
}

const zone = (s: ZoneSeed): Zone => ({
  id: s.id,
  buildingId: s.buildingId,
  name: s.name,
  kinds: s.kinds ?? ['dropoff', 'pickup'],
  polygon: rect(s.stop, s.size?.[0] ?? 22, s.size?.[1] ?? 7),
  stopPoint: s.stop,
  entrance: { label: s.entrance[0], location: s.entrance[1], accessible: s.entrance[2] },
  rooms: s.rooms ?? [],
  ownerId: null,
})

export const DEFAULT_ZONES: Zone[] = [
  // Graham Center: student union, several entrances for different wings
  zone({
    id: 'gc-east', buildingId: 'gc', name: 'East loop curb',
    stop: { lat: 25.75622, lng: -80.37245 }, size: [7, 24],
    entrance: ['East entrance (ballrooms)', { lat: 25.75624, lng: -80.37275 }, true],
    rooms: ['1xx', '2xx'],
  }),
  zone({
    id: 'gc-south', buildingId: 'gc', name: 'South drop-off lane',
    stop: { lat: 25.75568, lng: -80.37322 },
    entrance: ['South doors (food court)', { lat: 25.75592, lng: -80.3732 }, true],
    rooms: ['1xx'],
  }),
  zone({
    id: 'gc-north', buildingId: 'gc', name: 'North service drive',
    stop: { lat: 25.75682, lng: -80.37335 }, kinds: ['pickup'],
    entrance: ['North stairs (to 2nd–3rd floor)', { lat: 25.75658, lng: -80.37328 }, false],
    rooms: ['2xx', '3xx'],
  }),

  // Green Library
  zone({
    id: 'gl-east', buildingId: 'gl', name: 'Library east curb',
    stop: { lat: 25.75738, lng: -80.37305 }, size: [7, 22],
    entrance: ['Main entrance (east)', { lat: 25.75737, lng: -80.37338 }, true],
  }),
  zone({
    id: 'gl-north', buildingId: 'gl', name: 'North pull-off',
    stop: { lat: 25.758, lng: -80.3738 }, kinds: ['pickup'],
    entrance: ['North doors (stairs)', { lat: 25.75772, lng: -80.37378 }, false],
    rooms: ['3xx', '4xx', '5xx', '6xx', '7xx', '8xx'],
  }),

  // Primera Casa
  zone({
    id: 'pc-east', buildingId: 'pc', name: 'PC east curb',
    stop: { lat: 25.7553, lng: -80.37245 }, size: [7, 22],
    entrance: ['East entrance', { lat: 25.7553, lng: -80.37278 }, true],
  }),
  zone({
    id: 'pc-south', buildingId: 'pc', name: 'South lot curb',
    stop: { lat: 25.75478, lng: -80.3731 },
    entrance: ['South doors (stairs)', { lat: 25.75502, lng: -80.3731 }, false],
    rooms: ['3xx', '4xx', '5xx'],
  }),

  // Deuxième Maison
  zone({
    id: 'dm-west', buildingId: 'dm', name: 'West lot curb',
    stop: { lat: 25.7562, lng: -80.37625 }, size: [7, 22],
    entrance: ['West entrance', { lat: 25.7562, lng: -80.3759 }, true],
  }),

  // Ryder Business
  zone({
    id: 'rb-north', buildingId: 'rb', name: 'Business complex drop-off',
    stop: { lat: 25.76005, lng: -80.3733 },
    entrance: ['North lobby', { lat: 25.75982, lng: -80.37333 }, true],
  }),

  // Ocean Bank Convocation Center: event traffic
  zone({
    id: 'obc-east', buildingId: 'obc', name: 'Arena east plaza curb',
    stop: { lat: 25.7585, lng: -80.37825 }, size: [7, 26],
    entrance: ['East plaza gates', { lat: 25.7585, lng: -80.3785 }, true],
  }),
]
