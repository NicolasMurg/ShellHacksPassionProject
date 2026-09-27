import { describe, expect, test } from 'bun:test'
import { locateInTrip, tripElapsed } from '../src/tripTimeline'

// Walk to pickup (1 min) → ride to curb (5 min) → walk to door (1.5 min).
const trip = [{ seconds: 60 }, { seconds: 300 }, { seconds: 90 }]

describe('trip timeline', () => {
  test('a moment maps to the right leg and position in it', () => {
    expect(locateInTrip(trip, 0)).toEqual({ index: 0, fraction: 0 })
    expect(locateInTrip(trip, 30)).toEqual({ index: 0, fraction: 0.5 })
    expect(locateInTrip(trip, 60)).toEqual({ index: 1, fraction: 0 }) // a chapter boundary starts the next leg
    expect(locateInTrip(trip, 210)).toEqual({ index: 1, fraction: 0.5 })
    expect(locateInTrip(trip, 405)).toEqual({ index: 2, fraction: 0.5 })
  })

  test('the ends clamp to the start and the finish', () => {
    expect(locateInTrip(trip, -20)).toEqual({ index: 0, fraction: 0 })
    expect(locateInTrip(trip, 450)).toEqual({ index: 2, fraction: 1 })
    expect(locateInTrip(trip, 9999)).toEqual({ index: 2, fraction: 1 })
    expect(locateInTrip([], 10)).toEqual({ index: 0, fraction: 0 })
  })

  test('elapsed time and position round-trip', () => {
    expect(tripElapsed(trip, 0, 0)).toBe(0)
    expect(tripElapsed(trip, 1, 150)).toBe(210)
    expect(tripElapsed(trip, 2, 90)).toBe(450)
    for (const s of [0, 12, 59, 60, 61, 200, 359, 360, 400, 449]) {
      const { index, fraction } = locateInTrip(trip, s)
      expect(tripElapsed(trip, index, fraction * trip[index]!.seconds)).toBeCloseTo(s, 6)
    }
  })
})
