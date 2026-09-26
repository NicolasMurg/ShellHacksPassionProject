import { distanceMeters, distanceToPath } from './geo'
import type { DoorOption, Entrance, LatLng, RoadClosure, StopOption, TripKind, WalkingProfile, Zone } from './types'
import { walkSeconds } from './walking'

// Ranks the zones for a destination. The backend can do the same with real
// walking routes (Google Routes API); this runs instantly in the browser.

const CLOSURE_RADIUS_M = 40

export function servesRoom(entrance: Entrance, room: string): boolean {
  if (!room || entrance.rooms.length === 0) return true
  return entrance.rooms.some((pattern) =>
    room.toUpperCase().startsWith(pattern.replace(/x+$/i, '').toUpperCase()),
  )
}

export function floorOf(room: string): number {
  const floor = Number.parseInt(room[0] ?? '', 10)
  return Number.isNaN(floor) ? 0 : Math.max(0, floor - 1)
}

export function isNearClosure(zone: Zone, closures: RoadClosure[]): RoadClosure | undefined {
  return closures.find((c) => distanceToPath(zone.stopPoint, c.path) < CLOSURE_RADIUS_M)
}

export function rankStops(args: {
  zones: Zone[]
  entrances: Map<string, Entrance>
  buildingId: string
  room: string
  kind: TripKind
  stepFree: boolean
  profile?: WalkingProfile
  closures: RoadClosure[]
}): StopOption[] {
  const { zones, entrances, buildingId, room, kind, stepFree, profile, closures } = args

  let candidates = zones
    .filter((z) => z.buildingId === buildingId && z.kinds.includes(kind))
    .flatMap((zone) => {
      const entrance = entrances.get(zone.entranceId)
      return entrance ? [{ zone, entrance }] : []
    })
  const forRoom = candidates.filter((c) => servesRoom(c.entrance, room))
  if (forRoom.length > 0) candidates = forRoom

  const roomLabel = room ? `room ${room}` : 'the building'

  return candidates
    .map(({ zone, entrance }) => {
      const warnings: string[] = []
      let penalty = 0

      const closure = isNearClosure(zone, closures)
      if (closure) {
        warnings.push(`Access road reported closed: ${closure.reason}`)
        penalty += 900
      }
      if (!entrance.accessible) {
        warnings.push('Stairs at this entrance')
        if (stepFree) penalty += 1800
      }

      const seconds = walkSeconds(distanceMeters(zone.stopPoint, entrance.location), profile, {
        floors: floorOf(room),
        stairs: !entrance.accessible,
      })
      const personal = zone.source === 'personal'
      if (personal) penalty -= 20 // the user's own spots win ties

      const reason = personal
        ? `Your saved spot for ${roomLabel}`
        : `${entrance.accessible ? 'Step-free entrance' : 'Entrance'} closest to ${roomLabel}`

      return { option: { zone, entrance, walkSeconds: seconds, reason, warnings }, score: seconds + penalty }
    })
    .sort((a, b) => a.score - b.score)
    .map((s) => s.option)
}

/** Walk mode: rank the building's doors by walking time from where you are. */
export function rankDoors(args: {
  entrances: Entrance[]
  room: string
  origin: LatLng
  stepFree: boolean
  profile?: WalkingProfile
}): DoorOption[] {
  const { room, origin, stepFree, profile } = args
  let doors = args.entrances
  const forRoom = doors.filter((e) => servesRoom(e, room))
  if (forRoom.length > 0) doors = forRoom
  const roomLabel = room ? `room ${room}` : 'the building'

  return doors
    .map((entrance) => {
      const warnings = entrance.accessible ? [] : ['Stairs at this entrance']
      const seconds = walkSeconds(distanceMeters(origin, entrance.location), profile, {
        floors: floorOf(room),
        stairs: !entrance.accessible,
      })
      const penalty = !entrance.accessible && stepFree ? 1800 : 0
      const reason = `${entrance.accessible ? 'Step-free entrance' : 'Entrance'} closest to ${roomLabel}`
      return { option: { entrance, walkSeconds: seconds, reason, warnings }, score: seconds + penalty }
    })
    .sort((a, b) => a.score - b.score)
    .map((s) => s.option)
}

/** Shared zones, with the user's personal versions replacing the ones they customized or hid. */
export function visibleZones(defaults: Zone[], personal: Zone[]): Zone[] {
  const replaced = new Set(personal.map((z) => z.basedOnZoneId).filter(Boolean))
  return [...defaults.filter((z) => !replaced.has(z.id)), ...personal.filter((z) => !z.hidden)]
}
