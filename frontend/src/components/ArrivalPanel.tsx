import { useState } from 'react'
import * as api from '../api'
import { formatWalk } from '../geo'
import type { ArrivalState } from '../state/arrivals'
import { Button, Field, inputClass, Notice, Segmented, Switch } from './ui'
import { StreetViewPreview } from './StreetViewPreview'

export function ArrivalPanel({ destination, state, token, onSignIn, kind, onKind, stepFree, onStepFree }: {
  destination: api.ArrivalDestination; state: ArrivalState; token?: string; onSignIn: () => void;
  kind: 'dropoff' | 'pickup'; onKind: (kind: 'dropoff' | 'pickup') => void; stepFree: boolean; onStepFree: (v: boolean) => void
}) {
  const [name, setName] = useState<string>()
  const [instructions, setInstructions] = useState<string>()
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string>()
  const [error, setError] = useState<string>()
  const { option, data } = state
  const spotName = name ?? data?.savedStop?.name ?? ''
  const spotInstructions = instructions ?? data?.savedStop?.instructions ?? ''
  const mutate = async (action: () => Promise<unknown>, success: string) => {
    setSaving(true); setError(undefined); setMessage(undefined)
    try { await action(); setMessage(success); state.refresh() }
    catch (e) { setError((e as Error).message) }
    finally { setSaving(false) }
  }
  return <>
    <header><p className="m-0 text-xs font-semibold text-muted">Arrival point</p>
      <h1 className="m-0 text-xl font-extrabold">{destination.name}</h1></header>
    <Segmented label="Arrival type" value={kind} onChange={onKind} options={[{ value: 'dropoff', label: 'Drop-off' }, { value: 'pickup', label: 'Pickup' }]} />
    <Switch label="Prefer step-free access" checked={stepFree} onChange={onStepFree} />
    {!state.started && <>
      <Notice>Choose where the car should meet you. You can adjust the suggested pin and save a private preference.</Notice>
      <Button variant="primary" onClick={state.start}>{kind === 'dropoff' ? 'Drop off here' : 'Pick up here'}</Button>
    </>}
    {state.loading && <Notice>Checking arrival points and reported closures…</Notice>}
    {(state.error || error) && <Notice tone="error">{state.error ?? error}</Notice>}
    {message && <Notice tone="success">{message}</Notice>}
    {data?.notices.map(n => <Notice key={n}>{n}</Notice>)}
    {state.started && <div className="flex flex-wrap gap-2">
      <Button onClick={state.moving ? state.cancelMove : state.move}>{state.moving ? 'Cancel moving' : 'Move pin'}</Button>
      <Button onClick={state.suggest} disabled={state.loading}>Suggest stops again</Button>
    </div>}
    {state.moving && <Notice>Tap the map or drag the orange stop pin to choose a point within 500 m of the destination. We’ll check its route before you confirm.</Notice>}
    {!!data?.options.length && <div className="flex flex-wrap gap-2" aria-label="Arrival options">
      {data.options.map((o, i) => <Button key={o.id} aria-pressed={o.id === option?.id} onClick={() => state.select(o.id)}>
        {o.source === 'saved' ? 'Your saved spot' : `Option ${i + 1}`}
      </Button>)}
    </div>}
    {option && <section className="flex flex-col gap-3 rounded-2xl border border-selected bg-selected/10 p-4">
      <p className="m-0 text-xs font-bold text-selected">{state.confirmed ? `${kind === 'dropoff' ? 'Drop-off' : 'Pickup'} confirmed` : option.source === 'saved' ? 'Private saved preference · unverified' : 'Suggested stop · unverified'}</p>
      <h2 className="m-0 text-lg font-bold">{option.name}</h2>
      <p className="m-0 text-sm">{option.drive && `${Math.max(1, Math.round(option.drive.seconds / 60))} min drive · `}{formatWalk(option.walkSeconds)} {kind === 'pickup' ? 'from' : 'to'} the destination</p>
      {option.instructions && <p className="m-0 text-sm">{option.instructions}</p>}
      <p className="m-0 font-mono text-xs text-muted">{option.stopPoint.lat.toFixed(6)}, {option.stopPoint.lng.toFixed(6)}</p>
      <StreetViewPreview target={option.stopPoint} />
      {option.warnings.map(w => <Notice key={w}>{w}</Notice>)}
      {!state.moving && <Button variant="primary" onClick={state.confirmed ? state.change : state.confirm}>{state.confirmed ? 'Change stop' : 'Use this spot'}</Button>}
      {state.confirmed && <a className="text-center font-bold text-accent underline" target="_blank" rel="noreferrer"
        href={`https://www.google.com/maps/dir/?api=1&destination=${option.stopPoint.lat},${option.stopPoint.lng}&travelmode=driving`}>Navigate in Google Maps</a>}
      {state.confirmed && (token ? <>
        <Field label="Private spot name"><input className={inputClass} value={spotName} onChange={e => setName(e.target.value)} maxLength={100} placeholder="My driveway or front gate" /></Field>
        <Field label="Arrival instructions"><input className={inputClass} value={spotInstructions} onChange={e => setInstructions(e.target.value)} maxLength={500} placeholder="Enter from the side street" /></Field>
        <Button disabled={saving || !spotName.trim()} onClick={() => void mutate(() => api.saveStop(token, destination, option.stopPoint, spotName.trim(), spotInstructions.trim()), 'Saved privately to your account.')}>Save as my preferred spot</Button>
      </> : <Button onClick={onSignIn}>Sign in to save this spot privately</Button>)}
    </section>}
    {data?.savedStop && token && <Button disabled={saving} onClick={() => void mutate(() => api.deleteStop(token, data.savedStop!.id), 'Saved preference removed.')}>Forget “{data.savedStop.name}”</Button>}
    {!option && state.started && !state.loading && <Button onClick={state.move}>Choose a stop manually</Button>}
  </>
}
