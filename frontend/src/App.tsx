import { APIProvider, useMap } from '@vis.gl/react-google-maps'
import { useEffect, useRef, useState } from 'react'
import { ArrivalPanel } from './components/ArrivalPanel'
import { useArrival } from './state/arrivals'
import { AccountMenu } from './components/Account'
import { ClosurePanel } from './components/ClosurePanel'
import { DropoffPanel } from './components/DropoffPanel'
import { EditPanel } from './components/EditPanel'
import { LayerControl } from './components/LayerControl'
import { MapCanvas, type Tool } from './components/MapCanvas'
import { NavBanner, NavPanel } from './components/NavPanel'
import { PreferencesPage } from './components/PreferencesPage'
import { TabBar, type Tab } from './components/TabBar'
import { Button, LogoMark, Notice, Sheet } from './components/ui'
import { useMapLayers } from './mapLayers'
import * as api from './api'
import { type Destination } from './search'
import { AuthProvider, useAuth } from './state/auth'
import { CAMPUS_CENTER, CAMPUS_GATE, WALK_DEMO_START } from './data/mapDefaults'
import { distanceMeters } from './geo'
import { useCampus, useClosures, useZones } from './state/data'
import { useNavigation, type NavLeg } from './state/navigation'
import { useGeolocation, useRoute, useServerPlan, type Geo } from './state/routing'
import type { LatLng, TravelMode, TripKind, Zone } from './types'
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

type Panel = 'dropoff' | 'edit' | 'closure'

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
  const walking = mode === 'walk'

  // Zone editing
  const [editingZoneId, setEditingZoneId] = useState<string>()

  const stepFree = stepFreeChoice ?? needsStepFree(user?.profile)
  const { zones } = zoneStore

  const geo = useGeolocation()
  const onCampus = geo.position && distanceMeters(geo.position, CAMPUS_CENTER) < 3000
  const walkStart = onCampus && geo.position ? { location: geo.position, fromGps: true, label: 'your location' } : { ...WALK_DEMO_START, fromGps: false }
  const planning = useServerPlan(destination ? { buildingId: destination.building.id, room: destination.room,
    kind: mode, stepFree, origin: walking ? { lat: +walkStart.location.lat.toFixed(4), lng: +walkStart.location.lng.toFixed(4) } : undefined } : undefined,
    token, JSON.stringify([user?.profile, zoneStore.personal, closureStore.closures]))
  const options = (planning.data?.options ?? []).flatMap(o => o.zone ? [{ ...o, zone: o.zone }] : [])
  const doors = walking ? planning.data?.options ?? [] : []
  const activeZoneId = panel === 'edit' ? editingZoneId : options.some(o => o.zone.id === selectedZoneId) ? selectedZoneId : options[0]?.zone.id
  const activeOption = panel === 'dropoff' && !walking ? options.find(o => o.zone.id === activeZoneId) : undefined
  const activeDoor = panel === 'dropoff' && walking ? doors.find(d => d.entrance.id === selectedDoorId) ?? doors[0] : undefined
  const driveResult = useRoute('DRIVING', activeOption ? geo.position ?? CAMPUS_GATE : undefined, activeOption?.zone.stopPoint)
  const drive = driveResult.info
  const walk = (activeDoor ?? activeOption)?.route
  const searchRequest = useRef<AbortController | undefined>(undefined)
  useEffect(() => () => searchRequest.current?.abort(), [])

  const arrival = useArrival(arrivalDestination && panel === 'dropoff' ? {
    destination: arrivalDestination, kind: mode === 'pickup' ? 'pickup' : 'dropoff', stepFree,
    origin: geo.position ? { lat: +geo.position.lat.toFixed(4), lng: +geo.position.lng.toFixed(4) } : undefined,
  } : undefined, token, JSON.stringify([user?.profile, closureStore.closures]))
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
  const nav = useNavigation({ leg, gps: geo.position, walkSpeedMps: walkingSpeed(user?.profile), simulate, stepFree })

  const startTrip = (legs: NavLeg[], destinationLabel: string, door?: LatLng) => {
    setTrip({ legs, index: 0, destinationLabel, door })
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
      if (here && pickupPoint && distanceMeters(here, pickupPoint) > 25) {
        legs.push({
          travel: 'WALKING',
          from: here,
          to: pickupPoint,
          toLabel: myPickupSpot ? `your pickup spot (${myPickupSpot.name})` : 'your pickup spot',
          stage: 'Walk to pickup',
        })
      }
      legs.push(
        { travel: 'DRIVING', from: pickupPoint ?? here ?? CAMPUS_GATE, to: zone.stopPoint, toLabel: zone.name, stage: 'Ride to curb' },
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

  const handleMapClick = (point: LatLng, placeId?: string) => {
    if (tool === 'addZone') {
      const zone = zoneStore.createAt(point)
      if (zone) setEditingZoneId(zone.id)
      setTool('none')
    } else if (tool === 'drawClosure') {
      setDraftClosure((d) => [...d, point])
    } else if (panel === 'dropoff') {
      if (trip) return // tapping the map mid-trip shouldn't cancel navigation
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
        destination={panel === 'dropoff' ? mapDestination : undefined}
        arrivalStop={panel === 'dropoff' && arrivalDestination ? arrival.option?.stopPoint ?? arrival.draft : undefined}
        movingArrival={arrival.moving}
        onMoveArrival={arrival.moveTo}
        selectedZoneId={walking && panel === 'dropoff' ? undefined : activeZoneId}
        focusEntranceId={activeDoor?.entrance.id}
        walkMode={walking && panel === 'dropoff'}
        walkStart={activeDoor && !walkStart.fromGps ? walkStart : undefined}
        editingZoneId={editingZone?.source === 'personal' ? editingZone.id : undefined}
        me={geo.position && { position: geo.position, accuracy: geo.accuracy, heading: geo.heading }}
        drivePath={arrivalDestination ? arrival.option?.drive?.path : walking ? undefined : drive?.path}
        walkPath={arrivalDestination ? arrival.option?.walk.path : walk?.path}
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
            stepFree={stepFree}
            onStepFree={setStepFreeChoice}
            options={options}
            selectedZoneId={activeZoneId}
            onSelect={setSelectedZoneId}
            confirmedZoneId={confirmedZoneId}
            onConfirm={(id) => { setConfirmedZoneId(id); setConfirmedTripId(planning.data?.tripId); setFeedbackSent(false) }}
            feedbackSent={feedbackSent}
            drive={drive && { seconds: drive.seconds, fromGps: !!geo.position }}
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
