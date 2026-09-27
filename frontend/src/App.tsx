import { APIProvider, useMap } from '@vis.gl/react-google-maps'
import { useEffect, useMemo, useState } from 'react'
import { AccountMenu } from './components/Account'
import { ClosurePanel } from './components/ClosurePanel'
import { DropoffPanel } from './components/DropoffPanel'
import { EditPanel } from './components/EditPanel'
import { LayerControl } from './components/LayerControl'
import { MapCanvas, type Tool } from './components/MapCanvas'
import { NavBanner, NavPanel } from './components/NavPanel'
import { PreferencesPage } from './components/PreferencesPage'
import { TabBar, type Tab } from './components/TabBar'
import { LogoMark, Sheet } from './components/ui'
import { useMapLayers } from './mapLayers'
import { floorOf, rankDoors, rankStops, type WalkMeters } from './planner'
import { parseDestination, type Destination } from './search'
import { AuthProvider, useAuth } from './state/auth'
import { CAMPUS_CENTER, CAMPUS_GATE, WALK_DEMO_START } from './data/campus'
import { distanceMeters } from './geo'
import { useCampus, useClosures, useZones } from './state/data'
import { useNavigation, type NavLeg } from './state/navigation'
import { useCampusGraph, useGeolocation, useRoute, type Geo } from './state/routing'
import { inCampus, routeWalk } from './walkRouter'
import type { DoorOption, LatLng, TravelMode, TripKind, Zone } from './types'
import { learn, needsStepFree, walkingSpeed, walkSecondsForPath } from './walking'

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
  const { user, token, restoring, saveProfile } = useAuth()
  const [destination, setDestination] = useState<Destination>()
  const campus = useCampus(destination?.building.id)
  const zoneStore = useZones(campus.defaults, campus.buildings, user, token)
  const closureStore = useClosures(token, user?.name)

  const [panel, setPanel] = useState<Panel>('dropoff')
  const [tool, setTool] = useState<Tool>('none')
  const [draftClosure, setDraftClosure] = useState<LatLng[]>([])
  const [expanded, setExpanded] = useState(true)
  const [layers, setLayers] = useMapLayers()
  // Signed-out visitors land on the sign-in page; returning users go straight to the map.
  const [tab, setTab] = useState<Tab>(() => (user || restoring ? 'map' : 'preferences'))

  // Drop-off planning
  const [searchError, setSearchError] = useState<string>()
  const [mode, setMode] = useState<TravelMode>('dropoff')
  const [stepFreeChoice, setStepFreeChoice] = useState<boolean>()
  const [selectedZoneId, setSelectedZoneId] = useState<string>()
  const [confirmedZoneId, setConfirmedZoneId] = useState<string>()
  const [selectedDoorId, setSelectedDoorId] = useState<string>()
  const walking = mode === 'walk'
  const kind: TripKind = mode === 'pickup' ? 'pickup' : 'dropoff'

  // Zone editing
  const [editingZoneId, setEditingZoneId] = useState<string>()

  const stepFree = stepFreeChoice ?? needsStepFree(user?.profile)
  const { zones } = zoneStore

  // Real walking distances over campus footpaths, so "closest door" means the shortest walk.
  const campusGraph = useCampusGraph()
  const walkMeters = useMemo<WalkMeters | undefined>(
    () =>
      campusGraph
        ? (a, b) => (inCampus(campusGraph, a) && inCampus(campusGraph, b) ? routeWalk(campusGraph, a, b, { stepFree })?.meters : undefined)
        : undefined,
    [campusGraph, stepFree],
  )

  const options = useMemo(
    () =>
      destination && !walking
        ? rankStops({
            zones,
            entrances: campus.entrances,
            buildingId: destination.building.id,
            room: destination.room,
            kind,
            stepFree,
            profile: user?.profile,
            closures: closureStore.closures,
            walkMeters,
          })
        : [],
    [destination, walking, zones, campus.entrances, kind, stepFree, user?.profile, closureStore.closures, walkMeters],
  )

  const activeZoneId =
    panel === 'edit'
      ? editingZoneId
      : options.some((o) => o.zone.id === selectedZoneId)
        ? selectedZoneId
        : options[0]?.zone.id
  const activeOption = panel === 'dropoff' ? options.find((o) => o.zone.id === activeZoneId) : undefined

  const geo = useGeolocation()

  // Walk mode starts from your GPS when you're on campus, otherwise from a demo spot.
  const onCampus = geo.position && distanceMeters(geo.position, CAMPUS_CENTER) < 3000
  const walkStart = onCampus && geo.position ? { location: geo.position, fromGps: true, label: 'your location' } : { ...WALK_DEMO_START, fromGps: false }

  const doors =
    destination && walking
      ? rankDoors({ entrances: destination.building.entrances, room: destination.room, origin: walkStart.location, stepFree, profile: user?.profile, walkMeters })
      : []
  const activeDoor =
    panel === 'dropoff' && walking ? (doors.find((d) => d.entrance.id === selectedDoorId) ?? doors[0]) : undefined

  // Routes. Car: from you (or the campus gate without GPS) to the curb, then walk curb → door.
  // Walk mode: walk from you straight to the door.
  const driveFrom = geo.position ?? CAMPUS_GATE
  const drive = useRoute('DRIVING', activeOption && driveFrom, activeOption?.zone.stopPoint)
  const walkFrom = activeDoor ? walkStart.location : activeOption?.zone.stopPoint
  const walkTo = (activeDoor ?? activeOption)?.entrance.location
  const walk = useRoute('WALKING', walkFrom, walkTo, { stepFree })

  // Once Google has the real walking path, re-estimate the selected option with its true length.
  const refine = <T extends DoorOption>(o: T): T =>
    walk
      ? { ...o, walkSeconds: walkSecondsForPath(walk.meters, user?.profile, { floors: floorOf(destination?.room ?? ''), stairs: !o.entrance.accessible }) }
      : o
  const shownOptions = options.map((o) => (o === activeOption ? refine(o) : o))
  const shownDoors = doors.map((d) => (d === activeDoor ? refine(d) : d))

  // In-app navigation. A trip is one or more legs (ride to the curb, then walk to the door).
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
    const door = destination?.building.entrances.find((e) => e.id === entranceId)
    if (!door) return
    startTrip([{ travel: 'WALKING', from: walkStart.location, to: door.location, toLabel: door.label, stage: 'Walk to door' }], door.label, door.location)
  }

  // Where the car picks you up for a drop-off trip: one of your own pickup spots
  // near you, otherwise the nearest curb a car can reach (from Google's route start).
  const PICKUP_SEARCH_M = 300
  const myPickupSpot = geo.position
    ? zoneStore.personal
        .filter((z) => !z.hidden && z.kinds.includes('pickup') && distanceMeters(geo.position!, z.stopPoint) < PICKUP_SEARCH_M)
        .sort((a, b) => distanceMeters(geo.position!, a.stopPoint) - distanceMeters(geo.position!, b.stopPoint))[0]
    : undefined
  const pickupPoint = myPickupSpot?.stopPoint ?? (geo.position ? drive?.roadStart : undefined)

  const startCarTrip = () => {
    const option = options.find((o) => o.zone.id === confirmedZoneId)
    if (!option) return
    const { zone, entrance } = option
    if (kind === 'dropoff') {
      const legs: NavLeg[] = []
      // You're not standing on a road (e.g. inside a building): walk to the pickup curb first.
      if (geo.position && pickupPoint && distanceMeters(geo.position, pickupPoint) > 25) {
        legs.push({
          travel: 'WALKING',
          from: geo.position,
          to: pickupPoint,
          toLabel: myPickupSpot ? `your pickup spot (${myPickupSpot.name})` : 'your pickup spot',
          stage: 'Walk to pickup',
        })
      }
      legs.push(
        { travel: 'DRIVING', from: pickupPoint ?? driveFrom, to: zone.stopPoint, toLabel: zone.name, stage: 'Ride to curb' },
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

  // Reached the end of a leg with more to go (e.g. the car reached the curb): continue on foot.
  const legArrived = !!nav?.arrived && !!trip && trip.index < trip.legs.length - 1
  useEffect(() => {
    if (!legArrived) return
    const id = setTimeout(() => setTrip((t) => (t ? { ...t, index: t.index + 1 } : t)), 2000)
    return () => clearTimeout(id)
  }, [legArrived])

  const requireUser = (then: () => void) => {
    if (user) then()
    else setTab('preferences')
  }

  const openPanel = (next: Panel) =>
    requireUser(() => {
      setPanel(next)
      setTool(next === 'closure' ? 'drawClosure' : 'none')
      setDraftClosure([])
      setEditingZoneId(undefined)
      setExpanded(true)
    })

  const search = (text: string) => {
    try {
      // Your own saved spots win: typing "My apartment" goes straight to that spot.
      const q = text.trim().toLowerCase()
      const spot = zoneStore.personal.find((z) => !z.hidden && z.name.trim().length > 2 && q.includes(z.name.trim().toLowerCase()))
      const spotBuilding = spot && campus.buildings.find((b) => b.id === spot.buildingId)
      if (spot && spotBuilding) {
        setDestination({ building: spotBuilding, room: text.match(/\b([a-z]?\d{2,4}[a-z]?)\b/i)?.[1]?.toUpperCase() ?? '' })
        setSelectedZoneId(spot.id)
      } else {
        const found = parseDestination(text, campus.buildings)
        // Several buildings can share a name (13 "University Apartments"): prefer one you have a spot at.
        const sameName = campus.buildings.filter((b) => b.name === found.building.name)
        const withSpot = sameName.find((b) => zoneStore.personal.some((z) => !z.hidden && z.buildingId === b.id))
        setDestination(withSpot ? { ...found, building: withSpot } : found)
        setSelectedZoneId(undefined)
      }
      setSearchError(undefined)
      setSelectedDoorId(undefined)
      setConfirmedZoneId(undefined)
    } catch (e) {
      setDestination(undefined)
      setSearchError((e as Error).message)
    }
  }

  const handleMapClick = (point: LatLng) => {
    if (tool === 'addZone') {
      const zone = zoneStore.createAt(point)
      if (zone) setEditingZoneId(zone.id)
      setTool('none')
    } else if (tool === 'drawClosure') {
      setDraftClosure((d) => [...d, point])
    }
  }

  const handleSelectZone = (zone: Zone) => {
    if (panel === 'edit') {
      setEditingZoneId(zone.id)
      return
    }
    if (panel !== 'dropoff') return
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
        destination={panel === 'dropoff' ? destination?.building : undefined}
        selectedZoneId={walking && panel === 'dropoff' ? undefined : activeZoneId}
        focusEntranceId={activeDoor?.entrance.id}
        walkMode={walking && panel === 'dropoff'}
        walkStart={activeDoor && !walkStart.fromGps ? walkStart : undefined}
        editingZoneId={editingZone?.source === 'personal' ? editingZone.id : undefined}
        me={geo.position && { position: geo.position, accuracy: geo.accuracy, heading: geo.heading }}
        drivePath={walking ? undefined : drive?.path}
        walkPath={walk?.path ?? (walkFrom && walkTo ? [walkFrom, walkTo] : undefined)}
        editMode={panel === 'edit'}
        tool={tool}
        draftClosure={draftClosure}
        onMapClick={handleMapClick}
        onSelectZone={handleSelectZone}
        onSelectBuilding={(b) => {
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
        <LocateButton geo={geo} />
      </div>

      <Sheet expanded={expanded} onToggle={() => setExpanded((v) => !v)}>
        <div className="flex items-center gap-2.5">
          <LogoMark className="size-6" />
          <span className="text-lg font-extrabold tracking-tight">Doorstep</span>
          <span className="ml-auto text-xs text-muted">the right door, every time</span>
        </div>

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

        {!trip && panel === 'dropoff' && (
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
            doors={shownDoors}
            selectedDoorId={activeDoor?.entrance.id}
            onSelectDoor={setSelectedDoorId}
            walkStart={walkStart}
            stepFree={stepFree}
            onStepFree={setStepFreeChoice}
            options={shownOptions}
            selectedZoneId={activeZoneId}
            onSelect={setSelectedZoneId}
            confirmedZoneId={confirmedZoneId}
            onConfirm={setConfirmedZoneId}
            drive={drive && { seconds: drive.seconds, fromGps: !!geo.position }}
            generatingCurbs={campus.generating}
            onSearch={search}
            onClear={() => {
              setDestination(undefined)
              setSearchError(undefined)
              setConfirmedZoneId(undefined)
            }}
            onSignIn={() => setTab('preferences')}
            onFeedback={(f) => user && void saveProfile(learn(user.profile, f))}
            error={searchError ?? campus.error}
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
