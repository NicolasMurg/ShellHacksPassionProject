import { distanceMeters } from './geo'
import type { LatLng } from './types'
import { inCampus, insideDoorCircle, routeWalk, type CampusGraph, type WalkStep } from './walkRouter'

// Locks a walk onto doorway shortcuts when that's quicker: the walk through linked doors
// (a straight line through the building between the doors' grid squares, campus paths to
// and from them) replaces Google's walk only if it's shorter.

type Walk = { path: LatLng[]; seconds: number; meters: number }
type Walkable = { walkSeconds: number; reason: string; route?: Walk }

export type LockContext = {
  /** The campus network with doorway shortcuts; leave undefined when there are no linked doors. */
  graph?: CampusGraph
  stepFree: boolean
  speedMps: number
}

export type DoorwayWalk = { path: LatLng[]; meters: number; savedMeters: number; steps: WalkStep[] }

/**
 * The walk along `path` (`meters` long, per Google) through linked doorways instead, if that's
 * shorter. With both ends on campus the whole walk is rerouted; otherwise just the stretch of
 * it that's on campus, so a walk from an address off campus (or to a place off campus) still
 * cuts through buildings on the way. Turn-by-turn `steps` are kept in sync when given.
 */
export function throughDoorways(
  graph: CampusGraph,
  path: LatLng[],
  meters: number,
  stepFree: boolean,
  steps: WalkStep[] = [],
): DoorwayWalk | undefined {
  const inside = path.map((p) => inCampus(graph, p))
  const first = inside.indexOf(true)
  const last = inside.lastIndexOf(true)
  if (first < 0 || last <= first) return undefined

  const along = [0]
  for (let i = 1; i < path.length; i++) along.push(along[i - 1]! + distanceMeters(path[i - 1]!, path[i]!))
  const start = along[first]!
  const end = along[last]!
  const whole = first === 0 && last === path.length - 1
  const stretch = whole ? meters : end - start

  const through = routeWalk(graph, path[first]!, path[last]!, { stepFree })
  // Starting inside a linked-door circle is starting inside that building: out through one of its
  // doors, always. Otherwise only a walk that goes through a doorway, and only when it beats Google's.
  const leaving = first === 0 && insideDoorCircle(graph, path[0]!)
  if (!through || through.indoorMeters === 0 || (!leaving && through.meters >= stretch)) return undefined
  const savedMeters = stretch - through.meters // negative when leaving the building takes longer

  const shift = (s: WalkStep, by: number): WalkStep => ({ ...s, startAlong: s.startAlong + by, endAlong: s.endAlong + by })
  return {
    path: [...path.slice(0, first), ...through.path, ...path.slice(last + 1)],
    meters: whole ? through.meters : meters - savedMeters,
    savedMeters,
    steps: [
      ...steps.filter((s) => s.startAlong < start).map((s) => ({ ...s, endAlong: Math.min(s.endAlong, start) })),
      ...through.steps.map((s) => shift(s, start)),
      ...steps
        .filter((s) => s.endAlong > end)
        .map((s) => shift({ ...s, startAlong: Math.max(s.startAlong, end) }, start + through.meters - end)),
    ],
  }
}

/** The circle two linked doors sweep: the line between them spun around its middle (see walkRouter). */
export function doorCircle(a: LatLng, b: LatLng, steps = 48): LatLng[] {
  const center = { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 }
  const radius = distanceMeters(a, b) / 2
  const mPerDegLat = 111_320
  const mPerDegLng = mPerDegLat * Math.cos((center.lat * Math.PI) / 180)
  return Array.from({ length: steps }, (_, i) => {
    const angle = (2 * Math.PI * i) / steps
    return { lat: center.lat + (Math.sin(angle) * radius) / mPerDegLat, lng: center.lng + (Math.cos(angle) * radius) / mPerDegLng }
  })
}

export function lockToDoorways<T extends Walkable>(option: T, from: LatLng, to: LatLng, ctx: LockContext): T {
  const google = option.route
  const { graph } = ctx
  if (!graph || !google) return option
  const doors = throughDoorways(graph, [from, ...google.path, to], google.meters, ctx.stepFree)
  if (!doors) return option
  const savedSeconds = doors.savedMeters / ctx.speedMps
  return {
    ...option,
    walkSeconds: Math.max(0, option.walkSeconds - savedSeconds),
    reason:
      doors.savedMeters > 0
        ? `${option.reason} · through a doorway shortcut (${Math.round(doors.savedMeters)} m shorter)`
        : `${option.reason} · out of the building through a linked door`,
    route: { ...google, path: doors.path, meters: doors.meters, seconds: Math.max(0, google.seconds - savedSeconds) },
  }
}
