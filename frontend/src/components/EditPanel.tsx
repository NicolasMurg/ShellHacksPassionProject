import { distanceMeters } from '../geo'
import type { Building, LatLng, TripKind, Zone } from '../types'
import type { Tool } from './MapCanvas'
import { Button, Field, Notice, Switch, inputClass } from './ui'

type Props = {
  buildings: Building[]
  selected?: Zone
  personal: Zone[]
  hiddenDefaults: Zone[]
  tool: Tool
  onTool: (t: Tool) => void
  onSelect: (zoneId?: string) => void
  onUpdate: (zone: Zone) => void
  onDelete: (zone: Zone) => void
  onCustomize: (zone: Zone) => void
  onHide: (zone: Zone) => void
  onRestore: (defaultZoneId: string) => void
  onDone: () => void
}

/** Lets a signed-in user add, move, reshape, customize and hide zones just for themselves. */
export function EditPanel(p: Props) {
  const mine = p.personal.filter((z) => !z.hidden)
  const buildingName = (id: string) => p.buildings.find((b) => b.id === id)?.name ?? id
  const selectedBuilding = p.buildings.find((b) => b.id === p.selected?.buildingId)

  return (
    <>
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="m-0 text-xs font-semibold text-muted">Only you see these changes</p>
          <h1 className="m-0 text-xl font-extrabold tracking-tight">Edit my zones</h1>
        </div>
        <Button variant="primary" className="h-9 text-sm" onClick={p.onDone}>
          Done
        </Button>
      </header>

      {p.tool === 'addZone' ? (
        <div className="flex flex-col gap-2">
          <Notice tone="success">Tap the map where you want the car to stop.</Notice>
          <Button onClick={() => p.onTool('none')}>Cancel</Button>
        </div>
      ) : (
        <Button variant="primary" onClick={() => p.onTool('addZone')}>
          + Add a zone
        </Button>
      )}

      {p.selected?.source === 'personal' ? (
        <ZoneForm zone={p.selected} buildings={p.buildings} onChange={p.onUpdate} onDelete={p.onDelete} onClose={() => p.onSelect(undefined)} />
      ) : p.selected && selectedBuilding ? (
        <DefaultZoneCard zone={p.selected} building={selectedBuilding} onCustomize={p.onCustomize} onHide={p.onHide} />
      ) : (
        <Notice>Tap any zone on the map to customize it, or pick one of yours below.</Notice>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="m-0 text-sm font-bold text-muted">My zones ({mine.length})</h2>
        {mine.length === 0 && <p className="m-0 text-sm text-muted">None yet.</p>}
        {mine.map((z) => (
          <button
            key={z.id}
            type="button"
            onClick={() => p.onSelect(z.id)}
            className="flex items-center justify-between rounded-xl border border-line bg-raised px-3.5 py-2.5 text-left hover:border-personal"
          >
            <span>
              <span className="block font-semibold">{z.name}</span>
              <span className="text-xs text-muted">{buildingName(z.buildingId)}</span>
            </span>
            <span aria-hidden className="size-3 rounded-sm bg-personal" />
          </button>
        ))}
      </section>

      {p.hiddenDefaults.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="m-0 text-sm font-bold text-muted">Hidden default zones</h2>
          {p.hiddenDefaults.map((z) => (
            <div key={z.id} className="flex items-center justify-between rounded-xl border border-line bg-raised px-3.5 py-2">
              <span className="text-sm">{z.name}</span>
              <Button variant="quiet" className="h-8 px-2 text-sm" onClick={() => p.onRestore(z.id)}>
                Restore
              </Button>
            </div>
          ))}
        </section>
      )}
    </>
  )
}

function DefaultZoneCard({
  zone,
  building,
  onCustomize,
  onHide,
}: {
  zone: Zone
  building: Building
  onCustomize: (z: Zone) => void
  onHide: (z: Zone) => void
}) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-shared/40 bg-shared/5 p-4">
      <div>
        <p className="m-0 text-xs font-bold text-shared">
          {zone.source === 'generated' ? 'Suggested curb' : 'Public zone'} · {building.name}
        </p>
        <h3 className="m-0 mt-1 text-base font-bold">{zone.name}</h3>
        <p className="m-0 text-sm text-muted">The planner chooses the fastest suitable entrance.</p>
      </div>
      <p className="m-0 text-sm">Make your own copy to move or reshape it. Everyone else keeps seeing the original.</p>
      <div className="flex gap-2">
        <Button variant="primary" className="flex-1" onClick={() => onCustomize(zone)}>
          Customize for me
        </Button>
        <Button className="flex-1" onClick={() => onHide(zone)}>
          Hide for me
        </Button>
      </div>
    </div>
  )
}

