import { AdvancedMarker, Map, Polygon, Polyline, useMap } from '@vis.gl/react-google-maps'
import { useEffect, useRef, useState } from 'react'
import { CAMPUS_CENTER } from '../data/campus'
import { centroid, distanceMeters } from '../geo'
import { MAP_STYLES, type MapLayers } from '../mapLayers'
import type { Building, LatLng, RoadClosure, Zone } from '../types'

// Keep in sync with the @theme colors in index.css (the map needs raw hex).
const COLOR = {
  shared: '#2ee6d6',
  personal: '#a78bfa',
  selected: '#ffb547',
  closed: '#ff5d5d',
  route: '#2ee6d6',
}

export type Tool = 'none' | 'addZone' | 'drawClosure'

type Props = {
  buildings: Building[]
  zones: Zone[]
  closures: RoadClosure[]
  destination?: Building
  selectedZoneId?: string
  editingZoneId?: string
  editMode: boolean
  tool: Tool
  draftClosure: LatLng[]
  layers: MapLayers
  onMapClick: (point: LatLng) => void
  onSelectZone: (zone: Zone) => void
  onSelectBuilding: (b: Building) => void
  onZoneChange: (zone: Zone) => void
}

const MAP_ID = import.meta.env.VITE_GOOGLE_MAP_ID || 'DEMO_MAP_ID'

export function MapCanvas(props: Props) {
  const { buildings, zones, closures, destination, selectedZoneId, editingZoneId, editMode, tool, draftClosure, layers } = props
  const selected = zones.find((z) => z.id === selectedZoneId)
  const { mapTypeId, colorScheme } = MAP_STYLES[layers.style]
  const start = useStartCamera(colorScheme)

  useFitTo(destination, zones)

  // Markers only where they help: the destination's zones, or your own zones while editing.
  const showMarkersFor = (z: Zone) =>
    z.id === selectedZoneId || z.id === editingZoneId || z.buildingId === destination?.id || (editMode && z.ownerId !== null)

  return (
    <Map
      className="absolute inset-0"
      mapId={MAP_ID}
      colorScheme={colorScheme}
      mapTypeId={mapTypeId}
      defaultCenter={start.center}
      defaultZoom={start.zoom}
      // Flat 2D map: no tilting or rotating.
      tilt={0}
      heading={0}
      tiltInteractionEnabled={false}
      headingInteractionEnabled={false}
      gestureHandling="greedy"
      disableDefaultUI
      clickableIcons={false}
      draggableCursor={tool === 'none' ? undefined : 'crosshair'}
      onClick={(e) => e.detail.latLng && props.onMapClick(e.detail.latLng)}
    >
      {layers.traffic && <Overlay kind="traffic" />}
      {layers.transit && <Overlay kind="transit" />}

      {!destination &&
        !editMode &&
        buildings.map((b) => (
          <AdvancedMarker key={b.id} position={b.location} onClick={() => props.onSelectBuilding(b)}>
            <div className="pin-label transition-transform hover:scale-110 hover:border-accent">{b.code}</div>
          </AdvancedMarker>
        ))}

      {destination && !editMode && (
        <AdvancedMarker position={destination.location} zIndex={1}>
          <div className="rounded-full bg-[#3a3f48] px-2.5 py-1.5 text-[11px] font-bold text-[#c9ced6] opacity-90" title="Where ride apps drop you today">
            Address pin
          </div>
        </AdvancedMarker>
      )}

      {zones.map((z) => (
        <ZoneShape
          key={z.id}
          zone={z}
          selected={z.id === selectedZoneId}
          editing={z.id === editingZoneId}
          showMarkers={showMarkersFor(z)}
          interactive={tool === 'none'}
          onSelect={() => props.onSelectZone(z)}
          onChange={props.onZoneChange}
        />
      ))}

      {selected && !editMode && (
        <Polyline
          path={[selected.stopPoint, selected.entrance.location]}
          strokeOpacity={0}
          clickable={false}
          icons={[
            {
              icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, strokeColor: COLOR.route, strokeWeight: 4, scale: 3 },
              offset: '0',
              repeat: '14px',
            },
          ]}
        />
      )}

      {closures.map((c) => (
        <ClosureLine key={c.id} path={c.path} label={c.reason} />
      ))}

      {draftClosure.length > 0 && (
        <>
          <Polyline path={draftClosure} strokeColor={COLOR.closed} strokeOpacity={0.6} strokeWeight={6} clickable={false} />
          {draftClosure.map((p, i) => (
            <AdvancedMarker key={i} position={p} zIndex={50}>
              <div className="size-3 rounded-full border-2 border-white bg-closed" />
            </AdvancedMarker>
          ))}
        </>
      )}
    </Map>
  )
}

