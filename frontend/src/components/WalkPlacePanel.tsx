import { formatDistance, formatWalk } from '../geo'
import { DoorIcon, WalkIcon } from './icons'
import { Button, Notice } from './ui'

/** Walk mode to a place off campus (an address or a place on the map): the walk there. */
export function WalkPlacePanel({
  name,
  from,
  route,
  savedMeters,
  error,
  onStart,
}: {
  name: string
  /** Where the walk starts: "your location", a typed address, or the demo start. */
  from: string
  /** The walk, timed at your pace. */
  route?: { seconds: number; meters: number }
  /** How much shorter linked doorways made it (0 = no shortcut on the way). */
  savedMeters?: number
  error?: string
  onStart: () => void
}) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-selected bg-selected/[0.06] p-4">
      <p className="m-0 text-xs font-bold text-selected">Walking route</p>
      <h2 className="m-0 text-lg font-bold">{name}</h2>
      {error ? (
        <Notice tone="error">{error}</Notice>
      ) : route ? (
        <>
          <p className="m-0 text-sm">
            <WalkIcon size={16} className="mr-1 inline -translate-y-px text-accent" />
            {formatWalk(route.seconds)} · {formatDistance(route.meters)} from {from}
          </p>
          {savedMeters !== undefined && savedMeters > 0 && (
            <p className="m-0 text-sm font-semibold text-accent">
              <DoorIcon size={16} className="mr-1 inline -translate-y-px" />
              Through a doorway shortcut ({Math.round(savedMeters)} m shorter)
            </p>
          )}
          <Button variant="primary" className="h-12" onClick={onStart}>
            Start walking
          </Button>
        </>
      ) : (
        <Notice>Finding the walking route…</Notice>
      )}
    </section>
  )
}
