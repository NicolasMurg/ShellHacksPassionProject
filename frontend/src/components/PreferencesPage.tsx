import { useState, type FormEvent, type ReactNode } from 'react'
import { useAuth } from '../state/auth'
import type { Mobility, Pace, User, WalkingProfile } from '../types'
import { MOBILITY_LABEL, PACE_LABEL, walkingSpeed } from '../walking'
import { cx } from './cx'
import { Button, Field, LogoMark, Notice, inputClass } from './ui'

/** The Preferences tab: the sign-in page when signed out, personal settings when signed in. */
export function PreferencesPage({ onOpenMap }: { onOpenMap: () => void }) {
  const { user } = useAuth()
  return (
    // Nearly solid over the (still mounted) map, with just a hint of it showing through.
    <section aria-label="Preferences" className="absolute inset-0 z-40 overflow-y-auto overscroll-contain bg-ink/92 backdrop-blur-md">
      <Aurora />
      <div className="relative mx-auto flex min-h-full w-full max-w-md flex-col gap-5 px-4 pb-32 pt-[max(20px,env(safe-area-inset-top))]">
        {user ? <Preferences key={user.id} user={user} onOpenMap={onOpenMap} /> : <SignIn onOpenMap={onOpenMap} />}
      </div>
    </section>
  )
}

/** Soft teal and blue light drifting behind the page, plus a faint grid. */
function Aurora() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
      <div className="absolute -left-1/4 -top-1/4 size-[70vmax] animate-drift rounded-full bg-[radial-gradient(circle,rgb(46_230_214/0.07),transparent_60%)]" />
      <div className="absolute -bottom-1/3 -right-1/4 size-[70vmax] animate-drift rounded-full bg-[radial-gradient(circle,rgb(59_140_255/0.07),transparent_60%)] [animation-delay:-9s]" />
      <div className="absolute inset-0 bg-[linear-gradient(rgb(255_255_255/0.025)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255/0.025)_1px,transparent_1px)] bg-[size:44px_44px] [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]" />
    </div>
  )
}

function Card({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 rounded-[var(--radius-sheet)] border border-line bg-surface p-5 shadow-[var(--shadow-float)]">
      <div>
        <h2 className="m-0 text-base font-extrabold tracking-tight">{title}</h2>
        {hint && <p className="m-0 mt-1 text-sm text-muted">{hint}</p>}
      </div>
      {children}
    </div>
  )
}

