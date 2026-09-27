import { describe, expect, test } from 'bun:test'
import { distanceMeters, type LatLng } from '../../shared/geo'
import { GRID, cellCenter, cellIndex } from '../../shared/grid'
import {
  SPEED_RETENTION, deserializeSpeedGrid, recordSpeedMeasurement, serializeSpeedGrid,
  speedAt, updateSpeedCell, type SpeedCell, type SpeedGrid,
} from '../../shared/speedGrid'

const CENTER = { row: 330, col: 705 }
const POSITION = cellCenter(CENTER)

describe('weighted walking speed per grid cell', () => {
  test('two readings 4 m apart interpolate five positions with recency applied', () => {
    const expected = [1.2, 1.3015228426395937, 1.402020202020202, 1.5015075376884424, 1.6]
    for (let meters = 0; meters <= 4; meters++) {
      const first = updateSpeedCell(undefined, 1.2, meters, 4)
      const second = updateSpeedCell(first, 1.6, 4 - meters, 4)!
      expect(second.sum / second.weight).toBeCloseTo(expected[meters]!, 10)
    }
  })

  test('each contributing reading decays both accumulators and favors recent readings', () => {
    const first = updateSpeedCell(undefined, 1, 0, 4)!
    const second = updateSpeedCell(first, 2, 0, 4)!
    expect(first).toEqual({ sum: 1, weight: 1 })
    expect(second).toEqual({ sum: 2.98, weight: 1.98 })
    expect(second.sum / second.weight).toBeGreaterThan(1.5)
    const third = updateSpeedCell(second, 1, 2, 4)!
    expect(third.sum).toBeCloseTo(SPEED_RETENTION * 2.98 + 0.5, 12)
    expect(third.weight).toBeCloseTo(SPEED_RETENTION * 1.98 + 0.5, 12)
  })

  test('cutoff readings do not allocate cells or decay existing observations', () => {
    const previous = { sum: 3, weight: 2 }
    expect(updateSpeedCell(undefined, 1.6, 4, 4)).toBeUndefined()
    expect(updateSpeedCell(previous, 1.6, 4, 4)).toBe(previous)
    expect(updateSpeedCell(previous, 1.6, 5, 4)).toBe(previous)
  })

  test('recording visits only nearby cells and leaves a distant observation unchanged', () => {
    const distantIndex = cellIndex({ row: 900, col: 900 })
    const distant = { sum: 5, weight: 4 }
    const grid: SpeedGrid = new Map([[distantIndex, distant]])
    let reads = 0
    const originalGet = grid.get.bind(grid)
    grid.get = (key) => { reads++; return originalGet(key) }

    const count = recordSpeedMeasurement(grid, { position: POSITION, speedMps: 1.4, radiusMeters: 4 })
    const expected = new Set<number>()
    for (let row = CENTER.row - 5; row <= CENTER.row + 5; row++) {
      for (let col = CENTER.col - 5; col <= CENTER.col + 5; col++) {
        if (distanceMeters(POSITION, cellCenter({ row, col })) < 4) expected.add(cellIndex({ row, col }))
      }
    }
    expect(count).toBe(expected.size)
    expect(count).toBeGreaterThan(1)
    expect(grid.size).toBe(count + 1)
    expect(reads).toBe(count)
    expect(reads).toBeLessThan(100)
    expect(originalGet(distantIndex)).toBe(distant)
    for (const index of expected) {
      const value = originalGet(index)!
      expect(value).toBeDefined()
      expect(value.sum / value.weight).toBeCloseTo(1.4, 12)
    }
  })

  test('radius bounds remain correct at all four FIU corners', () => {
    for (const [row, col] of [[0, 0], [0, 999], [999, 0], [999, 999]]) {
      const position = cellCenter({ row: row!, col: col! })
      const grid: SpeedGrid = new Map()
      recordSpeedMeasurement(grid, { position, speedMps: 1.2, radiusMeters: 4 })
      const expected: number[] = []
      for (let r = Math.max(0, row! - 5); r <= Math.min(999, row! + 5); r++) {
        for (let c = Math.max(0, col! - 5); c <= Math.min(999, col! + 5); c++) {
          if (distanceMeters(position, cellCenter({ row: r, col: c })) < 4) expected.push(cellIndex({ row: r, col: c }))
        }
      }
      expect([...grid.keys()].sort((a, b) => a - b)).toEqual(expected.sort((a, b) => a - b))
      expect(grid.has(cellIndex({ row: row!, col: col! }))).toBe(true)
    }
  })

  test('unobserved and invalid locations use the supplied profile speed', () => {
    const grid: SpeedGrid = new Map()
    expect(speedAt(grid, POSITION, 0.9)).toBe(0.9)
    recordSpeedMeasurement(grid, { position: POSITION, speedMps: 1.6, radiusMeters: 0.1 })
    expect(grid.size).toBe(1)
    expect(speedAt(grid, POSITION, 0.9)).toBeCloseTo(1.6, 12)
    expect(speedAt(grid, cellCenter({ row: CENTER.row + 1, col: CENTER.col }), 0.9)).toBe(0.9)
    expect(speedAt(grid, { lat: NaN, lng: POSITION.lng }, 0.9)).toBe(0.9)
    expect(speedAt(grid, { lat: GRID.north + 0.01, lng: POSITION.lng }, 0.9)).toBe(0.9)
  })

  test('invalid readings and off-campus measurement centers leave the grid unchanged', () => {
    const previous: SpeedCell = { sum: 3, weight: 2 }
    for (const invalid of [0, -1, NaN, Infinity]) {
      expect(updateSpeedCell(previous, invalid, 0, 4)).toBe(previous)
      expect(updateSpeedCell(previous, 1.4, 0, invalid)).toBe(previous)
    }
    for (const distance of [-1, NaN, Infinity]) expect(updateSpeedCell(previous, 1.4, distance, 4)).toBe(previous)
    const grid: SpeedGrid = new Map([[cellIndex(CENTER), previous]])
    for (const invalid of [0, -1, NaN, Infinity]) {
      expect(recordSpeedMeasurement(grid, { position: POSITION, speedMps: invalid, radiusMeters: 4 })).toBe(0)
      expect(recordSpeedMeasurement(grid, { position: POSITION, speedMps: 1.4, radiusMeters: invalid })).toBe(0)
    }
    const positions: LatLng[] = [
      { lat: NaN, lng: POSITION.lng }, { lat: POSITION.lat, lng: Infinity },
      { lat: 91, lng: POSITION.lng }, { lat: POSITION.lat, lng: -181 },
      { lat: GRID.north + 0.000001, lng: POSITION.lng },
    ]
    for (const position of positions) expect(recordSpeedMeasurement(grid, { position, speedMps: 1.4, radiusMeters: 4 })).toBe(0)
    expect([...grid]).toEqual([[cellIndex(CENTER), previous]])
  })

  test('restoring sparse accumulators preserves both estimates and future learning', () => {
    const grid: SpeedGrid = new Map()
    recordSpeedMeasurement(grid, { position: POSITION, speedMps: 1.2, radiusMeters: 4 })
    const saved = serializeSpeedGrid(grid)
    const restored = deserializeSpeedGrid(saved)
    expect([...restored]).toEqual([...grid])
    expect(restored.size).toBeLessThan(100)
    expect(speedAt(restored, POSITION, 1.34)).toBeCloseTo(1.2, 12)
    const reading = { position: POSITION, speedMps: 1.6, radiusMeters: 4 }
    recordSpeedMeasurement(grid, reading)
    recordSpeedMeasurement(restored, reading)
    expect([...restored]).toEqual([...grid])
  })

  test('malformed storage and incompatible versions fail safely; invalid entries are skipped', () => {
    for (const saved of [null, '', '{', 'null', '[]', '{"version":2,"cells":[[0,1,1]]}', '{"version":1,"cells":{}}']) {
      expect(deserializeSpeedGrid(saved).size).toBe(0)
    }
    const cells: unknown[] = [
      [0, 1.4, 1], [999999, 2.8, 2], [-1, 1, 1], [1000000, 1, 1], [0.5, 1, 1],
      ['2', 1, 1], [3, 0, 1], [4, 1, 0], [5, -1, 1], [6, '1', 1], [7, 1, null],
      [8, Number.MAX_VALUE, Number.MIN_VALUE], null, [9, 1], [10, 1, 1, 1],
    ]
    expect([...deserializeSpeedGrid(JSON.stringify({ version: 1, cells }))]).toEqual([
      [0, { sum: 1.4, weight: 1 }], [999999, { sum: 2.8, weight: 2 }],
    ])
    expect(deserializeSpeedGrid('{"version":1,"cells":[[0,1e400,1]]}').size).toBe(0)
    const invalidGrid: SpeedGrid = new Map([
      [-1, { sum: 1, weight: 1 }], [0, { sum: Infinity, weight: 1 }],
      [1, { sum: 1, weight: 0 }], [2, { sum: 1.4, weight: 1 }],
    ])
    expect([...deserializeSpeedGrid(serializeSpeedGrid(invalidGrid))]).toEqual([[2, { sum: 1.4, weight: 1 }]])
  })
})
