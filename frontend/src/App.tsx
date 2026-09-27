import { APIProvider, useMap, useMapsLibrary } from '@vis.gl/react-google-maps'
import { useEffect, useMemo, useRef, useState } from 'react'
import { PublicStopsPanel } from './components/PublicStopsPanel'
import { usePublicStops } from './state/publicStops'
import { resolveLocationName } from './search'
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
import { CarIcon, DoorIcon, LocateIcon, TravelModeIcon, WalkIcon } from './components/icons'
import { PreferencesPage } from './components/PreferencesPage'
import { TabBar, type Tab } from './components/TabBar'
import { Button, LogoMark, Notice, Sheet } from './components/ui'
import { useMapLayers } from './mapLayers'
import * as api from './api'
import { looksLikeSentence, type Destination } from './search'
import { useSlope, useTimeSaved, useWeather } from './state/insights'
import { AuthProvider, useAuth } from './state/auth'
import { CAMPUS_CENTER, CAMPUS_GATE, WALK_DEMO_START } from './data/mapDefaults'
import { centroid, distanceMeters, distanceToPath } from './geo'
import { cellAt } from './grid'
import { insidePolygon, paintedArea } from './paintedZone'
import { useCampus, useClosures, useZones } from './state/data'
import { doorLocation, placeDoor, toggleLink, useDoorways } from './state/doorways'
import { MODE_LABEL, measuredPace, type Motion } from './motion'
import { recordFix, resetWalked, useMotion } from './state/motion'
import { locateInTrip, tripElapsed } from './tripTimeline'
import { recordWalkingFix } from './state/speedGrid'
import { useNavigation, type NavLeg } from './state/navigation'
import { lockToDoorways } from './doorShortcuts'
import { findAddress, useCampusGraphs, useGeolocation, useRoute, useServerPlan, type Geo } from './state/routing'
import type { LatLng, Place, TravelMode, TripKind, Zone } from './types'
import { needsStepFree, walkingSpeed } from './walking'
import { useWalkedPaths } from './state/walkedPaths'

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

type Panel = 'dropoff' | 'edit' | 'closure' | 'mark' | 'doors' | 'public'

