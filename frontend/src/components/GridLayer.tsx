import { ControlPosition, MapControl, Polygon, Polyline, useMap } from '@vis.gl/react-google-maps'
import { useEffect, useState } from 'react'
import { speedAt } from '../../../shared/speedGrid'
import { distanceMeters } from '../geo'
import { GRID, cellAt, cellBounds, cellCenter, cellIndex, colLng, rowLat, type Cell } from '../grid'
import { useAuth } from '../state/auth'
import { useSpeedGrid } from '../state/speedGrid'
import { walkingSpeed } from '../walking'

const LAT_STEP = (GRID.north - GRID.south) / GRID.rows
const LNG_STEP = (GRID.east - GRID.west) / GRID.cols
const corner = cellBounds({ row: 0, col: 0 })
/** The shorter side of one cell, in meters (~1.6 m). */
const CELL_M = Math.min(
  distanceMeters({ lat: corner.north, lng: corner.west }, { lat: corner.north, lng: corner.east }),
  distanceMeters({ lat: corner.north, lng: corner.west }, { lat: corner.south, lng: corner.west }),
)

/** Draw every Nth line so neighbouring lines stay at least this far apart on screen. */
const MIN_GAP_PX = 14
const STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500]
/** Also draw lines half a screen beyond the view, so panning doesn't reveal empty edges. */
const MARGIN = 0.5

type View = google.maps.LatLngBoundsLiteral & { zoom: number }

/** Which grid lines to draw for this view: every `step`-th row and column line that's near the screen. */
function visibleLines(view: View) {
  const midLat = (GRID.north + GRID.south) / 2
  const metersPerPx = (156543.03392 * Math.cos((midLat * Math.PI) / 180)) / 2 ** view.zoom
  const step = STEPS.find((s) => (s * CELL_M) / metersPerPx >= MIN_GAP_PX)
  if (!step) return { step: undefined, rows: [], cols: [] }

  const latPad = (view.north - view.south) * MARGIN
  const lngPad = (view.east - view.west) * MARGIN
  const range = (from: number, to: number, max: number) => {
    const out: number[] = []
    const start = Math.max(0, Math.ceil(from / step) * step)
    for (let i = start; i <= Math.min(max, to); i += step) out.push(i)
    return out
  }
  return {
    step,
    rows: range((GRID.north - (view.north + latPad)) / LAT_STEP, (GRID.north - (view.south - latPad)) / LAT_STEP, GRID.rows),
    cols: range((view.west - lngPad - GRID.west) / LNG_STEP, (view.east + lngPad - GRID.west) / LNG_STEP, GRID.cols),
  }
}

/**
 * The 1000 × 1000 grid between Tamiami Trail, SW 107th Ave, Coral Way and the Turnpike:
 * its outline, as many lines as are readable at this zoom, and the cell under the pointer.
 */
export function GridLayer({ light }: { light: boolean }) {
  const map = useMap()
  const { user } = useAuth()
  const speeds = useSpeedGrid(user?.id)
  const [view, setView] = useState<View>()
  const [hover, setHover] = useState<Cell>()

  useEffect(() => {
    if (!map) return
    const update = () => {
      const bounds = map.getBounds()?.toJSON()
      const zoom = map.getZoom()
      if (bounds && zoom !== undefined) setView({ ...bounds, zoom })
    }
    const point = (e: google.maps.MapMouseEvent) => setHover(e.latLng ? cellAt(e.latLng.toJSON()) : undefined)
    const listeners = [
      map.addListener('idle', update),
      map.addListener('mousemove', point),
      map.addListener('click', point), // phones have no hover
      map.addListener('mouseout', () => setHover(undefined)),
    ]
    const first = setTimeout(update, 0) // draw now, not only after the next pan
    return () => {
      listeners.forEach((l) => l.remove())
      clearTimeout(first)
    }
  }, [map])

  const { step, rows, cols } = view ? visibleLines(view) : { step: undefined, rows: [], cols: [] }
  const color = light ? '#1f2937' : '#ffffff'
  const line = (major: boolean) => ({
    strokeColor: color,
    strokeOpacity: major ? 0.5 : 0.2,
    strokeWeight: major ? 1.5 : 1,
    clickable: false,
    zIndex: 1,
  })
  const outline = [
    { lat: GRID.north, lng: GRID.west },
    { lat: GRID.north, lng: GRID.east },
    { lat: GRID.south, lng: GRID.east },
    { lat: GRID.south, lng: GRID.west },
    { lat: GRID.north, lng: GRID.west },
  ]
  const hovered = hover && step && step <= 2 ? cellBounds(hover) : undefined

  return (
    <>
      {rows.map((r) => (
        <Polyline key={`r${r}`} path={[{ lat: rowLat(r), lng: GRID.west }, { lat: rowLat(r), lng: GRID.east }]} {...line(r % 100 === 0)} />
      ))}
      {cols.map((c) => (
        <Polyline key={`c${c}`} path={[{ lat: GRID.north, lng: colLng(c) }, { lat: GRID.south, lng: colLng(c) }]} {...line(c % 100 === 0)} />
      ))}
      <Polyline path={outline} strokeColor="#2ee6d6" strokeOpacity={0.9} strokeWeight={2} clickable={false} zIndex={2} />
      {hovered && (
        <Polygon
          paths={[
            { lat: hovered.north, lng: hovered.west },
            { lat: hovered.north, lng: hovered.east },
            { lat: hovered.south, lng: hovered.east },
            { lat: hovered.south, lng: hovered.west },
          ]}
          strokeOpacity={0}
          fillColor="#2ee6d6"
          fillOpacity={0.45}
          clickable={false}
          zIndex={2}
        />
      )}

      <MapControl position={ControlPosition.TOP_CENTER}>
        <div className="mt-3 max-w-[calc(100vw-24px)] rounded-full border border-line bg-surface/90 px-3.5 py-1.5 text-center text-xs font-bold text-fg shadow-[var(--shadow-float)] backdrop-blur">
          {hover ? `Cell row ${hover.row} · col ${hover.col}` : `Grid ${GRID.rows} × ${GRID.cols}`}
          <span className="text-accent">
            {hover
              ? ` · ${speeds.cells.has(cellIndex(hover)) ? 'average' : 'default'} ${speedAt(speeds.cells, cellCenter(hover), walkingSpeed(user?.profile)).toFixed(2)} m/s`
              : ` · ${speeds.cells.size.toLocaleString()} learned cells`}
          </span>
          <span className="font-semibold text-muted">
            {step ? (step === 1 ? ' · every line' : ` · lines every ${step} cells`) : ' · zoom in to see lines'}
            {speeds.storageUnavailable && speeds.cells.size > 0 && ' · speeds kept for this session'}
          </span>
        </div>
      </MapControl>
    </>
  )
}
