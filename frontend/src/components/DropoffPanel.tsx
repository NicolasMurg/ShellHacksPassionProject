import { useState, type FormEvent } from 'react'
import { formatWalk } from '../geo'
import type { Destination } from '../search'
import type { DoorOption, StopOption, TravelMode, TripKind, User } from '../types'
import { walkingSpeed } from '../walking'
import { StreetViewPreview } from './StreetViewPreview'
import { cx } from './cx'
import { Button, Notice, Segmented, Switch } from './ui'

const QUICK_PICKS = ['GC 150', 'GC 243', 'Green Library 420', 'PC 110']

type Props = {
  user?: User
  destination?: Destination
  mode: TravelMode
  onMode: (m: TravelMode) => void
  /** Walk mode: ranked doors, and where the walk starts. */
  doors: DoorOption[]
  selectedDoorId?: string
  onSelectDoor: (entranceId: string) => void
  walkStart?: { fromGps: boolean; label: string }
  stepFree: boolean
  onStepFree: (v: boolean) => void
  options: StopOption[]
  selectedZoneId?: string
  onSelect: (zoneId: string) => void
  confirmedZoneId?: string
  onConfirm: (zoneId?: string) => void
  onSearch: (text: string) => void
  onClear: () => void
  onSignIn: () => void
  onFeedback: (f: 'faster' | 'right' | 'slower') => Promise<void>
  error?: string
  /** Drive to the selected curb, from GPS or (without GPS) from the campus gate. */
  drive?: { seconds: number; fromGps: boolean }
  planning?: boolean
  feedbackSent?: boolean
}

function formatDrive(seconds: number) {
  return `${Math.max(1, Math.round(seconds / 60))} min drive`
}

/** The "My car → Targeted drop-off" screen, plus walk mode for arriving on foot. */
export function DropoffPanel(p: Props) {
  const [text, setText] = useState('')
  const walking = p.mode === 'walk'
  const kind: TripKind = p.mode === 'pickup' ? 'pickup' : 'dropoff'
  const verb = kind === 'dropoff' ? 'drop-off' : 'pickup'
  const confirmed = walking ? undefined : p.options.find((o) => o.zone.id === p.confirmedZoneId)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (text.trim()) p.onSearch(text.trim())
  }

  return (
    <>
      <header>
        <p className="m-0 text-xs font-semibold text-muted">{walking ? 'On foot ›' : 'My car ›'}</p>
        <h1 className="m-0 text-xl font-extrabold tracking-tight">{walking ? 'Walk to the right door' : `Targeted ${verb}`}</h1>
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

      <form role="search" onSubmit={submit} className="flex h-13 items-center gap-1.5 rounded-full border border-line bg-raised pl-4 pr-1.5 focus-within:border-accent">
        <span aria-hidden className="text-lg text-muted">⌕</span>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Address, place, or GC 150"
          aria-label="Address, place, or building and room"
          enterKeyHint="go"
          className="h-full min-w-0 flex-1 bg-transparent font-medium placeholder:text-muted focus:outline-none"
        />
        {text && (
          <button
            type="button"
            aria-label="Clear"
            onClick={() => {
              setText('')
              p.onClear()
            }}
            className="size-8 rounded-full text-xl text-muted hover:text-fg"
          >
            ×
          </button>
        )}
        <button
          type="submit"
          disabled={!text.trim()}
          aria-label="Find the right entrance"
          className="grid size-11 place-items-center rounded-full bg-accent text-lg font-black text-accent-ink disabled:bg-high disabled:text-muted"
        >
          →
        </button>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Switch checked={p.stepFree} onChange={p.onStepFree} label="♿ Step-free only" />
        {p.user ? (
          <span className="text-xs text-muted">
            Your pace: {walkingSpeed(p.user.profile).toFixed(2)} m/s
          </span>
        ) : (
          <button type="button" onClick={p.onSignIn} className="text-xs font-semibold text-accent hover:underline">
            Sign in for personal walk times
          </button>
        )}
      </div>

      {p.error && <Notice tone="error">{p.error}</Notice>}

      {!p.destination && !p.error && <p className="m-0 text-sm text-muted">Search an address or tap a house or business on the map to choose an arrival point.</p>}

      {!p.destination && !p.error && (
        <div>
          <p className="mb-2 mt-0 text-sm font-semibold text-muted">Try</p>
          <div className="flex flex-wrap gap-2">
            {QUICK_PICKS.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => {
                  setText(q)
                  p.onSearch(q)
                }}
                className="h-10 rounded-full border border-line bg-raised px-3.5 font-semibold hover:border-accent"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {p.destination && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-base font-bold">{p.destination.building.name}</span>
          {p.destination.room && (
            <span className="rounded-full bg-accent/15 px-2.5 py-0.5 text-xs font-bold text-accent">Rm {p.destination.room}</span>
          )}
        </div>
      )}

      {walking && p.destination && p.walkStart && (
        <p className="m-0 text-xs text-muted">
          {p.walkStart.fromGps ? 'Walking from your location' : `You're off campus, so the walk starts at ${p.walkStart.label}`}
        </p>
      )}

      {p.destination && p.planning && !p.error && <Notice>Calculating walking routes…</Notice>}

      {walking ? (
        p.destination && (
          <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
            {p.doors.map((d, i) => (
              <DoorCard
                key={d.entrance.id}
                option={d}
                rank={i}
                selected={d.entrance.id === p.selectedDoorId}
                onSelect={() => p.onSelectDoor(d.entrance.id)}
              />
            ))}
          </ol>
        )
      ) : confirmed ? (
        <Confirmed option={confirmed} kind={kind} user={p.user} drive={p.drive} onChange={() => p.onConfirm(undefined)} onFeedback={p.onFeedback} thanked={p.feedbackSent ?? false} />
      ) : (
        p.destination &&
        (p.options.length === 0 ? (
          !p.error && !p.planning && <Notice>{`No matching ${verb} routes are available. Try another entrance preference or destination.`}</Notice>
        ) : (
          <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
            {p.options.map((o, i) => (
              <OptionCard
                key={o.zone.id}
                option={o}
                rank={i}
                selected={o.zone.id === p.selectedZoneId}
                verb={verb}
                drive={o.zone.id === p.selectedZoneId ? p.drive : undefined}
                onSelect={() => p.onSelect(o.zone.id)}
                onConfirm={() => p.onConfirm(o.zone.id)}
              />
            ))}
          </ol>
        ))
      )}
    </>
  )
}

