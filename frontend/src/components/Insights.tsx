import { useEffect, useState, type ReactNode } from 'react'
import type { TripParse } from '../api'
import { formatWalk } from '../geo'
import { useCurbCheck, type Slope, type Weather } from '../state/insights'
import type { LatLng } from '../types'
import { cx } from './cx'
import { AlertIcon, CheckIcon, RainIcon, SlopeIcon, SparkleIcon, SunIcon } from './icons'

function Chip({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <li
      className={cx(
        'flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold',
        ok ? 'bg-accent/15 text-accent' : 'bg-selected/15 text-selected',
      )}
    >
      {ok ? <CheckIcon size={13} strokeWidth={2.6} /> : <AlertIcon size={13} strokeWidth={2.2} />}
      {children}
    </li>
  )
}

/** Gemini's read of the Street View photos at a stop: curb cut, fire lane, bus stop, steps. */
export function CurbCheck({ stop, door }: { stop: LatLng; door?: LatLng }) {
  const { audit, error, loading } = useCurbCheck(stop, door)
  if (error) return <p className="m-0 text-xs text-muted">AI curb check unavailable: {error}</p>
  return (
    <section aria-live="polite" className="flex flex-col gap-2 rounded-xl border border-line bg-raised p-3">
      <header className="flex items-center justify-between gap-2 text-xs font-bold">
        <span className="flex items-center gap-1.5 text-accent">
          <SparkleIcon size={15} className={loading ? 'motion-safe:animate-pulse' : undefined} />
          {loading ? 'Gemini is checking this curb in Street View…' : 'AI curb check'}
        </span>
        {audit && (
          <span className={audit.safeToStop >= 7 ? 'text-accent' : 'text-selected'}>
            {audit.visible ? `Safe to stop ${audit.safeToStop}/10` : 'Curb not visible'}
          </span>
        )}
      </header>
      {audit && (
        <>
          {audit.visible && (
            <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
              <Chip ok={audit.curbCut}>{audit.curbCut ? 'Curb cut' : 'No curb cut seen'}</Chip>
              <Chip ok={!audit.fireLane}>{audit.fireLane ? 'Fire lane / hydrant' : 'No fire lane'}</Chip>
              <Chip ok={!audit.busStop}>{audit.busStop ? 'Bus stop' : 'No bus stop'}</Chip>
              {audit.noStopping && <Chip ok={false}>No-stopping zone</Chip>}
              <Chip ok={!audit.stairs}>{audit.stairs ? 'Steps to the door' : 'Level to the door'}</Chip>
              {audit.obstacles.map((o) => (
                <Chip key={o} ok={false}>
                  {o}
                </Chip>
              ))}
            </ul>
          )}
          <p className="m-0 text-sm">{audit.notes}</p>
          <p className="m-0 text-[11px] text-muted">
            Gemini · Google Street View{audit.imageDate ? ` (${audit.imageDate})` : ''} · AI can miss things; follow signs on site
          </p>
        </>
      )}
    </section>
  )
}

/** "Saves 3 min vs. the address pin". */
export function SavedBadge({ seconds }: { seconds?: number }) {
  if (seconds === undefined || seconds < 20) return null
  const text = seconds < 60 ? `${Math.round(seconds / 5) * 5} s` : `${Math.round(seconds / 60)} min`
  return (
    <p className="m-0 mt-2 inline-flex items-center gap-1.5 rounded-full bg-accent/15 px-2.5 py-0.5 text-xs font-bold text-accent">
      <CheckIcon size={13} strokeWidth={2.6} /> Saves {text} of walking vs. the address pin
    </p>
  )
}

/** Slope along the walk, for step-free riders. */
export function SlopeBadge({ slope }: { slope?: Slope }) {
  if (!slope) return null
  const pct = (slope.maxGrade * 100).toFixed(1)
  const steep = slope.maxGrade > 0.05
  return (
    <p className={cx('m-0 flex items-center gap-1.5 text-xs font-semibold', steep ? 'text-selected' : 'text-accent')}>
      <SlopeIcon size={16} />
      {steep ? `Steep stretch: up to ${pct}% grade on this walk` : `Gentle walk: max ${pct}% grade (under the 5% ADA limit)`}
    </p>
  )
}

/** Shown when rain or heat changes the ranking. */
export function WeatherNotice({ weather, walkSeconds }: { weather?: Weather; walkSeconds?: number }) {
  if (!weather || weather.kind === 'clear') return null
  const Icon = weather.kind === 'rain' ? RainIcon : SunIcon
  return (
    <div className="flex items-start gap-2.5 rounded-2xl border border-[#4c8dff]/40 bg-[#4c8dff]/10 px-3.5 py-2.5 text-sm">
      <Icon size={20} className="mt-px shrink-0 text-[#4c8dff]" />
      <p className="m-0">
        <span className="font-bold">{weather.label}{weather.demo ? ' (demo)' : ''}.</span>{' '}
        Ranked by the shortest walk outside{walkSeconds !== undefined ? `: ${formatWalk(walkSeconds)} to the door` : ''}.
      </p>
    </div>
  )
}

function clock12(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number)
  return new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/** What Gemini understood from a plain-English request, as editable-looking chips. */
export function TripChips({ parse, building, door }: { parse: TripParse; building?: string; door?: string }) {
  const chips = [
    building,
    parse.room && `Rm ${parse.room}`,
    door,
    parse.mode && { dropoff: 'Drop-off', pickup: 'Pickup', walk: 'Walking' }[parse.mode],
    parse.arriveBy && `Arrive by ${clock12(parse.arriveBy)}`,
    parse.stepFree && 'Step-free',
    parse.mobility && parse.mobility !== 'none' && parse.mobility[0].toUpperCase() + parse.mobility.slice(1),
  ].filter(Boolean) as string[]
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-accent/30 bg-accent/5 p-3">
      <p className="m-0 flex items-center gap-1.5 text-xs font-bold text-accent">
        <SparkleIcon size={15} /> Understood by Gemini
      </p>
      <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
        {chips.map((c) => (
          <li key={c} className="rounded-full border border-line bg-surface px-2.5 py-1 text-xs font-bold">
            {c}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Countdown to the requested arrival time: when the car should leave. */
export function ArriveBy({ hhmm, driveSeconds, walkSeconds }: { hhmm: string; driveSeconds?: number; walkSeconds: number }) {
  const now = useNow()
  const [h, m] = hhmm.split(':').map(Number)
  const target = new Date(now)
  target.setHours(h, m, 0, 0)
  if (target.getTime() < now - 60 * 60_000) target.setDate(target.getDate() + 1)
  const tripMs = ((driveSeconds ?? 0) + walkSeconds + 120) * 1000 // plus 2 min to get in and out
  const leaveAt = new Date(target.getTime() - tripMs)
  const late = leaveAt.getTime() < now
  const fmt = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return (
    <p className={cx('m-0 text-sm font-semibold', late ? 'text-selected' : 'text-accent')}>
      {late
        ? `Leave now: you'll reach the door about ${fmt(new Date(now + tripMs))} (asked for ${fmt(target)})`
        : `Leave by ${fmt(leaveAt)} to be at the door by ${fmt(target)}`}
    </p>
  )
}

/** The current time, refreshed every 30 seconds. */
function useNow() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])
  return now
}
