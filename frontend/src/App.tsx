import { PublicStopsPanel } from './components/PublicStopsPanel'
import { usePublicStops } from './state/publicStops'
import { APIProvider, useMap } from '@vis.gl/react-google-maps'
import { useEffect, useRef, useState } from 'react'
import { resolveLocationName } from './search'
import { ArrivalPanel } from './components/ArrivalPanel'
import { useArrival } from './state/arrivals'
import { AccountMenu } from './components/Account'
import { ClosurePanel } from './components/ClosurePanel'
import { DropoffPanel } from './components/DropoffPanel'
import { EditPanel } from './components/EditPanel'
import { LayerControl } from './components/LayerControl'
import { MapCanvas, type Tool } from './components/MapCanvas'
import { PreferencesPage } from './components/PreferencesPage'
import { TabBar, type Tab } from './components/TabBar'
import { Button, Notice, Sheet } from './components/ui'
import { useMapLayers } from './mapLayers'
import * as api from './api'
import { type Destination } from './search'
import { AuthProvider, useAuth } from './state/auth'
import { CAMPUS_CENTER, CAMPUS_GATE, WALK_DEMO_START } from './data/mapDefaults'
import { distanceMeters } from './geo'
import { useCampus, useClosures, useZones } from './state/data'
import { useGeolocation, useRoute, useServerPlan, type Geo } from './state/routing'
import type { LatLng, TravelMode, Zone } from './types'
import { useWalkedPaths } from './state/walkedPaths'
import { needsStepFree } from './walking'

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

type Panel = 'dropoff' | 'edit' | 'closure' | 'public'

