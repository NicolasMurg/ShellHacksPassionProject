import { AdvancedMarker, AdvancedMarkerAnchorPoint, Circle, CollisionBehavior, Map, Polygon, Polyline, useMap } from '@vis.gl/react-google-maps'
import { useEffect, useId, useRef, useState } from 'react'
import { CAMPUS_CENTER } from '../data/mapDefaults'
import { centroid, distanceMeters, splitPath } from '../geo'
import { MAP_STYLES, type MapLayers } from '../mapLayers'
import type { Building, Entrance, LatLng, RoadClosure, Zone } from '../types'

// Keep in sync with the @theme colors in index.css (the map needs raw hex).
const COLOR = {
  shared: '#2ee6d6',
  personal: '#a78bfa',
  selected: '#ffb547',
  closed: '#ff5d5d',
  drive: '#2ee6d6',
  walk: '#ffffff',
  walkNav: '#7df3e8',
  me: '#4c8dff',
}

export type Tool = 'none' | 'addZone' | 'drawClosure'

type Props = {
  buildings: Building[]
  entrances: globalThis.Map<string, Entrance>
  zones: Zone[]
  closures: RoadClosure[]
  destination?: Building
  selectedZoneId?: string
  /** Walk mode: the chosen door (there's no zone). */
  focusEntranceId?: string
  walkMode: boolean
  /** Where a walk starts when it isn't your GPS position. */
  walkStart?: { location: LatLng; label: string }
  editingZoneId?: string
  editMode: boolean
  tool: Tool
  draftClosure: LatLng[]
  me?: { position: LatLng; accuracy?: number; heading?: number }
  drivePath?: LatLng[]
  walkPath?: LatLng[]
  layers: MapLayers
  /** In-app navigation: the route, how far along you are, and where you are. */
  nav?: { travel: 'DRIVING' | 'WALKING'; path: LatLng[]; traveled: number; position?: LatLng; heading: number }
  follow: boolean
  onUserPan: () => void
  arrivalStop?: LatLng
  movingArrival?: boolean
  onMoveArrival: (point: LatLng) => void
  onMapClick: (point: LatLng, placeId?: string) => void
  onSelectZone: (zone: Zone) => void
  onSelectBuilding: (b: Building) => void
  onZoneChange: (zone: Zone) => void
}

const MAP_ID = import.meta.env.VITE_GOOGLE_MAP_ID || 'DEMO_MAP_ID'

