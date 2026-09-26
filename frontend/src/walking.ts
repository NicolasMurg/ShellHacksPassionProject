import type { Mobility, Pace, WalkingProfile } from './types'

// Personal walking-speed model. The backend can replace this with one trained
// on real trip data; the frontend uses it for instant estimates.

const BASE_SPEED_MPS = 1.34 // typical adult walking speed

// Starting guesses; tune with timed walks on campus.
const PACE_FACTOR: Record<Pace, number> = {
  slow: 0.8,
  average: 1,
  fast: 1.2,
}

export const PACE_LABEL: Record<Pace, string> = {
  slow: 'Slow',
  average: 'Average',
  fast: 'Fast',
}

const MOBILITY_FACTOR: Record<Mobility, number> = {
  none: 1,
  stroller: 0.9,
  wheelchair: 0.85,
  cane: 0.75,
  crutches: 0.6,
}

export const MOBILITY_LABEL: Record<Mobility, string> = {
  none: 'No mobility aid',
  stroller: 'Pushing a stroller',
  wheelchair: 'Wheelchair',
  cane: 'Cane or walker',
  crutches: 'Crutches',
}

function ageFactor(age?: number): number {
  if (!age) return 1
  if (age < 30) return 1
  if (age < 50) return 0.97
  if (age < 65) return 0.92
  if (age < 80) return 0.82
  return 0.7
}

function heightFactor(heightCm?: number): number {
  if (!heightCm) return 1
  return Math.min(1.1, Math.max(0.9, 1 + (heightCm - 170) * 0.002))
}

/** Walking speed in meters per second for this person (or an average adult). */
export function walkingSpeed(profile?: WalkingProfile): number {
  if (!profile) return BASE_SPEED_MPS
  const speed =
    BASE_SPEED_MPS *
    PACE_FACTOR[profile.pace ?? 'average'] *
    ageFactor(profile.age) *
    heightFactor(profile.heightCm) *
    MOBILITY_FACTOR[profile.mobility]
  return speed / (profile.learnedFactor || 1)
}

/** Whether this person should only be routed to step-free entrances. */
export function needsStepFree(profile?: WalkingProfile): boolean {
  return profile?.mobility === 'wheelchair' || profile?.mobility === 'stroller'
}

const PATH_FACTOR = 1.25 // real paths are longer than straight lines
const SECONDS_PER_FLOOR = 25

/** Estimated seconds from the curb to the room. */
export function walkSeconds(
  straightLineMeters: number,
  profile: WalkingProfile | undefined,
  opts: { floors?: number; stairs?: boolean } = {},
): number {
  const outdoor = (straightLineMeters * PATH_FACTOR) / walkingSpeed(profile)
  const indoor = 20 + (opts.floors ?? 0) * SECONDS_PER_FLOOR
  const stairs = opts.stairs ? (profile && profile.mobility !== 'none' ? 45 : 10) : 0
  return outdoor + indoor + stairs
}

/**
 * Update the learned factor after a trip ("that took longer than you said").
 * Moves gently so one odd trip doesn't swing future estimates much.
 */
export function learn(profile: WalkingProfile, feedback: 'faster' | 'right' | 'slower'): WalkingProfile {
  const target = feedback === 'faster' ? 0.85 : feedback === 'slower' ? 1.2 : 1
  const next = profile.learnedFactor * (1 + (target - 1) * 0.3)
  return { ...profile, learnedFactor: Math.min(2, Math.max(0.5, Number(next.toFixed(3)))) }
}
