import { useState } from 'react'
import { CarIcon } from './icons'
import { Button, Field, Notice, inputClass } from './ui'

type Props = {
  buildingName: string
  verb: string // "drop-off" or "pickup"
  strokeCount: number
  hasArea: boolean
  /** The closest road to the painted spot, found with a driving route to it. */
  road: { loading: boolean; error?: string; metersFromSpot?: number; driveMinutes?: number; from: string }
  saving: boolean
  onUndo: () => void
  onClear: () => void
  onSave: (name: string) => void
  onCancel: () => void
}

/** Sheet content while the user colors in their own drop-off spot on the map. */
export function MarkZonePanel(p: Props) {
  const [name, setName] = useState(`My ${p.verb} spot`)

  return (
    <>
      <header>
        <p className="m-0 text-xs font-semibold text-muted">{p.buildingName} ›</p>
        <h1 className="m-0 text-xl font-extrabold tracking-tight">Mark your {p.verb} spot</h1>
      </header>

      <Notice>
        Color in where you'd like the car to stop: press and drag on the map. Add more strokes to fill it in.
      </Notice>

      <div className="flex gap-2">
        <Button className="h-9 flex-1 text-sm" disabled={p.strokeCount === 0} onClick={p.onUndo}>
          Undo stroke
        </Button>
        <Button className="h-9 flex-1 text-sm" disabled={p.strokeCount === 0} onClick={p.onClear}>
          Clear
        </Button>
      </div>

      {p.hasArea &&
        (p.road.loading ? (
          <Notice>Finding the closest road to your spot…</Notice>
        ) : p.road.error ? (
          <Notice tone="error">
            Couldn't find the closest road ({p.road.error}). You can still save; the car will aim for the middle of your spot.
          </Notice>
        ) : (
          <Notice tone="success">
            <CarIcon size={16} className="mr-1 inline -translate-y-px" />
            The car stops on the closest road,{' '}
            {p.road.metersFromSpot ? `${p.road.metersFromSpot} m from your spot` : 'right at your spot'}
            {p.road.driveMinutes !== undefined && ` · ${p.road.driveMinutes} min drive from ${p.road.from}`}
          </Notice>
        ))}

      {p.hasArea && (
        <Field label="Name">
          <input className={inputClass} value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
        </Field>
      )}

      <div className="flex gap-2">
        <Button className="flex-1" onClick={p.onCancel}>
          Cancel
        </Button>
        <Button
          variant="primary"
          className="flex-1"
          disabled={!p.hasArea || p.road.loading || p.saving || !name.trim()}
          onClick={() => p.onSave(name.trim())}
        >
          {p.saving ? 'Saving…' : 'Save spot'}
        </Button>
      </div>
    </>
  )
}
