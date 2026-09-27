import type { TravelMode, User } from '../types'
import { walkingSpeed } from '../walking'
import { DestinationSearch } from './DestinationSearch'
import { Segmented, Switch } from './ui'

export type SearchControls = {
  searchText: string
  onSearchTextChange: (text: string) => void
  onSearch: (text: string) => void
  onClear: () => void
}

type Props = SearchControls & {
  user?: User
  mode: TravelMode
  onMode: (mode: TravelMode) => void
  allowWalking?: boolean
  stepFree: boolean
  onStepFree: (value: boolean) => void
  onSignIn: () => void
  destinationName?: string
  room?: string
}

/** Keep the destination controls identical for campus buildings and map-selected places. */
export function DestinationControls(p: Props) {
  const walking = p.mode === 'walk'
  return <>
    <header>
      <p className="m-0 text-xs font-semibold text-muted">{walking ? 'On foot ›' : 'My car ›'}</p>
      <h1 className="m-0 text-xl font-extrabold tracking-tight">{walking ? 'Walk to the right door' : p.mode === 'pickup' ? 'Targeted pickup' : 'Targeted drop-off'}</h1>
    </header>
    <Segmented<TravelMode> label="How are you getting there?" value={p.mode} onChange={p.onMode} options={[
      { value: 'dropoff', label: 'Drop-off' }, { value: 'pickup', label: 'Pickup' },
      ...(p.allowWalking ? [{ value: 'walk' as const, label: 'Walk' }] : []),
    ]} />
    <DestinationSearch text={p.searchText} onChange={p.onSearchTextChange} onSearch={p.onSearch} onClear={p.onClear} />
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Switch checked={p.stepFree} onChange={p.onStepFree} label="♿ Step-free only" />
      {p.user ? <span className="text-xs text-muted">Your pace: {walkingSpeed(p.user.profile).toFixed(2)} m/s</span>
        : <button type="button" onClick={p.onSignIn} className="text-xs font-semibold text-accent hover:underline">Sign in for personal walk times</button>}
    </div>
    {p.destinationName && <div className="flex flex-wrap items-center gap-2">
      <span className="text-base font-bold">{p.destinationName}</span>
      {p.room && <span className="rounded-full bg-accent/15 px-2.5 py-0.5 text-xs font-bold text-accent">Rm {p.room}</span>}
    </div>}
  </>
}
