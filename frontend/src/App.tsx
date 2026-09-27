import { APIProvider, useMap, useMapsLibrary } from '@vis.gl/react-google-maps'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrivalPanel } from './components/ArrivalPanel'
import { useArrival } from './state/arrivals'
import { AccountMenu } from './components/Account'
import { ClosurePanel } from './components/ClosurePanel'
import { DropoffPanel } from './components/DropoffPanel'
import { EditPanel } from './components/EditPanel'
import { LayerControl } from './components/LayerControl'
import { cx } from './components/cx'
import { DoorwaysPanel } from './components/DoorwaysPanel'
import { MapCanvas, type DoorwayMarks, type Tool } from './components/MapCanvas'
import { MarkZonePanel } from './components/MarkZonePanel'
import { NavBanner, NavPanel } from './components/NavPanel'
import { PreferencesPage } from './components/PreferencesPage'
import { TabBar, type Tab } from './components/TabBar'
import { Button, LogoMark, Notice, Sheet } from './components/ui'
import { useMapLayers } from './mapLayers'
import * as api from './api'
import { type Destination } from './search'
import { AuthProvider, useAuth } from './state/auth'
import { CAMPUS_CENTER, CAMPUS_GATE, WALK_DEMO_START } from './data/mapDefaults'
import { centroid, distanceMeters, distanceToPath } from './geo'
import { cellAt } from './grid'
import { insidePolygon, paintedArea } from './paintedZone'
import { useCampus, useClosures, useZones } from './state/data'
import { doorLocation, placeDoor, toggleLink, useDoorways } from './state/doorways'
import { MODE_ICON, MODE_LABEL, measuredPace, type Motion } from './motion'
import { recordFix, resetWalked, useMotion } from './state/motion'
import { recordWalkingFix } from './state/speedGrid'
import { useNavigation, type NavLeg } from './state/navigation'
import { lockToDoorways } from './doorShortcuts'
import { findAddress, useCampusGraphs, useGeolocation, useRoute, useServerPlan, type Geo } from './state/routing'
import type { LatLng, Place, TravelMode, TripKind, Zone } from './types'
import { needsStepFree, walkingSpeed } from './walking'

const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined

export default function App() {
  if (!API_KEY) {
    return (
      <div className="grid h-full place-items-center p-6 text-center text-muted">
        <p>
          Missing <code>VITE_GOOGLE_MAPS_API_KEY</code> in <code>frontend/.env.local</code>.
        </p>
      </div>
    )
  }
  return (
    <APIProvider apiKey={API_KEY}>
      <AuthProvider>
        <Doorstep />
      </AuthProvider>
    </APIProvider>
  )
}

type Panel = 'dropoff' | 'edit' | 'closure' | 'mark' | 'doors'

