import { distanceMeters, distanceToPath } from './geo'
import type { LatLng } from './types'

export type WalkSample = LatLng & { timestamp: number; accuracy: number; speed: number | null }
export type WalkPoint = LatLng & { offRoute: boolean }
export type WalkTrace = { id: string; points: WalkPoint[]; updatedAt: number }
export type LearnedPath = { trace: WalkTrace; walks: number }
export const WALK_STORAGE_KEY = 'doorstep.walkedPaths.v1'
const MAX_TRACES = 40

export function readWalks(raw: string | null): WalkTrace[] {
  try {
    const value: unknown = JSON.parse(raw ?? '[]')
    if (!Array.isArray(value)) return []
    return value.filter((t): t is WalkTrace => t && typeof t.id === 'string' && Number.isFinite(t.updatedAt)
      && Array.isArray(t.points) && t.points.length >= 2 && t.points.length <= 500
      && t.points.every((p: WalkPoint) => Number.isFinite(p.lat) && Math.abs(p.lat) <= 90
        && Number.isFinite(p.lng) && Math.abs(p.lng) <= 180 && typeof p.offRoute === 'boolean')).slice(-MAX_TRACES)
  } catch { return [] }
}

/** Each trace contributes at most one observation, regardless of its GPS sample count. */
export function learnedPaths(traces: WalkTrace[]): LearnedPath[] {
  const groups: LearnedPath[] = []
  for (const trace of traces) {
    const matches = (a: WalkTrace, b: WalkTrace) => {
      // Bound matching cost for long walks, while checking both directions below.
      const samples = a.points.filter((_, index) => index % Math.max(1, Math.ceil(a.points.length / 32)) === 0)
      return samples.filter(p => distanceToPath(p, b.points) <= 15).length / samples.length >= 0.8
    }
    const group = groups.find(g => matches(trace, g.trace) && matches(g.trace, trace))
    if (group) {
      group.walks++
      if (trace.points.filter(p => p.offRoute).length > group.trace.points.filter(p => p.offRoute).length) group.trace = trace
    } else groups.push({ trace, walks: 1 })
  }
  return groups
}

/** Foreground demo learner: filters fixes, separates walks, and retains bounded local traces. */
export class WalkRecorder {
  traces: WalkTrace[]
  points: WalkPoint[] = []
  status = 'Waiting for GPS'
  private anchor?: WalkSample
  private lastTimestamp = 0
  private reference: LatLng[] = []
  private activeReference: LatLng[] = []
  private id?: string
  private meters = 0

  constructor(traces: WalkTrace[] = []) { this.traces = traces }
  setReference(path: LatLng[]) {
    this.reference = path
    // The route request can finish after GPS tracking has already started.
    if (!this.activeReference.length && path.length >= 2) this.activeReference = [...path]
  }
  end() {
    this.anchor = undefined
    this.points = []
    this.id = undefined
    this.meters = 0
    this.activeReference = []
    this.status = 'Waiting for walking movement'
  }
  clear() { this.end(); this.traces = []; this.status = 'Waiting for walking movement' }

  add(sample: WalkSample, now = Date.now()): boolean {
    if (!Number.isFinite(sample.timestamp) || sample.timestamp <= this.lastTimestamp || Math.abs(now - sample.timestamp) > 15_000) return false
    this.lastTimestamp = sample.timestamp
    if (!Number.isFinite(sample.lat) || Math.abs(sample.lat) > 90 || !Number.isFinite(sample.lng) || Math.abs(sample.lng) > 180
      || !Number.isFinite(sample.accuracy) || sample.accuracy < 0 || sample.accuracy > 20) {
      this.end(); this.status = 'Waiting for more accurate GPS'; return false
    }
    if (!this.anchor || sample.timestamp - this.anchor.timestamp > 90_000) {
      this.end(); this.anchor = sample; this.activeReference = [...this.reference]
      this.status = 'Waiting for walking movement'; return false
    }
    const meters = distanceMeters(this.anchor, sample)
    const speed = meters / ((sample.timestamp - this.anchor.timestamp) / 1000)
    if (speed > 3 || (sample.speed !== null && sample.speed > 3)) {
      this.end(); this.status = 'Paused · movement faster than walking'; return false
    }
    if (meters < Math.max(6, sample.accuracy * 0.6) || speed < 0.35 || sample.speed === 0) return false
    const point = (p: WalkSample): WalkPoint => ({ lat: p.lat, lng: p.lng,
      offRoute: this.activeReference.length >= 2 && distanceToPath(p, this.activeReference) > Math.max(25, p.accuracy * 2) })
    if (!this.points.length) this.points = [point(this.anchor)]
    this.points = [...this.points, point(sample)]
    this.meters += meters
    this.anchor = sample
    this.status = 'Learning your walking path'
    if (this.meters < 30 || this.points.length < 4) return false
    this.id ??= crypto.randomUUID()
    const trace = { id: this.id, points: this.points, updatedAt: sample.timestamp }
    this.traces = [...this.traces.filter(t => t.id !== this.id), trace].slice(-MAX_TRACES)
    if (this.points.length >= 500) this.end()
    return true
  }
}
