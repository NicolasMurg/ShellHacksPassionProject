import { useState } from 'react'
import * as api from '../api'
import type { User } from '../types'
import { StopOptionCard, StopConfirmation, type StopChoice } from './StopSelection'
import type { ArrivalState } from '../state/arrivals'
import { Button, Field, inputClass, Notice, Switch } from './ui'

export function ArrivalPanel({ destination, state, token, onSignIn, kind, stepFree, onStepFree, onPropose }: {
  onPropose: (input: api.PublicStopInput) => void;
  user?: User; destination: api.ArrivalDestination; state: ArrivalState; token?: string; onSignIn: () => void;
  kind: 'dropoff' | 'pickup'; stepFree: boolean; onStepFree: (v: boolean) => void
}) {
  const [name, setName] = useState<string>()
  const [instructions, setInstructions] = useState<string>()
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string>()
  const [error, setError] = useState<string>()
  const { option, data } = state
  const publicStop = !!destination.publicStopId
  const spotName = name ?? data?.savedStop?.name ?? ''
  const spotInstructions = instructions ?? data?.savedStop?.instructions ?? ''
  const mutate = async (action: () => Promise<unknown>, success: string) => {
    setSaving(true); setError(undefined); setMessage(undefined)
    try { await action(); setMessage(success); state.refresh() }
    catch (e) { setError((e as Error).message) }
    finally { setSaving(false) }
  }
  const propose = (value: NonNullable<ArrivalState['option']>) => onPropose({ name: value.name, instructions: value.instructions, location: value.stopPoint, kinds: [kind === 'pickup' ? 'PICKUP' : 'DROPOFF'], placeId: destination.placeId, origin: 'suggestion', suggestedZoneId: value.suggestedZoneId })
  const verb = kind === 'pickup' ? 'pickup' : 'drop-off'
  const choice = (value: NonNullable<ArrivalState['option']>): StopChoice => ({
    name: value.name, stopPoint: value.stopPoint, walkSeconds: value.walkSeconds, destinationLabel: destination.name,
    instructions: value.instructions, warnings: value.warnings,
    badge: value.source === 'public' ? `${value.publicStopStatus === 'VERIFIED' ? 'Verified' : 'Unverified'} public stop`
      : value.source === 'saved' ? 'Saved stop' : value.source === 'manual' ? 'Chosen stop' : 'Suggested stop',
    personal: value.source === 'saved', drive: value.drive && { seconds: value.drive.seconds, fromGps: true },
  })
  return <>
<Switch checked={stepFree} onChange={onStepFree} label="Prefer step-free access" />
    {state.loading && <Notice>Finding pickup and drop-off options…</Notice>}
    {(state.error || error) && <Notice tone="error">{state.error ?? error}</Notice>}
    {message && <Notice tone="success">{message}</Notice>}
    {data?.notices.map(n => <Notice key={n}>{n}</Notice>)}
    {state.started && !state.confirmed && !publicStop && <div className="flex flex-wrap gap-2">
      <Button onClick={state.moving ? state.cancelMove : state.move}>{state.moving ? 'Cancel moving' : 'Move pin'}</Button>
      <Button onClick={state.suggest} disabled={state.loading}>Refresh suggestions</Button>
    </div>}
    {state.moving && <Notice>Tap the map or drag the orange stop pin to choose a point within 100 m of the destination. We’ll check its route before you confirm.</Notice>}
    {option && state.confirmed ? <StopConfirmation option={choice(option)} kind={kind} onChange={state.change}>
      {option.source !== 'public' && <Button onClick={() => propose(option)}>Propose as public zone</Button>}
      {!publicStop && (token ? <>
        <Field label="Private spot name"><input className={inputClass} value={spotName} onChange={e => setName(e.target.value)} maxLength={100} placeholder="My driveway or front gate" /></Field>
        <Field label="Arrival instructions"><input className={inputClass} value={spotInstructions} onChange={e => setInstructions(e.target.value)} maxLength={500} placeholder="Enter from the side street" /></Field>
        <Button disabled={saving || !spotName.trim()} onClick={() => void mutate(() => api.saveStop(token, destination, option.stopPoint, spotName.trim(), spotInstructions.trim()), 'Saved privately to your account.')}>Save as my preferred spot</Button>
      </> : <Button onClick={onSignIn}>Sign in to save this spot privately</Button>)}
    </StopConfirmation> : data?.options.length ? (
      <ol className="m-0 flex list-none flex-col gap-2.5 p-0" aria-label="Pickup and drop-off options">
        {data.options.map((value, rank) => <StopOptionCard key={value.id} option={choice(value)} rank={rank}
          selected={value.id === option?.id} kind={kind} onSelect={() => state.select(value.id)}
          onConfirm={state.confirm} onPropose={value.source !== 'public' ? () => propose(value) : undefined} disabled={state.moving || state.loading} />)}
      </ol>
    ) : !state.loading && !state.error && <Notice>{`No matching ${verb} routes are available. Try changing your preferences or choosing another destination.`}</Notice>}
    {data?.savedStop && token && <Button disabled={saving} onClick={() => void mutate(() => api.deleteStop(token, data.savedStop!.id), 'Saved preference removed.')}>Forget “{data.savedStop.name}”</Button>}
    {!option && state.started && !state.loading && !publicStop && <Button onClick={state.move}>Choose a stop manually</Button>}
  </>
}
