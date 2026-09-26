import { useState, type FormEvent, type ReactNode } from 'react'
import { useAuth } from '../state/auth'
import type { Mobility, Pace, User, WalkingProfile } from '../types'
import { MOBILITY_LABEL, PACE_LABEL, walkingSpeed } from '../walking'
import { Button, Field, Notice, Segmented, inputClass } from './ui'

/** The Preferences tab: the sign-in page when signed out, personal settings when signed in. */
export function PreferencesPage({ onOpenMap }: { onOpenMap: () => void }) {
  const { user, error } = useAuth()
  return (
    <section aria-label="Preferences" className="absolute inset-0 z-40 overflow-y-auto overscroll-contain bg-ink">
      <div className="mx-auto flex min-h-full w-full max-w-md flex-col gap-5 px-4 pb-8 pt-[max(32px,env(safe-area-inset-top))]">
        {error && <Notice tone="error">{error}</Notice>}
        {user ? <Preferences key={user.id} user={user} onOpenMap={onOpenMap} /> : <SignIn onOpenMap={onOpenMap} />}
      </div>
    </section>
  )
}

function Card({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3.5 rounded-[var(--radius-sheet)] border border-line bg-surface p-5">
      <div>
        <h2 className="m-0 text-base font-extrabold tracking-tight">{title}</h2>
        {hint && <p className="m-0 mt-1 text-sm text-muted">{hint}</p>}
      </div>
      {children}
    </div>
  )
}

function SignIn({ onOpenMap }: { onOpenMap: () => void }) {
  const { login } = useAuth()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [registering, setRegistering] = useState(false)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      await login(email, password, registering ? name : undefined) // on success this page switches to the preferences view
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="flex items-center gap-3 py-4">
        <span aria-hidden className="size-10 rounded-[11px_11px_11px_3px] bg-gradient-to-br from-accent to-[#2a8cff]" />
        <span>
          <span className="block text-2xl font-extrabold tracking-tight">Doorstep</span>
          <span className="block text-sm text-muted">The right door, every time</span>
        </span>
      </div>

      <Card title={registering ? "Create account" : "Sign in"} hint="Get arrival times based on your own walking pace, and save your own drop-off spots.">
        <form onSubmit={submit} className="flex flex-col gap-3.5">
          {registering && <Field label="Name">
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
          </Field>}
          <Field label="Email">
            <input className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          </Field>
          <Field label="Password">
            <input className={inputClass} type="password" minLength={8} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} required autoComplete={registering ? 'new-password' : 'current-password'} />
          </Field>
          {error && <Notice tone="error">{error}</Notice>}
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Please wait…' : registering ? 'Create account' : 'Sign in'}
          </Button>
        </form>
        <Button variant="quiet" onClick={() => { setRegistering(v => !v); setError(undefined) }}>
          {registering ? 'Already have an account? Sign in' : 'New here? Create an account'}
        </Button>
      </Card>

      <div className="flex flex-col items-center gap-1 text-center">
        <Button variant="quiet" onClick={onOpenMap}>
          Continue without signing in
        </Button>
        <p className="m-0 text-xs text-muted">You'll see standard walk times for an average walker.</p>
      </div>
    </>
  )
}

const PROFILE_FIELDS = ['pace', 'age', 'heightCm', 'mobility'] as const

function Preferences({ user, onOpenMap }: { user: User; onOpenMap: () => void }) {
  const { logout, saveProfile } = useAuth()
  const [draft, setDraft] = useState<WalkingProfile>(user.profile)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string>()

  const dirty = PROFILE_FIELDS.some((k) => draft[k] !== user.profile[k])
  const num = (v: string) => (v === '' ? undefined : Number(v))
  const change = (next: Partial<WalkingProfile>) => {
    setDraft({ ...draft, ...next })
    setSaved(false)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await saveProfile(draft)
      setSaved(true)
      setError(undefined)
    } catch (e) { setError((e as Error).message) } finally {
      setBusy(false)
    }
  }

  const initials = user.name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <>
      <h1 className="m-0 text-2xl font-extrabold tracking-tight">Preferences</h1>

      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="grid size-12 shrink-0 place-items-center rounded-full bg-gradient-to-br from-accent to-[#2a8cff] text-lg font-extrabold text-accent-ink"
        >
          {initials || '?'}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-bold">{user.name}</span>
          <span className="block truncate text-sm text-muted">{user.email}</span>
        </span>
        <Button variant="quiet" className="h-9 px-2 text-sm" onClick={logout}>
          Sign out
        </Button>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-5">
        <Card title="Walking pace" hint="How fast you usually walk. Your arrival times on the map use it.">
          <Segmented
            label="Walking pace"
            value={draft.pace ?? 'average'}
            onChange={(pace) => change({ pace })}
            options={(Object.keys(PACE_LABEL) as Pace[]).map((p) => ({ value: p, label: PACE_LABEL[p] }))}
          />
          <div className="flex items-center justify-between rounded-xl bg-raised px-3.5 py-3">
            <span className="text-sm">
              <span className="block font-semibold">Estimated speed</span>
              <span className="text-xs text-muted">
                {draft.learnedFactor === 1
                  ? 'Adjusts as you rate your walks'
                  : `Adjusted from your past trips (×${(1 / draft.learnedFactor).toFixed(2)})`}
              </span>
            </span>
            <span className="text-lg font-extrabold text-accent">{walkingSpeed(draft).toFixed(2)} m/s</span>
          </div>

        </Card>

        <Card title="Getting around">
          <Field label="How do you get around?" hint="Wheelchair and stroller users are only routed to step-free entrances.">
            <select className={inputClass} value={draft.mobility} onChange={(e) => change({ mobility: e.target.value as Mobility })}>
              {(Object.keys(MOBILITY_LABEL) as Mobility[]).map((m) => (
                <option key={m} value={m}>
                  {MOBILITY_LABEL[m]}
                </option>
              ))}
            </select>
          </Field>
        </Card>

        <Card title="Fine-tune (optional)" hint="Age and height adjust your estimate slightly.">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Age">
              <input className={inputClass} type="number" min={5} max={110} value={draft.age ?? ''} onChange={(e) => change({ age: num(e.target.value) })} />
            </Field>
            <Field label="Height (cm)">
              <input
                className={inputClass}
                type="number"
                min={80}
                max={230}
                value={draft.heightCm ?? ''}
                onChange={(e) => change({ heightCm: num(e.target.value) })}
              />
            </Field>
          </div>
        </Card>

        {error && <Notice tone="error">{error}</Notice>}
        {saved && !dirty && <Notice tone="success">Saved. Arrival times on the map now use these settings.</Notice>}
        <Button type="submit" variant="primary" disabled={busy || !dirty}>
          {busy ? 'Saving…' : 'Save preferences'}
        </Button>
      </form>

      <Button onClick={onOpenMap}>Open map</Button>
    </>
  )
}