function ZoneShape({
  zone,
  selected,
  editing,
  showMarkers,
  interactive,
  onSelect,
  onChange,
}: {
  zone: Zone
  selected: boolean
  editing: boolean
  showMarkers: boolean
  interactive: boolean
  onSelect: () => void
  onChange: (z: Zone) => void
}) {
  const personal = zone.ownerId !== null
  const color = selected ? COLOR.selected : personal ? COLOR.personal : COLOR.shared

  const handlePaths = (paths: google.maps.LatLng[][]) => {
    const polygon = (paths[0] ?? []).map((p) => p.toJSON())
    if (polygon.length < 3) return
    // If the whole shape was dragged, move the stop point with it.
    const before = centroid(zone.polygon)
    const after = centroid(polygon)
    const moved = distanceMeters(before, after) > 0.5 && polygon.length === zone.polygon.length &&
      polygon.every((p, i) => Math.abs(p.lat - zone.polygon[i].lat - (after.lat - before.lat)) < 1e-7)
    const stopPoint = moved
      ? { lat: zone.stopPoint.lat + after.lat - before.lat, lng: zone.stopPoint.lng + after.lng - before.lng }
      : zone.stopPoint
    onChange({ ...zone, polygon, stopPoint })
  }

  const dragTo = (e: google.maps.MapMouseEvent) => e.latLng?.toJSON()

  return (
    <>
      <Polygon
        paths={zone.polygon}
        strokeColor={color}
        strokeOpacity={0.95}
        strokeWeight={selected || editing ? 3 : 2}
        fillColor={color}
        fillOpacity={selected || editing ? 0.4 : 0.22}
        clickable={interactive}
        editable={editing}
        draggable={editing}
        zIndex={selected || editing ? 10 : personal ? 5 : 2}
        onClick={onSelect}
        onPathsChanged={editing ? handlePaths : undefined}
      />
      {showMarkers && (
        <>
          <AdvancedMarker
            position={zone.stopPoint}
            zIndex={selected ? 40 : 20}
            draggable={editing}
            onClick={onSelect}
            onDragEnd={(e) => {
              const p = dragTo(e)
              if (p) onChange({ ...zone, stopPoint: p })
            }}
            title={editing ? 'Drag to move where the car stops' : zone.name}
          >
            <div
              className="pin-stop"
              style={{ borderColor: color, background: selected ? color : undefined }}
            >
              🚗
            </div>
          </AdvancedMarker>
          <AdvancedMarker
            position={zone.entrance.location}
            zIndex={selected ? 35 : 15}
            draggable={editing}
            onDragEnd={(e) => {
              const p = dragTo(e)
              if (p) onChange({ ...zone, entrance: { ...zone.entrance, location: p } })
            }}
            title={editing ? 'Drag to move the entrance' : zone.entrance.label}
          >
            <div className="pin-door" style={{ borderColor: selected || editing ? color : undefined }}>
              {zone.entrance.accessible ? '♿' : '🚪'}
            </div>
          </AdvancedMarker>
        </>
      )}
    </>
  )
}

function ClosureLine({ path, label }: { path: LatLng[]; label: string }) {
  const mid = path[Math.floor(path.length / 2)]
  return (
    <>
      <Polyline path={path} strokeColor={COLOR.closed} strokeOpacity={0.9} strokeWeight={7} clickable={false} zIndex={30} />
      {mid && (
        <AdvancedMarker position={mid} zIndex={45} title={`Closed: ${label}`}>
          <div className="grid size-7 place-items-center rounded-full bg-closed text-sm font-black text-white shadow-[var(--shadow-float)]">
            ⛔
          </div>
        </AdvancedMarker>
      )}
    </>
  )
}

/** Google's live traffic or transit lines drawn over the map. */
function Overlay({ kind }: { kind: 'traffic' | 'transit' }) {
  const map = useMap()

  useEffect(() => {
    if (!map) return
    const layer = kind === 'traffic' ? new google.maps.TrafficLayer() : new google.maps.TransitLayer()
    layer.setMap(map)
    return () => layer.setMap(null)
  }, [map, kind])

  return null
}

/**
 * Where a new map instance should open. Changing the color scheme makes the
 * library build a new map, so it starts where the old one was, not at campus center.
 */
function useStartCamera(colorScheme: string) {
  const map = useMap()
  const [start, setStart] = useState({ colorScheme, center: CAMPUS_CENTER, zoom: 17 })
  if (start.colorScheme !== colorScheme) {
    setStart({
      colorScheme,
      center: map?.getCenter()?.toJSON() ?? start.center,
      zoom: map?.getZoom() ?? start.zoom,
    })
  }
  return start
}

/** Zoom to the destination building and its zones. */
function useFitTo(destination: Building | undefined, zones: Zone[]) {
  const map = useMap()
  const destinationId = destination?.id
  const fittedFor = useRef<string>(undefined)

  useEffect(() => {
    if (!map) return
    // A rebuilt map (after a light/dark switch) already opens at the old view.
    if (fittedFor.current === (destinationId ?? '')) return
    fittedFor.current = destinationId ?? ''
    if (!destination) {
      map.panTo(CAMPUS_CENTER)
      map.setZoom(17)
      return
    }
    const bounds = new google.maps.LatLngBounds()
    bounds.extend(destination.location)
    for (const z of zones) {
      if (z.buildingId !== destination.id) continue
      bounds.extend(z.stopPoint)
      bounds.extend(z.entrance.location)
    }
    const desktop = window.matchMedia('(min-width: 900px)').matches
    map.fitBounds(
      bounds,
      desktop
        ? { top: 90, right: 80, bottom: 80, left: 470 }
        : { top: 90, right: 40, bottom: Math.round(window.innerHeight * 0.55), left: 40 },
    )
    // Only refit when the destination changes, not on every zone edit.
  }, [map, destinationId]) // eslint-disable-line react-hooks/exhaustive-deps
}