function Doorstep() {
  const { user, token, restoring, sendFeedback, error: authError } = useAuth()
  const campus = useCampus()
  const zoneStore = useZones(campus.defaults, campus.buildings, user, token)
  const closureStore = useClosures(token)

  const publicStops = usePublicStops(token, user?.role === 'ADMIN')
  const [selectedPublicStopId, setSelectedPublicStopId] = useState<string>()
  const [publicBoundary, setPublicBoundary] = useState<LatLng[]>([])
  const [proposal, setProposal] = useState<Partial<api.PublicStopInput>>()
  const [publicStopDraft, setPublicStopDraft] = useState<LatLng>()
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
  const [searchText, setSearchText] = useState('')
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
  // A plain-English request that Gemini turned into these settings, and the door it asked for.
  const [aiTrip, setAiTrip] = useState<{ parse: api.TripParse; building?: string; door?: string }>()
  const [aiBusy, setAiBusy] = useState(false)
  const preferredDoorId = aiTrip?.parse.entranceId ?? undefined

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

  const walkedPaths = useWalkedPaths(tab === 'map' && panel === 'dropoff')
  const geo = useGeolocation(walkedPaths.record)
  const onCampus = geo.position && distanceMeters(geo.position, CAMPUS_CENTER) < 3000
  const walkStart = start
    ? { ...start, fromGps: false }
    : onCampus && geo.position
      ? { location: geo.position, fromGps: true, label: 'your location' }
      : { ...WALK_DEMO_START, fromGps: false }
  const planning = useServerPlan(destination ? { buildingId: destination.building.id, room: destination.room,
    kind: mode, stepFree, origin: walking ? { lat: +walkStart.location.lat.toFixed(4), lng: +walkStart.location.lng.toFixed(4) } : undefined } : undefined,
    token, JSON.stringify([user?.profile, zoneStore.personal, closureStore.closures, publicStops.stops.map(s => [s.id, s.revision])]))
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
  // Rain or heat: rank purely by the shortest walk outside (after any doorway shortcuts are applied).
  const weather = useWeather(CAMPUS_CENTER)
  const byWeather = <T extends { walkSeconds: number }>(list: T[]) =>
    weather && weather.kind !== 'clear' ? [...list].sort((a, b) => a.walkSeconds - b.walkSeconds) : list
  const options = byWeather(
    (planning.data?.options ?? []).flatMap((o) =>
      o.zone ? [lockToDoorways({ ...o, zone: o.zone }, o.zone.stopPoint, o.entrance.location, lock)] : [],
    ),
  )
  const doors = walking
    ? byWeather((planning.data?.options ?? []).map((d) => lockToDoorways(d, walkStart.location, d.entrance.location, lock)))
    : []
  // Default selection: the door Gemini heard you ask for, otherwise the best option.
  const preferredZoneId = options.find(o => o.entrance.id === preferredDoorId)?.zone.id
  const activeZoneId = panel === 'edit' ? editingZoneId : options.some(o => o.zone.id === selectedZoneId) ? selectedZoneId : preferredZoneId ?? options[0]?.zone.id
  const activeOption = panel === 'dropoff' && !walking ? options.find(o => o.zone.id === activeZoneId) : undefined
  const activeDoor = panel === 'dropoff' && walking
    ? doors.find(d => d.entrance.id === selectedDoorId) ?? doors.find(d => d.entrance.id === preferredDoorId) ?? doors[0] : undefined
  // Car: from the typed address, you, or the campus gate to the curb.
  const driveFrom = start?.location ?? geo.position ?? CAMPUS_GATE
  const driveFromName = start ? start.label.split(',')[0] : geo.position ? 'you' : 'the SW 8th St entrance'
  const driveResult = useRoute('DRIVING', activeOption ? driveFrom : undefined, activeOption?.zone.stopPoint)
  const drive = driveResult.info
  const walk = (activeDoor ?? activeOption)?.route
  // Where ride apps stop today: the end of Google's driving route to the building's address pin.
  const pinDrive = useRoute('DRIVING', destination && !walking && panel === 'dropoff' ? CAMPUS_GATE : undefined, destination?.building.location)
  const saved = useTimeSaved(campusGraph, pinDrive.info?.path.at(-1), options, stepFree, walkingSpeed(user?.profile))
  const slope = useSlope(walk?.path, stepFree && panel === 'dropoff')

  // The painted spot, and the closest road to it: a car route to the spot ends where it meets a road.
  const paintArea = useMemo(() => (panel === 'mark' ? paintedArea(strokes) : undefined), [panel, strokes])
  const paintCenter = useMemo(() => paintArea && centroid(paintArea), [paintArea])
  const road = useRoute('DRIVING', paintCenter && driveFrom, paintCenter)
  const roadStop = road.info?.path[road.info.path.length - 1]
  const searchRequest = useRef<AbortController | undefined>(undefined)
  useEffect(() => () => searchRequest.current?.abort(), [])

  // Arrival planning starts from a typed "From" address, otherwise your GPS.
  const arrivalFrom = start?.location ?? geo.position
  const arrival = useArrival(arrivalDestination && panel === 'dropoff' ? {
    destination: arrivalDestination, kind: mode === 'pickup' ? 'pickup' : 'dropoff', stepFree,
    origin: arrivalFrom ? { lat: +arrivalFrom.lat.toFixed(4), lng: +arrivalFrom.lng.toFixed(4) } : undefined,
  } : undefined, token, JSON.stringify([user?.profile, closureStore.closures, publicStops.stops.map(s => [s.id, s.revision])]))
  const referenceWalk = arrivalDestination ? arrival.option?.walk.path : walk?.path
  const setWalkReference = walkedPaths.setReference
  useEffect(() => { setWalkReference(referenceWalk ?? []) }, [referenceWalk, setWalkReference])
  const mapDestination = arrivalDestination ? { id: arrivalDestination.placeId ?? `point:${arrivalDestination.location.lat},${arrivalDestination.location.lng}`,
    name: arrivalDestination.name, code: '', location: arrivalDestination.location, entrances: [] } : destination?.building

  // In-app navigation. A trip is one or more legs (walk to pickup, ride to the curb, walk to the door).
  const kind: TripKind = mode === 'pickup' ? 'pickup' : 'dropoff'
  const [trip, setTrip] = useState<{ legs: NavLeg[]; index: number; destinationLabel: string; door?: LatLng }>()
  const [simulateChoice, setSimulateChoice] = useState<boolean>()
  const [voice, setVoice] = useState(false)
  const [follow, setFollow] = useState(true)
  // Off campus (or no GPS) there's nothing real to track, so play the trip by default.
  const simulate = simulateChoice ?? !onCampus
  const leg = trip?.legs[trip.index]
  // Simulated trips play like a video: pause, or scrub the timeline to any moment of the ride.
  const [playing, setPlaying] = useState(true)
  const [seekRequest, setSeekRequest] = useState<{ id: number; fraction: number }>()
  const nav = useNavigation({
    leg,
    gps: geo.position,
    walkSpeedMps: walkingSpeed(user?.profile),
    simulate,
    stepFree,
    playing,
    seek: seekRequest,
  })

  // Timeline chapters, one per leg: the real route time once a leg has been routed, a rough
  // estimate (straight line × 1.3 at walking speed, or ~8 m/s by car) until then.
  const [legSeconds, setLegSeconds] = useState<Record<number, number>>({})
  if (trip && nav?.status === 'active' && legSeconds[trip.index] !== nav.totalSeconds) {
    setLegSeconds({ ...legSeconds, [trip.index]: nav.totalSeconds })
  }
  const estimateSeconds = (l: NavLeg) => (distanceMeters(l.from, l.to) * 1.3) / (l.travel === 'DRIVING' ? 8 : walkingSpeed(user?.profile))
  const chapters = (trip?.legs ?? []).map((l, i) => ({
    label: l.stage,
    icon: l.travel === 'DRIVING' ? <CarIcon size={14} /> : <WalkIcon size={14} />,
    seconds: Math.max(1, legSeconds[i] ?? estimateSeconds(l)),
  }))
  const elapsed = trip
    ? tripElapsed(chapters, trip.index, nav?.status === 'active' ? nav.totalSeconds - nav.remainingSeconds : 0)
    : 0
  // Jump to a moment of the trip. Within the current leg it follows the drag live; jumping to
  // another leg happens on release, since that leg may need its route first.
  const seekTrip = (seconds: number, commit: boolean) => {
    if (!trip) return
    const { index, fraction } = locateInTrip(chapters, seconds)
    if (index !== trip.index && !commit) return
    if (index !== trip.index) setTrip({ ...trip, index })
    setSeekRequest((s) => ({ id: (s?.id ?? 0) + 1, fraction }))
  }

  const startTrip = (legs: NavLeg[], destinationLabel: string, door?: LatLng) => {
    setTrip({ legs, index: 0, destinationLabel, door })
    resetWalked() // measure this trip's walking pace from scratch
    setSimulateChoice(undefined)
    setPlaying(true)
    setLegSeconds({})
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
  // (A paused simulation stays put, even at the end of a leg.)
  const legArrived = !!nav?.arrived && !!trip && trip.index < trip.legs.length - 1 && (!simulate || playing)
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

  const clearSelection = () => {
    setSelectedPublicStopId(undefined)
    setPublicStopDraft(undefined)
    setProposal(undefined)
    setPublicBoundary([])
    arrival.reset()
    setSearchText('')
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
    setAiTrip(undefined)
    setAiBusy(false)
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
      clearSelection()
      setDestination({ building: spotBuilding, room: text.match(/\b([a-z]?\d{2,4}[a-z]?)\b/i)?.[1]?.toUpperCase() ?? '' })
      setSelectedZoneId(spot.id)
      return
    }
    if (looksLikeSentence(text)) await askGemini(text, controller)
    else await plainSearch(text, controller)
  }

  /** Building + room, address or place name. Resolves to whether something was found. */
  const plainSearch = async (text: string, controller: AbortController) => {
    try {
      const result = await api.search(text, controller.signal)
      if (controller.signal.aborted) return false
      clearSelection()
      if (result.building) {
        setDestination({ building: result.building, room: result.room })
        setSearchText([result.building.name, result.room].filter(Boolean).join(' '))
      } else if (result.destination) {
        setArrivalDestination(result.destination)
        setSearchText(result.destination.name)
      }
      setSearchError(undefined)
      setSelectedZoneId(undefined)
      setSelectedDoorId(undefined)
      setConfirmedZoneId(undefined)
      return true
    } catch (e) {
      if (controller.signal.aborted) return false
      clearSelection()
      setSearchText(text)
      setSearchError((e as Error).message)
      return false
    }
  }

  /** "Side door of GC by the food court at 9, I'm on crutches" → building, door, time, mode, step-free. */
  const askGemini = async (text: string, controller: AbortController) => {
    setAiBusy(true)
    let parse: api.TripParse
    try {
      parse = await api.parseTrip(text, controller.signal)
    } catch (e) {
      if (controller.signal.aborted) return
      setAiBusy(false)
      if (!(await plainSearch(text, controller)) && !controller.signal.aborted) {
        setSearchError(`Gemini couldn't read that (${(e as Error).message}). Try a building and room, like "GC 150".`)
      }
      return
    }
    if (controller.signal.aborted) return
    const building = campus.buildings.find((b) => b.id === parse.buildingId)
    if (building) {
      clearSelection()
      setDestination({ building, room: parse.room })
      setSearchText([building.name, parse.room].filter(Boolean).join(' '))
    } else if (!(await plainSearch(parse.placeQuery || text, controller))) {
      setAiBusy(false)
      return
    }
    if (parse.mode) setMode(parse.mode)
    if (parse.stepFree) setStepFreeChoice(true)
    setAiTrip({ parse, building: building?.name, door: building?.entrances.find((d) => d.id === parse.entranceId)?.label })
    setExpanded(true)
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
      setSearchText(graham.name)
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
    if (tool === 'drawPublicBoundary') {
      setPublicBoundary(points => [...points, point])
    } else if (tool === 'addPublicStop') {
      setPublicStopDraft(point)
      setTool('none')
    } else if (tool === 'addZone') {
      const zone = zoneStore.createAt(point)
      if (zone) setEditingZoneId(zone.id)
      setTool('none')
    } else if (tool === 'drawClosure') {
      setDraftClosure((d) => [...d, point])
    } else if (panel === 'dropoff') {
      if (trip) return // tapping the map mid-trip shouldn't cancel navigation
      if (arrivalDestination && arrival.moving) { arrival.moveTo(point); return }
      clearSelection()
      const selected = { name: `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`, location: point, placeId }
      setArrivalDestination(selected)
      setSearchText(selected.name)
      const controller = new AbortController()
      searchRequest.current = controller
      void resolveLocationName(point, placeId).then(name => {
        if (controller.signal.aborted) return
        setArrivalDestination({ ...selected, name })
        setSearchText(name)
      }).catch(() => {
        // Keep the selected coordinates usable when the name lookup is unavailable.
      })
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
    if (options.some(option => option.zone.id === zone.id)) {
      setSelectedZoneId(zone.id); setConfirmedZoneId(undefined); setExpanded(true); return
    }
    arrival.reset()
    setArrivalDestination(undefined)
    if (zone.buildingId !== destination?.building.id) {
      const building = campus.buildings.find((b) => b.id === zone.buildingId)
      if (building) {
        setDestination({ building, room: '' })
        setSearchText(building.name)
      }
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

  const proposeZone = (input: api.PublicStopInput) => requireUser(() => {
    clearSelection(); setProposal(input); setPublicStopDraft(input.location); setPanel('public'); setTool('none'); setExpanded(true)
  })
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
        publicStops={panel === 'public' ? publicStops.stops.filter(stop => stop.status !== 'RETIRED') : []}
        nearbyPublicStops={panel !== 'dropoff' ? [] : arrivalDestination
          ? (arrival.data?.options ?? []).flatMap(option => option.publicStopId ? [{ id: option.publicStopId, status: option.publicStopStatus ?? 'UNVERIFIED', name: option.name, location: option.stopPoint }] : [])
          : options.flatMap(option => option.zone.publicStopId ? [{ id: option.zone.publicStopId, status: option.zone.publicStopStatus ?? 'UNVERIFIED', name: option.zone.name, location: option.zone.stopPoint }] : [])}
        activePublicStopId={panel !== 'dropoff' ? undefined : arrivalDestination ? arrival.option?.publicStopId : activeOption?.zone.publicStopId}
        publicStopDraft={publicStopDraft}
        publicBoundary={publicBoundary}
        selectedPublicStopId={selectedPublicStopId}
        onSelectPublicStop={stop => {
          if (panel === 'dropoff' && arrivalDestination) {
            const option = arrival.data?.options.find(option => option.publicStopId === stop.id)
            if (option) { arrival.select(option.id); setExpanded(true); return }
          }
          if (panel === 'dropoff' && destination) {
            const option = options.find(option => option.zone.publicStopId === stop.id)
            if (option) { setSelectedZoneId(option.zone.id); setConfirmedZoneId(undefined); setExpanded(true); return }
          }
          clearSelection(); setPanel('public'); setTool('none'); setPublicStopDraft(undefined)
          setSelectedPublicStopId(stop.id); setExpanded(true)
        }}
        learnedPaths={walkedPaths.paths}
        liveWalk={walkedPaths.live}
        buildings={campus.buildings}
        entrances={campus.entrances}
        zones={panel === 'edit' ? zones : panel === 'dropoff' && !walking && !arrivalDestination ? options.map(o => o.zone) : []}
        closures={closureStore.closures}
        destination={panel === 'dropoff' || panel === 'mark' ? mapDestination : undefined}
        arrivalStop={panel !== 'dropoff' ? undefined : arrivalDestination ? arrival.option?.stopPoint ?? arrival.draft : activeOption?.zone.source === 'public' ? activeOption.zone.stopPoint : undefined}
        movingArrival={arrival.moving}
        onMoveArrival={arrival.moveTo}
        selectedZoneId={walking && panel === 'dropoff' ? undefined : activeZoneId}
        focusEntranceId={activeDoor?.entrance.id ?? activeOption?.entrance.id}
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
          setPanel('dropoff')
          setDestination({ building: b, room: '' })
          setSearchText(b.name)
          setExpanded(true)
          setSearchError(undefined)
          setSelectedZoneId(undefined)
          setSelectedDoorId(undefined)
          setConfirmedZoneId(undefined)
        }}
        onZoneChange={(z) => void zoneStore.upsert(z)}
      />

      {trip && leg && <NavBanner nav={nav} leg={leg} />}

      {/* While navigating on a phone, the instruction banner takes the top of the screen. */}
      {/* Right of this cluster is the Preferences/Map switch (TabBar), pinned to the corner. */}
      <div className={`absolute right-[112px] top-[max(16px,env(safe-area-inset-top))] z-30 flex flex-col items-end gap-2 ${trip ? 'max-[899px]:hidden' : ''}`}>
        <div className="flex items-center gap-2">
          <Button className="bg-surface shadow-[var(--shadow-float)]" onClick={() => {
            clearSelection(); setPanel('public'); setTool('none'); setSelectedPublicStopId(undefined); setPublicStopDraft(undefined); setExpanded(true)
          }}>Public zones</Button>
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
          <DoorIcon size={20} className={panel === 'doors' ? 'text-accent' : undefined} />
        </button>
        {geo.position && <MotionChip motion={motion} />}
      </div>

      <Sheet expanded={expanded} onToggle={() => setExpanded((v) => !v)}>
        <div className="flex items-center gap-2.5">
          <LogoMark className="size-6" />
          <span className="text-lg font-extrabold tracking-tight">DoorStep</span>
          <span className="ml-auto text-xs text-muted">the right door, every time</span>
        </div>

        {panel === 'dropoff' && <section className="rounded-xl border border-line bg-raised px-3 py-2 text-xs" aria-label="Walking path learning">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span role="status">{geo.error ?? walkedPaths.status} · {walkedPaths.paths.length} learned paths</span>
            <div className="flex gap-3">
              <button type="button" className="font-semibold text-accent" onClick={walkedPaths.toggle}>{walkedPaths.paused ? 'Resume' : 'Pause'}</button>
              <button type="button" className="font-semibold text-muted" onClick={walkedPaths.clear}>Clear walks</button>
            </div>
          </div>
          <p className="mb-0 mt-1 text-muted">GPS walks save automatically on this device while the map is open. Blue: walked · Purple: repeated · Orange: differs from your planned walk. Paths are unverified.</p>
          {walkedPaths.storageError && <p className="mb-0 mt-1 text-muted">Browser storage is unavailable; these walks last until you close the app.</p>}
        </section>}

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
            timeline={
              simulate ? { chapters, elapsed, playing, onPlayPause: () => setPlaying((p) => !p), onSeek: seekTrip } : undefined
            }
            voice={voice}
            onVoice={setVoice}
            following={follow}
            onRecenter={() => setFollow(true)}
            onEnd={() => setTrip(undefined)}
          />
        )}

        {!trip && panel === 'dropoff' && arrivalDestination && <ArrivalPanel
          key={`${arrivalDestination.placeId ?? ''}:${arrivalDestination.location.lat},${arrivalDestination.location.lng}:${token ?? ''}`}
          onPropose={proposeZone}
          user={user} searchText={searchText}
          onSearchTextChange={text => { searchRequest.current?.abort(); setSearchText(text) }}
          onSearch={search} onClear={clearSelection}
          destination={arrivalDestination} state={arrival} token={token} onSignIn={() => setTab('preferences')}
          kind={mode === 'pickup' ? 'pickup' : 'dropoff'} onKind={setMode} stepFree={stepFree} onStepFree={setStepFreeChoice}
        />}
        {suggestDropoff && (
          <div className="flex flex-col gap-2.5 rounded-2xl border border-accent/40 bg-accent/10 p-3.5 text-sm">
            <p className="m-0">
              <CarIcon size={16} className="mr-1 inline -translate-y-px text-accent" />
              <b>Looks like you're in a vehicle</b> (
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
            onPropose={zone => proposeZone({ name: zone.name, instructions: zone.instructions ?? '', location: zone.stopPoint, kinds: zone.kinds.map(k => k === 'pickup' ? 'PICKUP' : 'DROPOFF'), buildingId: zone.buildingId || undefined, origin: 'suggestion', suggestedZoneId: zone.source === 'generated' ? zone.id : undefined })}
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
            saved={saved}
            weather={weather}
            slope={slope}
            ai={aiTrip}
            aiBusy={aiBusy}
            searchText={searchText}
            onSearchTextChange={text => { searchRequest.current?.abort(); setSearchText(text) }}
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

        {!trip && panel === 'public' && <PublicStopsPanel
          buildings={campus.buildings} proposal={proposal} boundary={publicBoundary} drawing={tool === 'drawPublicBoundary'}
          onDrawBoundary={() => setTool(tool === 'drawPublicBoundary' ? 'none' : 'drawPublicBoundary')}
          onUndoBoundary={() => setPublicBoundary(points => points.slice(0, -1))}
          store={publicStops} user={user} token={token}
          selected={publicStops.stops.find(stop => stop.id === selectedPublicStopId)}
          draft={publicStopDraft} adding={tool === 'addPublicStop'}
          onAdd={() => { setPublicBoundary([]); setProposal(undefined); setSelectedPublicStopId(undefined); setPublicStopDraft(undefined); setTool('addPublicStop') }}
          onSelect={stop => { setSelectedPublicStopId(stop?.id); setTool('none') }}
          onCancelAdd={() => { setPublicBoundary([]); setPublicStopDraft(undefined); setTool('none') }}
          onDone={() => { setPublicBoundary([]); setProposal(undefined); setPanel('dropoff'); setTool('none'); setPublicStopDraft(undefined); setSelectedPublicStopId(undefined) }}
          onSignIn={() => setTab('preferences')}
          onUse={stop => {
            clearSelection(); setArrivalDestination({ name: stop.name, location: stop.location, publicStopId: stop.id })
            setSearchText(stop.name); setMode(stop.kinds.includes('DROPOFF') || stop.kinds.includes('BOTH') ? 'dropoff' : 'pickup')
            setPanel('dropoff'); setTool('none'); setSelectedPublicStopId(undefined); setPublicStopDraft(undefined)
          }}
        />}

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

        <PreferencesPage open={tab === 'preferences'} light={layers.style === 'light'} onOpenMap={() => setTab('map')} />
      </div>

      {/* No tab bar on the sign-in screen: "Continue as a guest" leads to the map instead. */}
      {!(tab === 'preferences' && !user) && (
        // Light Preferences page → light switch. Hidden on phones mid-trip (the turn banner is up there).
        <div className={`${tab === 'preferences' && layers.style === 'light' && user ? 'theme-light' : ''} ${trip ? 'max-[899px]:hidden' : ''}`}>
          <TabBar tab={tab} onTab={setTab} />
        </div>
      )}
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
      <TravelModeIcon mode={motion.mode} size={15} />
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
      <LocateIcon size={20} className={geo.position ? 'text-[#4c8dff]' : 'text-muted'} />
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
