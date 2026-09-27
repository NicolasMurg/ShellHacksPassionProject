import { useEffect, useRef } from 'react'
import { formatDistance } from '../geo'
import type { Navigation, NavLeg } from '../state/navigation'
import type { LatLng } from '../types'
import { cx } from './cx'
import { StreetViewPreview } from './StreetViewPreview'
import { Button, Switch } from './ui'

// Arrows for Google's maneuver ids.
const MANEUVER_ICON: Record<string, string> = {
  'turn-left': '↰',
  'turn-sharp-left': '↰',
  'turn-slight-left': '↖',
  'turn-right': '↱',
  'turn-sharp-right': '↱',
  'turn-slight-right': '↗',
  'keep-left': '↖',
  'keep-right': '↗',
  'fork-left': '↖',
  'fork-right': '↗',
  'ramp-left': '↖',
  'ramp-right': '↗',
  'uturn-left': '↶',
  'uturn-right': '↷',
  'roundabout-left': '⟲',
  'roundabout-right': '⟳',
  merge: '↗',
  straight: '↑',
}

function formatMinutes(seconds: number) {
  return seconds < 60 ? '<1 min' : `${Math.round(seconds / 60)} min`
}

function clock(secondsFromNow: number) {
  return new Date(Date.now() + secondsFromNow * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/** What the next instruction says: the upcoming turn, or arriving. */
function nextInstruction(nav: Navigation, leg: NavLeg) {
  if (nav.nextStep) {
    return {
      icon: MANEUVER_ICON[nav.nextStep.maneuver] ?? '↑',
      text: nav.nextStep.instruction,
      meters: nav.metersToManeuver,
    }
  }
  return { icon: '⚑', text: `Arrive at ${leg.toLabel}`, meters: nav.remainingMeters }
}

/** Big instruction banner along the top of the map. */
export function NavBanner({ nav, leg }: { nav?: Navigation; leg: NavLeg }) {
  if (!nav || nav.status !== 'active' || nav.arrived) return null
  const next = nextInstruction(nav, leg)
  return (
    <div className="absolute inset-x-3 top-[max(12px,env(safe-area-inset-top))] z-40 min-[900px]:left-[452px] min-[900px]:right-auto min-[900px]:w-[440px]">
      <div className="flex items-center gap-4 rounded-3xl border border-accent/30 bg-[#0d2b2a] px-4 py-3.5 shadow-[var(--shadow-float)]">
        <span aria-hidden className="grid size-14 shrink-0 place-items-center rounded-2xl bg-accent text-3xl font-black text-accent-ink">
          {next.icon}
        </span>
        <div className="min-w-0">
          <p className="m-0 text-2xl font-extrabold tabular-nums tracking-tight">{formatDistance(next.meters)}</p>
          <p className="m-0 line-clamp-2 text-sm font-semibold text-fg/90">{next.text}</p>
        </div>
      </div>
    </div>
  )
}

type PanelProps = {
  nav?: Navigation
  legs: NavLeg[]
  legIndex: number
  destinationLabel: string // "East entrance (ballrooms)"
  doorLocation?: LatLng
  simulate: boolean
  onSimulate: (v: boolean) => void
  voice: boolean
  onVoice: (v: boolean) => void
  following: boolean
  onRecenter: () => void
  onEnd: () => void
}

/** The trip panel while navigating: time left, progress, and controls. */
export function NavPanel(p: PanelProps) {
  const leg = p.legs[p.legIndex]
  const nav = p.nav
  const lastLeg = p.legIndex === p.legs.length - 1
  const done = nav?.arrived && lastLeg

  useSpokenDirections(p.voice, nav, leg, lastLeg)

  if (done) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <span aria-hidden className="grid size-12 place-items-center rounded-2xl bg-accent/15 text-2xl">
            ✓
          </span>
          <div>
            <p className="m-0 text-xs font-bold text-accent">You've arrived</p>
            <h1 className="m-0 text-xl font-extrabold tracking-tight">{p.destinationLabel}</h1>
          </div>
        </div>
        {p.doorLocation && <StreetViewPreview target={p.doorLocation} />}
        <Button variant="primary" className="h-12" onClick={p.onEnd}>
          Done
        </Button>
      </div>
    )
  }

  const title = leg.travel === 'DRIVING' ? `Riding to ${leg.toLabel.toLowerCase()}` : `Walking to ${leg.toLabel}`

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 text-xs font-semibold text-muted">{leg.travel === 'DRIVING' ? 'On the way' : 'On foot'}</p>
          <h1 className="m-0 truncate text-xl font-extrabold tracking-tight">{title}</h1>
        </div>
        <Button variant="danger" className="h-9 shrink-0 px-4 text-sm" onClick={p.onEnd}>
          End
        </Button>
      </header>

      {p.legs.length > 1 && (
        <ol className="m-0 flex list-none gap-2 p-0 text-xs font-bold">
          {p.legs.map((l, i) => (
            <li
              key={i}
              className={cx(
                'flex-1 rounded-full border px-3 py-1.5 text-center',
                i === p.legIndex ? 'border-accent/50 bg-accent/10 text-accent' : i < p.legIndex ? 'border-line text-muted line-through' : 'border-line text-muted',
              )}
            >
              {l.travel === 'DRIVING' ? '🚗' : '🚶'} {l.stage}
            </li>
          ))}
        </ol>
      )}

      {!nav || nav.status === 'routing' ? (
        <p className="m-0 text-sm text-muted">Finding the route…</p>
      ) : nav.status === 'error' ? (
        <p className="m-0 text-sm text-closed">Couldn't get a route: {nav.error}</p>
      ) : nav.arrived ? (
        <p className="m-0 rounded-2xl border border-accent/30 bg-accent/10 px-4 py-3 text-sm font-semibold text-accent">
          {leg.travel === 'DRIVING'
            ? `You've reached the curb. Now walking to ${p.legs[p.legIndex + 1]?.toLabel ?? 'the door'}…`
            : `You're at ${leg.toLabel}. Your car is on its way…`}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="Time left" value={formatMinutes(nav.remainingSeconds)} accent />
            <Stat label="Distance" value={formatDistance(nav.remainingMeters)} />
            <Stat label="Arrive" value={clock(nav.remainingSeconds)} />
          </div>
          <div aria-hidden className="h-1.5 overflow-hidden rounded-full bg-high">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-300"
              style={{ width: `${Math.round((nav.traveled / Math.max(1, nav.traveled + nav.remainingMeters)) * 100)}%` }}
            />
          </div>
          {nav.upcoming.length > 0 && (
            <section>
              <h2 className="m-0 mb-2 text-xs font-bold text-muted">Then</h2>
              <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
                {nav.upcoming.map((s) => (
                  <li key={s.startAlong} className="flex items-center gap-3 rounded-xl border border-line bg-raised px-3 py-2">
                    <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg bg-high text-lg font-black">
                      {MANEUVER_ICON[s.maneuver] ?? '↑'}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm">{s.instruction}</span>
                    <span className="shrink-0 text-xs font-semibold tabular-nums text-muted">{formatDistance(s.startAlong - nav.traveled)}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </>
      )}

      <div className="flex flex-wrap items-center justify-between gap-x-4">
        <Switch checked={p.voice} onChange={p.onVoice} label="🔊 Voice" />
        <Switch checked={p.simulate} onChange={p.onSimulate} label="▶ Simulate trip" />
      </div>
      {!p.following && (
        <Button className="h-10 text-sm" onClick={p.onRecenter}>
          ◎ Recenter
        </Button>
      )}
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-line bg-raised px-2 py-2.5">
      <p className={cx('m-0 text-lg font-extrabold tabular-nums tracking-tight', accent && 'text-accent')}>{value}</p>
      <p className="m-0 text-[11px] font-semibold text-muted">{label}</p>
    </div>
  )
}

function spokenDistance(meters: number) {
  return meters < 1000 ? `${Math.max(5, Math.round(meters / 5) * 5)} meters` : `${(meters / 1000).toFixed(1)} kilometers`
}

/** Reads each new instruction aloud with the browser's built-in voice. */
function useSpokenDirections(enabled: boolean, nav: Navigation | undefined, leg: NavLeg, lastLeg: boolean) {
  const lastSaid = useRef('')
  const message = !nav || nav.status !== 'active'
    ? ''
    : nav.arrived
      ? lastLeg
        ? `You've arrived at ${leg.toLabel}.`
        : leg.travel === 'DRIVING'
          ? 'You have reached the curb. Now walk to the door.'
          : `You're at ${leg.toLabel}. Your car is on its way.`
      : nav.nextStep
        ? `In ${spokenDistance(nav.metersToManeuver)}, ${nav.nextStep.instruction}`
        : `Continue to ${leg.toLabel}.`
  // Announce when the instruction changes, not every time the distance ticks down.
  const key = !nav || nav.status !== 'active' ? '' : nav.arrived ? `arrived|${leg.toLabel}` : `${nav.nextStep?.startAlong ?? 'end'}|${leg.toLabel}`

  useEffect(() => {
    if (!enabled || !key || key === lastSaid.current || !('speechSynthesis' in window)) return
    lastSaid.current = key
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(message))
  }, [enabled, key, message])

  useEffect(() => () => window.speechSynthesis?.cancel(), [])
}
