import type { LatLng } from './types'
import { inCampus, routeWalk, type CampusGraph } from './walkRouter'

// Locks a planned walk onto doorway shortcuts when that's quicker: the walk through
// linked doors (straight through the building between the doors' grid squares, campus
// paths to and from them) replaces Google's walk only if it's shorter.

type Walk = { path: LatLng[]; seconds: number; meters: number }
type Walkable = { walkSeconds: number; reason: string; route?: Walk }

export type LockContext = {
  /** The campus network with doorway shortcuts; leave undefined when there are no linked doors. */
  graph?: CampusGraph
  stepFree: boolean
  speedMps: number
}

export function lockToDoorways<T extends Walkable>(option: T, from: LatLng, to: LatLng, ctx: LockContext): T {
  const google = option.route
  const { graph } = ctx
  if (!graph || !google || !inCampus(graph, from) || !inCampus(graph, to)) return option
  const through = routeWalk(graph, from, to, { stepFree: ctx.stepFree })
  // Only a walk that actually goes through a doorway, and only when it beats Google's.
  if (!through || through.indoorMeters === 0 || through.meters >= google.meters) return option
  const savedMeters = google.meters - through.meters
  const savedSeconds = savedMeters / ctx.speedMps
  return {
    ...option,
    walkSeconds: Math.max(0, option.walkSeconds - savedSeconds),
    reason: `${option.reason} · through a doorway shortcut (${Math.round(savedMeters)} m shorter)`,
    route: { ...google, path: through.path, meters: through.meters, seconds: Math.max(0, google.seconds - savedSeconds) },
  }
}
