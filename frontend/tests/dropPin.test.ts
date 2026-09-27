import { describe, expect, test } from 'bun:test'
import { PIN_REACH_M, clampPin, placedDoorsAt, reachArea, walkFromPin } from '../src/dropPin'
import { distanceMeters } from '../src/geo'
import type { Entrance } from '../src/types'
import { loadCampusGraph } from '../src/walkRouter'

// Graham Center's address pin, and two made-up doors on its east and west sides.
const center = { lat: 25.7563, lng: -80.3727 }
const east: Entrance = { id: 'e', buildingId: 'gc', label: 'East entrance', location: { lat: 25.7563, lng: -80.3717 }, accessible: false, rooms: [] }
const west: Entrance = { id: 'w', buildingId: 'gc', label: 'West entrance', location: { lat: 25.7563, lng: -80.3737 }, accessible: true, rooms: [] }
const anchors = [center, east.location, west.location]
const nearest = (p: { lat: number; lng: number }) => Math.min(...anchors.map((a) => distanceMeters(a, p)))

describe('drop-off pin', () => {
  test('a pin near the building stays where it was dropped', () => {
    const p = { lat: 25.7568, lng: -80.3717 } // ~55 m north of the east door
    expect(clampPin(anchors, p)).toEqual({ point: p, moved: false })
  })

  test('a pin dropped too far away is pulled back to the 100 m edge, toward the closest part', () => {
    const far = { lat: 25.7563, lng: -80.3680 } // ~370 m east of the east door
    const { point, moved } = clampPin(anchors, far)
    expect(moved).toBe(true)
    expect(nearest(point)).toBeLessThanOrEqual(PIN_REACH_M)
    expect(nearest(point)).toBeGreaterThan(PIN_REACH_M - 2)
    expect(point.lng).toBeGreaterThan(east.location.lng) // still east of the building
  })

  test('the outline of where the pin may go follows the 100 m reach', () => {
    const area = reachArea(anchors)
    expect(area.length).toBe(72)
    for (const p of area) {
      expect(nearest(p)).toBeLessThanOrEqual(PIN_REACH_M)
      expect(nearest(p)).toBeGreaterThan(PIN_REACH_M - 3)
    }
  })

  test("doors you placed count as the building's own when they're closest to it", () => {
    const gc = { id: 'gc', code: 'GC', name: 'Graham Center', location: center, entrances: [east, west] }
    const pc = { id: 'pc', code: 'PC', name: 'Charles E. Perry', location: { lat: 25.7555, lng: -80.3750 }, entrances: [] }
    const placed = [
      { id: '1', label: 'Door 1', location: { lat: 25.7558, lng: -80.3724 } }, // south side of GC
      { id: '2', label: 'Door 2', location: { lat: 25.7556, lng: -80.3747 } }, // right by PC
      { id: '3', label: 'Door 3', location: { lat: 25.7600, lng: -80.3727 } }, // 400 m north of everything
    ]
    const doors = placedDoorsAt(gc, [gc, pc], placed)
    expect(doors.map((d) => d.id)).toEqual(['placed-1'])
    expect(doors[0]).toMatchObject({ buildingId: 'gc', label: 'Door 1 (your door)', accessible: false })
    expect(placedDoorsAt(pc, [gc, pc], placed).map((d) => d.id)).toEqual(['placed-2'])
  })

  test('from the pin you walk to the closest door, or the step-free one when that is needed', async () => {
    const graph = await loadCampusGraph()
    const nearEast = { lat: 25.7563, lng: -80.3712 }
    expect(walkFromPin(graph, [east, west], nearEast, false)?.entrance.id).toBe('e')
    expect(walkFromPin(graph, [east, west], nearEast, true)?.entrance.id).toBe('w')
    const walk = walkFromPin(graph, [east, west], nearEast, false)!
    expect(walk.path[0]).toEqual(nearEast)
    expect(walk.meters).toBeGreaterThan(distanceMeters(nearEast, east.location) - 1)
  })
})
