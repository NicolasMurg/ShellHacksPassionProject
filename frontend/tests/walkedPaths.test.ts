import { describe, expect, test } from 'bun:test'
import { offset } from '../src/geo'
import { learnedPaths, readWalks, WalkRecorder, type WalkSample } from '../src/walkedPaths'

const origin = { lat: 25.756, lng: -80.374 }
const start = 1_800_000_000_000
function sample(east: number, seconds: number, north = 0, overrides: Partial<WalkSample> = {}): WalkSample {
  return { ...offset(origin, east, north), timestamp: start + seconds * 1000, accuracy: 5, speed: null, ...overrides }
}
function feed(recorder: WalkRecorder, fixes: WalkSample[]) {
  for (const fix of fixes) recorder.add(fix, fix.timestamp)
}
function walk(recorder: WalkRecorder, seconds = 0, north = 0, reverse = false) {
  feed(recorder, Array.from({ length: 7 }, (_, i) => sample(reverse ? 60 - i * 10 : i * 10, seconds + i * 8, north)))
}

describe('foreground walking-path learner', () => {
  test('saves walking movement automatically, without counting GPS fixes as repeated walks', () => {
    const recorder = new WalkRecorder()
    walk(recorder)
    expect(recorder.traces).toHaveLength(1)
    expect(recorder.traces[0].points).toHaveLength(7)
    expect(learnedPaths(recorder.traces)[0].walks).toBe(1)
  })
  test('groups a second walk in the reverse direction, tolerating small GPS differences', () => {
    const recorder = new WalkRecorder()
    walk(recorder)
    recorder.end()
    walk(recorder, 120, 4, true)
    const paths = learnedPaths(recorder.traces)
    expect(paths).toHaveLength(1)
    expect(paths[0].walks).toBe(2)
  })
  test('keeps physically distinct paths separate', () => {
    const recorder = new WalkRecorder()
    walk(recorder)
    recorder.end()
    walk(recorder, 120, 50)
    expect(learnedPaths(recorder.traces)).toHaveLength(2)
  })
  test('flags deviation from a planned route but never assumes a missing route means deviation', () => {
    const recorder = new WalkRecorder()
    recorder.setReference([origin, offset(origin, 100, 0)])
    walk(recorder, 0, 50)
    expect(recorder.traces[0].points.every(p => p.offRoute)).toBe(true)
    const unknown = new WalkRecorder()
    walk(unknown)
    expect(unknown.traces[0].points.some(p => p.offRoute)).toBe(false)
  })
  test('uses a route that finishes loading after the first GPS fix', () => {
    const recorder = new WalkRecorder()
    feed(recorder, [sample(0, 0, 50)])
    recorder.setReference([origin, offset(origin, 100, 0)])
    feed(recorder, Array.from({ length: 6 }, (_, i) => sample((i + 1) * 10, (i + 1) * 8, 50)))
    expect(recorder.traces[0].points.every(p => p.offRoute)).toBe(true)
  })
  test('does not flag a walk along the Google route', () => {
    const recorder = new WalkRecorder()
    recorder.setReference([origin, offset(origin, 100, 0)])
    walk(recorder, 0, 5)
    expect(recorder.traces[0].points.some(p => p.offRoute)).toBe(false)
  })
  test('rejects stationary jitter, inaccurate GPS, and vehicle movement', () => {
    for (const fixes of [
      Array.from({ length: 20 }, (_, i) => sample(i % 3, i * 5)),
      Array.from({ length: 10 }, (_, i) => sample(i * 10, i * 8, 0, { accuracy: 80 })),
      Array.from({ length: 10 }, (_, i) => sample(i * 50, i * 2)),
      Array.from({ length: 10 }, (_, i) => sample(i * 10, i * 8, 0, { speed: 12 })),
    ]) {
      const recorder = new WalkRecorder()
      feed(recorder, fixes)
      expect(recorder.traces).toHaveLength(0)
    }
  })
  test('does not connect across a GPS gap or an explicit foreground pause', () => {
    const recorder = new WalkRecorder()
    walk(recorder)
    walk(recorder, 200, 100)
    expect(recorder.traces).toHaveLength(2)
    expect(recorder.traces[1].points).toHaveLength(7)
    recorder.end()
    expect(recorder.points).toHaveLength(0)
    expect(recorder.traces).toHaveLength(2)
  })
  test('ignores stale and out-of-order fixes', () => {
    const recorder = new WalkRecorder()
    const fix = sample(0, 0)
    recorder.add(fix, start + 30_000)
    expect(recorder.points).toHaveLength(0)
    walk(recorder, 60)
    const points = recorder.points
    recorder.add(fix, start)
    expect(recorder.points).toBe(points)
  })
  test('restores saved walks defensively and clears all local traces', () => {
    const recorder = new WalkRecorder()
    walk(recorder)
    expect(readWalks(JSON.stringify(recorder.traces))).toEqual(recorder.traces)
    expect(readWalks('{bad')).toEqual([])
    expect(readWalks(JSON.stringify([{ id: 'bad', points: [null] }]))).toEqual([])
    recorder.clear()
    expect(recorder.traces).toEqual([])
    expect(recorder.points).toEqual([])
  })
})
