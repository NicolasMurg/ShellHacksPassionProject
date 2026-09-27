import type { LatLng } from './geo'

// A 1000 × 1000 grid over FIU's Modesto A. Maidique Campus area, bounded by the
// centerlines of Tamiami Trail (SW 8th St, north), SW 107th Ave (east),
// Coral Way (SW 24th St, south) and Florida's Turnpike (west). The edges are the
// median centerline positions measured from OpenStreetMap road geometry.
// Row 0 is the north edge and column 0 the west edge. The area is about
// 1.69 km × 1.63 km, so each cell is about 1.69 m wide and 1.63 m tall.

export const GRID = {
  north: 25.761084, // Tamiami Trail (SW 8th St)
  south: 25.746468, // Coral Way (SW 24th St)
  west: -80.385122, // Florida's Turnpike (Homestead Extension)
  east: -80.368206, // SW 107th Ave
  rows: 1000,
  cols: 1000,
} as const

export type Cell = { row: number; col: number }

const LAT_STEP = (GRID.north - GRID.south) / GRID.rows
const LNG_STEP = (GRID.east - GRID.west) / GRID.cols

/** Latitude of the horizontal line above `row` (0 = north edge, rows = south edge). */
export const rowLat = (row: number) => GRID.north - row * LAT_STEP

/** Longitude of the vertical line left of `col` (0 = west edge, cols = east edge). */
export const colLng = (col: number) => GRID.west + col * LNG_STEP

/** The cell containing a point, or undefined outside the grid. */
export function cellAt(p: LatLng): Cell | undefined {
  if (p.lat > GRID.north || p.lat < GRID.south || p.lng < GRID.west || p.lng > GRID.east) return undefined
  return {
    row: Math.min(GRID.rows - 1, Math.floor((GRID.north - p.lat) / LAT_STEP)),
    col: Math.min(GRID.cols - 1, Math.floor((p.lng - GRID.west) / LNG_STEP)),
  }
}

/** The edges of a cell. */
export function cellBounds({ row, col }: Cell) {
  return { north: rowLat(row), south: rowLat(row + 1), west: colLng(col), east: colLng(col + 1) }
}

export function cellCenter({ row, col }: Cell): LatLng {
  return { lat: rowLat(row + 0.5), lng: colLng(col + 0.5) }
}

/** Row-major position (0 … rows × cols − 1), for storing one value per cell in a flat array. */
export const cellIndex = ({ row, col }: Cell) => row * GRID.cols + col

/**
 * Meters from a point to the nearest of the four big roads that bound the grid (their
 * centerlines): Tamiami Trail, SW 107th Ave, Coral Way and the Turnpike.
 */
export function distanceToBoundaryRoads(p: LatLng): number {
  const M_PER_DEG_LAT = 110_574
  const mPerDegLng = 111_320 * Math.cos((p.lat * Math.PI) / 180)
  const PAD = 0.002 // ~200 m: the roads carry on past the grid's corners
  const alongEW = p.lng >= GRID.west - PAD && p.lng <= GRID.east + PAD
  const alongNS = p.lat >= GRID.south - PAD && p.lat <= GRID.north + PAD
  return Math.min(
    alongEW ? Math.abs(p.lat - GRID.north) * M_PER_DEG_LAT : Infinity,
    alongEW ? Math.abs(p.lat - GRID.south) * M_PER_DEG_LAT : Infinity,
    alongNS ? Math.abs(p.lng - GRID.west) * mPerDegLng : Infinity,
    alongNS ? Math.abs(p.lng - GRID.east) * mPerDegLng : Infinity,
  )
}
