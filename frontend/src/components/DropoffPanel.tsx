import { useState, type FormEvent } from 'react'
import { DestinationControls } from './DestinationControls'
import { StopOptionCard, StopConfirmation, type StopChoice } from './StopSelection'
import { formatWalk } from '../geo'
import type { Destination } from '../search'
import type { DoorOption, Place, StopOption, TravelMode, TripKind, User } from '../types'
import { StreetViewPreview } from './StreetViewPreview'
import { cx } from './cx'
import { DoorIcon, LocateIcon, PencilIcon, SparkleIcon, WheelchairIcon } from './icons'
import { ArriveBy, CurbCheck, SavedBadge, SlopeBadge, TripChips, WeatherNotice } from './Insights'
import { Button, Notice } from './ui'
import type { TripParse } from '../api'
import type { Slope, Weather } from '../state/insights'

const QUICK_PICKS = ['GC 150', 'Green Library 420', 'CASE 241', 'PC 110']
const AI_EXAMPLE = "Drop me at Graham Center by the food court at 9, I'm on crutches"

type Props = {
  onPropose: (zone: StopOption["zone"]) => void
  user?: User
  destination?: Destination
  mode: TravelMode
  onMode: (m: TravelMode) => void
  /** Walk mode: ranked doors, and where the walk starts. */
  doors: DoorOption[]
  selectedDoorId?: string
  onSelectDoor: (entranceId: string) => void
  walkStart?: { fromGps: boolean; label: string }
  /** Start in-app navigation: walk to a door (walk mode) or the confirmed car trip. */
  onStartWalk: (entranceId: string) => void
  onStartTrip: () => void
  /** A typed starting address (any address); trips then start there. */
  start?: Place
  onStart: (address: string) => Promise<void>
  onClearStart: () => void
  stepFree: boolean
  onStepFree: (v: boolean) => void
  options: StopOption[]
  selectedZoneId?: string
  onSelect: (zoneId: string) => void
  confirmedZoneId?: string
  onConfirm: (zoneId?: string) => void
  searchText: string
  onSearchTextChange: (text: string) => void
  onSearch: (text: string) => void
  onClear: () => void
  onSignIn: () => void
  onFeedback: (f: 'faster' | 'right' | 'slower') => Promise<void>
  error?: string
  /** Drive to the selected curb, and where it starts ("you", a typed address, or the campus gate). */
  drive?: { seconds: number; from: string }
  planning?: boolean
  feedbackSent?: boolean
  /** Your GPS-measured walking pace this trip (walking stretches only), and the answer it points to. */
  measuredWalk?: { speed: number; suggestion: 'faster' | 'right' | 'slower' }
  /** Start coloring in your own drop-off/pickup spot for the destination. */
  onMarkZone: () => void
  /** Walking saved per zone id, vs. where ride apps stop for the address pin. */
  saved?: Map<string, number>
  weather?: Weather
  /** Slope along the selected walk (shown to step-free riders). */
  slope?: Slope
  /** A plain-English request Gemini turned into these settings. */
  ai?: { parse: TripParse; building?: string; door?: string }
  aiBusy?: boolean
}

