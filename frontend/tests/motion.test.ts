import { describe, expect, test } from 'bun:test'
import { BOLT_MPS, areaOf, initialMotion, measuredPace, stepMotion, type Area, type Motion } from '../src/motion'

// Replays GPS traces (one fix per second, moving north) through the travel-mode detector.
// Run with: cd frontend && bun test

const START = { lat: 25.7565, lng: -80.374 }
const M_PER_DEG_LAT = 110_574

type Segment = { speed: number; seconds: number; area?: Area; doppler?: boolean; accuracy?: number }

function replay(segments: Segment[]) {
  let s: Motion = stepMotion(initialMotion, { ...START, t: 0, accuracy: 5 })
  let t = 0
  let north = 0
  const modes: { t: number; mode: Motion['mode'] }[] = []
  for (const seg of segments) {
    for (let i = 0; i < seg.seconds; i++) {
      t += 1000
      north += seg.speed
      const fix = {
        lat: START.lat + north / M_PER_DEG_LAT,
        lng: START.lng,
        t,
        accuracy: seg.accuracy ?? 5,
        speed: seg.doppler === false ? null : seg.speed,
      }
      s = stepMotion(s, fix, seg.area ?? 'unknown')
      modes.push({ t: t / 1000, mode: s.mode })
    }
  }
  const firstTime = (mode: Motion['mode'], after = 0) => modes.find((m) => m.t > after && m.mode === mode)?.t
  return { s, modes, firstTime }
}

describe('travel mode from GPS', () => {
  test('walking is detected within ~10 m', () => {
    const r = replay([{ speed: 1.4, seconds: 60 }])
    expect(r.s.mode).toBe('walking')
    expect(r.firstTime('walking')).toBeLessThanOrEqual(8)
    expect(r.s.speed).toBeCloseTo(1.4, 1)
  })

  test('a car on a road becomes "vehicle" after 100 m and 10 s', () => {
    const r = replay([{ speed: 12, seconds: 30, area: 'road' }])
    expect(r.s.mode).toBe('vehicle')
    const at = r.firstTime('vehicle')!
    expect(at).toBeGreaterThanOrEqual(9) // 100 m at 12 m/s ≈ 8.3 s, plus the 10 s hold
    expect(at).toBeLessThanOrEqual(11)
  })

  test('campus drives use a lower bar: 6.5 m/s is a car there, a bike on a main road', () => {
    expect(replay([{ speed: 6.5, seconds: 40, area: 'campusRoad' }]).s.mode).toBe('vehicle')
    expect(replay([{ speed: 6.5, seconds: 40, area: 'road' }]).s.mode).toBe('cycling')
  })

  test('on a walkway, fast is a bike or scooter unless it beats Bolt for 100 m', () => {
    expect(replay([{ speed: 9, seconds: 40, area: 'walkway' }]).s.mode).toBe('cycling')
    const bolt = replay([{ speed: BOLT_MPS + 0.5, seconds: 20, area: 'walkway' }])
    expect(bolt.s.mode).toBe('vehicle')
    expect(bolt.firstTime('vehicle')).toBeLessThanOrEqual(10) // 100 m at ~10.9 m/s
  })

  test('a red light does not end the ride; a long stop does', () => {
    const light = replay([{ speed: 12, seconds: 30, area: 'road' }, { speed: 0, seconds: 60, area: 'road' }])
    expect(light.s.mode).toBe('vehicle')
    const parked = replay([{ speed: 12, seconds: 30, area: 'road' }, { speed: 0, seconds: 140, area: 'road' }])
    expect(parked.s.mode).toBe('still')
  })

  test('getting out of the car switches to walking after ~40 m of real walking', () => {
    const r = replay([{ speed: 12, seconds: 30, area: 'road' }, { speed: 1.3, seconds: 60 }])
    expect(r.s.mode).toBe('walking')
    const at = r.firstTime('walking', 30)! - 30
    expect(at).toBeGreaterThanOrEqual(25)
    expect(at).toBeLessThanOrEqual(40)
  })

  test('stop-and-go traffic stays "vehicle"', () => {
    const creep: Segment[] = []
    for (let i = 0; i < 10; i++) creep.push({ speed: 1.5, seconds: 3, area: 'road' }, { speed: 8, seconds: 3, area: 'road' })
    const r = replay([{ speed: 12, seconds: 30, area: 'road' }, ...creep])
    expect(r.modes.filter((m) => m.t > 30).every((m) => m.mode === 'vehicle')).toBe(true)
  })

  test('a single GPS jump does not look like driving', () => {
    let s = stepMotion(initialMotion, { ...START, t: 0, accuracy: 8 })
    let north = 0
    const seen = new Set<string>()
    for (let i = 1; i <= 60; i++) {
      north += 1.3
      const jump = i === 30 ? 60 : 0 // one fix lands 60 m away, then snaps back
      s = stepMotion(s, { lat: START.lat + (north + jump) / M_PER_DEG_LAT, lng: START.lng, t: i * 1000, accuracy: 8, speed: null })
      if (i > 10) seen.add(s.mode)
    }
    expect([...seen]).toEqual(['walking'])
  })

  test('blurry fixes are ignored', () => {
    const r = replay([{ speed: 20, seconds: 30, accuracy: 80, doppler: false }])
    expect(r.s.mode).toBe('unknown')
  })

  test("the phone's Doppler speed wins over jittery positions", () => {
    let s = stepMotion(initialMotion, { ...START, t: 0, accuracy: 10 })
    for (let i = 1; i <= 30; i++) {
      const jitter = i % 2 ? 6 : 0 // positions bounce 6 m every second (6 m/s if computed)
      s = stepMotion(s, { lat: START.lat + (i * 1.2 + jitter) / M_PER_DEG_LAT, lng: START.lng, t: i * 1000, accuracy: 10, speed: 1.2 })
    }
    expect(s.mode).toBe('walking')
  })

  test('walking pace only counts walking, never the ride', () => {
    const r = replay([
      { speed: 1.4, seconds: 60 },
      { speed: 12, seconds: 60, area: 'road' },
      { speed: 1.4, seconds: 60 },
    ])
    const { meters, seconds } = r.s.walked
    expect(meters).toBeGreaterThan(100) // most of the 168 m walked
    expect(meters).toBeLessThan(200) // none of the ~720 m driven
    expect(meters / seconds).toBeCloseTo(1.4, 1)
  })
})

describe('where you are', () => {
  test('roads win over the sidewalk next to them', () => {
    expect(areaOf({ walkway: 3, campusRoad: 40, road: 12 })).toBe('road')
    expect(areaOf({ walkway: 3, campusRoad: 10, road: 90 })).toBe('campusRoad')
    expect(areaOf({ walkway: 5, campusRoad: 40, road: 90 })).toBe('walkway')
    expect(areaOf({ walkway: 60, campusRoad: 40, road: 90 })).toBe('unknown')
  })
})

describe('measured walking pace', () => {
  test('suggests faster / about right / slower once there is enough walking', () => {
    expect(measuredPace({ meters: 300, seconds: 180 }, 1.34)?.suggestion).toBe('faster') // 1.67 m/s
    expect(measuredPace({ meters: 268, seconds: 200 }, 1.34)?.suggestion).toBe('right') // 1.34 m/s
    expect(measuredPace({ meters: 200, seconds: 200 }, 1.34)?.suggestion).toBe('slower') // 1.0 m/s
    expect(measuredPace({ meters: 100, seconds: 70 }, 1.34)).toBeUndefined() // too little walking
  })
})
