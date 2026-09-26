import type { Building, TripKind, Zone } from '../types'
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

      {p.selected ? (
        p.selected.ownerId === null ? (
          <DefaultZoneCard zone={p.selected} building={buildingName(p.selected.buildingId)} onCustomize={p.onCustomize} onHide={p.onHide} />
        ) : (
          <ZoneForm zone={p.selected} building={buildingName(p.selected.buildingId)} onChange={p.onUpdate} onDelete={p.onDelete} onClose={() => p.onSelect(undefined)} />
        )
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
  building: string
  onCustomize: (z: Zone) => void
  onHide: (z: Zone) => void
}) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-shared/40 bg-shared/5 p-4">
      <div>
        <p className="m-0 text-xs font-bold text-shared">Default zone · {building}</p>
        <h3 className="m-0 mt-1 text-base font-bold">{zone.name}</h3>
        <p className="m-0 text-sm text-muted">→ {zone.entrance.label}</p>
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

function ZoneForm({
  zone,
  building,
  onChange,
  onDelete,
  onClose,
}: {
  zone: Zone
  building: string
  onChange: (z: Zone) => void
  onDelete: (z: Zone) => void
  onClose: () => void
}) {
  const toggleKind = (k: TripKind, on: boolean) => {
    const kinds = on ? [...new Set([...zone.kinds, k])] : zone.kinds.filter((x) => x !== k)
    if (kinds.length > 0) onChange({ ...zone, kinds })
  }

  return (
    <div className="flex flex-col gap-3.5 rounded-2xl border border-personal/40 bg-personal/5 p-4">
      <div className="flex items-center justify-between">
        <p className="m-0 text-xs font-bold text-personal">Your zone · {building}</p>
        <button type="button" onClick={onClose} className="text-sm text-muted hover:text-fg">
          Close
        </button>
      </div>
      <Notice>Drag the shape or its corners to reshape it. Drag 🚗 to move the stop point and the door to move the entrance.</Notice>

      <Field label="Zone name">
        <input className={inputClass} value={zone.name} onChange={(e) => onChange({ ...zone, name: e.target.value })} />
      </Field>
      <Field label="Entrance">
        <input
          className={inputClass}
          value={zone.entrance.label}
          onChange={(e) => onChange({ ...zone, entrance: { ...zone.entrance, label: e.target.value } })}
        />
      </Field>
      <Field label="Rooms this is for" hint="Comma-separated, e.g. 1xx, 212, 3xx. Leave empty for any room.">
        <input
          className={inputClass}
          value={zone.rooms.join(', ')}
          placeholder="Any room"
          onChange={(e) =>
            onChange({
              ...zone,
              rooms: e.target.value
                .split(',')
                .map((r) => r.trim())
                .filter(Boolean),
            })
          }
        />
      </Field>
      <div className="flex flex-wrap gap-x-5">
        {KINDS.map((k) => (
          <Switch key={k.value} checked={zone.kinds.includes(k.value)} onChange={(on) => toggleKind(k.value, on)} label={k.label} />
        ))}
      </div>
      <Switch
        checked={zone.entrance.accessible}
        onChange={(accessible) => onChange({ ...zone, entrance: { ...zone.entrance, accessible } })}
        label="♿ Entrance is step-free"
      />
      <Button variant="danger" onClick={() => onDelete(zone)}>
        {zone.basedOnZoneId ? 'Delete (brings back the default)' : 'Delete zone'}
      </Button>
    </div>
  )
}
