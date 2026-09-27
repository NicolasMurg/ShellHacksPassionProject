import { describe, expect, test } from 'bun:test'
import { lockToDoorways, throughDoorways } from '../src/doorShortcuts'
import { distanceMeters } from '../src/geo'
import { loadCampusGraph, routeWalk, withShortcuts } from '../src/walkRouter'

// Two Recreation Center doors: 79 m apart in a straight line, a 231 m walk around the building.
const doorA = { lat: 25.7554854, lng: -80.3778439 }
const doorB = { lat: 25.7561085, lng: -80.3782302 }
// A starting address well west of campus.
const offCampus = { lat: 25.7554854, lng: -80.41 }

const base = await loadCampusGraph()
const linked = withShortcuts(base, [{ a: doorA, b: doorB }])
const around = routeWalk(base, doorA, doorB)!
const polyline = (path: { lat: number; lng: number }[]) => path.slice(1).reduce((sum, p, i) => sum + distanceMeters(path[i]!, p), 0)

describe('walks through linked doorways', () => {
  test('a walk on campus goes through the building when that is shorter', () => {
    const doors = throughDoorways(linked, around.path, around.meters, false)!
    expect(doors).toBeDefined()
    expect(doors.meters).toBeLessThan(around.meters - 100)
    expect(doors.savedMeters).toBeCloseTo(around.meters - doors.meters, 6)
    expect(doors.steps.some((s) => /building/i.test(s.instruction))).toBe(true)
  })

  test('a walk from off campus keeps its first stretch and cuts through the building on campus', () => {
    const path = [offCampus, ...around.path]
    const meters = polyline(path)
    const approach = distanceMeters(offCampus, around.path[0]!)
    const steps = [
      { instruction: 'Head east on SW 8th St', maneuver: '', startAlong: 0, endAlong: approach },
      { instruction: 'Walk around the building', maneuver: '', startAlong: approach, endAlong: meters },
    ]
    const doors = throughDoorways(linked, path, meters, false, steps)!
    expect(doors).toBeDefined()
    expect(doors.path[0]).toEqual(offCampus)
    expect(doors.savedMeters).toBeGreaterThan(100)
    expect(doors.meters).toBeCloseTo(meters - doors.savedMeters, 6)
    // The off-campus step stays; the walk around the building is replaced by the way through it.
    expect(doors.steps[0]).toEqual(steps[0]!)
    expect(doors.steps.some((s) => s.instruction === 'Walk around the building')).toBe(false)
    expect(doors.steps.some((s) => /building/i.test(s.instruction))).toBe(true)
    expect(doors.steps.at(-1)!.endAlong).toBeCloseTo(doors.meters, 0)
  })

  test("Google's walk stays when the doorways aren't shorter", () => {
    expect(throughDoorways(linked, around.path, 50, false)).toBeUndefined()
  })

  test('no linked doors, or a walk that never reaches campus: nothing changes', () => {
    expect(throughDoorways(base, around.path, around.meters, false)).toBeUndefined()
    expect(throughDoorways(linked, [offCampus, { lat: 25.75, lng: -80.42 }], 1000, false)).toBeUndefined()
  })

  test('starting inside the circle of two linked doors, the walk goes out through one of them', () => {
    const inside = { lat: (doorA.lat + doorB.lat) / 2, lng: (doorA.lng + doorB.lng) / 2 } // the middle of the building
    const garage = { lat: 25.754877, lng: -80.37206 } // Gold Parking Garage, to the southeast
    const out = routeWalk(linked, inside, garage)!
    expect(out.path[0]).toEqual(inside)
    expect([doorA, doorB]).toContainEqual(out.path[1]!) // straight to a door, not the nearest path
    expect(out.steps[0]!.instruction).toContain('out of the building')
    // Without linked doors it's the usual start from the nearest path.
    expect(routeWalk(base, inside, garage)!.steps[0]!.instruction).not.toContain('out of the building')
    // Standing right at a door isn't inside.
    expect(routeWalk(linked, doorA, garage)!.steps[0]!.instruction).not.toContain('out of the building')
  })

  test("from inside the building the door route is used even when Google's looks shorter", () => {
    const inside = { lat: (doorA.lat + doorB.lat) / 2, lng: (doorA.lng + doorB.lng) / 2 }
    const doors = throughDoorways(linked, [inside, doorB], 1, false)!
    expect(doors).toBeDefined()
    expect([doorA, doorB]).toContainEqual(doors.path[1]!)
  })

  test('lockToDoorways shortens a planned walk and says why', () => {
    const option = { walkSeconds: around.meters / 1.4, reason: 'Closest door', route: { path: around.path, meters: around.meters, seconds: around.meters / 1.4 } }
    const locked = lockToDoorways(option, doorA, doorB, { graph: linked, stepFree: false, speedMps: 1.4 })
    expect(locked.walkSeconds).toBeLessThan(option.walkSeconds - 60)
    expect(locked.reason).toContain('doorway shortcut')
    expect(locked.route!.meters).toBeLessThan(around.meters)
    expect(lockToDoorways(option, doorA, doorB, { stepFree: false, speedMps: 1.4 })).toBe(option)
  })
})
