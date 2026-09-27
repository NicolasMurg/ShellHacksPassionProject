import { useMapsLibrary } from '@vis.gl/react-google-maps'
import { useEffect, useMemo, useRef, useState } from 'react'
import { bearing, distanceMeters, pointAlong, projectOnPath } from '../geo'
import type { LatLng } from '../types'
import { throughDoorways } from '../doorShortcuts'
import { inCampus, routeWalk } from '../walkRouter'
import { useCampusGraph } from './routing'

// In-app turn-by-turn navigation. Gets a route with steps from Google, then
// tracks where you are along it (live GPS, or a simulated trip for demos),
// which step you're on, what's left, and when you've arrived. Reroutes if you
// wander off the route.

/** One part of a trip: e.g. ride to the curb, then walk to the door. */
export type NavLeg = {
  travel: 'DRIVING' | 'WALKING'
  from: LatLng // where this leg starts if there's no GPS
  to: LatLng
  toLabel: string // "East entrance (ballrooms)"
  stage: string // short name for the trip tracker: "Walk to pickup", "Ride to curb", "Walk to door"
}

export type NavStep = {
  instruction: string // plain text, e.g. "Turn left onto SW 8th St"
  maneuver: string // Google maneuver id, e.g. "turn-left" ("" = straight)
  startAlong: number // meters from the route start
  endAlong: number
}

type NavRoute = { key: string; path: LatLng[]; steps: NavStep[]; meters: number; seconds: number }

export type Navigation = {
  status: 'routing' | 'active' | 'error'
  error?: string
  path: LatLng[]
  position?: LatLng
  heading: number
  traveled: number // meters along the route
  remainingMeters: number
  remainingSeconds: number
  /** The whole leg, for the trip timeline. */
  totalMeters: number
  totalSeconds: number
  step?: NavStep
  nextStep?: NavStep
  /** Turns after the next one, for the "upcoming" list. */
  upcoming: NavStep[]
  metersToManeuver: number
  arrived: boolean
}

const OFF_ROUTE_M = 35 // farther than this from the route with real GPS → reroute
const REROUTE_EVERY_MS = 8000
const ARRIVED_M = 12
const SIM_TICK_MS = 250
const SIM_SPEEDUP = { WALKING: 6, DRIVING: 4 } // demo trips play faster than real time

function plainText(html: string): string {
  const doc = new DOMParser().parseFromString(html.replace(/<div[^>]*>/g, '. '), 'text/html')
  return (doc.body.textContent ?? '').replace(/\s+/g, ' ').replace(/^\.\s*/, '').trim()
}

