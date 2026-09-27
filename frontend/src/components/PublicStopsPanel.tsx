import { useState, type FormEvent } from 'react'
import * as api from '../api'
import type { Building, LatLng, User } from '../types'
import type { usePublicStops } from '../state/publicStops'
import { distanceMeters } from '../geo'
import { Button, Field, inputClass, Notice, Switch } from './ui'

const labels = { UNVERIFIED: 'Unverified', VERIFIED: 'Verified', DISPUTED: 'Disputed', RETIRED: 'Retired' }
const accessLabels = { UNKNOWN: 'Not checked', PERMITTED: 'Public stopping permitted', RESTRICTED: 'Restricted' }
const accessibilityLabels = { UNKNOWN: 'Not checked', STEP_FREE: 'Step-free stop', NOT_STEP_FREE: 'Not step-free' }
type Props = {
  store: ReturnType<typeof usePublicStops>; user?: User; token?: string; selected?: api.PublicStop;
  boundary: LatLng[]; drawing: boolean; onDrawBoundary: () => void; onUndoBoundary: () => void;
  buildings: Building[]; proposal?: Partial<api.PublicStopInput>;
  draft?: LatLng; adding: boolean; onAdd: () => void; onSelect: (stop?: api.PublicStop) => void;
  onCancelAdd: () => void; onDone: () => void; onSignIn: () => void; onUse: (stop: api.PublicStop) => void;
}
export function PublicStopsPanel(p: Props) {
  return <>
    <header className="flex items-center justify-between gap-2">
      <h1 className="m-0 text-xl font-extrabold">Public zones</h1><Button onClick={p.onDone}>Done</Button>
    </header>
    <p className="m-0 text-sm text-muted">Shared pickup and drop-off locations for all destinations within a 500 m walk. New submissions appear in nearby route options labeled Unverified.</p>
    <div className="flex flex-wrap gap-2">
      <Button variant="primary" onClick={p.user ? p.onAdd : p.onSignIn}>+ Add public zone</Button>
      <Button onClick={p.store.refresh}>Refresh</Button>
      {p.selected && <Button onClick={() => p.onSelect()}>All stops</Button>}
    </div>
    {p.user?.role === 'ADMIN' && <Switch checked={p.store.queue} onChange={p.store.setQueue} label="Review queue only" />}
    {p.store.loading && <Notice>Loading public stops…</Notice>}
    {p.store.error && <Notice tone="error">{p.store.error}</Notice>}
    {p.adding && <Notice>Tap the map where the car can stop. <button type="button" className="underline" onClick={p.onCancelAdd}>Cancel</button></Notice>}
    {p.draft && p.token && <Submission key={`${p.draft.lat},${p.draft.lng}`} point={p.draft} token={p.token} buildings={p.buildings} proposal={p.proposal} boundary={p.boundary} drawing={p.drawing} onDrawBoundary={p.onDrawBoundary} onUndoBoundary={p.onUndoBoundary} nearby={p.store.stops}
      onCancel={p.onCancelAdd} onSaved={stop => { p.store.update(stop); p.onCancelAdd(); p.onSelect(stop) }} />}
    {p.selected && !p.draft && <StopDetails key={`${p.selected.id}:${p.selected.revision}`} stop={p.selected}
      token={p.token} user={p.user} onUpdated={p.store.update} onSignIn={p.onSignIn} onUse={p.onUse} />}
    {!p.selected && !p.draft && !p.adding && <div className="flex flex-col gap-2">
      {!p.store.loading && !p.store.stops.length && <Notice>{p.store.queue ? 'No stops awaiting review.' : 'No public stops yet. Add the first one on the map.'}</Notice>}
      {p.store.stops.map(stop => <button type="button" key={stop.id} onClick={() => p.onSelect(stop)}
        className="rounded-xl border border-line bg-raised p-3 text-left hover:border-accent">
        <span className="block font-bold">{stop.name}</span>
        <span className="text-xs text-muted">{labels[stop.status]} · {stop.confirmationCount} confirmations · {stop.reports.filter(r => !r.resolvedAt).length} open reports</span>
      </button>)}
      {p.store.hasMore && <Button disabled={p.store.loadingMore} onClick={() => void p.store.loadMore()}>Load more</Button>}
    </div>}
  </>
}
function Submission({ point, token, onSaved, onCancel, buildings, proposal, boundary, drawing, onDrawBoundary, onUndoBoundary, nearby }: { boundary: LatLng[]; drawing: boolean; onDrawBoundary: () => void; onUndoBoundary: () => void; nearby: api.PublicStop[]; buildings: Building[]; proposal?: Partial<api.PublicStopInput>; point: LatLng; token: string; onSaved: (stop: api.PublicStop) => void; onCancel: () => void }) {
  const [name, setName] = useState(proposal?.name ?? '')
  const [buildingId, setBuildingId] = useState(proposal?.buildingId ?? '')
  const [instructions, setInstructions] = useState(proposal?.instructions ?? '')
  const [photoUrl, setPhotoUrl] = useState('')
  const [dropoff, setDropoff] = useState(!proposal?.kinds || proposal.kinds.includes('DROPOFF'))
  const [pickup, setPickup] = useState(!proposal?.kinds || proposal.kinds.includes('PICKUP'))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(undefined)
    try { onSaved(await api.submitPublicStop(token, { ...proposal, polygon: boundary, buildingId: buildingId || undefined, name: name.trim(), instructions: instructions.trim(), location: point,
      kinds: [...(dropoff ? ['DROPOFF' as const] : []), ...(pickup ? ['PICKUP' as const] : [])], photoUrl: photoUrl.trim() || undefined })) }
    catch (error) { setError((error as Error).message) }
    finally { setBusy(false) }
  }
  return <form onSubmit={submit} className="flex flex-col gap-3 rounded-2xl border border-line p-3">
    <h2 className="m-0 text-lg font-bold">Propose public zone</h2>
    <p className="m-0 text-xs text-muted">{point.lat.toFixed(5)}, {point.lng.toFixed(5)} · Visible to everyone as Unverified until reviewed. This stop is available to nearby destinations with its Unverified label.</p>
    {nearby.filter(stop => distanceMeters(stop.location, point) < 15).map(stop => <Notice key={stop.id}>Nearby zone: {stop.name}. <button type="button" className="underline" onClick={() => onSaved(stop)}>Use existing zone</button></Notice>)}
    {!proposal?.suggestedZoneId && <div className="flex flex-wrap gap-2"><Button onClick={onDrawBoundary}>{drawing ? 'Finish boundary' : 'Draw optional boundary'}</Button>{boundary.length > 0 && <Button onClick={onUndoBoundary}>Undo boundary point</Button>}</div>}
    {drawing && <Notice>Tap the map to outline the zone with at least three points. The stopping pin stays in place.</Notice>}
    {boundary.length > 0 && boundary.length < 3 && <Notice>Add at least three points, or undo to remove the boundary.</Notice>}
    <Field label="Building (optional)"><select className={inputClass} value={buildingId} onChange={e => setBuildingId(e.target.value)}><option value="">General nearby stop</option>{buildings.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
    <p className="m-0 text-xs text-muted">The planner chooses the fastest entrance. Nearby destinations can also use this zone.</p>
    <Field label="Stop name"><input required minLength={2} maxLength={120} className={inputClass} value={name} onChange={e => setName(e.target.value)} /></Field>
    <Field label="Where should the car stop?"><textarea required minLength={3} maxLength={1000} className={inputClass} value={instructions} onChange={e => setInstructions(e.target.value)} placeholder="Curb location, signs, access hours, and approach instructions" /></Field>
    <Field label="Photo link (optional)"><input type="url" maxLength={2000} className={inputClass} value={photoUrl} onChange={e => setPhotoUrl(e.target.value)} placeholder="https://…" /></Field>
    <div className="flex gap-4"><Switch checked={dropoff} onChange={setDropoff} label="Drop-off" /><Switch checked={pickup} onChange={setPickup} label="Pickup" /></div>
    {error && <Notice tone="error">{error}</Notice>}
    <div className="flex gap-2"><Button type="submit" variant="primary" disabled={busy || drawing || (boundary.length > 0 && boundary.length < 3) || (!dropoff && !pickup)}>{busy ? 'Saving…' : 'Submit public zone'}</Button><Button onClick={onCancel} disabled={busy}>Cancel</Button></div>
  </form>
}
function StopDetails({ stop, token, user, onUpdated, onSignIn, onUse }: {
  stop: api.PublicStop; token?: string; user?: User; onUpdated: (stop: api.PublicStop) => void; onSignIn: () => void; onUse: (stop: api.PublicStop) => void;
}) {
  const [category, setCategory] = useState('MISPLACED')
  const [details, setDetails] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [reviewStatus, setReviewStatus] = useState<api.PublicStop['status']>('VERIFIED')
  const [access, setAccess] = useState<api.PublicStop['access']>('UNKNOWN')
  const [accessibility, setAccessibility] = useState<api.PublicStop['accessibility']>('UNKNOWN')
  const [notes, setNotes] = useState('')
  const [days, setDays] = useState(90)
  const mutate = async (operation: () => Promise<api.PublicStop>) => {
    setBusy(true); setError(undefined)
    try { onUpdated(await operation()) } catch (error) { setError((error as Error).message) } finally { setBusy(false) }
  }
  return <section className="flex flex-col gap-3 rounded-2xl border border-line p-3">
    <div><span className="text-xs font-bold text-accent">{labels[stop.status]}</span><h2 className="m-0 text-lg font-bold">{stop.name}</h2></div>
    <p className="m-0 text-sm">{stop.instructions}</p>
    <p className="m-0 text-xs text-muted">{stop.kinds.includes('BOTH') ? 'Pickup and drop-off' : stop.kinds.map(k => k === 'PICKUP' ? 'Pickup' : 'Drop-off').join(' · ')} · {stop.confirmationCount} distinct account confirmations</p>
    <p className="m-0 text-xs">Access: {accessLabels[stop.access]} · Accessibility: {accessibilityLabels[stop.accessibility]}</p>
    {stop.photoUrl && <a className="text-sm font-bold text-accent underline" href={stop.photoUrl} target="_blank" rel="noreferrer">View submitted photo</a>}
    {stop.verificationExpiresAt && stop.status === 'VERIFIED' && <p className="m-0 text-xs text-muted">Verified until {new Date(stop.verificationExpiresAt).toLocaleDateString()}. Accessibility applies to the stop, not the entire walking route.</p>}
    {(stop.status === 'VERIFIED' || stop.status === 'UNVERIFIED') && stop.access !== 'RESTRICTED' && <Button variant="primary" onClick={() => onUse(stop)}>Use this public stop</Button>}
    {error && <Notice tone="error">{error}</Notice>}
    {!token ? <Button onClick={onSignIn}>Sign in to confirm or report</Button> : stop.status !== 'RETIRED' && <>
      <Button disabled={busy || stop.confirmedByMe || stop.submittedByMe} onClick={() => void mutate(() => confirmNearby(token, stop.id))}>
        {stop.confirmedByMe ? 'You confirmed this stop' : stop.submittedByMe ? 'Awaiting confirmations from other people' : busy ? 'Checking…' : 'I used this stop successfully'}
      </Button>
      <p className="m-0 text-xs text-muted">Confirmation checks your current GPS proximity. One confirmation per account; this does not grant verified status.</p>
      {stop.reportedByMe ? <Notice>Your report is awaiting review.</Notice> : <form onSubmit={event => { event.preventDefault(); void mutate(() => api.reportPublicStop(token, stop.id, category, details)) }} className="flex flex-col gap-2">
        <Field label="Report a problem"><select className={inputClass} value={category} onChange={e => setCategory(e.target.value)}>
          {Object.entries({ MISPLACED: 'Wrong location', INACCESSIBLE: 'Accessibility issue', PRIVATE_PROPERTY: 'Private property / no stopping', CLOSED: 'Closed', UNSAFE: 'Unsafe', OTHER: 'Other' }).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></Field>
        <textarea aria-label="Report details" required minLength={5} maxLength={1000} className={inputClass} value={details} onChange={e => setDetails(e.target.value)} placeholder="Describe what needs checking" />
        <Button type="submit" disabled={busy}>Submit report</Button>
      </form>}
    </>}
    {!!stop.reports.length && <details><summary className="cursor-pointer font-semibold">Reports ({stop.reports.filter(r => !r.resolvedAt).length} open)</summary>
      {stop.reports.map(report => <div className="mt-2 border-t border-line pt-2 text-sm" key={report.id}><strong>{report.category.replaceAll('_', ' ')} · {report.resolvedAt ? 'Reviewed' : 'Open'}</strong><p className="mb-0">{report.details}</p></div>)}
    </details>}
    {user?.role === 'ADMIN' && token && <form className="flex flex-col gap-2 border-t border-line pt-3" onSubmit={event => {
      event.preventDefault(); void mutate(() => api.reviewPublicStop(token, stop.id, { status: reviewStatus, access, accessibility, notes, validDays: days, revision: stop.revision }))
    }}>
      <h3 className="m-0 font-bold">Administrator review</h3>
      <Field label="Decision"><select className={inputClass} value={reviewStatus} onChange={e => setReviewStatus(e.target.value as api.PublicStop['status'])}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
      <>
        <Field label="Public access check"><select required className={inputClass} value={access} onChange={e => setAccess(e.target.value as api.PublicStop['access'])}>{Object.entries(accessLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
        <Field label="Accessibility check"><select className={inputClass} value={accessibility} onChange={e => setAccessibility(e.target.value as api.PublicStop['accessibility'])}>{Object.entries(accessibilityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
        {reviewStatus === 'VERIFIED' && <Field label="Days until recheck"><input type="number" min={1} max={180} required className={inputClass} value={days} onChange={e => setDays(Number(e.target.value))} /></Field>}
      </>
      <Field label="Evidence and decision notes"><textarea required minLength={10} maxLength={2000} className={inputClass} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Record signs, site inspection, property manager confirmation, and how reports were resolved." /></Field>
      <p className="m-0 text-xs text-muted">Decisions and evidence are public. Verifying requires permitted access and a reviewer other than the submitter.</p>
      <Button type="submit" variant="primary" disabled={busy || (reviewStatus === 'VERIFIED' && (access !== 'PERMITTED' || stop.submittedByMe))}>Save review</Button>
    </form>}
    <details><summary className="cursor-pointer font-semibold">Verification history</summary>{[...stop.reviews].reverse().map((review, index) => <div className="mt-2 border-t border-line pt-2 text-xs" key={index}>
      <strong>{labels[review.status]} · {review.actorName}</strong> · {new Date(review.createdAt).toLocaleString()}<p className="mb-0">{review.notes}</p>
    </div>)}</details>
  </section>
}

async function confirmNearby(token: string, id: string) {
  if (!navigator.geolocation) throw new Error('Your browser does not support location access.')
  const position = await new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject,
    { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 }))
  return api.confirmPublicStop(token, id, { location: { lat: position.coords.latitude, lng: position.coords.longitude },
    accuracy: position.coords.accuracy, timestamp: position.timestamp })
}