function Doorstep() {
  const { user, token, restoring, sendFeedback, error: authError } = useAuth()
  const campus = useCampus()
  const zoneStore = useZones(campus.defaults, campus.buildings, user, token)
  const closureStore = useClosures(token)

  const [panel, setPanel] = useState<Panel>('dropoff')
  const [tool, setTool] = useState<Tool>('none')
  const [draftClosure, setDraftClosure] = useState<LatLng[]>([])
  const [expanded, setExpanded] = useState(true)
  const [layers, setLayers] = useMapLayers()
  // Signed-out visitors land on the sign-in page; returning users go straight to the map.
  const [tab, setTab] = useState<Tab>(() => (user || restoring ? 'map' : 'preferences'))

  // Drop-off planning
  const [destination, setDestination] = useState<Destination>()
  const [arrivalDestination, setArrivalDestination] = useState<api.ArrivalDestination>()
  const [searchError, setSearchError] = useState<string>()
  const [mode, setMode] = useState<TravelMode>('dropoff')
  const [stepFreeChoice, setStepFreeChoice] = useState<boolean>()
  const [selectedZoneId, setSelectedZoneId] = useState<string>()
  const [confirmedZoneId, setConfirmedZoneId] = useState<string>()
  const [confirmedTripId, setConfirmedTripId] = useState<string>()
  const [feedbackSent, setFeedbackSent] = useState(false)
  const [selectedDoorId, setSelectedDoorId] = useState<string>()
  // A typed starting address; without one, trips start from your GPS (or the campus gate).
  const [start, setStart] = useState<Place>()
  const routesLib = useMapsLibrary('routes')
  const walking = mode === 'walk'

  // Zone editing
  const [editingZoneId, setEditingZoneId] = useState<string>()
  // Marking your own spot: the brush strokes painted on the map so far.
  const [strokes, setStrokes] = useState<LatLng[][]>([])
  // Doorways on the grid: tap a square to place one, tap two doors to link them.
  const doorways = useDoorways()
  const [selectedDoorwayId, setSelectedDoorwayId] = useState<string>()
  const [doorError, setDoorError] = useState<string>()
  const [savingSpot, setSavingSpot] = useState(false)

  const stepFree = stepFreeChoice ?? needsStepFree(user?.profile)
  const { zones } = zoneStore

  const geo = useGeolocation()
  // Trips start from a typed address, your GPS when you're on campus, otherwise a demo spot.
  const onCampus = geo.position && distanceMeters(geo.position, CAMPUS_CENTER) < 3000
  const walkStart = start
    ? { ...start, fromGps: false }
    : onCampus && geo.position
      ? { location: geo.position, fromGps: true, label: 'your location' }
      : { ...WALK_DEMO_START, fromGps: false }
  const planning = useServerPlan(destination ? { buildingId: destination.building.id, room: destination.room,
    kind: mode, stepFree, origin: walking ? { lat: +walkStart.location.lat.toFixed(4), lng: +walkStart.location.lng.toFixed(4) } : undefined } : undefined,
    token, JSON.stringify([user?.profile, zoneStore.personal, closureStore.closures]))
  // Walks lock onto linked doorways when going through the building beats Google's walk.
  const { graph: campusGraph } = useCampusGraphs()
  const lock = { graph: doorways.links.length > 0 ? campusGraph : undefined, stepFree, speedMps: walkingSpeed(user?.profile) }

  // Travel-mode detection (still / walking / bike / vehicle) runs on the same GPS fixes: no extra tracking.
  useEffect(() => {
    if (geo.position && geo.timestamp !== undefined) {
      const fix = { ...geo.position, accuracy: geo.accuracy, speed: geo.speed, t: geo.timestamp }
      const detected = recordFix(fix, campusGraph)
      if (!restoring) recordWalkingFix(fix, detected, user?.id)
    }
  }, [geo.timestamp, user?.id, restoring]) // eslint-disable-line react-hooks/exhaustive-deps
  const motion = useMotion()
  // Your GPS-measured walking pace (walking stretches only) vs. what the model expects.
  const measuredWalk = measuredPace(motion.walked, walkingSpeed(user?.profile))
  const [dismissedDriveHint, setDismissedDriveHint] = useState<number>()
  const options = (planning.data?.options ?? []).flatMap((o) =>
    o.zone ? [lockToDoorways({ ...o, zone: o.zone }, o.zone.stopPoint, o.entrance.location, lock)] : [],
  )
  const doors = walking
    ? (planning.data?.options ?? []).map((d) => lockToDoorways(d, walkStart.location, d.entrance.location, lock))
    : []
  const activeZoneId = panel === 'edit' ? editingZoneId : options.some(o => o.zone.id === selectedZoneId) ? selectedZoneId : options[0]?.zone.id
  const activeOption = panel === 'dropoff' && !walking ? options.find(o => o.zone.id === activeZoneId) : undefined
  const activeDoor = panel === 'dropoff' && walking ? doors.find(d => d.entrance.id === selectedDoorId) ?? doors[0] : undefined
  // Car: from the typed address, you, or the campus gate to the curb.
  const driveFrom = start?.location ?? geo.position ?? CAMPUS_GATE
  const driveFromName = start ? start.label.split(',')[0] : geo.position ? 'you' : 'the SW 8th St entrance'
  const driveResult = useRoute('DRIVING', activeOption ? driveFrom : undefined, activeOption?.zone.stopPoint)
  const drive = driveResult.info
  const walk = (activeDoor ?? activeOption)?.route

  // The painted spot, and the closest road to it: a car route to the spot ends where it meets a road.
  const paintArea = useMemo(() => (panel === 'mark' ? paintedArea(strokes) : undefined), [panel, strokes])
  const paintCenter = useMemo(() => paintArea && centroid(paintArea), [paintArea])
  const road = useRoute('DRIVING', paintCenter && driveFrom, paintCenter)
  const roadStop = road.info?.path[road.info.path.length - 1]
  const searchRequest = useRef<AbortController | undefined>(undefined)
  useEffect(() => () => searchRequest.current?.abort(), [])

  // In-app navigation. A trip is one or more legs (walk to pickup, ride to the curb, walk to the door).
  const kind: TripKind = mode === 'pickup' ? 'pickup' : 'dropoff'
  const [trip, setTrip] = useState<{ legs: NavLeg[]; index: number; destinationLabel: string; door?: LatLng }>()
  const [simulateChoice, setSimulateChoice] = useState<boolean>()
  const [voice, setVoice] = useState(false)
  const [follow, setFollow] = useState(true)
  // Off campus (or no GPS) there's nothing real to track, so play the trip by default.
  const simulate = simulateChoice ?? !onCampus
  const leg = trip?.legs[trip.index]
  const nav = useNavigation({ leg, gps: geo.position, walkSpeedMps: walkingSpeed(user?.profile), simulate, stepFree })

  const startTrip = (legs: NavLeg[], destinationLabel: string, door?: LatLng) => {
    setTrip({ legs, index: 0, destinationLabel, door })
    resetWalked() // measure this trip's walking pace from scratch
    setSimulateChoice(undefined)
    setFollow(true)
    setExpanded(true)
  }
  const startWalk = (entranceId: string) => {
    const door = doors.find((d) => d.entrance.id === entranceId)?.entrance
    if (!door) return
    startTrip([{ travel: 'WALKING', from: walkStart.location, to: door.location, toLabel: door.label, stage: 'Walk to door' }], door.label, door.location)
  }

  // Where the car picks you up: one of your own pickup spots near you, otherwise
  // the start of the server's driving route (the nearest drivable point to you).
  const PICKUP_SEARCH_M = 300
  const here = geo.position
  const myPickupSpot = here
    ? zoneStore.personal
        .filter((z) => !z.hidden && z.kinds.includes('pickup') && distanceMeters(here, z.stopPoint) < PICKUP_SEARCH_M)
        .sort((a, b) => distanceMeters(here, a.stopPoint) - distanceMeters(here, b.stopPoint))[0]
    : undefined
  const pickupPoint = myPickupSpot?.stopPoint ?? (here ? drive?.path[0] : undefined)

  const startCarTrip = () => {
    const option = options.find((o) => o.zone.id === confirmedZoneId)
    if (!option) return
    const { zone, entrance } = option
    if (kind === 'dropoff') {
      const legs: NavLeg[] = []
      // You're not standing on a road (e.g. inside a building): walk to the pickup curb first.
      // A typed "From" address means you're starting there instead, so no walk leg.
      if (!start && here && pickupPoint && distanceMeters(here, pickupPoint) > 25) {
        legs.push({
          travel: 'WALKING',
          from: here,
          to: pickupPoint,
          toLabel: myPickupSpot ? `your pickup spot (${myPickupSpot.name})` : 'your pickup spot',
          stage: 'Walk to pickup',
        })
      }
      legs.push(
        { travel: 'DRIVING', from: start?.location ?? pickupPoint ?? here ?? CAMPUS_GATE, to: zone.stopPoint, toLabel: zone.name, stage: 'Ride to curb' },
        { travel: 'WALKING', from: zone.stopPoint, to: entrance.location, toLabel: entrance.label, stage: 'Walk to door' },
      )
      startTrip(legs, entrance.label, entrance.location)
    } else {
      // Pickup: you walk out to where the car will meet you.
      startTrip(
        [{ travel: 'WALKING', from: walkStart.location, to: zone.stopPoint, toLabel: `pickup spot (${zone.name.toLowerCase()})`, stage: 'Walk to pickup' }],
        'Your pickup spot',
        zone.stopPoint,
      )
    }
  }

  // Reached the end of a leg with more to go (e.g. the car reached the curb): continue to the next one.
  const legArrived = !!nav?.arrived && !!trip && trip.index < trip.legs.length - 1
  useEffect(() => {
    if (!legArrived) return
    const id = setTimeout(() => setTrip((t) => (t ? { ...t, index: t.index + 1 } : t)), 2000)
    return () => clearTimeout(id)
  }, [legArrived])

  // Real movement moves the trip along too: getting out of the car ends the ride leg, and
  // getting into it (picked up) ends the walk to the pickup spot. Not while simulating.
  const [seenMode, setSeenMode] = useState<Motion['mode']>(motion.mode)
  if (motion.mode !== seenMode) {
    setSeenMode(motion.mode)
    const next = trip?.legs[trip.index + 1]
    if (trip && leg && next && !simulate) {
      const gotOut = leg.travel === 'DRIVING' && seenMode === 'vehicle' && motion.mode === 'walking'
      const gotIn = leg.travel === 'WALKING' && next.travel === 'DRIVING' && motion.mode === 'vehicle'
      if (gotOut || gotIn) setTrip({ ...trip, index: trip.index + 1 })
    }
  }
  // "Looks like you're in a vehicle": offered once per ride while planning a walk.
  const suggestDropoff = motion.mode === 'vehicle' && walking && !trip && panel === 'dropoff' && dismissedDriveHint !== motion.since

  // Arrival planning starts from a typed "From" address, otherwise your GPS.
  const arrivalFrom = start?.location ?? geo.position
  const arrival = useArrival(arrivalDestination && panel === 'dropoff' ? {
    destination: arrivalDestination, kind: mode === 'pickup' ? 'pickup' : 'dropoff', stepFree,
    origin: arrivalFrom ? { lat: +arrivalFrom.lat.toFixed(4), lng: +arrivalFrom.lng.toFixed(4) } : undefined,
  } : undefined, token, JSON.stringify([user?.profile, closureStore.closures]))
  const mapDestination = arrivalDestination ? { id: arrivalDestination.placeId ?? `point:${arrivalDestination.location.lat},${arrivalDestination.location.lng}`,
    name: arrivalDestination.name, code: '', location: arrivalDestination.location, entrances: [] } : destination?.building

  const clearSelection = () => {
    arrival.reset()
    setArrivalDestination(undefined)
    searchRequest.current?.abort()
    setDestination(undefined)
    setSearchError(undefined)
    setSelectedZoneId(undefined)
    setSelectedDoorId(undefined)
    setEditingZoneId(undefined)
    setConfirmedZoneId(undefined)
    setConfirmedTripId(undefined)
    setFeedbackSent(false)
    if (panel === 'mark') stopMarking()
  }

  const requireUser = (then: () => void) => {
    if (user) then()
    else setTab('preferences')
  }

  const openPanel = (next: Panel) =>
    requireUser(() => {
      clearSelection()
      setPanel(next)
      setTool(next === 'closure' ? 'drawClosure' : 'none')
      setDraftClosure([])
      setEditingZoneId(undefined)
      setExpanded(true)
    })

  // "Mark my drop-off spot": color in an area near the destination and save it as your own zone.
  const startMarking = () =>
    requireUser(() => {
      setPanel('mark')
      setTool('paintZone')
      setStrokes([])
      setExpanded(true)
    })

  function stopMarking() {
    setPanel('dropoff')
    setTool('none')
    setStrokes([])
  }

  const saveSpot = async (name: string) => {
    if (!user || !destination || !paintArea || !paintCenter) return
    // Lead to the building's door nearest the spot (a step-free one when that's needed).
    const all = destination.building.entrances
    const usable = stepFree && all.some((e) => e.accessible) ? all.filter((e) => e.accessible) : all
    const door = [...usable].sort((a, b) => distanceMeters(paintCenter, a.location) - distanceMeters(paintCenter, b.location))[0]
    if (!door) return
    const zone: Zone = {
      id: api.newId('zone'),
      buildingId: destination.building.id,
      entranceId: door.id,
      source: 'personal',
      name,
      kinds: [mode === 'pickup' ? 'pickup' : 'dropoff'],
      polygon: paintArea,
      stopPoint: roadStop ?? paintCenter,
      ownerId: user.id,
      rooms: [],
    }
    setSavingSpot(true)
    try {
      await zoneStore.upsert(zone)
    } finally {
      setSavingSpot(false)
    }
    setSelectedZoneId(zone.id)
    stopMarking()
  }

  const search = async (text: string) => {
    searchRequest.current?.abort()
    const controller = new AbortController()
    searchRequest.current = controller
    // Your own saved spots win: typing "My apartment" goes straight to that spot.
    const q = text.trim().toLowerCase()
    const spot = zoneStore.personal.find((z) => !z.hidden && z.name.trim().length > 2 && q.includes(z.name.trim().toLowerCase()))
    const spotBuilding = spot && campus.buildings.find((b) => b.id === spot.buildingId)
    if (spot && spotBuilding) {
      setDestination({ building: spotBuilding, room: text.match(/\b([a-z]?\d{2,4}[a-z]?)\b/i)?.[1]?.toUpperCase() ?? '' })
      setSearchError(undefined)
      setSelectedZoneId(spot.id)
      setSelectedDoorId(undefined)
      setConfirmedZoneId(undefined)
      return
    }
    try {
      const result = await api.search(text, controller.signal)
      if (controller.signal.aborted) return
      clearSelection()
      if (result.building) setDestination({ building: result.building, room: result.room })
      else if (result.destination) setArrivalDestination(result.destination)
      setSearchError(undefined)
      setSelectedZoneId(undefined)
      setSelectedDoorId(undefined)
      setConfirmedZoneId(undefined)
    } catch (e) {
      if (controller.signal.aborted) return
      clearSelection()
      setSearchError((e as Error).message)
    }
  }

  // Any address → Graham Center, unless a building or other place is already chosen.
  const chooseStart = async (address: string) => {
    if (!routesLib) throw new Error('Google Maps is still loading. Try again in a moment.')
    const graham = campus.buildings.find((b) => b.id === 'gc')
    setStart(await findAddress(routesLib, address, graham?.location ?? CAMPUS_CENTER))
    setConfirmedZoneId(undefined)
    setConfirmedTripId(undefined)
    setFeedbackSent(false)
    if (!destination && !arrivalDestination && graham) {
      setDestination({ building: graham, room: '' })
      setSearchError(undefined)
      setSelectedZoneId(undefined)
      setSelectedDoorId(undefined)
    }
  }

  const openDoorways = () => {
    setPanel('doors')
    setTool('placeDoor')
    setDoorError(undefined)
    setExpanded(true)
  }
  const closeDoorways = () => {
    setPanel('dropoff')
    setTool('none')
    setSelectedDoorwayId(undefined)
    setDoorError(undefined)
  }
  // With a door selected, tapping another door links them (or unlinks them), and the
  // selection moves along so you can chain links: A → B → C.
  const tapDoor = (id: string) => {
    setDoorError(undefined)
    if (!selectedDoorwayId || selectedDoorwayId === id) {
      setSelectedDoorwayId(selectedDoorwayId === id ? undefined : id)
      return
    }
    toggleLink(selectedDoorwayId, id)
    setSelectedDoorwayId(id)
  }

  const handleMapClick = (point: LatLng, placeId?: string) => {
    if (tool === 'placeDoor') {
      const cell = cellAt(point)
      if (!cell) {
        setDoorError('Doors go inside the grid: between Tamiami Trail, SW 107th Ave, Coral Way and the Turnpike.')
        return
      }
      const existing = doorways.doors.find((d) => d.row === cell.row && d.col === cell.col)
      if (existing) tapDoor(existing.id)
      else {
        setDoorError(undefined)
        setSelectedDoorwayId(placeDoor(cell).id)
      }
      return
    }
    if (tool === 'addZone') {
      const zone = zoneStore.createAt(point)
      if (zone) setEditingZoneId(zone.id)
      setTool('none')
    } else if (tool === 'drawClosure') {
      setDraftClosure((d) => [...d, point])
    } else if (panel === 'dropoff') {
      if (arrivalDestination && arrival.moving) { arrival.moveTo(point); return }
      clearSelection()
      setArrivalDestination({ name: placeId ? 'Selected place' : 'Selected location', location: point, placeId })
      setExpanded(true)
    }
  }

  const handleSelectZone = (zone: Zone) => {
    searchRequest.current?.abort()
    if (panel === 'edit') {
      setEditingZoneId(zone.id)
      return
    }
    if (panel !== 'dropoff') return
    arrival.reset()
    setArrivalDestination(undefined)
    if (zone.buildingId !== destination?.building.id) {
      const building = campus.buildings.find((b) => b.id === zone.buildingId)
      if (building) setDestination({ building, room: '' })
    }
    setSelectedZoneId(zone.id)
    setConfirmedZoneId(undefined)
    setExpanded(true)
  }

  const doorById = new Map(doorways.doors.map((d) => [d.id, d]))
  const doorMarks: DoorwayMarks = {
    doors: doorways.doors.map((d) => ({ id: d.id, label: d.label, location: doorLocation(d) })),
    links: doorways.links.flatMap((l) => {
      const a = doorById.get(l.a)
      const b = doorById.get(l.b)
      return a && b ? [{ id: l.id, a: doorLocation(a), b: doorLocation(b) }] : []
    }),
    selectedId: panel === 'doors' ? selectedDoorwayId : undefined,
    onSelect: (id) => panel === 'doors' && tapDoor(id),
  }

  const editingZone = zones.find((z) => z.id === editingZoneId)
  const hiddenDefaults = campus.defaults.filter((z) => zoneStore.hiddenDefaultIds.has(z.id))

  return (
    <div className="fixed inset-0 flex flex-col">
      <div className="relative min-h-0 flex-1">
        {/* The map stays mounted behind the Preferences page so it doesn't reload. */}
        <main className="absolute inset-0" inert={tab !== 'map'}>
      <MapCanvas
        layers={layers}
        nav={
          nav?.status === 'active' && leg
            ? { travel: leg.travel, path: nav.path, traveled: nav.traveled, position: nav.position, heading: nav.heading }
            : undefined
        }
        follow={follow}
        onUserPan={() => trip && setFollow(false)}
        buildings={campus.buildings}
        entrances={campus.entrances}
        zones={zones}
        closures={closureStore.closures}
        destination={panel === 'dropoff' || panel === 'mark' ? mapDestination : undefined}
        arrivalStop={panel === 'dropoff' && arrivalDestination ? arrival.option?.stopPoint ?? arrival.draft : undefined}
        movingArrival={arrival.moving}
        onMoveArrival={arrival.moveTo}
        selectedZoneId={walking && panel === 'dropoff' ? undefined : activeZoneId}
        focusEntranceId={activeDoor?.entrance.id}
        walkMode={walking && panel === 'dropoff'}
        start={start ? { ...start, typed: true } : activeDoor && !walkStart.fromGps ? walkStart : undefined}
        editingZoneId={editingZone?.source === 'personal' ? editingZone.id : undefined}
        me={geo.position && { position: geo.position, accuracy: geo.accuracy, heading: geo.heading }}
        drivePath={
          panel === 'mark' ? road.info?.path : arrivalDestination ? arrival.option?.drive?.path : walking ? undefined : drive?.path
        }
        walkPath={panel === 'mark' ? undefined : arrivalDestination ? arrival.option?.walk.path : walk?.path}
        doorways={panel === 'doors' || layers.grid ? doorMarks : undefined}
        paint={
          panel === 'mark' && destination
            ? {
                focus: destination.building.location,
                strokes,
                area: paintArea,
                stopPoint: roadStop,
                onStroke: (stroke) => setStrokes((all) => [...all, stroke]),
              }
            : undefined
        }
        editMode={panel === 'edit'}
        tool={tool}
        draftClosure={draftClosure}
        onMapClick={handleMapClick}
        onSelectZone={handleSelectZone}
        onSelectBuilding={(b) => {
          searchRequest.current?.abort()
          clearSelection()
          setDestination({ building: b, room: '' })
          setSearchError(undefined)
          setSelectedZoneId(undefined)
          setSelectedDoorId(undefined)
          setConfirmedZoneId(undefined)
        }}
        onZoneChange={(z) => void zoneStore.upsert(z)}
      />

      {trip && leg && <NavBanner nav={nav} leg={leg} />}

      {/* While navigating on a phone, the instruction banner takes the top of the screen. */}
      <div className={`absolute right-4 top-[max(16px,env(safe-area-inset-top))] z-30 flex flex-col items-end gap-2 ${trip ? 'max-[899px]:hidden' : ''}`}>
        <div className="flex items-center gap-2">
          {!trip && <Legend />}
          <LayerControl value={layers} onChange={setLayers} />
          <AccountMenu
            onSignIn={() => setTab('preferences')}
            onPreferences={() => setTab('preferences')}
            onEditZones={() => openPanel('edit')}
            onReportClosure={() => openPanel('closure')}
          />
        </div>
        {(arrivalDestination || destination || activeZoneId || editingZoneId || selectedDoorId) && (
          <Button
            className="bg-surface shadow-[var(--shadow-float)]"
            aria-label="Clear selected building and zone"
            onClick={clearSelection}
          >
            <span aria-hidden>×</span>
            Clear selection
          </Button>
        )}
        <LocateButton geo={geo} />
        <button
          type="button"
          aria-label="Doorways: place doors and link them into shortcuts"
          title="Doorways"
          aria-pressed={panel === 'doors'}
          onClick={() => (panel === 'doors' ? closeDoorways() : openDoorways())}
          className={cx(
            'grid size-11 place-items-center rounded-full border bg-surface text-lg shadow-[var(--shadow-float)] hover:border-accent',
            panel === 'doors' ? 'border-accent' : 'border-line',
          )}
        >
          <span aria-hidden>🚪</span>
        </button>
        {geo.position && <MotionChip motion={motion} />}
      </div>

      <Sheet expanded={expanded} onToggle={() => setExpanded((v) => !v)}>
        <div className="flex items-center gap-2.5">
          <LogoMark className="size-6" />
          <span className="text-lg font-extrabold tracking-tight">Doorstep</span>
          <span className="ml-auto text-xs text-muted">the right door, every time</span>
        </div>

        {(authError || zoneStore.error || closureStore.error) && <Notice tone="error">{authError ?? zoneStore.error ?? closureStore.error}</Notice>}

        {trip && (
          <NavPanel
            nav={nav}
            legs={trip.legs}
            legIndex={trip.index}
            destinationLabel={trip.destinationLabel}
            doorLocation={trip.door}
            simulate={simulate}
            onSimulate={setSimulateChoice}
            voice={voice}
            onVoice={setVoice}
            following={follow}
            onRecenter={() => setFollow(true)}
            onEnd={() => setTrip(undefined)}
          />
        )}

        {!trip && panel === 'dropoff' && arrivalDestination && <ArrivalPanel
          key={`${arrivalDestination.placeId ?? ''}:${arrivalDestination.location.lat},${arrivalDestination.location.lng}:${token ?? ''}`}
          destination={arrivalDestination} state={arrival} token={token} onSignIn={() => setTab('preferences')}
          kind={mode === 'pickup' ? 'pickup' : 'dropoff'} onKind={setMode} stepFree={stepFree} onStepFree={setStepFreeChoice}
        />}
        {suggestDropoff && (
          <div className="flex flex-col gap-2.5 rounded-2xl border border-accent/40 bg-accent/10 p-3.5 text-sm">
            <p className="m-0">
              <span aria-hidden>🚗</span> <b>Looks like you're in a vehicle</b> (
              {Math.round((motion.speed ?? 0) * MPH_PER_MPS)} mph). Plan a drop-off instead of a walk?
            </p>
            <div className="flex gap-2">
              <Button
                variant="primary"
                className="h-9 flex-1 text-sm"
                onClick={() => {
                  setMode('dropoff')
                  setConfirmedZoneId(undefined)
                }}
              >
                Switch to drop-off
              </Button>
              <Button className="h-9 flex-1 text-sm" onClick={() => setDismissedDriveHint(motion.since)}>
                Not now
              </Button>
            </div>
          </div>
        )}

        {!trip && panel === 'dropoff' && !arrivalDestination && (
          <DropoffPanel
            onStartWalk={startWalk}
            onStartTrip={startCarTrip}
            user={user}
            destination={destination}
            mode={mode}
            onMode={(m) => {
              setMode(m)
              setConfirmedZoneId(undefined)
            }}
            doors={doors}
            selectedDoorId={activeDoor?.entrance.id}
            onSelectDoor={setSelectedDoorId}
            walkStart={walkStart}
            start={start}
            onStart={chooseStart}
            onClearStart={() => {
              setStart(undefined)
              setConfirmedZoneId(undefined)
            }}
            stepFree={stepFree}
            onStepFree={setStepFreeChoice}
            options={options}
            selectedZoneId={activeZoneId}
            onSelect={setSelectedZoneId}
            confirmedZoneId={confirmedZoneId}
            onConfirm={(id) => { setConfirmedZoneId(id); setConfirmedTripId(planning.data?.tripId); setFeedbackSent(false) }}
            feedbackSent={feedbackSent}
            measuredWalk={measuredWalk}
            drive={drive && { seconds: drive.seconds, from: driveFromName }}
            planning={planning.loading}
            onSearch={search}
            onClear={clearSelection}
            onSignIn={() => setTab('preferences')}
            onFeedback={async (f) => {
              if (!confirmedTripId) throw new Error("Confirm a route while signed in before sending feedback")
              await sendFeedback(confirmedTripId, f)
              setFeedbackSent(true)
            }}
            error={searchError ?? planning.error ?? driveResult.error ?? campus.error}
            onMarkZone={startMarking}
          />
        )}

        {!trip && panel === 'doors' && (
          <DoorwaysPanel
            doors={doorways.doors}
            links={doorways.links}
            selectedId={selectedDoorwayId}
            onSelect={setSelectedDoorwayId}
            error={doorError}
            onDone={closeDoorways}
          />
        )}

        {!trip && panel === 'mark' && destination && (
          <MarkZonePanel
            buildingName={destination.building.name}
            verb={mode === 'pickup' ? 'pickup' : 'drop-off'}
            strokeCount={strokes.length}
            hasArea={!!paintArea}
            road={{
              loading: !!paintCenter && !road.info && !road.error,
              error: road.error,
              metersFromSpot:
                roadStop && paintArea && !insidePolygon(roadStop, paintArea)
                  ? Math.round(distanceToPath(roadStop, [...paintArea, paintArea[0]!]))
                  : 0,
              driveMinutes: road.info && Math.max(1, Math.round(road.info.seconds / 60)),
              from: driveFromName,
            }}
            saving={savingSpot}
            onUndo={() => setStrokes((all) => all.slice(0, -1))}
            onClear={() => setStrokes([])}
            onSave={(name) => void saveSpot(name)}
            onCancel={stopMarking}
          />
        )}

        {!trip && panel === 'edit' && user && (
          <EditPanel
            buildings={campus.buildings}
            selected={editingZone}
            personal={zoneStore.personal}
            hiddenDefaults={hiddenDefaults}
            tool={tool}
            onTool={setTool}
            onSelect={setEditingZoneId}
            onUpdate={(z) => void zoneStore.upsert(z)}
            onDelete={(z) => {
              void zoneStore.remove(z)
              setEditingZoneId(undefined)
            }}
            onCustomize={(z) => setEditingZoneId(zoneStore.customize(z)?.id)}
            onHide={(z) => {
              zoneStore.hideDefault(z)
              setEditingZoneId(undefined)
            }}
            onRestore={zoneStore.restoreDefault}
            onDone={() => {
              setPanel('dropoff')
              setTool('none')
              setEditingZoneId(undefined)
            }}
          />
        )}

        {!trip && panel === 'closure' && user && (
          <ClosurePanel
            user={user}
            draft={draftClosure}
            closures={closureStore.closures}
            onUndo={() => setDraftClosure((d) => d.slice(0, -1))}
            onSubmit={async (reason) => {
              await closureStore.report(draftClosure, reason)
              setDraftClosure([])
            }}
            onRemove={(id) => void closureStore.remove(id)}
            onDone={() => {
              setPanel('dropoff')
              setTool('none')
              setDraftClosure([])
            }}
          />
        )}

        <p className="m-0 mt-auto pt-2 text-[11px] text-muted/70">
          Buildings: FIU campus map · Walkways &amp; doors: ©{' '}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="underline hover:text-fg">
            OpenStreetMap contributors
          </a>
        </p>
      </Sheet>
        </main>

        {tab === 'preferences' && <PreferencesPage onOpenMap={() => setTab('map')} />}
      </div>

      <TabBar tab={tab} onTab={setTab} />
    </div>
  )
}