export function MapCanvas(props: Props) {
  const { buildings, entrances, zones, closures, destination, selectedZoneId, editingZoneId, editMode, tool, draftClosure, me, layers } = props
  const selected = zones.find((z) => z.id === selectedZoneId)
  const { mapTypeId, colorScheme } = MAP_STYLES[layers.style]
  const start = useStartCamera(colorScheme)
  const selectedEntranceId = selected?.entranceId ?? props.focusEntranceId

  // In walk mode also fit where the walk starts (demo start, or you).
  const walkOrigin = props.walkMode ? (props.walkStart?.location ?? me?.position) : undefined
  const navigating = !!props.nav
  useFitTo(destination, walkOrigin, navigating)
  useFollow(props.nav?.position, navigating && props.follow)
  const [navDone, navAhead] = props.nav ? splitPath(props.nav.path, props.nav.traveled) : [[], []]

  // Car markers only where they help: the destination's zones, or your own zones while editing.
  const showStopFor = (z: Zone) =>
    !props.walkMode &&
    (z.id === selectedZoneId || z.id === editingZoneId || z.buildingId === destination?.id || (editMode && z.source === 'personal'))

  // Doors: the destination's, plus the selected zone's.
  const doors = [
    ...(destination?.entrances ?? []),
    ...(selectedEntranceId && !destination?.entrances.some((e) => e.id === selectedEntranceId)
      ? [entrances.get(selectedEntranceId)].filter((e): e is Entrance => !!e)
      : []),
  ]

  return (
    <Map
      className="absolute inset-0"
      mapId={MAP_ID}
      colorScheme={colorScheme}
      mapTypeId={mapTypeId}
      defaultCenter={start.center}
      defaultZoom={start.zoom}
      // Flat 2D map: no tilting or rotating.
      tiltInteractionEnabled={false}
      headingInteractionEnabled={false}
      gestureHandling="greedy"
      disableDefaultUI
      clickableIcons={!editMode && tool === 'none' && !props.movingArrival}
      draggableCursor={tool === 'none' && !props.movingArrival ? undefined : 'crosshair'}
      onClick={(e) => {
        e.stop()
        if (e.detail.latLng) props.onMapClick(e.detail.latLng, e.detail.placeId ?? undefined)
      }}
      onDragstart={props.onUserPan}
    >
      {layers.traffic && <Overlay kind="traffic" />}
      {layers.transit && <Overlay kind="transit" />}

      {!destination &&
        !editMode &&
        !navigating &&
        buildings.map((b) => (
          <AdvancedMarker
            key={b.id}
            position={b.location}
            onClick={() => props.onSelectBuilding(b)}
            title={b.name}
            // With 90 buildings, let Google hide labels that would overlap (bigger buildings win).
            collisionBehavior={CollisionBehavior.OPTIONAL_AND_HIDES_LOWER_PRIORITY}
            zIndex={b.entrances.length}
          >
            <div className="pin-label transition-transform hover:scale-110 hover:border-accent">{b.code}</div>
          </AdvancedMarker>
        ))}

      {destination && !editMode && !navigating && (
        <AdvancedMarker position={destination.location} zIndex={1}>
          <div className="rounded-full bg-[#3a3f48] px-2.5 py-1.5 text-[11px] font-bold text-[#c9ced6] opacity-90" title="Your destination">
            Destination
          </div>
        </AdvancedMarker>
      )}

      {/* In-app navigation: gray behind you, bright ahead. */}
      {props.nav && (
        <>
          <Polyline path={navDone} strokeColor="#6b7686" strokeOpacity={0.7} strokeWeight={6} clickable={false} zIndex={3} />
          <Polyline path={navAhead} strokeColor="#000000" strokeOpacity={0.45} strokeWeight={11} clickable={false} zIndex={4} />
          <Polyline
            path={navAhead}
            strokeColor={props.nav.travel === 'DRIVING' ? COLOR.drive : COLOR.walkNav}
            strokeOpacity={1}
            strokeWeight={7}
            clickable={false}
            zIndex={5}
          />
          {props.nav.position && (
            <AdvancedMarker position={props.nav.position} zIndex={70} title="You" anchorPoint={AdvancedMarkerAnchorPoint.CENTER}>
              <Beacon heading={props.nav.heading} arrow />
            </AdvancedMarker>
          )}
        </>
      )}

      {props.arrivalStop && !editMode && <AdvancedMarker position={props.arrivalStop} zIndex={50}
        draggable={props.movingArrival} title={props.movingArrival ? 'Drag to move the stop' : 'Suggested stopping point'}
        onDragEnd={e => { const p = e.latLng?.toJSON(); if (p) props.onMoveArrival(p) }}>
        <div className="pin-stop" style={{ borderColor: COLOR.selected, background: COLOR.selected }}>🚗</div>
      </AdvancedMarker>}

      {/* Car route: you → curb */}
      {props.drivePath && !editMode && !navigating && (
        <>
          <Polyline path={props.drivePath} strokeColor="#000000" strokeOpacity={0.5} strokeWeight={9} clickable={false} zIndex={3} />
          <Polyline path={props.drivePath} strokeColor={COLOR.drive} strokeOpacity={1} strokeWeight={5} clickable={false} zIndex={4} />
        </>
      )}

      {/* Walking route: curb → door */}
      {props.walkPath && !editMode && !navigating && (
        <Polyline
          path={props.walkPath}
          strokeOpacity={0}
          clickable={false}
          zIndex={6}
          icons={[
            {
              icon: { path: google.maps.SymbolPath.CIRCLE, fillColor: COLOR.walk, fillOpacity: 1, strokeOpacity: 0, scale: 2.6 },
              offset: '0',
              repeat: '10px',
            },
          ]}
        />
      )}

      {!navigating && zones.map((z) => (
        <ZoneShape
          key={z.id}
          zone={z}
          selected={z.id === selectedZoneId}
          editing={z.id === editingZoneId}
          showStop={showStopFor(z)}
          interactive={tool === 'none' && !props.movingArrival}
          onSelect={() => props.onSelectZone(z)}
          onChange={props.onZoneChange}
        />
      ))}

      {doors.map((e) => {
        const chosen = e.id === selectedEntranceId
        return (
          <AdvancedMarker key={e.id} position={e.location} zIndex={chosen ? 35 : 15} title={e.label}>
            <div className="pin-door" style={{ borderColor: chosen ? COLOR.selected : undefined, opacity: chosen ? 1 : 0.8 }}>
              {e.accessible ? '♿' : '🚪'}
            </div>
          </AdvancedMarker>
        )
      })}

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

      {props.walkStart && !navigating && (
        <AdvancedMarker position={props.walkStart.location} zIndex={55} title={`Walk starts at ${props.walkStart.label}`}>
          <div className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] font-bold shadow-[var(--shadow-float)]">
            <span aria-hidden className="size-2.5 rounded-full bg-[#4c8dff]" />
            Start
          </div>
        </AdvancedMarker>
      )}

      {me && !navigating && (
        <>
          {me.accuracy && me.accuracy < 200 && (
            <Circle
              center={me.position}
              radius={me.accuracy}
              strokeOpacity={0}
              fillColor={COLOR.me}
              fillOpacity={0.12}
              clickable={false}
            />
          )}
          <AdvancedMarker position={me.position} zIndex={60} title="You are here" anchorPoint={AdvancedMarkerAnchorPoint.CENTER}>
            <Beacon heading={me.heading} />
          </AdvancedMarker>
        </>
      )}
    </Map>
  )
}

