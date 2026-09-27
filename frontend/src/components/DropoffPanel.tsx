import { useState } from 'react'
import { formatWalk } from '../geo'
import type { Destination } from '../search'
import type { DoorOption, Place, StopOption, TravelMode, User } from '../types'
import { PIN_REACH_M, PIN_ZONE_ID } from '../dropPin'
import { walkingSpeed } from '../walking'
import { StreetViewPreview } from './StreetViewPreview'
import { cx } from './cx'
import { CarIcon, DoorIcon, LocateIcon, PencilIcon, SparkleIcon, WalkIcon, WheelchairIcon } from './icons'
import { ArriveBy, CurbCheck, SavedBadge, SlopeBadge, TripChips, WeatherNotice } from './Insights'
import { Button, Notice, Switch } from './ui'
import type { TripParse } from '../api'
import type { Slope, Weather } from '../state/insights'

const GENERATED_WARNING = 'This generated stop has not been checked for legal or safe stopping.'

type Props = {
  user?: User
  destination?: Destination
  mode: TravelMode
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
  stepFree: boolean
  onStepFree: (v: boolean) => void
  options: StopOption[]
  selectedZoneId?: string
  onSelect: (zoneId: string) => void
  confirmedZoneId?: string
  onConfirm: (zoneId?: string) => void
  onSignIn: () => void
  onFeedback: (f: 'faster' | 'right' | 'slower') => Promise<void>
  error?: string
  /** Drive to the selected curb, and where it starts ("you", a typed address, or the campus gate). */
  drive?: { seconds: number; from: string }
  planning?: boolean
  feedbackSent?: boolean
  /** Your GPS-measured walking pace this trip (walking stretches only), and the answer it points to. */
  measuredWalk?: { speed: number; suggestion: 'faster' | 'right' | 'slower' }
  /** Start coloring in your own drop-off spot for the destination. */
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

function formatDrive(seconds: number) {
  return `${Math.max(1, Math.round(seconds / 60))} min drive`
}

/** Results under the From/To form: the ranked drop-off spots, or the doors to walk to. */
export function DropoffPanel(p: Props) {
  const walking = p.mode === 'walk'
  const verb = 'drop-off'
  const confirmed = walking ? undefined : p.options.find((o) => o.zone.id === p.confirmedZoneId)

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Switch
          checked={p.stepFree}
          onChange={p.onStepFree}
          label={
            <span className="flex items-center gap-1.5">
              <WheelchairIcon size={18} className="text-accent" /> Step-free only
            </span>
          }
        />
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

      {p.aiBusy && (
        <p className="m-0 flex items-center gap-1.5 text-sm font-semibold text-accent">
          <SparkleIcon size={16} className="motion-safe:animate-pulse" /> Gemini is reading your request…
        </p>
      )}
      {p.ai && !p.aiBusy && <TripChips parse={p.ai.parse} building={p.ai.building} door={p.ai.door} />}

      {p.error && <Notice tone="error">{p.error}</Notice>}

      {p.destination && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-base font-bold">{p.destination.building.name}</span>
          {p.destination.room && (
            <span className="rounded-full bg-accent/15 px-2.5 py-0.5 text-xs font-bold text-accent">Rm {p.destination.room}</span>
          )}
        </div>
      )}

      {p.destination && !walking && !confirmed && p.options.length > 0 && (
        <p className="m-0 text-xs text-muted">
          Drag the car pin on the map to exactly where you want to be dropped off, anywhere within {PIN_REACH_M} m of the building.
          The route follows it.
        </p>
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

      {p.destination && p.planning && !p.error && <Notice>Calculating walking routes…</Notice>}

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
          !p.error && !p.planning && <Notice>{`No matching ${verb} routes are available. Try another entrance preference or destination.`}</Notice>
        ) : (
          <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
            {p.options.map((o, i) => (
              <OptionCard
                key={o.zone.id}
                option={o}
                rank={p.options[0]?.zone.id === PIN_ZONE_ID ? i - 1 : i}
                selected={o.zone.id === p.selectedZoneId}
                verb={verb}
                drive={o.zone.id === p.selectedZoneId ? p.drive : undefined}
                saved={p.saved?.get(o.zone.id)}
                slope={o.zone.id === p.selectedZoneId && p.stepFree ? p.slope : undefined}
                arriveBy={o.zone.id === p.selectedZoneId ? (p.ai?.parse.arriveBy ?? undefined) : undefined}
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

function OptionCard({
  option,
  rank,
  selected,
  verb,
  drive,
  saved,
  slope,
  arriveBy,
  onSelect,
  onConfirm,
}: {
  option: StopOption
  rank: number
  selected: boolean
  verb: string
  drive?: Props['drive']
  saved?: number
  slope?: Slope
  arriveBy?: string
  onSelect: () => void
  onConfirm: () => void
}) {
  const { zone } = option
  // Once selected, the AI curb check below replaces the generic "unchecked" warning.
  const warnings = selected ? option.warnings.filter((w) => w !== GENERATED_WARNING) : option.warnings
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
          selected ? 'cursor-default border-selected bg-selected/[0.06]' : 'cursor-pointer border-line hover:border-high',
        )}
      >
        <div className="flex items-center justify-between text-xs font-bold">
          <span className={selected ? 'text-selected' : 'text-muted'}>
            {rank < 0 ? 'Your pin' : rank === 0 ? 'Best' : `Option ${rank + 1}`}
            {personal && rank >= 0 && <span className="ml-2 rounded-full bg-personal/15 px-2 py-0.5 text-personal">Mine</span>}
          </span>
          <span>{formatWalk(option.walkSeconds)}</span>
        </div>
        <h3 className="mb-0 mt-1.5 text-base font-bold tracking-tight">{zone.name}</h3>
        <p className="m-0 mt-0.5 text-sm text-muted">→ {option.entrance.label}</p>
        <p className="m-0 mt-2 text-sm">{option.reason}</p>
        <SavedBadge seconds={saved} />
        {drive && (
          <p className="m-0 mt-2 text-sm font-semibold text-accent">
            <CarIcon size={16} className="mr-1.5 inline -translate-y-px" />
            {formatDrive(drive.seconds)} from {drive.from}
          </p>
        )}
        {warnings.length > 0 && (
          <ul className="m-0 mt-2.5 flex list-none flex-wrap gap-1.5 p-0">
            {warnings.map((w) => (
              <li key={w} className="rounded-full bg-selected/15 px-2.5 py-0.5 text-xs font-bold text-selected">
                {w}
              </li>
            ))}
          </ul>
        )}
        {selected && (
          <div className="mt-3.5 flex flex-col gap-2.5" onClick={(e) => e.stopPropagation()}>
            {arriveBy && <ArriveBy hhmm={arriveBy} driveSeconds={drive?.seconds} walkSeconds={option.walkSeconds} />}
            <CurbCheck stop={zone.stopPoint} door={option.entrance.location} />
            <SlopeBadge slope={slope} />
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
  const { zone } = option
  const coords = `${zone.stopPoint.lat.toFixed(6)}, ${zone.stopPoint.lng.toFixed(6)}`

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-accent/40 bg-accent/10 p-4">
      <p className="m-0 text-xs font-bold text-accent">Drop-off set</p>
      <h3 className="m-0 text-lg font-extrabold tracking-tight">
        Your car will stop at the {zone.name.toLowerCase()} by {option.entrance.label}
      </h3>
      <p className="m-0 text-sm">
        {drive && (
          <>
            <CarIcon size={16} className="mr-1 inline -translate-y-px text-accent" />
            {formatDrive(drive.seconds)} ·{' '}
          </>
        )}
        <WalkIcon size={16} className="mr-1 inline -translate-y-px text-accent" />
        {formatWalk(option.walkSeconds)} to the door
      </p>
      {arriveBy && <ArriveBy hhmm={arriveBy} driveSeconds={drive?.seconds} walkSeconds={option.walkSeconds} />}
      <SlopeBadge slope={slope} />
      <p className="m-0 font-mono text-xs text-muted">{coords}</p>
      <div className="flex gap-2">
        <Button className="flex-1" onClick={onChange}>
          Change
        </Button>
        <Button variant="primary" className="flex-[2]" onClick={onStart}>
          Start trip
        </Button>
      </div>
      {option.warnings.some((w) => w !== GENERATED_WARNING) && (
        <Notice>{option.warnings.filter((w) => w !== GENERATED_WARNING).join(' ')}</Notice>
      )}
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
    </div>
  )
}