function DoorCard({
  option,
  rank,
  selected,
  onSelect,
}: {
  option: DoorOption
  rank: number
  selected: boolean
  onSelect: () => void
}) {
  const { entrance } = option
  const { lat, lng } = entrance.location
  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={selected}
        onClick={onSelect}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect()}
        className={cx(
          'rounded-2xl border bg-raised px-4 py-3.5 transition-colors',
          selected ? 'cursor-default border-selected bg-gradient-to-b from-selected/10 to-transparent' : 'cursor-pointer border-line hover:border-high',
        )}
      >
        <div className="flex items-center justify-between text-xs font-bold">
          <span className={selected ? 'text-selected' : 'text-muted'}>{rank === 0 ? 'Best' : `Option ${rank + 1}`}</span>
          <span>{formatWalk(option.walkSeconds)}</span>
        </div>
        <h3 className="mb-0 mt-1.5 text-base font-bold tracking-tight">
          {entrance.accessible ? '♿ ' : '🚪 '}
          {entrance.label}
        </h3>
        <p className="m-0 mt-2 text-sm">{option.reason}</p>
        {option.warnings.length > 0 && (
          <ul className="m-0 mt-2.5 flex list-none flex-wrap gap-1.5 p-0">
            {option.warnings.map((w) => (
              <li key={w} className="rounded-full bg-selected/15 px-2.5 py-0.5 text-xs font-bold text-selected">
                {w}
              </li>
            ))}
          </ul>
        )}
        {selected && (
          <div className="mt-3.5 flex flex-col gap-2.5" onClick={(e) => e.stopPropagation()}>
            <StreetViewPreview target={entrance.location} />
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-11 items-center justify-center rounded-full bg-accent font-bold text-accent-ink hover:brightness-110"
            >
              Start walking
            </a>
          </div>
        )}
      </div>
    </li>
  )
}

