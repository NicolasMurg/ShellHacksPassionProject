import { distanceMeters, type LatLng } from './geo'
import { GRID, cellAt, cellCenter, cellIndex } from './grid'

export type SpeedCell = { sum: number; weight: number }
export type SpeedGrid = Map<number, SpeedCell>
export type SpeedMeasurement = { position: LatLng; speedMps: number; radiusMeters: number }

export const SPEED_RETENTION = 0.98

const EARTH_RADIUS_M = 6_371_000
const LAT_STEP = (GRID.north - GRID.south) / GRID.rows
const LNG_STEP = (GRID.east - GRID.west) / GRID.cols

const positiveFinite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0
const validIndex = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < GRID.rows * GRID.cols

function validPosition(p: LatLng): boolean {
  return Number.isFinite(p?.lat) && Number.isFinite(p?.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180
}

function validCell(value: unknown): value is SpeedCell {
  if (!value || typeof value !== 'object' || !('sum' in value) || !('weight' in value)) return false
  return positiveFinite(value.sum) && positiveFinite(value.weight) && positiveFinite(value.sum / value.weight)
}

/**
 * a = max(0, 1 - distance / radius), S = 0.98 S + a v, W = 0.98 W + a.
 * Decay happens once per contributing reading, not per elapsed second. A reading
 * at or beyond the radius leaves the cell unchanged, including its confidence.
 */
export function updateSpeedCell(
  previous: SpeedCell | undefined,
  speedMps: number,
  distanceMeters: number,
  radiusMeters: number,
): SpeedCell | undefined {
  if (!positiveFinite(speedMps) || !positiveFinite(radiusMeters) || !Number.isFinite(distanceMeters) || distanceMeters < 0) return previous
  const a = Math.max(0, 1 - distanceMeters / radiusMeters)
  if (a === 0) return previous
  const prior = validCell(previous) ? previous : undefined
  const next = {
    sum: SPEED_RETENTION * (prior?.sum ?? 0) + a * speedMps,
    weight: SPEED_RETENTION * (prior?.weight ?? 0) + a,
  }
  return validCell(next) ? next : previous
}

/** Update only cells whose centers fall inside this reading's radius. Returns the number updated. */
export function recordSpeedMeasurement(grid: SpeedGrid, measurement: SpeedMeasurement): number {
  const { position, speedMps, radiusMeters } = measurement
  if (!validPosition(position) || !cellAt(position) || !positiveFinite(speedMps) || !positiveFinite(radiusMeters)) return 0

  // Bound a spherical radius before checking true distances. Ordinary GPS readings
  // visit a small rectangle of cells instead of scanning the million-cell grid.
  const angularRadius = radiusMeters / EARTH_RADIUS_M
  const latitude = position.lat * Math.PI / 180
  const latRadius = angularRadius * 180 / Math.PI
  const lngRadius = angularRadius >= Math.PI / 2 - Math.abs(latitude)
    ? 180
    : Math.asin(Math.min(1, Math.sin(angularRadius) / Math.cos(latitude))) * 180 / Math.PI
  const firstRow = Math.max(0, Math.floor((GRID.north - position.lat - latRadius) / LAT_STEP))
  const lastRow = Math.min(GRID.rows - 1, Math.floor((GRID.north - position.lat + latRadius) / LAT_STEP))
  const firstCol = Math.max(0, Math.floor((position.lng - lngRadius - GRID.west) / LNG_STEP))
  const lastCol = Math.min(GRID.cols - 1, Math.floor((position.lng + lngRadius - GRID.west) / LNG_STEP))

  let updated = 0
  for (let row = firstRow; row <= lastRow; row++) {
    for (let col = firstCol; col <= lastCol; col++) {
      const cell = { row, col }
      const distance = distanceMeters(position, cellCenter(cell))
      if (distance >= radiusMeters) continue
      const index = cellIndex(cell)
      const previous = grid.get(index)
      const next = updateSpeedCell(previous, speedMps, distance, radiusMeters)
      if (next && next !== previous) {
        grid.set(index, next)
        updated++
      }
    }
  }
  return updated
}

/** Speed at a cell, or the caller's walking-profile estimate when no usable reading exists. */
export function speedAt(grid: SpeedGrid, position: LatLng, defaultSpeedMps: number): number {
  const cell = validPosition(position) ? cellAt(position) : undefined
  const value = cell ? grid.get(cellIndex(cell)) : undefined
  return validCell(value) ? value.sum / value.weight : defaultSpeedMps
}

/** Persist sparse accumulators, rather than averages, so later readings keep their correct weights. */
export function serializeSpeedGrid(grid: SpeedGrid): string {
  const cells: [number, number, number][] = []
  for (const [index, cell] of grid) {
    if (validIndex(index) && validCell(cell)) cells.push([index, cell.sum, cell.weight])
  }
  return JSON.stringify({ version: 1, cells })
}

export function deserializeSpeedGrid(serialized: string | null): SpeedGrid {
  const grid: SpeedGrid = new Map()
  if (!serialized) return grid
  try {
    const saved: unknown = JSON.parse(serialized)
    if (!saved || typeof saved !== 'object' || !('version' in saved) || saved.version !== 1 || !('cells' in saved) || !Array.isArray(saved.cells)) return grid
    for (const entry of saved.cells) {
      if (!Array.isArray(entry) || entry.length !== 3 || !validIndex(entry[0])) continue
      const cell = { sum: entry[1] as unknown, weight: entry[2] as unknown }
      if (validCell(cell)) grid.set(entry[0], cell)
    }
  } catch {
    // Missing, malformed, or incompatible storage starts with no observations.
  }
  return grid
}
