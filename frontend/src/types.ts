// Shared data shapes. Keep these in sync with the backend (Prisma schema).

export type LatLng = { lat: number; lng: number }

/** Whether the car is dropping you off or picking you up. */
export type TripKind = 'dropoff' | 'pickup'

export type Building = {
  id: string
  code: string // "GC"
  name: string // "Graham Center"
  location: LatLng // the single "address pin" ride apps use today
}

export type Entrance = {
  label: string // "South ramp entrance"
  location: LatLng
  accessible: boolean // step-free (ramp / level / elevator)
}

/**
 * A curb area where the car stops for a specific entrance.
 * Default zones are drawn by our design team (ownerId = null).
 * Personal zones belong to one user and only they see them.
 */
export type Zone = {
  id: string
  buildingId: string
  name: string // "Newell Dr curb"
  kinds: TripKind[] // what this curb can be used for
  polygon: LatLng[] // the curb area, drawn on the map
  stopPoint: LatLng // the exact point the car targets
  entrance: Entrance // the door this curb leads to
  rooms: string[] // room patterns this entrance serves, e.g. ["1xx", "2xx"]; empty = any
  ownerId: string | null
  basedOnZoneId?: string // set when a personal zone customizes a default one
  hidden?: boolean // personal "hide this default zone" marker
}

/** A road someone reported closed. Shared with everyone. */
export type RoadClosure = {
  id: string
  path: LatLng[]
  reason: string
  reportedBy: string // display name
  createdAt: string // ISO date
}

export type Mobility = 'none' | 'cane' | 'crutches' | 'wheelchair' | 'stroller'

/** How fast someone says they usually walk. */
export type Pace = 'slow' | 'average' | 'fast'

/** Personal metrics used to estimate walking time. */
export type WalkingProfile = {
  pace?: Pace // unset = average
  age?: number
  heightCm?: number
  mobility: Mobility
  /** Learned from past trips: actual / predicted time. 1 = matches the model. */
  learnedFactor: number
}

export type User = {
  id: string
  name: string
  email: string
  profile: WalkingProfile
}

/** One ranked choice for where the car should stop. */
export type StopOption = {
  zone: Zone
  walkSeconds: number
  reason: string
  warnings: string[] // "Access road reported closed", "Stairs at this entrance"
}