function OptionCard({
  option,
  rank,
  selected,
  verb,
  drive,
  onSelect,
  onConfirm,
}: {
  option: StopOption
  rank: number
  selected: boolean
  verb: string
  drive?: Props['drive']
  onSelect: () => void
  onConfirm: () => void
}) {
  const { zone } = option
  const personal = zone.source === 'personal'
  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={selected}
        onClick={onSelect}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect()}
        className={cx(
          'rounded-2xl border bg-raised px-4 py-3.5 transition-colors',
          selected ? 'cursor-default border-selected bg-gradient-to-b from-selected/10 to-transparent' : 'cursor-pointer border-line hover:border-high',
        )}
      >
        <div className="flex items-center justify-between text-xs font-bold">
          <span className={selected ? 'text-selected' : 'text-muted'}>
            {rank === 0 ? 'Best' : `Option ${rank + 1}`}
            {personal && <span className="ml-2 rounded-full bg-personal/15 px-2 py-0.5 text-personal">Mine</span>}
          </span>
          <span>{formatWalk(option.walkSeconds)}</span>
        </div>
        <h3 className="mb-0 mt-1.5 text-base font-bold tracking-tight">{zone.name}</h3>
        <p className="m-0 mt-0.5 text-sm text-muted">→ {option.entrance.label}</p>
        <p className="m-0 mt-2 text-sm">{option.reason}</p>
        {drive && (
          <p className="m-0 mt-2 text-sm font-semibold text-accent">
            🚗 {formatDrive(drive.seconds)} {drive.fromGps ? 'from you' : 'from the SW 8th St entrance'}
          </p>
        )}
        {option.warnings.length > 0 && (
          <ul className="m-0 mt-2.5 flex list-none flex-wrap gap-1.5 p-0">
            {option.warnings.map((w) => (
              <li key={w} className="rounded-full bg-selected/15 px-2.5 py-0.5 text-xs font-bold text-selected">
                {w}
              </li>
            ))}
          </ul>
        )}
        {selected && (
          <div className="mt-3.5 flex flex-col gap-2.5" onClick={(e) => e.stopPropagation()}>
            <StreetViewPreview target={zone.stopPoint} />
            <Button variant="primary" onClick={onConfirm}>
              Set {verb} here
            </Button>
          </div>
        )}
      </div>
    </li>
  )
}

function Confirmed({
  option,
  kind,
  user,
  drive,
  onChange,
  onFeedback,
  thanked,
}: {
  option: StopOption
  kind: TripKind
  user?: User
  drive?: Props['drive']
  onChange: () => void
  thanked: boolean
  onFeedback: (f: 'faster' | 'right' | 'slower') => Promise<void>
}) {
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string>()
  const { zone } = option
  const coords = `${zone.stopPoint.lat.toFixed(6)}, ${zone.stopPoint.lng.toFixed(6)}`

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-accent/40 bg-accent/10 p-4">
      <p className="m-0 text-xs font-bold text-accent">{kind === 'dropoff' ? 'Drop-off set' : 'Pickup set'}</p>
      <h3 className="m-0 text-lg font-extrabold tracking-tight">
        Your car will {kind === 'dropoff' ? 'stop' : 'meet you'} at the {zone.name.toLowerCase()} by {option.entrance.label}
      </h3>
      <p className="m-0 text-sm">
        {drive && `🚗 ${formatDrive(drive.seconds)} · `}🚶 {formatWalk(option.walkSeconds)} {kind === 'dropoff' ? 'to the door' : 'from the door'}
      </p>
      <p className="m-0 font-mono text-xs text-muted">{coords}</p>
      <div className="flex gap-2">
        <Button className="flex-1" onClick={onChange}>
          Change
        </Button>
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${zone.stopPoint.lat},${zone.stopPoint.lng}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-11 flex-1 items-center justify-center rounded-full border border-line bg-high font-bold hover:border-accent"
        >
          Open in Maps
        </a>
      </div>
      {option.warnings.length > 0 && <Notice>{option.warnings.join(" ")}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      {user && (
        <div className="border-t border-line pt-3">
          {thanked ? (
            <p className="m-0 text-sm text-muted">Thanks! Future walk times are adjusted to your pace.</p>
          ) : (
            <>
              <p className="m-0 mb-2 text-sm font-semibold">Arrived? How did the walk compare?</p>
              <div className="flex gap-2">
                {(
                  [
                    ['faster', 'Faster'],
                    ['right', 'About right'],
                    ['slower', 'Slower'],
                  ] as const
                ).map(([f, label]) => (
                  <Button
                    key={f}
                    className="h-9 flex-1 text-sm"
                    disabled={sending}
                    onClick={async () => {
                      setSending(true)
                      try { await onFeedback(f); setError(undefined) }
                      catch (e) { setError((e as Error).message) }
                      finally { setSending(false) }
                    }}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