/** The "My car → Targeted drop-off" screen, plus walk mode for arriving on foot. */
export function DropoffPanel(p: Props) {
  const walking = p.mode === 'walk'
  const kind: TripKind = p.mode === 'pickup' ? 'pickup' : 'dropoff'
  const verb = kind === 'dropoff' ? 'drop-off' : 'pickup'
  const confirmed = walking ? undefined : p.options.find((o) => o.zone.id === p.confirmedZoneId)

  return (
    <>
      <DestinationControls
        user={p.user} mode={p.mode} onMode={p.onMode} allowWalking
        searchText={p.searchText} onSearchTextChange={p.onSearchTextChange} onSearch={p.onSearch} onClear={p.onClear}
        stepFree={p.stepFree} onStepFree={p.onStepFree} onSignIn={p.onSignIn}
        destinationName={p.destination?.building.name} room={p.destination?.room}
      />

      <StartField start={p.start} onStart={p.onStart} onClear={p.onClearStart} />
      {p.aiBusy && (
        <p className="m-0 flex items-center gap-1.5 text-sm font-semibold text-accent">
          <SparkleIcon size={16} className="motion-safe:animate-pulse" /> Gemini is reading your request…
        </p>
      )}
      {p.ai && !p.aiBusy && <TripChips parse={p.ai.parse} building={p.ai.building} door={p.ai.door} />}

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
                  p.onSearchTextChange(q)
                  p.onSearch(q)
                }}
                className="h-10 rounded-full border border-line bg-raised px-3.5 font-semibold hover:border-accent"
              >
                {q}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                p.onSearchTextChange(AI_EXAMPLE)
                p.onSearch(AI_EXAMPLE)
              }}
              className="flex min-h-10 items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-3.5 py-1.5 text-left text-sm font-semibold text-accent hover:border-accent"
            >
              <SparkleIcon size={16} className="shrink-0" /> “{AI_EXAMPLE}”
            </button>
          </div>
        </div>
      )}

      {p.destination && !walking && (
        <Button className="h-10 self-start text-sm" onClick={p.onMarkZone}>
          <PencilIcon size={16} />
          Mark my {verb} spot
        </Button>
      )}

      {walking && p.destination && p.walkStart && (
        <p className="m-0 text-xs text-muted">
          {p.start
            ? `Walking from ${p.start.label}`
            : p.walkStart.fromGps
              ? 'Walking from your location'
              : `You're off campus, so the walk starts at ${p.walkStart.label}`}
        </p>
      )}

      {p.destination && p.planning && !p.error && <Notice>{walking ? 'Calculating walking routes…' : 'Finding pickup and drop-off options…'}</Notice>}

      {p.destination && !p.planning && (
        <WeatherNotice weather={p.weather} walkSeconds={(walking ? p.doors[0] : p.options[0])?.walkSeconds} />
      )}

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
                onStart={() => p.onStartWalk(d.entrance.id)}
                slope={d.entrance.id === p.selectedDoorId && p.stepFree ? p.slope : undefined}
              />
            ))}
          </ol>
        )
      ) : confirmed ? (
        <Confirmed
          option={confirmed}
          kind={kind}
          user={p.user}
          drive={p.drive}
          onChange={() => p.onConfirm(undefined)}
          onStart={p.onStartTrip}
          onFeedback={p.onFeedback}
          thanked={p.feedbackSent ?? false}
          measured={p.measuredWalk}
          arriveBy={p.ai?.parse.arriveBy ?? undefined}
          slope={p.stepFree ? p.slope : undefined}
        />
      ) : (
        p.destination &&
        (p.options.length === 0 ? (
          !p.error && !p.planning && <Notice>{`No matching ${verb} routes are available. Try changing your preferences or choosing another destination.`}</Notice>
        ) : (
          <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
            {p.options.map((o, i) => (
              <StopOptionCard
                key={o.zone.id}
                option={stopChoice(o, o.zone.id === p.selectedZoneId ? p.drive : undefined)}
                rank={i}
                selected={o.zone.id === p.selectedZoneId}
                kind={kind}
                onSelect={() => p.onSelect(o.zone.id)}
                onConfirm={() => p.onConfirm(o.zone.id)}
                onPropose={o.zone.source === 'generated' ? () => p.onPropose(o.zone) : undefined}
                summary={<SavedBadge seconds={p.saved?.get(o.zone.id)} />}
              >
                {p.ai?.parse.arriveBy && <ArriveBy hhmm={p.ai.parse.arriveBy} driveSeconds={p.drive?.seconds} walkSeconds={o.walkSeconds} />}
                <CurbCheck stop={o.zone.stopPoint} door={o.entrance.location} />
                <SlopeBadge slope={p.stepFree ? p.slope : undefined} />
              </StopOptionCard>
            ))}
          </ol>
        ))
      )}
      {confirmed?.zone.source === 'generated' && <Button onClick={() => p.onPropose(confirmed.zone)}>Propose as public zone</Button>}
    </>
  )
}

/** "From" field: type any address to start the trip there. Empty = your GPS (or the campus gate). */
function StartField({ start, onStart, onClear }: { start?: Place; onStart: (address: string) => Promise<void>; onClear: () => void }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  if (start) {
    return (
      <div className="flex h-13 items-center gap-2 rounded-full border border-line bg-raised pl-4 pr-1.5">
        <span className="text-xs font-bold text-muted">From</span>
        <span className="min-w-0 flex-1 truncate font-medium" title={start.label}>
          {start.label}
        </span>
        <button
          type="button"
          aria-label="Clear starting address"
          onClick={() => {
            setText('')
            onClear()
          }}
          className="size-8 rounded-full text-xl text-muted hover:text-fg"
        >
          ×
        </button>
      </div>
    )
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!text.trim()) return
    setBusy(true)
    setError(undefined)
    try {
      await onStart(text.trim())
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <form onSubmit={submit} className="flex h-13 items-center gap-1.5 rounded-full border border-line bg-raised pl-4 pr-1.5 focus-within:border-accent">
        <span className="text-xs font-bold text-muted">From</span>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Any address, e.g. Dolphin Mall"
          aria-label="Starting address"
          enterKeyHint="go"
          autoComplete="street-address"
          className="h-full min-w-0 flex-1 bg-transparent font-medium placeholder:text-muted focus:outline-none"
        />
        <button
          type="submit"
          disabled={!text.trim() || busy}
          aria-label="Start from this address"
          className="grid size-11 place-items-center rounded-full bg-accent text-lg font-black text-accent-ink disabled:bg-high disabled:text-muted"
        >
          {busy ? '…' : '→'}
        </button>
      </form>
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  )
}

