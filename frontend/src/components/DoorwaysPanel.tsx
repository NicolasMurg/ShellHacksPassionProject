import { distanceMeters } from '../geo'
import { doorLocation, removeDoor, removeLink, type DoorLink, type Doorway } from '../state/doorways'
import { useCampusGraphs } from '../state/routing'
import { MAX_DOOR_REACH_M, distanceToNetwork, routeWalk } from '../walkRouter'
import { cx } from './cx'
import { DoorIcon } from './icons'
import { Button, Notice } from './ui'

type Props = {
  doors: Doorway[]
  links: DoorLink[]
  selectedId?: string
  onSelect: (id?: string) => void
  error?: string
  onDone: () => void
}

/** Sheet content for placing doorways on the grid and linking them into shortcuts through buildings. */
export function DoorwaysPanel(p: Props) {
  // Compare each shortcut against walking around on the mapped paths alone.
  const { base } = useCampusGraphs()
  const byId = new Map(p.doors.map((d) => [d.id, d]))
  const selected = p.selectedId ? byId.get(p.selectedId) : undefined
  const unreachable = (d: Doorway) => !!base && distanceToNetwork(base, doorLocation(d)) > MAX_DOOR_REACH_M

  return (
    <>
      <header>
        <p className="m-0 text-xs font-semibold text-muted">Shortcuts through buildings ›</p>
        <h1 className="m-0 text-xl font-extrabold tracking-tight">Doorways</h1>
      </header>

      <Notice>
        Tap a grid square to place a door there (zoom in until you can see the squares). Then tap one door and another to
        link them: walking routes can cut through the building between linked doors. Tap the pair again to unlink.
      </Notice>

      {p.error && <Notice tone="error">{p.error}</Notice>}

      {selected && (
        <div className="flex flex-col gap-2 rounded-2xl border border-selected/40 bg-selected/10 p-3.5">
          <div className="flex items-center justify-between gap-2">
            <span>
              <span className="flex items-center gap-1.5 font-bold">
                <DoorIcon size={17} className="text-selected" /> {selected.label}
              </span>
              <span className="text-xs text-muted">
                Square row {selected.row} · col {selected.col}. Tap another door to link it.
              </span>
            </span>
            <Button
              variant="danger"
              className="h-9 shrink-0 px-3 text-sm"
              onClick={() => {
                removeDoor(selected.id)
                p.onSelect(undefined)
              }}
            >
              Delete
            </Button>
          </div>
          {unreachable(selected) && (
            <p className="m-0 text-xs font-semibold text-closed">
              More than {MAX_DOOR_REACH_M} m from any mapped path, so routes can't reach this door.
            </p>
          )}
        </div>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="m-0 text-sm font-bold">
          Links <span className="font-semibold text-muted">({p.links.length})</span>
        </h2>
        {p.links.length === 0 ? (
          <p className="m-0 text-sm text-muted">No links yet. Place two doors on either side of a building and link them.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {p.links.map((l) => {
              const a = byId.get(l.a)
              const b = byId.get(l.b)
              if (!a || !b) return null
              const through = distanceMeters(doorLocation(a), doorLocation(b))
              const around = base && routeWalk(base, doorLocation(a), doorLocation(b))?.meters
              const usable = !unreachable(a) && !unreachable(b)
              return (
                <li key={l.id} className="flex items-center justify-between gap-2 rounded-xl border border-line bg-raised px-3.5 py-2.5">
                  <span className="min-w-0 text-sm">
                    <span className="block font-bold">
                      {a.label} ↔ {b.label}
                    </span>
                    <span className={cx('text-xs', usable ? 'text-muted' : 'text-closed')}>
                      {!usable
                        ? 'A door is too far from any path to use'
                        : `Through: ${Math.round(through)} m${
                            around === undefined
                              ? ''
                              : ` · walking around: ${Math.round(around)} m${around > through ? ` (saves ${Math.round(around - through)} m)` : ''}`
                          }`}
                    </span>
                  </span>
                  <Button variant="quiet" className="h-8 shrink-0 px-2 text-sm" onClick={() => removeLink(l.id)}>
                    Remove
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {p.doors.length > 0 && (
        <p className="m-0 text-xs text-muted">
          {p.doors.length} door{p.doors.length === 1 ? '' : 's'} placed. Saved on this device. Walking directions in
          step-by-step navigation use linked doors as shortcuts.
        </p>
      )}

      <Button variant="primary" onClick={p.onDone}>
        Done
      </Button>
    </>
  )
}