/**
 * You on the map: a blue dot (or arrow while navigating) with a soft pulse, and
 * a beam fanning out in the direction you're facing or heading.
 */
function Beacon({ heading, arrow }: { heading?: number; arrow?: boolean }) {
  const gradientId = useId()
  return (
    <div className="pointer-events-none relative grid size-24 place-items-center">
      {heading !== undefined && (
        <svg aria-hidden viewBox="0 0 96 96" className="absolute inset-0 transition-transform duration-300" style={{ transform: `rotate(${heading}deg)` }}>
          <defs>
            <radialGradient id={gradientId} cx="48" cy="48" r="46" gradientUnits="userSpaceOnUse">
              <stop offset="0.15" stopColor="#4c8dff" stopOpacity="0.55" />
              <stop offset="1" stopColor="#4c8dff" stopOpacity="0" />
            </radialGradient>
          </defs>
          {/* A 70° wedge pointing up (north); the whole svg rotates to the heading. */}
          <path d="M48 48 L22.8 12 A44 44 0 0 1 73.2 12 Z" fill={`url(#${gradientId})`} />
        </svg>
      )}
      <span aria-hidden className="absolute size-9 animate-ping-soft rounded-full bg-[#4c8dff]/35" />
      {arrow ? (
        <div
          className="relative grid size-9 place-items-center rounded-full border-[3px] border-white bg-[#4c8dff] shadow-[0_2px_10px_rgb(0_0_0/0.4)]"
          style={{ transform: `rotate(${heading ?? 0}deg)` }}
        >
          <svg aria-hidden viewBox="0 0 24 24" className="size-4">
            <path d="M12 3 19 20l-7-4-7 4 7-17Z" fill="white" />
          </svg>
        </div>
      ) : (
        <div className="relative size-[18px] rounded-full border-[3px] border-white bg-[#4c8dff] shadow-[0_2px_10px_rgb(0_0_0/0.4)]" />
      )}
    </div>
  )
}

