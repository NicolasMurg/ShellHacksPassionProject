import { describe, expect, test } from 'bun:test'
import { distanceMeters, offset } from '../../shared/geo'
import { GRID } from '../../shared/grid'
import { initialMotion, type Fix, type Motion } from '../src/motion'
import { collectWalkingMeasurement, initialWalkingWindow, type WalkingWindow } from '../src/walkingMeasurements'

const START = { lat: 25.7565, lng: -80.374 }
const walking: Motion = { ...initialMotion, mode: 'walking', speed: 1.4 }
const fixAt = (seconds: number, extra: Partial<Fix> = {}): Fix => ({
  ...offset(START, 0, 1.4 * seconds), t: seconds * 1000, speed: 1.4, accuracy: 5, ...extra,
})

function collect(fixes: Fix[], motion = walking, start: WalkingWindow = initialWalkingWindow) {
  let window = start
  const measurements = []
  for (const fix of fixes) {
    const next = collectWalkingMeasurement(window, fix, motion)
    window = next.window
    if (next.measurement) measurements.push(next.measurement)
  }
  return { window, measurements }
}

describe('continuous walking measurements', () => {
  test('waits five seconds, then emits consecutive nonoverlapping windows', () => {
    const first = collect([0, 1, 2, 3, 4].map(t => fixAt(t)))
    expect(first.measurements).toHaveLength(0)
    const next = collect([5, 6, 7, 8, 9, 10].map(t => fixAt(t)), walking, first.window)
    expect(next.measurements).toHaveLength(2)
    for (const measurement of next.measurements) expect(measurement.speedMps).toBeCloseTo(1.4, 10)
    expect(distanceMeters(next.measurements[0]!.position, offset(START, 0, 3.5))).toBeLessThan(0.01)
    expect(next.measurements[0]!.radiusMeters).toBeCloseTo(8.5, 2)
    expect(next.window.fixes).toHaveLength(1)
    expect(first.window.fixes).toHaveLength(5) // input snapshots stay unchanged
  })

  test('time-weights reported speed when GPS intervals vary', () => {
    const fixes = [[0, 1], [1, 1], [3, 2], [5, 2]].map(([t, speed]) => fixAt(t!, { speed, ...START }))
    const result = collect(fixes)
    expect(result.measurements).toHaveLength(1)
    // 1 second at 1, 2 seconds averaging 1.5, then 2 seconds at 2.
    expect(result.measurements[0]!.speedMps).toBeCloseTo(1.6, 10)
  })

  test('uses reported speed despite noisy positions and includes the uncertainty envelope', () => {
    const fixes = [0, 1, 2, 3, 4, 5].map(t => fixAt(t, { ...offset(START, t % 2 ? 8 : -8, 1.4 * t), accuracy: 10 }))
    const [measurement] = collect(fixes).measurements
    expect(measurement!.speedMps).toBeCloseTo(1.4, 10)
    for (const fix of fixes) expect(measurement!.radiusMeters + 1e-8).toBeGreaterThanOrEqual(distanceMeters(measurement!.position, fix) + fix.accuracy!)
    expect(measurement!.radiusMeters).toBeGreaterThan(18)
  })

  test('retains a minimum four-meter footprint even for precise positions', () => {
    const [measurement] = collect([0, 1, 2, 3, 4, 5].map(t => fixAt(t, { ...START, accuracy: 0 }))).measurements
    expect(measurement!.radiusMeters).toBe(4)
  })

  test('never invents speed from position changes when the phone has no speed', () => {
    for (const speed of [undefined, null, NaN, Infinity, -1]) {
      expect(collect(Array.from({ length: 31 }, (_, t) => fixAt(t, { speed }))).measurements).toHaveLength(0)
    }
  })

  test('a raw stop or nonwalking speed resets immediately even while the motion median lags', () => {
    for (const speed of [0, 0.49, 2.5, 12]) {
      const before = collect([0, 1, 2, 3, 4].map(t => fixAt(t)))
      const stopped = collectWalkingMeasurement(before.window, fixAt(5, { speed }), walking)
      expect(stopped.measurement).toBeUndefined()
      expect(stopped.window.fixes).toHaveLength(0)
      const resumed = collect([6, 7, 8, 9, 10].map(t => fixAt(t)), walking, stopped.window)
      expect(resumed.measurements).toHaveLength(0)
      expect(collectWalkingMeasurement(resumed.window, fixAt(11), walking).measurement?.speedMps).toBeCloseTo(1.4, 10)
    }
    expect(collect([0, 1, 2, 3, 4, 5].map(t => fixAt(t, { speed: 0.5 }))).measurements).toHaveLength(1)
  })

  test('requires confirmed walking, with no pending mode transition', () => {
    const modes: Motion[] = [
      ...(['unknown', 'still', 'cycling', 'vehicle'] as const).map(mode => ({ ...walking, mode })),
      { ...walking, pending: { mode: 'still', since: 0, meters: 0 } },
      { ...walking, pending: { mode: 'vehicle', since: 0, meters: 0 } },
    ]
    const before = collect([0, 1, 2, 3, 4].map(t => fixAt(t)))
    for (const motion of modes) {
      const next = collectWalkingMeasurement(before.window, fixAt(5), motion)
      expect(next.measurement).toBeUndefined()
      expect(next.window.fixes).toHaveLength(0)
    }
  })

  test('does not bridge a gap in GPS coverage', () => {
    const before = collect([0, 1, 2, 3, 4].map(t => fixAt(t)))
    const after = collect([10, 11, 12, 13, 14].map(t => fixAt(t)), walking, before.window)
    expect(after.measurements).toHaveLength(0)
    expect(collectWalkingMeasurement(after.window, fixAt(15), walking).measurement).toBeDefined()
  })

  test('rejects poor or missing accuracy and invalid or outside-grid fixes', () => {
    const bad: Partial<Fix>[] = [
      { accuracy: 25.1 }, { accuracy: -1 }, { accuracy: NaN }, { accuracy: Infinity }, { accuracy: undefined },
      { lat: NaN }, { lng: Infinity }, { lat: GRID.north + 0.01 }, { lng: GRID.west - 0.01 },
      { t: NaN }, { t: Infinity }, { t: -1 },
    ]
    const before = collect([0, 1, 2, 3, 4].map(t => fixAt(t)))
    for (const extra of bad) {
      const next = collectWalkingMeasurement(before.window, fixAt(5, extra), walking)
      expect(next.measurement).toBeUndefined()
      expect(next.window.fixes).toHaveLength(0)
    }
    expect(collect([0, 1, 2, 3, 4, 5].map(t => fixAt(t, { accuracy: 25 }))).measurements).toHaveLength(1)
  })

  test('ignores duplicate and out-of-order timestamps without replaying samples or disrupting a walk', () => {
    const before = collect([0, 1, 2, 3, 4].map(t => fixAt(t)))
    for (const t of [4, 2]) {
      const next = collectWalkingMeasurement(before.window, fixAt(t, { speed: 0 }), walking)
      expect(next.window).toBe(before.window)
      expect(next.measurement).toBeUndefined()
    }
    const emitted = collectWalkingMeasurement(before.window, fixAt(5), walking)
    expect(emitted.measurement).toBeDefined()
    expect(collectWalkingMeasurement(emitted.window, fixAt(5), walking).measurement).toBeUndefined()
  })

  test('drops an implausible location jump rather than spreading a walking sample across campus', () => {
    const before = collect([0, 1, 2, 3, 4].map(t => fixAt(t)))
    const next = collectWalkingMeasurement(before.window, fixAt(5, offset(START, 300, 0)), walking)
    expect(next.measurement).toBeUndefined()
    expect(next.window.fixes).toHaveLength(0)
  })
})