function Doorstep() {
  const { user, token, restoring, sendFeedback, error: authError } = useAuth()
  const campus = useCampus()
  const zoneStore = useZones(campus.defaults, campus.buildings, user, token)
  const closureStore = useClosures(token)

  const publicStops = usePublicStops(token, user?.role === 'ADMIN')
  const [selectedPublicStopId, setSelectedPublicStopId] = useState<string>()
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
  const walking = mode === 'walk'

  // Zone editing
  const [editingZoneId, setEditingZoneId] = useState<string>()

  const stepFree = stepFreeChoice ?? needsStepFree(user?.profile)
  const { zones } = zoneStore

  const walkedPaths = useWalkedPaths(tab === 'map' && panel === 'dropoff')
  const geo = useGeolocation(walkedPaths.record)
  const onCampus = geo.position && distanceMeters(geo.position, CAMPUS_CENTER) < 3000
  const walkStart = onCampus && geo.position ? { location: geo.position, fromGps: true, label: 'your location' } : { ...WALK_DEMO_START, fromGps: false }
  const planning = useServerPlan(destination ? { buildingId: destination.building.id, room: destination.room,
    kind: mode, stepFree, origin: walking ? { lat: +walkStart.location.lat.toFixed(4), lng: +walkStart.location.lng.toFixed(4) } : undefined } : undefined,
    token, JSON.stringify([user?.profile, zoneStore.personal, closureStore.closures, publicStops.stops.map(s => [s.id, s.revision])]))
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
  } : undefined, token, JSON.stringify([user?.profile, closureStore.closures, publicStops.stops.map(s => [s.id, s.revision])]))
  const referenceWalk = arrivalDestination ? arrival.option?.walk.path : walk?.path
  const setWalkReference = walkedPaths.setReference
  useEffect(() => { setWalkReference(referenceWalk ?? []) }, [referenceWalk, setWalkReference])
  const mapDestination = arrivalDestination ? { id: arrivalDestination.placeId ?? `point:${arrivalDestination.location.lat},${arrivalDestination.location.lng}`,
    name: arrivalDestination.name, code: '', location: arrivalDestination.location, entrances: [] } : destination?.building

  const clearSelection = () => {
    setSelectedPublicStopId(undefined)
    setPublicStopDraft(undefined)
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
    try {
      const result = await api.search(text, controller.signal)
      if (controller.signal.aborted) return
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
    } catch (e) {
      if (controller.signal.aborted) return
      clearSelection()
      setSearchText(text)
      setSearchError((e as Error).message)
    }
  }

  const handleMapClick = (point: LatLng, placeId?: string) => {
    if (tool === 'addPublicStop') {
      setPublicStopDraft(point)
      setTool('none')
    } else if (tool === 'addZone') {
      const zone = zoneStore.createAt(point)
      if (zone) setEditingZoneId(zone.id)
      setTool('none')
    } else if (tool === 'drawClosure') {
      setDraftClosure((d) => [...d, point])
    } else if (panel === 'dropoff') {
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

  const editingZone = zones.find((z) => z.id === editingZoneId)
  const hiddenDefaults = campus.defaults.filter((z) => zoneStore.hiddenDefaultIds.has(z.id))

  return (
    <div className="fixed inset-0 flex flex-col">
      <div className="relative min-h-0 flex-1">
        {/* The map stays mounted behind the Preferences page so it doesn't reload. */}
        <main className="absolute inset-0" inert={tab !== 'map'}>
      <MapCanvas
        layers={layers}
        publicStops={publicStops.stops.filter(stop => stop.status !== 'RETIRED')}
        nearbyPublicStops={panel !== 'dropoff' ? [] : arrivalDestination
          ? (arrival.data?.options ?? []).flatMap(option => option.publicStopId ? [{ id: option.publicStopId, status: option.publicStopStatus ?? 'UNVERIFIED', name: option.name, location: option.stopPoint }] : [])
          : options.flatMap(option => option.zone.publicStopId ? [{ id: option.zone.publicStopId, status: option.zone.publicStopStatus ?? 'UNVERIFIED', name: option.zone.name, location: option.zone.stopPoint }] : [])}
        activePublicStopId={panel !== 'dropoff' ? undefined : arrivalDestination ? arrival.option?.publicStopId : activeOption?.zone.publicStopId}
        publicStopDraft={publicStopDraft}
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
        zones={zones}
        closures={closureStore.closures}
        destination={panel === 'dropoff' ? mapDestination : undefined}
        arrivalStop={panel !== 'dropoff' ? undefined : arrivalDestination ? arrival.option?.stopPoint ?? arrival.draft : activeOption?.zone.source === 'public' ? activeOption.zone.stopPoint : undefined}
        movingArrival={arrival.moving}
        onMoveArrival={arrival.moveTo}
        selectedZoneId={walking && panel === 'dropoff' ? undefined : activeZoneId}
        focusEntranceId={activeDoor?.entrance.id ?? activeOption?.entrance.id}
        walkMode={walking && panel === 'dropoff'}
        walkStart={activeDoor && !walkStart.fromGps ? walkStart : undefined}
        editingZoneId={editingZone?.source === 'personal' ? editingZone.id : undefined}
        me={geo.position && { position: geo.position, accuracy: geo.accuracy }}
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

      <div className="absolute right-4 top-[max(16px,env(safe-area-inset-top))] z-30 flex flex-col items-end gap-2">
        <div className="flex items-center gap-2">
          <Button className="bg-surface shadow-[var(--shadow-float)]" onClick={() => {
            clearSelection(); setPanel('public'); setTool('none'); setSelectedPublicStopId(undefined); setPublicStopDraft(undefined); setExpanded(true)
          }}>Public stops</Button>
          <Legend />
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
          <span aria-hidden className="size-5 rounded-[6px_6px_6px_2px] bg-gradient-to-br from-accent to-[#2a8cff]" />
          <span className="text-lg font-extrabold tracking-tight">Doorstep</span>
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
        {panel === 'dropoff' && arrivalDestination && <ArrivalPanel
          key={`${arrivalDestination.placeId ?? ''}:${arrivalDestination.location.lat},${arrivalDestination.location.lng}:${token ?? ''}`}
          user={user} searchText={searchText}
          onSearchTextChange={text => { searchRequest.current?.abort(); setSearchText(text) }}
          onSearch={search} onClear={clearSelection}
          destination={arrivalDestination} state={arrival} token={token} onSignIn={() => setTab('preferences')}
          kind={mode === 'pickup' ? 'pickup' : 'dropoff'} onKind={setMode} stepFree={stepFree} onStepFree={setStepFreeChoice}
        />}
        {panel === 'dropoff' && !arrivalDestination && (
          <DropoffPanel
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
          />
        )}

        {panel === 'public' && <PublicStopsPanel
          store={publicStops} user={user} token={token}
          selected={publicStops.stops.find(stop => stop.id === selectedPublicStopId)}
          draft={publicStopDraft} adding={tool === 'addPublicStop'}
          onAdd={() => { setSelectedPublicStopId(undefined); setPublicStopDraft(undefined); setTool('addPublicStop') }}
          onSelect={stop => { setSelectedPublicStopId(stop?.id); setTool('none') }}
          onCancelAdd={() => { setPublicStopDraft(undefined); setTool('none') }}
          onDone={() => { setPanel('dropoff'); setTool('none'); setPublicStopDraft(undefined); setSelectedPublicStopId(undefined) }}
          onSignIn={() => setTab('preferences')}
          onUse={stop => {
            clearSelection(); setArrivalDestination({ name: stop.name, location: stop.location, publicStopId: stop.id })
            setSearchText(stop.name); setMode(stop.kinds.includes('DROPOFF') || stop.kinds.includes('BOTH') ? 'dropoff' : 'pickup')
            setPanel('dropoff'); setTool('none'); setSelectedPublicStopId(undefined); setPublicStopDraft(undefined)
          }}
        />}

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