function DoorCard({
  option,
  rank,
  selected,
  onSelect,
  onStart,
  slope,
}: {
  option: DoorOption
  rank: number
  selected: boolean
  onSelect: () => void
  onStart: () => void
  slope?: Slope
}) {
  const { entrance } = option
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
          selected ? 'cursor-default border-selected bg-selected/[0.06]' : 'cursor-pointer border-line hover:border-high',
        )}
      >
        <div className="flex items-center justify-between text-xs font-bold">
          <span className={selected ? 'text-selected' : 'text-muted'}>{rank === 0 ? 'Best' : `Option ${rank + 1}`}</span>
          <span>{formatWalk(option.walkSeconds)}</span>
        </div>
        <h3 className="mb-0 mt-1.5 text-base font-bold tracking-tight">
          {entrance.accessible ? (
            <WheelchairIcon size={18} className="mr-1.5 inline -translate-y-px text-accent" />
          ) : (
            <DoorIcon size={18} className="mr-1.5 inline -translate-y-px text-muted" />
          )}
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
            <SlopeBadge slope={slope} />
            <StreetViewPreview target={entrance.location} />
            <Button variant="primary" className="h-12" onClick={onStart}>
              Start walking
            </Button>
          </div>
        )}
      </div>
    </li>
  )
}

function stopChoice(option: StopOption, drive?: Props['drive']): StopChoice {
  const { zone } = option
  return { name: zone.name, stopPoint: zone.stopPoint, walkSeconds: option.walkSeconds,
    destinationLabel: option.entrance.label, reason: option.reason, instructions: zone.instructions,
    badge: zone.source === 'public' ? `${zone.publicStopStatus === 'VERIFIED' ? 'Verified' : 'Unverified'} public stop`
      : zone.source === 'personal' ? 'Saved stop' : zone.source === 'generated' ? 'Suggested stop' : 'Default zone',
    personal: zone.source === 'personal', warnings: option.warnings, drive: drive && { seconds: drive.seconds, from: drive.from } }
}

function Confirmed({
  option,
  kind,
  user,
  drive,
  onChange,
  onStart,
  onFeedback,
  thanked,
  measured,
  arriveBy,
  slope,
}: {
  arriveBy?: string
  slope?: Slope
  option: StopOption
  kind: TripKind
  user?: User
  drive?: Props['drive']
  onChange: () => void
  onStart: () => void
  thanked: boolean
  onFeedback: (f: 'faster' | 'right' | 'slower') => Promise<void>
  measured?: Props['measuredWalk']
}) {
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string>()

  return (
    <StopConfirmation option={stopChoice(option, drive)} kind={kind} onChange={onChange}>
      {arriveBy && <ArriveBy hhmm={arriveBy} driveSeconds={drive?.seconds} walkSeconds={option.walkSeconds} />}
      <SlopeBadge slope={slope} />
      <Button variant="primary" onClick={onStart}>{kind === 'dropoff' ? 'Start trip' : 'Walk to pickup'}</Button>
      {error && <Notice tone="error">{error}</Notice>}
      {user && (
        <div className="border-t border-line pt-3">
          {thanked ? (
            <p className="m-0 text-sm text-muted">Thanks! Future walk times are adjusted to your pace.</p>
          ) : (
            <>
              <p className="m-0 mb-2 text-sm font-semibold">Arrived? How did the walk compare?</p>
              {measured && (
                <p className="m-0 mb-2 text-xs text-muted">
                  <LocateIcon size={14} className="mr-1 inline -translate-y-px" />
                  Your GPS measured {measured.speed.toFixed(2)} m/s while walking (the ride doesn't count), so it looks{' '}
                  <b>{measured.suggestion === 'right' ? 'about right' : measured.suggestion}</b>. That's highlighted; pick
                  whatever matches.
                </p>
              )}
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
                    variant={measured?.suggestion === f ? 'primary' : 'ghost'}
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
    </StopConfirmation>
  )
}
