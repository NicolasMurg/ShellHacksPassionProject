// View models for the map. api/adapters.ts converts canonical backend JSON into these types.

export type LatLng = { lat: number; lng: number }

/** Whether the car is dropping you off or picking you up. */
export type TripKind = 'dropoff' | 'pickup'

/** A door into a building. Part of the campus data (design team). */
export type Entrance = {
  id: string // "gc-east"
  buildingId: string
  label: string // "East entrance (ballrooms)"
  location: LatLng
  accessible: boolean // step-free (ramp / level / elevator)
  rooms: string[] // rooms this door is closest to, e.g. ["1xx", "2xx"]; empty = any room
  hours?: string // "7am–11pm"
}

export type Building = {
  id: string // "gc"
  code: string // "GC"
  name: string // "Graham Center"
  location: LatLng // the single "address pin" ride apps use today
  entrances: Entrance[]
}

/** What a curb looks like, checked by AI from Street View or by reports. */
export type CurbAudit = {
  curbCut: boolean
  fireLane: boolean
  busStop: boolean
  obstacles: string[]
  safeToStop: number // 0-10
  notes: string
}

/**
 * A general-purpose stopping spot; routing chooses the fastest relevant entrance.
 *  - generated: made automatically for every entrance (nearest drivable road point)
 *  - design:    drawn or adjusted by our design team
 *  - personal:  made by one user; only they see it
 */
export type Zone = {
  id: string
  buildingId: string
  entranceId: string // historical editor hint; empty when unassociated
  source: 'generated' | 'design' | 'personal' | 'public'
  publicStopId?: string
  publicStopStatus?: 'VERIFIED' | 'UNVERIFIED'
  instructions?: string
  rooms?: string[]
  name: string // "East loop curb"
  kinds: TripKind[] // what this curb can be used for
  polygon: LatLng[] // the curb area, drawn on the map
  stopPoint: LatLng // the exact point the car targets
  ownerId: string | null // set only for personal zones
  basedOnZoneId?: string // a personal zone that replaces/customizes another zone
  hidden?: boolean // personal marker meaning "hide basedOnZoneId for me"
  audit?: CurbAudit
}

/** A road someone reported closed. Shared with everyone. */
export type RoadClosure = {
  id: string
  path: LatLng[]
  reason: string
  reportedBy: string // display name
  ownerId: string | null
  createdAt: string // ISO date
}

export type Mobility = 'none' | 'cane' | 'crutches' | 'wheelchair' | 'stroller'

/** How fast someone says they usually walk. */
export type Pace = 'slow' | 'average' | 'fast'

/** Personal metrics used to estimate walking time. */
export type WalkingProfile = {
  avoidStairs?: boolean
  requireCurbCuts?: boolean
  avoidSteepSlopes?: boolean
  maxWalkMinutes?: number | null
  preferAccessibleEntrances?: boolean
  pace?: Pace // unset = average
  age?: number
  heightCm?: number
  mobility: Mobility
  /** Learned from past trips: actual / predicted time. 1 = matches the model. */
  learnedFactor: number
}

export type User = {
  role: string
  id: string
  name: string
  email: string
  profile: WalkingProfile
}

/** How you're getting there: by robotaxi (drop-off / pickup) or on foot. */
export type TravelMode = TripKind | 'walk'

/** One ranked door to walk to (walk mode). */
export type DoorOption = {
  entrance: Entrance
  walkSeconds: number
  reason: string
  warnings: string[] // "Access road reported closed", "Stairs at this entrance"
}

/** One ranked choice for where the car should stop, and the door it leads to. */
export type StopOption = DoorOption & { zone: Zone }