const KINDS: { value: TripKind; label: string }[] = [
  { value: 'dropoff', label: 'Drop-off' },
  { value: 'pickup', label: 'Pickup' },
]

/** How far (rounded) from the car's stop point, for labels like "· 40 m". */
const away = (from: LatLng, to: LatLng) => `${Math.round(distanceMeters(from, to) / 10) * 10} m`

function ZoneForm({
  zone,
  buildings,
  onChange,
  onDelete,
  onClose,
}: {
  zone: Zone
  buildings: Building[]
  onChange: (z: Zone) => void
  onDelete: (z: Zone) => void
  onClose: () => void
}) {
  const toggleKind = (k: TripKind, on: boolean) => {
    const kinds = on ? [...new Set([...zone.kinds, k])] : zone.kinds.filter((x) => x !== k)
    if (kinds.length > 0) onChange({ ...zone, kinds })
  }

  // Buildings nearest this spot first: the one you're going to is almost always close by.
  const byDistance = [...buildings].sort((a, b) => distanceMeters(zone.stopPoint, a.location) - distanceMeters(zone.stopPoint, b.location))
  const building = buildings.find((b) => b.id === zone.buildingId) ?? byDistance[0]
  const nearby = byDistance.slice(0, 8)
  const choices = nearby.includes(building) ? nearby : [building, ...nearby]
  const pickBuilding = (id: string) => {
    const next = buildings.find((b) => b.id === id)
    if (!next) return
    // Default to that building's door closest to where the car stops.
    const closest = [...next.entrances].sort(
      (a, b) => distanceMeters(zone.stopPoint, a.location) - distanceMeters(zone.stopPoint, b.location),
    )[0]
    onChange({ ...zone, buildingId: next.id, entranceId: closest?.id ?? zone.entranceId })
  }

  return (
    <div className="flex flex-col gap-3.5 rounded-2xl border border-personal/40 bg-personal/5 p-4">
      <div className="flex items-center justify-between">
        <p className="m-0 text-xs font-bold text-personal">Your drop-off spot</p>
        <button type="button" onClick={onClose} className="text-sm text-muted hover:text-fg">
          Close
        </button>
      </div>
      <Notice>Drag the shape or its corners to reshape it. Drag the car marker to move exactly where the car stops.</Notice>

      <Field label="Name">
        <input className={inputClass} value={zone.name} placeholder="e.g. My apartment" onChange={(e) => onChange({ ...zone, name: e.target.value })} />
      </Field>
      <Field label="Use this spot when I'm going to" hint="Search for this building and your car stops here instead of the default curb.">
        <select className={inputClass} value={building?.id ?? ''} onChange={(e) => pickBuilding(e.target.value)}>
          {choices.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name} ({b.code}) · {away(zone.stopPoint, b.location)}
            </option>
          ))}
        </select>
      </Field>
      <p className="m-0 text-sm text-muted">This zone serves the building as a whole. Each trip uses the fastest suitable entrance.</p>
      <div className="flex flex-wrap gap-x-5">
        {KINDS.map((k) => (
          <Switch key={k.value} checked={zone.kinds.includes(k.value)} onChange={(on) => toggleKind(k.value, on)} label={k.label} />
        ))}
      </div>
      <Button variant="danger" onClick={() => onDelete(zone)}>
        {zone.basedOnZoneId ? 'Delete (brings back the default)' : 'Delete zone'}
      </Button>
    </div>
  )
}
