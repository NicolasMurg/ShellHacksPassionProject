import { distanceMeters } from '../../shared/geo'
import { cellAt } from '../../shared/grid'
import type { SpeedMeasurement } from '../../shared/speedGrid'
import { MAX_ACCURACY_M, STILL_MAX_MPS, WALK_MAX_MPS, type Fix, type Motion } from './motion'

const WINDOW_MS = 5_000
const MAX_FIX_GAP_MS = 2_500
const MIN_RADIUS_M = 4

type WalkingFix = Fix & { accuracy: number; speed: number }

export type WalkingWindow = {
  /** Latest timestamp seen, including rejected readings, to ignore replays. */
  lastT?: number
  fixes: readonly WalkingFix[]
}

export const initialWalkingWindow: WalkingWindow = { fixes: [] }

function usable(fix: Fix, motion: Motion): fix is WalkingFix {
  return motion.mode === 'walking' && !motion.pending &&
    Number.isFinite(fix.lat) && Number.isFinite(fix.lng) && !!cellAt(fix) &&
    typeof fix.accuracy === 'number' && Number.isFinite(fix.accuracy) && fix.accuracy >= 0 && fix.accuracy <= MAX_ACCURACY_M &&
    typeof fix.speed === 'number' && Number.isFinite(fix.speed) && fix.speed >= STILL_MAX_MPS && fix.speed < WALK_MAX_MPS
}

/**
 * Feed only real GPS fixes, together with their updated motion state. A sample needs
 * at least five continuous seconds of confirmed walking. Phone-reported speeds are
 * time-weighted; position differences never become speed measurements. Devices
 * without a reported speed or accuracy do not contribute to the learned grid.
 */
export function collectWalkingMeasurement(
  window: WalkingWindow,
  fix: Fix,
  motion: Motion,
): { window: WalkingWindow; measurement?: SpeedMeasurement } {
  if (!Number.isFinite(fix.t) || fix.t < 0) return { window: { lastT: window.lastT, fixes: [] } }
  if (window.lastT !== undefined && fix.t <= window.lastT) return { window }
  if (!usable(fix, motion)) return { window: { lastT: fix.t, fixes: [] } }

  const last = window.fixes[window.fixes.length - 1]
  if (!last || fix.t - last.t > MAX_FIX_GAP_MS) return { window: { lastT: fix.t, fixes: [{ ...fix }] } }

  // Reject a location jump that cannot be explained by walking plus both GPS
  // uncertainty circles. This checks the positions, not the measured speed.
  const possibleMeters = last.accuracy + fix.accuracy + WALK_MAX_MPS * (fix.t - last.t) / 1000
  if (distanceMeters(last, fix) > possibleMeters) return { window: { lastT: fix.t, fixes: [] } }

  const fixes = [...window.fixes, { ...fix }]
  const durationMs = fix.t - fixes[0]!.t
  if (durationMs < WINDOW_MS) return { window: { lastT: fix.t, fixes } }

  // Integrate each pair's mean value over its interval, so irregular GPS update
  // frequency does not give faster-reporting seconds extra influence.
  let speedIntegral = 0
  let latIntegral = 0
  let lngIntegral = 0
  for (let i = 1; i < fixes.length; i++) {
    const a = fixes[i - 1]!
    const b = fixes[i]!
    const halfInterval = (b.t - a.t) / 2
    speedIntegral += (a.speed + b.speed) * halfInterval
    latIntegral += (a.lat + b.lat) * halfInterval
    lngIntegral += (a.lng + b.lng) * halfInterval
  }
  const position = { lat: latIntegral / durationMs, lng: lngIntegral / durationMs }
  const radiusMeters = fixes.reduce((radius, p) => Math.max(radius, distanceMeters(position, p) + p.accuracy), MIN_RADIUS_M)

  return {
    // Adjacent windows share an endpoint, but none of their elapsed time overlaps.
    window: { lastT: fix.t, fixes: [{ ...fix }] },
    measurement: { position, speedMps: speedIntegral / durationMs, radiusMeters },
  }
}
