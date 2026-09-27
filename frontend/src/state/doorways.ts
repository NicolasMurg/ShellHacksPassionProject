import { useSyncExternalStore } from 'react'
import { cellCenter, type Cell } from '../grid'
import type { LatLng } from '../types'

// Doorways placed on the grid, and links between them. A link says "you can walk
// through the building from this door to that one", and the campus walking router
// uses it as a shortcut (walkRouter.ts withShortcuts). Saved on this device for now.

export type Doorway = Cell & { id: string; label: string }
export type DoorLink = { id: string; a: string; b: string }
type Doorways = { doors: Doorway[]; links: DoorLink[] }

const STORAGE_KEY = 'doorstep.doorways'
const EMPTY: Doorways = { doors: [], links: [] }

function load(): Doorways {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Doorways | null
    return saved && Array.isArray(saved.doors) && Array.isArray(saved.links) ? saved : EMPTY
  } catch {
    return EMPTY
  }
}

let state = load()
const listeners = new Set<() => void>()

function update(next: Doorways) {
  state = next
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Storage blocked: changes last until the page reloads.
  }
  listeners.forEach((l) => l())
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Where a doorway is: the center of its grid square. */
export const doorLocation = (d: Doorway): LatLng => cellCenter(d)

const sameLink = (l: DoorLink, a: string, b: string) => (l.a === a && l.b === b) || (l.a === b && l.b === a)

/** Put a door on a grid square (or return the one already there). */
export function placeDoor(cell: Cell): Doorway {
  const existing = state.doors.find((d) => d.row === cell.row && d.col === cell.col)
  if (existing) return existing
  const next = state.doors.reduce((max, d) => Math.max(max, Number(d.label.match(/\d+$/)?.[0] ?? 0)), 0) + 1
  const door: Doorway = { id: crypto.randomUUID(), row: cell.row, col: cell.col, label: `Door ${next}` }
  update({ ...state, doors: [...state.doors, door] })
  return door
}

/** Remove a door and every link that uses it. */
export function removeDoor(id: string) {
  update({ doors: state.doors.filter((d) => d.id !== id), links: state.links.filter((l) => l.a !== id && l.b !== id) })
}

/** Link two doors (a walk through the building), or unlink them if they're already linked. */
export function toggleLink(a: string, b: string) {
  if (a === b) return
  const linked = state.links.some((l) => sameLink(l, a, b))
  update({
    ...state,
    links: linked ? state.links.filter((l) => !sameLink(l, a, b)) : [...state.links, { id: crypto.randomUUID(), a, b }],
  })
}

export function removeLink(id: string) {
  update({ ...state, links: state.links.filter((l) => l.id !== id) })
}

const snapshot = () => state

export function useDoorways(): Doorways {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

/** Each link as its two door positions, ready for the walking router. */
export function shortcutsOf({ doors, links }: Doorways): { a: LatLng; b: LatLng }[] {
  const byId = new Map(doors.map((d) => [d.id, d]))
  return links.flatMap((l) => {
    const a = byId.get(l.a)
    const b = byId.get(l.b)
    return a && b ? [{ a: doorLocation(a), b: doorLocation(b) }] : []
  })
}
