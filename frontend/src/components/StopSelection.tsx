import { useId, type ReactNode } from 'react'
import { formatWalk } from '../geo'
import type { LatLng, TripKind } from '../types'
import { StreetViewPreview } from './StreetViewPreview'
import { Button, Notice } from './ui'
import { cx } from './cx'

export type StopChoice = {
  name: string
  stopPoint: LatLng
  walkSeconds: number
  destinationLabel: string
  reason?: string
  instructions?: string
  badge?: string
  personal?: boolean
  warnings: string[]
  drive?: { seconds: number; fromGps?: boolean; from?: string }
}
const formatDrive = (seconds: number) => `${Math.max(1, Math.round(seconds / 60))} min drive`

export function StopOptionCard({ option, rank, selected, kind, onSelect, onConfirm, onPropose, summary, children, disabled = false }: {
  summary?: ReactNode; children?: ReactNode;
  option: StopChoice; rank: number; selected: boolean; kind: TripKind;
  onSelect: () => void; onConfirm: () => void; onPropose?: () => void; disabled?: boolean;
}) {
  const detailsId = useId()
  return <li className={cx('overflow-hidden rounded-2xl border bg-raised transition-colors',
    selected ? 'border-selected bg-gradient-to-b from-selected/10 to-transparent' : 'border-line hover:border-high')}>
    <button type="button" aria-expanded={selected} aria-controls={selected ? detailsId : undefined} onClick={onSelect}
      className="block w-full px-4 py-3.5 text-left focus-visible:outline-2 focus-visible:outline-accent">
      <span className="flex items-start justify-between gap-3 text-xs font-bold">
        <span className={selected ? 'text-selected' : 'text-muted'}>{rank < 0 ? 'Your pin' : rank === 0 ? 'Best' : `Option ${rank + 1}`}</span>
        <span className="shrink-0">{formatWalk(option.walkSeconds)}</span>
      </span>
      <span className="mt-1.5 block text-base font-bold tracking-tight">{option.name}</span>
      {option.badge && <span className={cx('mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-bold',
        option.personal ? 'bg-personal/15 text-personal' : 'bg-accent/15 text-accent')}>{option.badge}</span>}
      <span className="mt-1 block text-sm text-muted">{kind === 'pickup' ? '← From' : '→ To'} {option.destinationLabel}</span>
      {option.reason && <span className="mt-2 block text-sm">{option.reason}</span>}
      {option.drive && <span className="mt-2 block text-sm font-semibold text-accent">🚗 {formatDrive(option.drive.seconds)} from {option.drive.from ?? (option.drive.fromGps ? 'you' : 'the SW 8th St entrance')}</span>}
    </button>
    {summary && <div className="px-4 pb-2">{summary}</div>}
    {selected && <div id={detailsId} className="flex flex-col gap-3 px-4 pb-3.5">
      {option.instructions && <p className="m-0 text-sm text-muted">{option.instructions}</p>}
      {!!option.warnings.length && <Notice>{option.warnings.join(' ')}</Notice>}
      {children}
      <StreetViewPreview target={option.stopPoint} />
      <Button variant="primary" disabled={disabled} onClick={onConfirm}>Set {kind === 'pickup' ? 'pickup' : 'drop-off'} here</Button>
      {onPropose && <Button disabled={disabled} onClick={onPropose}>Propose as public zone</Button>}
    </div>}
  </li>
}

export function StopConfirmation({ option, kind, onChange, children }: {
  option: StopChoice; kind: TripKind; onChange: () => void; children?: ReactNode;
}) {
  return <section className="flex flex-col gap-3 rounded-2xl border border-accent/40 bg-accent/10 p-4">
    <p className="m-0 text-xs font-bold text-accent">{kind === 'pickup' ? 'Pickup set' : 'Drop-off set'}</p>
    <h2 className="m-0 text-lg font-extrabold tracking-tight">{option.name}</h2>
    {option.badge && <p className="m-0 text-xs font-semibold text-muted">{option.badge}</p>}
    <p className="m-0 text-sm">{option.drive && `🚗 ${formatDrive(option.drive.seconds)} · `}🚶 {formatWalk(option.walkSeconds)} {kind === 'pickup' ? 'from' : 'to'} {option.destinationLabel}</p>
    {option.instructions && <p className="m-0 text-sm">{option.instructions}</p>}
    <p className="m-0 font-mono text-xs text-muted">{option.stopPoint.lat.toFixed(6)}, {option.stopPoint.lng.toFixed(6)}</p>
    <div className="flex flex-wrap gap-2">
      <Button className="flex-1" onClick={onChange}>Change stop</Button>
      <a href={`https://www.google.com/maps/dir/?api=1&destination=${option.stopPoint.lat},${option.stopPoint.lng}&travelmode=driving`}
        target="_blank" rel="noreferrer" className="inline-flex min-h-11 flex-1 items-center justify-center rounded-full border border-line bg-high px-4 text-center font-bold hover:border-accent">Navigate in Maps</a>
    </div>
    {!!option.warnings.length && <Notice>{option.warnings.join(' ')}</Notice>}
    {children}
  </section>
}
