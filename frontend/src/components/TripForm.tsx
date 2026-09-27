import { useState, type FormEvent, type ReactNode } from 'react'
import { looksLikeSentence } from '../search'
import type { Place, TravelMode } from '../types'
import { cx } from './cx'
import { SparkleIcon } from './icons'
import { Button, Notice, Segmented } from './ui'

const QUICK_PICKS = ['GC 150', 'Green Library 420', 'CASE 241', 'PC 110']
const AI_EXAMPLE = "Drop me at Graham Center by the food court at 9, I'm on crutches"

type Props = {
  mode: TravelMode
  onMode: (m: TravelMode) => void
  /** The typed starting address once it's been found. An empty "From" starts from your location. */
  start?: Place
  /** What "To" found (a building and room, or a place), shown back in the field. */
  destinationLabel?: string
  hasGps: boolean
  /** Nothing chosen yet: show example destinations. */
  showExamples: boolean
  /** Enter: plan from → to. Throws when the "From" address can't be found. */
  onEnter: (from: string, to: string) => Promise<void>
}

/** "From" and "To", then Enter: shows the route for a drop-off or a walk. */
export function TripForm(p: Props) {
  const walking = p.mode === 'walk'
  const [from, setFrom] = useState(p.start?.label ?? '')
  const [to, setTo] = useState(p.destinationLabel ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  // Once found, the fields show what was found: the full address, the building's name.
  const [shown, setShown] = useState({ start: p.start?.label, destination: p.destinationLabel })
  if (shown.start !== p.start?.label || shown.destination !== p.destinationLabel) {
    if (p.start?.label && p.start.label !== shown.start) setFrom(p.start.label)
    if (p.destinationLabel && p.destinationLabel !== shown.destination) setTo(p.destinationLabel)
    setShown({ start: p.start?.label, destination: p.destinationLabel })
  }

  const enter = async (nextTo = to) => {
    setBusy(true)
    setError(undefined)
    try {
      await p.onEnter(from.trim(), nextTo.trim())
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    void enter()
  }
  const pick = (text: string) => {
    setTo(text)
    void enter(text)
  }

  return (
    <>
      <header>
        <p className="m-0 text-xs font-semibold text-muted">{walking ? 'On foot ›' : 'My car ›'}</p>
        <h1 className="m-0 text-xl font-extrabold tracking-tight">{walking ? 'Walk to the right door' : p.mode === 'pickup' ? 'Targeted pickup' : 'Targeted drop-off'}</h1>
      </header>

      <Segmented
        label="How are you getting there?"
        value={p.mode}
        onChange={p.onMode}
        options={[
          { value: 'dropoff', label: 'Drop-off' },
          { value: 'pickup', label: 'Pickup' },
          { value: 'walk', label: 'Walk' },
        ]}
      />

      <form onSubmit={submit} className="flex flex-col gap-2">
        <Field label="From" value={from} onClear={() => setFrom('')}>
          <input
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            placeholder={p.hasGps ? 'Your location' : 'Any address, e.g. Dolphin Mall'}
            aria-label="From: starting address"
            enterKeyHint="go"
            autoComplete="street-address"
            className="h-full min-w-0 flex-1 bg-transparent font-medium placeholder:text-muted focus:outline-none"
          />
        </Field>
        <Field label="To" value={to} onClear={() => setTo('')}>
          <input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="Address, GC 150, or just say it"
            aria-label="To: address, place, or building and room"
            enterKeyHint="go"
            className="h-full min-w-0 flex-1 bg-transparent font-medium placeholder:text-muted focus:outline-none"
          />
          {/* Lights up once you type a sentence: that's when Gemini reads the request. */}
          <SparkleIcon
            size={18}
            className={cx('shrink-0 transition-opacity', looksLikeSentence(to) ? 'opacity-100' : 'opacity-45')}
          />
          {looksLikeSentence(to) && <span className="sr-only">Gemini will read this request</span>}
        </Field>
        <Button type="submit" variant="primary" className="h-12" disabled={busy}>
          {busy ? 'Finding the route…' : 'Enter'}
        </Button>
      </form>
      {error && <Notice tone="error">{error}</Notice>}

      {p.showExamples && (
        <div>
          <p className="m-0 mb-2 text-sm text-muted">
            Leave From empty to start {p.hasGps ? 'from your location' : 'near campus'}, and To empty to go to Graham Center. Or tap a
            place on the map.
          </p>
          <p className="mb-2 mt-0 text-sm font-semibold text-muted">Try</p>
          <div className="flex flex-wrap gap-2">
            {QUICK_PICKS.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => pick(q)}
                className="h-10 rounded-full border border-line bg-raised px-3.5 font-semibold hover:border-accent"
              >
                {q}
              </button>
            ))}
            <button
              type="button"
              onClick={() => pick(AI_EXAMPLE)}
              className="flex min-h-10 items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-3.5 py-1.5 text-left text-sm font-semibold text-accent hover:border-accent"
            >
              <SparkleIcon size={16} className="shrink-0" /> “{AI_EXAMPLE}”
            </button>
          </div>
        </div>
      )}
    </>
  )
}

/** One labeled field in the From/To form, with a clear (×) button once it has text. */
function Field({ label, value, onClear, children }: { label: string; value: string; onClear: () => void; children: ReactNode }) {
  return (
    <div className="flex h-13 items-center gap-1.5 rounded-full border border-line bg-raised pl-4 pr-2 focus-within:border-accent">
      <span className="w-9 shrink-0 text-xs font-bold text-muted">{label}</span>
      {children}
      {value && (
        <button type="button" aria-label={`Clear ${label}`} onClick={onClear} className="size-8 shrink-0 rounded-full text-xl text-muted hover:text-fg">
          ×
        </button>
      )}
    </div>
  )
}
