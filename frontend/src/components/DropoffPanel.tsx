import { useState } from 'react'
import { DestinationControls } from './DestinationControls'
import { StopOptionCard, StopConfirmation, type StopChoice } from './StopSelection'
import { formatWalk } from '../geo'
import type { Destination } from '../search'
import type { DoorOption, StopOption, TravelMode, TripKind, User } from '../types'
import { StreetViewPreview } from './StreetViewPreview'
import { cx } from './cx'
import { Button, Notice } from './ui'

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
  searchText: string
  onSearchTextChange: (text: string) => void
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
          </div>
        </div>
      )}

      {walking && p.destination && p.walkStart && (
        <p className="m-0 text-xs text-muted">
          {p.walkStart.fromGps ? 'Walking from your location' : `You're off campus, so the walk starts at ${p.walkStart.label}`}
        </p>
      )}

      {p.destination && p.planning && !p.error && <Notice>{walking ? 'Calculating walking routes…' : 'Finding pickup and drop-off options…'}</Notice>}

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

function stopChoice(option: StopOption, drive?: Props['drive']): StopChoice {
  const { zone } = option
  return { name: zone.name, stopPoint: zone.stopPoint, walkSeconds: option.walkSeconds,
    destinationLabel: option.entrance.label, reason: option.reason, instructions: zone.instructions,
    badge: zone.source === 'public' ? `${zone.publicStopStatus === 'VERIFIED' ? 'Verified' : 'Unverified'} public stop`
      : zone.source === 'personal' ? 'Saved stop' : zone.source === 'generated' ? 'Suggested stop' : 'Default zone',
    personal: zone.source === 'personal', warnings: option.warnings, drive }
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

  return (
    <StopConfirmation option={stopChoice(option, drive)} kind={kind} onChange={onChange}>
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
    </StopConfirmation>
  )
}