const MPH_PER_MPS = 2.23694

/** What your GPS speed says you're doing: still, walking, on a bike or scooter, or in a vehicle. */
function MotionChip({ motion }: { motion: Motion }) {
  if (motion.mode === 'unknown' || motion.speed === undefined) return null
  const fast = motion.mode === 'vehicle' || motion.mode === 'cycling'
  return (
    <div
      title="Detected from your GPS speed, on this device only"
      className="flex items-center gap-1.5 rounded-full border border-line bg-surface/90 px-3 py-1.5 text-xs font-bold shadow-[var(--shadow-float)] backdrop-blur"
    >
      <span aria-hidden>{MODE_ICON[motion.mode]}</span>
      {MODE_LABEL[motion.mode]}
      {motion.mode !== 'still' && (
        <span className="font-semibold text-muted">
          · {fast ? `${Math.round(motion.speed * MPH_PER_MPS)} mph` : `${motion.speed.toFixed(1)} m/s`}
        </span>
      )}
    </div>
  )
}

/** Centers the map on your GPS position. */
function LocateButton({ geo }: { geo: Geo }) {
  const map = useMap()
  const label = geo.position ? 'Show my location' : (geo.error ?? 'Finding your location…')
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={!geo.position}
      onClick={() => {
        geo.enableCompass?.() // iPhone: the compass (for the direction beam) needs a tap to allow
        if (!map || !geo.position) return
        map.panTo(geo.position)
        if ((map.getZoom() ?? 0) < 17) map.setZoom(17)
      }}
      className="grid size-11 place-items-center rounded-full border border-line bg-surface text-lg shadow-[var(--shadow-float)] hover:border-accent disabled:opacity-50"
    >
      <span aria-hidden className={geo.position ? 'text-[#4c8dff]' : 'text-muted'}>
        ◎
      </span>
    </button>
  )
}

function Legend() {
  const item = (color: string, label: string) => (
    <span className="flex items-center gap-1.5">
      <span aria-hidden className={`size-2.5 rounded-sm ${color}`} />
      {label}
    </span>
  )
  return (
    <div className="hidden items-center gap-3 rounded-full border border-line bg-surface/90 px-3.5 py-2 text-xs font-semibold shadow-[var(--shadow-float)] backdrop-blur sm:flex">
      {item('bg-shared', 'Default zone')}
      {item('bg-personal', 'Your zone')}
      {item('bg-selected', 'Selected')}
      {item('bg-closed', 'Closed road')}
    </div>
  )
}
