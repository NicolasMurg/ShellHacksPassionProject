import { AdvancedMarker, Polygon, Polyline, useMap } from '@vis.gl/react-google-maps'
import { useEffect, useRef, useState } from 'react'
import type { LatLng } from '../types'

// Keep in sync with --color-personal in index.css (the map needs raw hex).
const COLOR = '#a78bfa'
const BRUSH_PX = 22
const STREET_ZOOM = 19

export type Paint = {
  /** Where to zoom in when painting starts (the destination building). */
  focus: LatLng
  strokes: LatLng[][]
  /** The zone outline built from the strokes. */
  area?: LatLng[]
  /** Where the car stops: the closest road point to the painted spot. */
  stopPoint?: LatLng
  onStroke: (stroke: LatLng[]) => void
}

/**
 * "Color in" mode: press and drag on the map to paint where you'd like the car to stop.
 * The map holds still while painting; each finished stroke goes to onStroke.
 */
export function PaintLayer({ focus, strokes, area, stopPoint, onStroke }: Paint) {
  const map = useMap()
  const [live, setLive] = useState<LatLng[]>([])
  const onStrokeRef = useRef(onStroke)
  useEffect(() => {
    onStrokeRef.current = onStroke
  })

  // Zoom in close and flat so painting lands where the finger or mouse is.
  useEffect(() => {
    map?.moveCamera({ center: focus, zoom: STREET_ZOOM, tilt: 0, heading: 0 })
  }, [map, focus.lat, focus.lng]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!map) return
    const div = map.getDiv()
    // An empty overlay gives access to the map's pixel ↔ lat/lng projection.
    const overlay = new google.maps.OverlayView()
    overlay.onAdd = () => {}
    overlay.draw = () => {}
    overlay.onRemove = () => {}
    overlay.setMap(map)

    let stroke: LatLng[] | undefined
    let last = { x: 0, y: 0 }
    const toLatLng = (e: PointerEvent) => {
      const projection = overlay.getProjection()
      if (!projection) return undefined
      const box = div.getBoundingClientRect()
      return projection.fromContainerPixelToLatLng(new google.maps.Point(e.clientX - box.left, e.clientY - box.top))?.toJSON()
    }

    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      const p = toLatLng(e)
      if (!p) return
      e.preventDefault()
      e.stopPropagation()
      stroke = [p]
      last = { x: e.clientX, y: e.clientY }
      setLive([p])
    }
    const move = (e: PointerEvent) => {
      if (!stroke || Math.hypot(e.clientX - last.x, e.clientY - last.y) < 4) return
      const p = toLatLng(e)
      if (!p) return
      last = { x: e.clientX, y: e.clientY }
      stroke.push(p)
      setLive([...stroke])
    }
    const up = () => {
      if (!stroke) return
      const done = stroke
      stroke = undefined
      setLive([])
      onStrokeRef.current(done)
    }

    // Capture phase, so painting wins over the map's own drag handling.
    div.addEventListener('pointerdown', down, true)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    const touchAction = div.style.touchAction
    div.style.touchAction = 'none' // stop the page from scrolling under a finger
    return () => {
      div.removeEventListener('pointerdown', down, true)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      div.style.touchAction = touchAction
      overlay.setMap(null)
    }
  }, [map])

  const brush = { strokeColor: COLOR, strokeOpacity: 0.45, strokeWeight: BRUSH_PX, clickable: false, zIndex: 60 }

  return (
    <>
      {area && (
        <Polygon paths={area} strokeColor={COLOR} strokeOpacity={0.95} strokeWeight={2} fillColor={COLOR} fillOpacity={0.22} clickable={false} zIndex={58} />
      )}
      {strokes.map((s, i) => (
        <Polyline key={i} path={s} {...brush} />
      ))}
      {live.length > 0 && <Polyline path={live} {...brush} />}
      {stopPoint && (
        <AdvancedMarker position={stopPoint} zIndex={70} title="The car stops here: the closest road to your spot">
          <div className="pin-stop" style={{ borderColor: COLOR, background: COLOR }}>
            🚗
          </div>
        </AdvancedMarker>
      )}
    </>
  )
}
