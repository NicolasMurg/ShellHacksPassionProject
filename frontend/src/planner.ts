import { distanceMeters, distanceToPath } from './geo'
import type { RoadClosure, StopOption, TripKind, WalkingProfile, Zone } from './types'
import { walkSeconds } from './walking'

// Ranks the zones for a destination. The backend can do the same with real
// walking routes (Google Routes API); this runs instantly in the browser.

const CLOSURE_RADIUS_M = 40

export function servesRoom(zone: Zone, room: string): boolean {
  if (!room || zone.rooms.length === 0) return true
  return zone.rooms.some((pattern) =>
    room.toUpperCase().startsWith(pattern.replace(/x+$/i, '').toUpperCase()),
  )
}

function floorOf(room: string): number {
  const floor = Number.parseInt(room[0] ?? '', 10)
  return Number.isNaN(floor) ? 0 : Math.max(0, floor - 1)
}

export function isNearClosure(zone: Zone, closures: RoadClosure[]): RoadClosure | undefined {
  return closures.find((c) => distanceToPath(zone.stopPoint, c.path) < CLOSURE_RADIUS_M)
}

export function rankStops(args: {
  zones: Zone[]
  buildingId: string
  room: string
  kind: TripKind
  stepFree: boolean
  profile?: WalkingProfile
  closures: RoadClosure[]
}): StopOption[] {
  const { zones, buildingId, room, kind, stepFree, profile, closures } = args

  let candidates = zones.filter((z) => z.buildingId === buildingId && z.kinds.includes(kind))
  const forRoom = candidates.filter((z) => servesRoom(z, room))
  if (forRoom.length > 0) candidates = forRoom

  const roomLabel = room ? `room ${room}` : 'the building'

  return candidates
    .map((zone) => {
      const warnings: string[] = []
      let penalty = 0

      const closure = isNearClosure(zone, closures)
      if (closure) {
        warnings.push(`Access road reported closed: ${closure.reason}`)
        penalty += 900
      }
      if (!zone.entrance.accessible) {
        warnings.push('Stairs at this entrance')
        if (stepFree) penalty += 1800
      }

      const seconds = walkSeconds(distanceMeters(zone.stopPoint, zone.entrance.location), profile, {
        floors: floorOf(room),
        stairs: !zone.entrance.accessible,
      })
      const personal = zone.ownerId !== null
      if (personal) penalty -= 20 // the user's own spots win ties

      const reason = personal
        ? `Your saved spot for ${roomLabel}`
        : `${zone.entrance.accessible ? 'Step-free entrance' : 'Entrance'} closest to ${roomLabel}`

      return { option: { zone, walkSeconds: seconds, reason, warnings }, score: seconds + penalty }
    })
    .sort((a, b) => a.score - b.score)
    .map((s) => s.option)
}

/** Default zones, with the user's personal versions replacing the ones they customized or hid. */
export function visibleZones(defaults: Zone[], personal: Zone[]): Zone[] {
  const replaced = new Set(personal.map((z) => z.basedOnZoneId).filter(Boolean))
  return [...defaults.filter((z) => !replaced.has(z.id)), ...personal.filter((z) => !z.hidden)]
}