/** Tappable choice tiles with an icon, e.g. walking pace or mobility aid. */
function Choices<T extends string>({
  label,
  value,
  options,
  onChange,
  columns = 3,
}: {
  label: string
  value: T
  options: { value: T; label: string; icon: string }[]
  onChange: (v: T) => void
  columns?: number
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid gap-2" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {options.map((o) => {
        const checked = value === o.value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={checked}
            onClick={() => onChange(o.value)}
            className={cx(
              'flex flex-col items-center gap-1.5 rounded-2xl border px-2 py-3 text-sm font-semibold transition-all active:scale-[0.97]',
              checked
                ? 'border-accent/50 bg-accent/12 text-fg'
                : 'border-line bg-raised text-muted hover:text-fg',
            )}
          >
            <span aria-hidden className={cx('text-2xl transition-transform', checked && 'scale-110')}>
              {o.icon}
            </span>
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

function SignIn({ onOpenMap }: { onOpenMap: () => void }) {
  const { login } = useAuth()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      await login(name, email) // on success this page switches to the preferences view
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="flex flex-col items-center gap-4 pt-2 text-center">
        <div className="relative grid size-20 place-items-center">
          <span aria-hidden className="absolute inset-0 animate-ping-soft rounded-full border border-accent/50" />
          <span aria-hidden className="absolute inset-0 animate-ping-soft rounded-full border border-accent-2/40 [animation-delay:-1.2s]" />
          <LogoMark className="relative size-12" />
        </div>
        <div>
          <h1 className="m-0 text-4xl font-extrabold tracking-tight">
            Door<span className="text-brand">step</span>
          </h1>
          <p className="m-0 mt-1.5 text-muted">Arrive at the right door, every time.</p>
        </div>
        <ul className="m-0 flex list-none flex-wrap justify-center gap-2 p-0 text-xs font-semibold text-muted">
          {['🚗 Smart drop-offs', '♿ Step-free routes', '⏱ Your own pace'].map((f) => (
            <li key={f} className="rounded-full border border-line bg-raised px-3 py-1.5">
              {f}
            </li>
          ))}
        </ul>
      </div>

      <Card title="Sign in" hint="Get arrival times based on your own walking pace, and save your own drop-off spots.">
        <form onSubmit={submit} className="flex flex-col gap-3.5">
          <Field label="Name">
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Alex Rivera" required autoComplete="name" />
          </Field>
          <Field label="Email">
            <input
              className={inputClass}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@fiu.edu"
              required
              autoComplete="email"
            />
          </Field>
          {error && <Notice tone="error">{error}</Notice>}
          <Button type="submit" variant="primary" className="mt-1 h-12" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </Card>

      <div className="flex flex-col items-center gap-1 text-center">
        <Button variant="quiet" onClick={onOpenMap}>
          Continue as a guest →
        </Button>
        <p className="m-0 text-xs text-muted">You'll see standard walk times for an average walker.</p>
      </div>
    </>
  )
}

const PROFILE_FIELDS = ['pace', 'age', 'heightCm', 'mobility', 'learnedFactor'] as const

const PACE_ICON: Record<Pace, string> = { slow: '🐢', average: '🚶', fast: '🐇' }
const MOBILITY_ICON: Record<Mobility, string> = { none: '👟', cane: '🦯', crutches: '🩼', wheelchair: '♿', stroller: '👶' }
const MOBILITY_SHORT: Record<Mobility, string> = { none: 'No aid', cane: 'Cane', crutches: 'Crutches', wheelchair: 'Wheelchair', stroller: 'Stroller' }

// Speed gauge range in m/s (covers every profile the model can produce).
const GAUGE_MIN = 0.5
const GAUGE_MAX = 2

function Preferences({ user, onOpenMap }: { user: User; onOpenMap: () => void }) {
  const { logout, saveProfile } = useAuth()
  const [draft, setDraft] = useState<WalkingProfile>(user.profile)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

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
    } finally {
      setBusy(false)
    }
  }

  const initials = user.name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  const speed = walkingSpeed(draft)
  const gauge = Math.min(1, Math.max(0, (speed - GAUGE_MIN) / (GAUGE_MAX - GAUGE_MIN)))

  return (
    <>
      <div className="flex items-center gap-3 rounded-[var(--radius-sheet)] border border-line bg-surface p-4 shadow-[var(--shadow-float)]">
        <span aria-hidden className="grid size-13 shrink-0 place-items-center rounded-full bg-brand text-lg font-extrabold text-accent-ink">
          {initials || '?'}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold text-muted">Welcome back</span>
          <span className="block truncate text-lg font-extrabold tracking-tight">{user.name}</span>
          <span className="block truncate text-sm text-muted">{user.email}</span>
        </span>
        <Button variant="quiet" className="h-9 px-2 text-sm" onClick={logout}>
          Sign out
        </Button>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-5">
        <Card title="Walking pace" hint="How fast you usually walk. Your arrival times on the map use it.">
          <Choices
            label="Walking pace"
            value={draft.pace ?? 'average'}
            onChange={(pace) => change({ pace })}
            options={(Object.keys(PACE_LABEL) as Pace[]).map((p) => ({ value: p, label: PACE_LABEL[p], icon: PACE_ICON[p] }))}
          />
          <div className="flex flex-col gap-2.5 rounded-2xl border border-line bg-raised px-4 py-3.5">
            <div className="flex items-end justify-between">
              <span className="text-sm">
                <span className="block font-semibold">Estimated speed</span>
                <span className="text-xs text-muted">
                  {draft.learnedFactor === 1
                    ? 'Adjusts as you rate your walks'
                    : `Adjusted from your past trips (×${(1 / draft.learnedFactor).toFixed(2)})`}
                </span>
              </span>
              <span className="text-2xl font-extrabold tabular-nums">
                <span className="text-brand">{speed.toFixed(2)}</span>
                <span className="ml-1 text-xs font-bold text-muted">m/s</span>
              </span>
            </div>
            <div aria-hidden className="h-1.5 overflow-hidden rounded-full bg-high">
              <div
                className="h-full rounded-full bg-brand transition-[width] duration-500"
                style={{ width: `${Math.round(gauge * 100)}%` }}
              />
            </div>
          </div>
          {draft.learnedFactor !== 1 && (
            <Button variant="quiet" className="h-8 self-start px-0 text-sm" onClick={() => change({ learnedFactor: 1 })}>
              Reset learned pace
            </Button>
          )}
        </Card>

        <Card title="Getting around" hint="Wheelchair and stroller users are only routed to step-free entrances.">
          <Choices
            label={`How do you get around? Currently: ${MOBILITY_LABEL[draft.mobility]}`}
            value={draft.mobility}
            onChange={(mobility) => change({ mobility })}
            options={(Object.keys(MOBILITY_LABEL) as Mobility[]).map((m) => ({ value: m, label: MOBILITY_SHORT[m], icon: MOBILITY_ICON[m] }))}
          />
        </Card>

        <Card title="Fine-tune" hint="Optional. Age and height adjust your estimate slightly.">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Age">
              <input className={inputClass} type="number" min={5} max={110} placeholder="—" value={draft.age ?? ''} onChange={(e) => change({ age: num(e.target.value) })} />
            </Field>
            <Field label="Height (cm)">
              <input
                className={inputClass}
                type="number"
                min={80}
                max={230}
                placeholder="—"
                value={draft.heightCm ?? ''}
                onChange={(e) => change({ heightCm: num(e.target.value) })}
              />
            </Field>
          </div>
        </Card>

        {saved && !dirty && <Notice tone="success">Saved. Arrival times on the map now use these settings.</Notice>}
        <Button type="submit" variant="primary" className="h-12" disabled={busy || !dirty}>
          {busy ? 'Saving…' : 'Save preferences'}
        </Button>
      </form>

      <Button className="h-12" onClick={onOpenMap}>
        Open map →
      </Button>
    </>
  )
}
