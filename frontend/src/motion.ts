import { distanceMeters } from './geo'

// Travel-mode detection from shared GPS: still, walking, bike/scooter, or in a vehicle.
// Speeds are smoothed over a few seconds, a new mode has to hold for a distance and a
// time before it's accepted (GPS jumps and red lights don't flip it), and the vehicle
// threshold depends on where you are: a car can't be on a campus walkway.
// Everything runs on the device; only a few seconds of fixes are kept.

export type TravelMode = 'unknown' | 'still' | 'walking' | 'cycling' | 'vehicle'

/** What's under you: footpaths, slow campus drives, or regular roads. */
export type Area = 'walkway' | 'campusRoad' | 'road' | 'unknown'

/** One GPS reading. `speed` is the phone's own (Doppler) speed in m/s when it has one; `t` is in ms. */
export type Fix = { lat: number; lng: number; accuracy?: number; speed?: number | null; t: number }

/** Usain Bolt's 100 m world record (9.58 s) averages ~10.44 m/s: nobody on foot sustains more. */
export const BOLT_MPS = 100 / 9.58
export const STILL_MAX_MPS = 0.5
export const WALK_MAX_MPS = 2.5
/**
 * Sustained speed at or above this means a vehicle. Campus drives are slow, so the bar is
 * lower there; on walkways only Bolt pace counts (anything slower is a bike or scooter).
 */
export const VEHICLE_MIN_MPS: Record<Area, number> = { walkway: BOLT_MPS, campusRoad: 6, road: 7, unknown: 7 }
/** Fixes blurrier than this are ignored: they can't tell walking from standing. */
export const MAX_ACCURACY_M = 25
/** Speeds are the median over this window. */
const SMOOTH_MS = 10_000
/** A longer gap between fixes isn't counted as walking time (you may have stopped). */
const MAX_WALK_GAP_S = 30

export type Motion = {
  mode: TravelMode
  /** Smoothed speed in m/s, once there are usable fixes. */
  speed?: number
  /** When the current mode started (ms). */
  since: number
  /** Distance and time spent walking (vehicle and bike stretches never count), for measuring your real pace. */
  walked: { meters: number; seconds: number }
  recent: { t: number; speed: number }[]
  last?: { lat: number; lng: number; t: number }
  /** A different mode that's been seen but hasn't held long enough yet. */
  pending?: { mode: TravelMode; since: number; meters: number }
  /** The last fix looked at (usable or not), so each one is counted once. */
  lastT?: number
}

export const initialMotion: Motion = { mode: 'unknown', since: 0, walked: { meters: 0, seconds: 0 }, recent: [] }

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

/** How far and how long a new mode must hold before switching to it. */
function needed(from: TravelMode, to: TravelMode, speed: number) {
  // No one runs 100 m faster than Bolt, so at that pace 100 m is enough on its own.
  if (to === 'vehicle') return { meters: 100, seconds: speed >= BOLT_MPS ? 0 : 10 }
  // Stop-and-go traffic averages bike speeds, so leaving a vehicle for "bike" needs much more.
  if (to === 'cycling') return from === 'vehicle' ? { meters: 300, seconds: 60 } : { meters: 50, seconds: 10 }
  if (to === 'walking') {
    // Getting out of a car: real walking, not creeping traffic.
    if (from === 'vehicle') return { meters: 40, seconds: 25 }
    if (from === 'cycling') return { meters: 20, seconds: 10 }
    return { meters: 10, seconds: 0 }
  }
  // A car waiting at a red light is still in a vehicle.
  if (to === 'still') return { meters: 0, seconds: from === 'vehicle' ? 120 : 5 }
  return { meters: 0, seconds: 0 }
}

/** Feed one GPS fix; returns the updated state (the same object if the fix was already seen). */
export function stepMotion(s: Motion, fix: Fix, area: Area = 'unknown'): Motion {
  if (fix.t === s.lastT) return s
  const seen: Motion = { ...s, lastT: fix.t }
  if (fix.accuracy !== undefined && fix.accuracy > MAX_ACCURACY_M) return seen

  const here = { lat: fix.lat, lng: fix.lng, t: fix.t }
  const step = s.last ? distanceMeters(s.last, here) : 0
  const dt = s.last ? (fix.t - s.last.t) / 1000 : 0
  if (s.last && dt <= 0) return seen

  // The phone's Doppler speed when it has one (steadier), otherwise distance over time.
  const raw = fix.speed != null && fix.speed >= 0 ? fix.speed : s.last && dt >= 0.5 ? step / dt : undefined
  const recent = raw === undefined ? s.recent : [...s.recent, { t: fix.t, speed: raw }].filter((r) => fix.t - r.t <= SMOOTH_MS)
  const speed = recent.length ? median(recent.map((r) => r.speed)) : s.speed
  const next: Motion = { ...seen, last: here, recent, speed }
  if (speed === undefined) return next

  const candidate: TravelMode =
    speed < STILL_MAX_MPS ? 'still' : speed < WALK_MAX_MPS ? 'walking' : speed < VEHICLE_MIN_MPS[area] ? 'cycling' : 'vehicle'

  // Count this stretch toward your walking pace only if it was itself at walking speed: the
  // smoothed speed lags a few seconds, and the first seconds of a ride mustn't sneak in.
  const walkingStep = raw !== undefined && raw >= STILL_MAX_MPS && raw < WALK_MAX_MPS
  if (s.mode === 'walking' && candidate === 'walking' && walkingStep && s.last && dt <= MAX_WALK_GAP_S) {
    next.walked = { meters: s.walked.meters + step, seconds: s.walked.seconds + dt }
  }

  if (candidate === s.mode) return { ...next, pending: undefined }
  const pending =
    s.pending?.mode === candidate
      ? { ...s.pending, meters: s.pending.meters + step }
      : { mode: candidate, since: s.last?.t ?? fix.t, meters: step }
  const need = needed(s.mode, candidate, speed)
  if (pending.meters >= need.meters && (fix.t - pending.since) / 1000 >= need.seconds) {
    return { ...next, mode: candidate, since: pending.since, pending: undefined }
  }
  return { ...next, pending }
}

/**
 * Which area a point is in, from its distance (m) to the nearest footpath, campus drive and
 * main road. Roads win when close, since sidewalks run right next to them.
 */
export function areaOf(near: { walkway: number; campusRoad: number; road: number }): Area {
  if (near.road <= 15) return 'road'
  if (near.campusRoad <= 15) return 'campusRoad'
  if (near.walkway <= 25) return 'walkway'
  return 'unknown'
}

export type PaceFeedback = 'faster' | 'right' | 'slower'

/** Your GPS-measured walking speed vs. the model's, once there's enough walking to judge (≥ 150 m and 1 min). */
export function measuredPace(walked: Motion['walked'], expectedMps: number): { speed: number; suggestion: PaceFeedback } | undefined {
  if (walked.meters < 150 || walked.seconds < 60) return undefined
  const speed = walked.meters / walked.seconds
  const ratio = speed / expectedMps
  return { speed, suggestion: ratio > 1.1 ? 'faster' : ratio < 0.9 ? 'slower' : 'right' }
}

export const MODE_LABEL: Record<TravelMode, string> = {
  unknown: 'Detecting…',
  still: 'Still',
  walking: 'Walking',
  cycling: 'Bike or scooter',
  vehicle: 'In a vehicle',
}
export const MODE_ICON: Record<TravelMode, string> = { unknown: '📍', still: '🧍', walking: '🚶', cycling: '🚲', vehicle: '🚗' }