export function useNavigation(opts: {
  leg?: NavLeg
  gps?: LatLng
  walkSpeedMps: number
  simulate: boolean
  stepFree?: boolean
  /** Simulation only: false pauses the simulated trip (default true). */
  playing?: boolean
  /** Simulation only: jump to this fraction (0–1) of the current leg; a new `id` means a new jump. */
  seek?: { id: number; fraction: number }
}): Navigation | undefined {
  const { leg, gps, walkSpeedMps, simulate, stepFree, playing = true, seek } = opts
  const routes = useMapsLibrary('routes')
  const graph = useCampusGraph()
  // Routes already fetched, so scrubbing back and forth between legs doesn't ask Google again.
  const [fetched, setFetched] = useState<Record<string, NavRoute>>({})
  const [failed, setFailed] = useState<{ key: string; message: string }>()
  const [rerouteFrom, setRerouteFrom] = useState<{ legKey: string; from: LatLng; n: number }>()
  const [sim, setSim] = useState<{ key: string; along: number }>()
  const lastReroute = useRef(0)

  const legKey = leg ? `${leg.travel}|${leg.to.lat},${leg.to.lng}|${leg.from.lat},${leg.from.lng}` : undefined
  const reroute = rerouteFrom && rerouteFrom.legKey === legKey ? rerouteFrom : undefined
  const routeKey = legKey && `${legKey}|${reroute?.n ?? 0}`
  // Start from GPS when we have it (and it's not wildly far away), otherwise the leg's own start.
  const startFrom = reroute?.from ?? (gps && leg && distanceMeters(gps, leg.to) < 20_000 ? gps : leg?.from)

  // Walks on campus: our own footpath router (instant, shortest, knows stairs).
  const campusRoute = useMemo((): NavRoute | undefined => {
    if (!graph || !leg || !routeKey || !startFrom || leg.travel !== 'WALKING') return undefined
    if (!inCampus(graph, startFrom) || !inCampus(graph, leg.to)) return undefined
    const r = routeWalk(graph, startFrom, leg.to, { stepFree })
    return r && { key: routeKey, path: r.path, steps: r.steps, meters: r.meters, seconds: r.meters / walkSpeedMps }
    // startFrom is captured when the route key changes; GPS drift alone shouldn't reroute.
  }, [graph, routeKey, stepFree, walkSpeedMps]) // eslint-disable-line react-hooks/exhaustive-deps

  // Everything else: fetch from Google (again when rerouting).
  const alreadyFetched = !!routeKey && routeKey in fetched
  useEffect(() => {
    if (!routes || !leg || !routeKey || !startFrom || campusRoute || alreadyFetched) return
    let cancelled = false
    new routes.DirectionsService()
      .route({ origin: startFrom, destination: leg.to, travelMode: google.maps.TravelMode[leg.travel] })
      .then((res) => {
        const gLeg = res.routes[0]?.legs[0]
        if (cancelled || !gLeg) return
        const path: LatLng[] = []
        const steps: NavStep[] = []
        let along = 0
        const add = (p: LatLng) => {
          const last = path[path.length - 1]
          if (last) {
            const d = distanceMeters(last, p)
            if (d < 0.5) return
            along += d
          }
          path.push(p)
        }
        add(startFrom)
        for (const s of gLeg.steps) {
          const startAlong = along
          for (const p of s.path) add(p.toJSON())
          steps.push({ instruction: plainText(s.instructions), maneuver: s.maneuver ?? '', startAlong, endAlong: along })
        }
        // Google stops at the nearest path; finish the last few meters to the real point.
        const before = along
        add(leg.to)
        if (along > before && steps.length) steps[steps.length - 1].endAlong = along
        // A walk that crosses campus still cuts through linked doorways when that's shorter.
        const doors = leg.travel === 'WALKING' && graph ? throughDoorways(graph, path, along, !!stepFree, steps) : undefined
        const route = doors
          ? { key: routeKey, path: doors.path, steps: doors.steps, meters: doors.meters, seconds: doors.meters / walkSpeedMps }
          : { key: routeKey, path, steps, meters: along, seconds: gLeg.duration?.value ?? along / walkSpeedMps }
        setFetched((f) => ({ ...f, [routeKey]: route }))
      })
      .catch((err: Error) => !cancelled && setFailed({ key: routeKey, message: err.message || 'No route found' }))
    return () => {
      cancelled = true
    }
    // startFrom is captured when the route key changes; GPS drift alone shouldn't refetch.
  }, [routes, routeKey, campusRoute, alreadyFetched]) // eslint-disable-line react-hooks/exhaustive-deps

  const current = campusRoute ?? (routeKey ? fetched[routeKey] : undefined)

  // A timeline jump: applied as soon as the leg's route is known (it may still be loading after
  // jumping to another leg). Each jump has a new id, so it's applied exactly once.
  const [appliedSeek, setAppliedSeek] = useState<number>()
  if (simulate && seek && seek.id !== appliedSeek && current) {
    setAppliedSeek(seek.id)
    setSim({ key: current.key, along: Math.min(1, Math.max(0, seek.fraction)) * current.meters })
  }

  // Simulated trip: move along the route at (sped-up) travel speed.
  const travelSpeed = leg?.travel === 'DRIVING' && current ? current.meters / Math.max(1, current.seconds) : walkSpeedMps
  useEffect(() => {
    if (!simulate || !playing || !current || !leg) return
    const step = travelSpeed * SIM_SPEEDUP[leg.travel] * (SIM_TICK_MS / 1000)
    const id = setInterval(() => {
      setSim((s) => {
        const along = s && s.key === current.key ? s.along : 0
        return { key: current.key, along: Math.min(current.meters, along + step) }
      })
    }, SIM_TICK_MS)
    return () => clearInterval(id)
  }, [simulate, playing, current, leg, travelSpeed])

  const simAlong = sim && current && sim.key === current.key ? sim.along : 0
  const position = current ? (simulate ? pointAlong(current.path, simAlong) : (gps ?? current.path[0])) : undefined
  const progress = useMemo(() => (current && position ? projectOnPath(position, current.path) : undefined), [current, position])

  // Reroute when real GPS says you've left the route.
  useEffect(() => {
    if (simulate || !gps || !progress || !legKey || progress.off < OFF_ROUTE_M) return
    const now = Date.now()
    if (now - lastReroute.current < REROUTE_EVERY_MS) return
    lastReroute.current = now
    setRerouteFrom((r) => ({ legKey, from: gps, n: (r?.legKey === legKey ? r.n : 0) + 1 }))
  }, [simulate, gps, progress, legKey])

  if (!leg || !routeKey) return undefined
  const idle = {
    path: [],
    heading: 0,
    traveled: 0,
    remainingMeters: 0,
    remainingSeconds: 0,
    totalMeters: 0,
    totalSeconds: 0,
    upcoming: [],
    metersToManeuver: 0,
    arrived: false,
  }
  if (failed && failed.key === routeKey && !current) return { status: 'error', error: failed.message, ...idle }
  if (!current || !position || !progress) return { status: 'routing', ...idle }

  const traveled = simulate ? simAlong : progress.along
  const remainingMeters = Math.max(0, current.meters - traveled)
  const totalSeconds = leg.travel === 'WALKING' ? current.meters / walkSpeedMps : current.seconds
  const remainingSeconds = totalSeconds * (remainingMeters / Math.max(1, current.meters))
  const stepIndex = Math.max(0, current.steps.findIndex((s) => traveled < s.endAlong - 1))
  const step = current.steps[stepIndex]
  const ahead = pointAlong(current.path, traveled + 8)
  const arrived = remainingMeters < ARRIVED_M || distanceMeters(position, leg.to) < ARRIVED_M

  return {
    status: 'active',
    path: current.path,
    position,
    heading: distanceMeters(position, ahead) > 0.5 ? bearing(position, ahead) : 0,
    traveled,
    remainingMeters,
    remainingSeconds,
    totalMeters: current.meters,
    totalSeconds,
    step,
    nextStep: current.steps[stepIndex + 1],
    upcoming: current.steps.slice(stepIndex + 2, stepIndex + 6),
    metersToManeuver: step ? Math.max(0, step.endAlong - traveled) : 0,
    arrived,
  }
}