function ZoneShape({
  zone,
  selected,
  editing,
  showStop,
  interactive,
  onSelect,
  onChange,
}: {
  zone: Zone
  selected: boolean
  editing: boolean
  showStop: boolean
  interactive: boolean
  onSelect: () => void
  onChange: (z: Zone) => void
}) {
  const personal = zone.source === 'personal'
  const color = selected ? COLOR.selected : personal ? COLOR.personal : COLOR.shared

  const handlePaths = (paths: google.maps.LatLng[][]) => {
    const polygon = (paths[0] ?? []).map((p) => p.toJSON())
    if (polygon.length < 3) return
    // If the whole shape was dragged, move the stop point with it.
    const before = centroid(zone.polygon)
    const after = centroid(polygon)
    const moved =
      distanceMeters(before, after) > 0.5 &&
      polygon.length === zone.polygon.length &&
      polygon.every((p, i) => Math.abs(p.lat - zone.polygon[i].lat - (after.lat - before.lat)) < 1e-7)
    const stopPoint = moved
      ? { lat: zone.stopPoint.lat + after.lat - before.lat, lng: zone.stopPoint.lng + after.lng - before.lng }
      : zone.stopPoint
    onChange({ ...zone, polygon, stopPoint })
  }

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
      {showStop && (
        <AdvancedMarker
          position={zone.stopPoint}
          zIndex={selected ? 40 : 20}
          draggable={editing}
          onClick={onSelect}
          onDragEnd={(e) => {
            const p = e.latLng?.toJSON()
            if (p) onChange({ ...zone, stopPoint: p })
          }}
          title={editing ? 'Drag to move where the car stops' : zone.name}
        >
          <div className="pin-stop" style={{ borderColor: color, background: selected ? color : undefined }}>
            🚗
          </div>
        </AdvancedMarker>
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

const MAX_FIT_ZOOM = 18

/**
 * Frame a destination once. Route results and pin edits must not move the camera,
 * and while navigating the camera follows you instead (see useFollow).
 */
function useFitTo(destination?: Building, origin?: LatLng, navigating = false) {
  const map = useMap()
  const key = destination?.id
  const fittedFor = useRef<string>(undefined)

  useEffect(() => {
    if (!map || navigating || fittedFor.current === key) return
    if (!destination) {
      fittedFor.current = undefined
      return
    }
    const frame = () => {
      const projection = map.getProjection()
      if (!projection) return
      const points = [destination.location, ...destination.entrances.map(e => e.location)]
      if (origin && distanceMeters(origin, destination.location) < 3000) points.push(origin)
      const projected = points.map(p => projection.fromLatLngToPoint(new google.maps.LatLng(p))!)
      // Keep nearby locations together even when they straddle the date line.
      const anchorX = projected[0].x
      const xs = projected.map(p => anchorX + ((p.x - anchorX + 384) % 256) - 128)
      const ys = projected.map(p => p.y)
      const west = Math.min(...xs), east = Math.max(...xs)
      const north = Math.min(...ys), south = Math.max(...ys)
      const padding = mapPadding()
      const { clientWidth: width, clientHeight: height } = map.getDiv()
      if (!width || !height) return
      const usableWidth = Math.max(1, width - padding.left - padding.right)
      const usableHeight = Math.max(1, height - padding.top - padding.bottom)
      const zoom = Math.max(0, Math.min(MAX_FIT_ZOOM,
        Math.log2(usableWidth / Math.max(east - west, 1e-9)),
        Math.log2(usableHeight / Math.max(south - north, 1e-9))))
      const scale = 2 ** zoom
      const center = projection.fromPointToLatLng(new google.maps.Point(
        (west + east) / 2 - (padding.left - padding.right) / (2 * scale),
        (north + south) / 2 - (padding.top - padding.bottom) / (2 * scale),
      ))
      if (!center) return
      fittedFor.current = key
      // Set center and the already-capped zoom together. No fitBounds/idle correction.
      map.moveCamera({ center, zoom })
    }
    frame()
    if (fittedFor.current === key) return
    const listener = google.maps.event.addListenerOnce(map, 'idle', frame)
    return () => listener.remove()
    // Only a new destination reframes the map; keep the user's view during planning/editing.
  }, [map, key, navigating]) // eslint-disable-line react-hooks/exhaustive-deps
}

const NAV_ZOOM = 18

/** Keep the camera on you while navigating (until you drag the map). */
function useFollow(position: LatLng | undefined, enabled: boolean) {
  const map = useMap()
  const zoomed = useRef(false)

  useEffect(() => {
    if (!enabled) zoomed.current = false
  }, [enabled])

  useEffect(() => {
    if (!map || !enabled || !position) return
    if (!zoomed.current) {
      map.setZoom(NAV_ZOOM)
      zoomed.current = true
    }
    map.panTo(offsetForPanel(map, position))
  }, [map, enabled, position?.lat, position?.lng]) // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * The map center that puts `p` in the middle of the part of the map you can
 * actually see: right of the side panel on desktop, above the sheet on phones.
 */
function offsetForPanel(map: google.maps.Map, p: LatLng): LatLng {
  const projection = map.getProjection()
  const zoom = map.getZoom()
  if (!projection || zoom === undefined) return p
  const desktop = window.matchMedia('(min-width: 900px)').matches
  // Pixels to shift the view: half the panel width, or a quarter of the screen height.
  const dx = desktop ? -226 : 0
  const dy = desktop ? 0 : window.innerHeight * 0.22
  const scale = 2 ** zoom
  const world = projection.fromLatLngToPoint(p)
  if (!world) return p
  const center = projection.fromPointToLatLng(new google.maps.Point(world.x + dx / scale, world.y + dy / scale))
  return center ? center.toJSON() : p
}

/** Leave room for the panel so fitted content isn't hidden behind it. */
function mapPadding(): Required<google.maps.Padding> {
  const desktop = window.matchMedia('(min-width: 900px)').matches
  return desktop
    ? { top: 90, right: 80, bottom: 80, left: 470 }
    : { top: 90, right: 40, bottom: Math.round(window.innerHeight * 0.55), left: 40 }
}
