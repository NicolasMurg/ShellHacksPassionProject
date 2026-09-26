import { APIProvider, useMap } from '@vis.gl/react-google-maps'
import { useMemo, useState } from 'react'
import { AccountMenu } from './components/Account'
import { ClosurePanel } from './components/ClosurePanel'
import { DropoffPanel } from './components/DropoffPanel'
import { EditPanel } from './components/EditPanel'
import { LayerControl } from './components/LayerControl'
import { MapCanvas, type Tool } from './components/MapCanvas'
import { PreferencesPage } from './components/PreferencesPage'
import { TabBar, type Tab } from './components/TabBar'
import { Sheet } from './components/ui'
import { useMapLayers } from './mapLayers'
import { floorOf, rankDoors, rankStops } from './planner'
import { parseDestination, type Destination } from './search'
import { AuthProvider, useAuth } from './state/auth'
import { CAMPUS_CENTER, CAMPUS_GATE, WALK_DEMO_START } from './data/campus'
import { distanceMeters } from './geo'
import { useCampus, useClosures, useZones } from './state/data'
import { useGeolocation, useRoute, type Geo } from './state/routing'
import type { DoorOption, LatLng, TravelMode, TripKind, Zone } from './types'
import { learn, needsStepFree, walkSecondsForPath } from './walking'

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
  const campus = useCampus()
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
  const [destination, setDestination] = useState<Destination>()
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
          })
        : [],
    [destination, walking, zones, campus.entrances, kind, stepFree, user?.profile, closureStore.closures],
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
      ? rankDoors({ entrances: destination.building.entrances, room: destination.room, origin: walkStart.location, stepFree, profile: user?.profile })
      : []
  const activeDoor =
    panel === 'dropoff' && walking ? (doors.find((d) => d.entrance.id === selectedDoorId) ?? doors[0]) : undefined

  // Routes. Car: from you (or the campus gate without GPS) to the curb, then walk curb → door.
  // Walk mode: walk from you straight to the door.
  const driveFrom = geo.position ?? CAMPUS_GATE
  const drive = useRoute('DRIVING', activeOption && driveFrom, activeOption?.zone.stopPoint)
  const walkFrom = activeDoor ? walkStart.location : activeOption?.zone.stopPoint
  const walkTo = (activeDoor ?? activeOption)?.entrance.location
  const walk = useRoute('WALKING', walkFrom, walkTo)

  // Once Google has the real walking path, re-estimate the selected option with its true length.
  const refine = <T extends DoorOption>(o: T): T =>
    walk
      ? { ...o, walkSeconds: walkSecondsForPath(walk.meters, user?.profile, { floors: floorOf(destination?.room ?? ''), stairs: !o.entrance.accessible }) }
      : o
  const shownOptions = options.map((o) => (o === activeOption ? refine(o) : o))
  const shownDoors = doors.map((d) => (d === activeDoor ? refine(d) : d))

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
      setDestination(parseDestination(text, campus.buildings))
      setSearchError(undefined)
      setSelectedZoneId(undefined)
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
        me={geo.position && { position: geo.position, accuracy: geo.accuracy }}
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

      <div className="absolute right-4 top-[max(16px,env(safe-area-inset-top))] z-30 flex flex-col items-end gap-2">
        <div className="flex items-center gap-2">
          <Legend />
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
          <span aria-hidden className="size-5 rounded-[6px_6px_6px_2px] bg-gradient-to-br from-accent to-[#2a8cff]" />
          <span className="text-lg font-extrabold tracking-tight">Doorstep</span>
          <span className="ml-auto text-xs text-muted">the right door, every time</span>
        </div>

        {panel === 'dropoff' && (
          <DropoffPanel
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

        {panel === 'edit' && user && (
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

        {panel === 'closure' && user && (
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
