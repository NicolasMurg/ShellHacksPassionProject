import { useState, type FormEvent, type ReactNode } from 'react'
import { measuredPace } from '../motion'
import { useAuth } from '../state/auth'
import { useMotion } from '../state/motion'
import type { Mobility, Pace, User, WalkingProfile } from '../types'
import { MOBILITY_LABEL, PACE_LABEL, walkingSpeed } from '../walking'
import { cx } from './cx'
import {
  CaneIcon,
  CarIcon,
  ClockIcon,
  CrutchesIcon,
  LocateIcon,
  RunIcon,
  SneakerIcon,
  StrollerIcon,
  TurtleIcon,
  WalkIcon,
  WheelchairIcon,
} from './icons'
import { BayDay, BayNight, NightScene } from './NightScene'
import { Button, Field, LogoMark, Notice, inputClass } from './ui'

/**
 * The Preferences tab: the sign-in page when signed out, personal settings when signed in.
 * It stays mounted and fades/slides in and out over the map instead of switching abruptly.
 * `light` (the map is in Light mode) gives signed-in users a daytime version.
 */
export function PreferencesPage({ open, light, onOpenMap }: { open: boolean; light: boolean; onOpenMap: () => void }) {
  const { user, error } = useAuth()
  const daytime = light && !!user // the sign-in page keeps its night-city scene
  return (
    <section
      aria-label="Preferences"
      aria-hidden={!open}
      inert={!open}
      className={cx(
        'absolute inset-0 z-40 overflow-hidden bg-ink transition-[opacity,transform,visibility] duration-300 ease-out motion-reduce:transition-none',
        open ? 'visible translate-y-0 opacity-100' : 'invisible pointer-events-none translate-y-4 opacity-0',
        daytime && 'theme-light',
      )}
    >
      {/* The scene stays put behind the cards; only the cards scroll. */}
      {!user ? <NightScene /> : daytime ? <BayDay /> : <BayNight />}
      <div className="absolute inset-0 overflow-y-auto overscroll-contain">
        {/* Extra top room on phones so the corner Preferences/Map switch never covers content. */}
        <div className="relative mx-auto flex min-h-full w-full max-w-md flex-col gap-5 px-4 pb-12 pt-[max(68px,env(safe-area-inset-top))] sm:pt-[max(20px,env(safe-area-inset-top))]">
          {error && <Notice tone="error">{error}</Notice>}
          {user ? <Preferences key={user.id} user={user} onOpenMap={onOpenMap} /> : <SignIn onOpenMap={onOpenMap} />}
        </div>
      </div>
    </section>
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
  options: { value: T; label: string; icon: ReactNode }[]
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
            <span aria-hidden className={cx('transition-[transform,color]', checked ? 'scale-110 text-accent' : 'text-muted')}>
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
      <div className="flex flex-col items-center gap-4 pt-2 text-center">
        <div className="relative grid size-20 place-items-center">
          <span aria-hidden className="absolute inset-0 animate-ping-soft rounded-full border border-accent/50" />
          <span aria-hidden className="absolute inset-0 animate-ping-soft rounded-full border border-accent-2/40 [animation-delay:-1.2s]" />
          <LogoMark className="relative size-12" />
        </div>
        <div>
          <h1 className="m-0 text-4xl font-extrabold tracking-tight">
            Door<span className="text-accent">Step</span>
          </h1>
          <p className="m-0 mt-1.5 text-muted">Arrive at the right door, every time.</p>
        </div>
        <ul className="m-0 flex list-none flex-wrap justify-center gap-2 p-0 text-xs font-semibold text-muted">
          {(
            [
              [<CarIcon size={15} />, 'Smart drop-offs'],
              [<WheelchairIcon size={15} />, 'Step-free routes'],
              [<ClockIcon size={15} />, 'Your own pace'],
            ] as const
          ).map(([icon, label]) => (
            <li key={label} className="flex items-center gap-1.5 rounded-full border border-line bg-raised px-3 py-1.5">
              <span className="text-accent">{icon}</span>
              {label}
            </li>
          ))}
        </ul>
      </div>

      <Card title={registering ? 'Create account' : 'Sign in'} hint="Get arrival times based on your own walking pace, and save your own drop-off spots.">
        <form onSubmit={submit} className="flex flex-col gap-3.5">
          {registering && (
            <Field label="Name">
              <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Alex Rivera" required autoComplete="name" />
            </Field>
          )}
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
          <Field label="Password">
            <input
              className={inputClass}
              type="password"
              minLength={8}
              maxLength={128}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete={registering ? 'new-password' : 'current-password'}
            />
          </Field>
          {error && <Notice tone="error">{error}</Notice>}
          <Button type="submit" variant="primary" className="mt-1 h-12" disabled={busy}>
            {busy ? 'Please wait…' : registering ? 'Create account' : 'Sign in'}
          </Button>
        </form>
        <Button
          variant="quiet"
          onClick={() => {
            setRegistering((v) => !v)
            setError(undefined)
          }}
        >
          {registering ? 'Already have an account? Sign in' : 'New here? Create an account'}
        </Button>
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

const PROFILE_FIELDS = ['pace', 'age', 'heightCm', 'mobility'] as const

type HeightUnit = 'in' | 'cm'
const CM_PER_IN = 2.54
const HEIGHT_UNIT_KEY = 'doorstep.heightUnit'
// The backend stores whole centimeters from 80 to 230; the inch limits cover the same range.
const HEIGHT_LIMITS: Record<HeightUnit, { min: number; max: number }> = { cm: { min: 80, max: 230 }, in: { min: 32, max: 90 } }

function savedHeightUnit(): HeightUnit {
  try {
    const saved = localStorage.getItem(HEIGHT_UNIT_KEY)
    if (saved === 'in' || saved === 'cm') return saved
  } catch {
    // Storage blocked: fall back to the locale's usual unit.
  }
  return navigator.language === 'en-US' ? 'in' : 'cm'
}

const feetAndInches = (inches: number) => `${Math.floor(inches / 12)}′${Math.round(inches % 12)}″`
const toText = (heightCm: number | undefined, unit: HeightUnit) =>
  heightCm === undefined ? '' : String(unit === 'cm' ? heightCm : Math.round(heightCm / CM_PER_IN))

/**
 * Height in inches or centimeters. It's always saved as whole centimeters; the field keeps
 * what you typed in your unit so the number doesn't jump while you type.
 */
function HeightField({ heightCm, onChange }: { heightCm?: number; onChange: (heightCm?: number) => void }) {
  const [unit, setUnit] = useState<HeightUnit>(savedHeightUnit)
  const [text, setText] = useState(() => toText(heightCm, unit))

  const pickUnit = (next: HeightUnit) => {
    setUnit(next)
    setText(toText(heightCm, next))
    try {
      localStorage.setItem(HEIGHT_UNIT_KEY, next)
    } catch {
      // Not remembered; still works this session.
    }
  }
  const type = (value: string) => {
    setText(value)
    const n = value === '' ? undefined : Number(value)
    onChange(n === undefined || Number.isNaN(n) ? undefined : Math.round(unit === 'cm' ? n : n * CM_PER_IN))
  }

  const inches = heightCm === undefined ? undefined : heightCm / CM_PER_IN
  const hint =
    inches === undefined
      ? undefined
      : unit === 'in'
        ? `${feetAndInches(inches)} · ${heightCm} cm`
        : `${feetAndInches(inches)} · ${Math.round(inches)} in`

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor="height" className="text-sm font-semibold">
          Height
        </label>
        <div role="radiogroup" aria-label="Height unit" className="flex rounded-full bg-raised p-0.5 text-xs font-bold">
          {(['in', 'cm'] as const).map((u) => (
            <button
              key={u}
              type="button"
              role="radio"
              aria-checked={unit === u}
              onClick={() => pickUnit(u)}
              className={cx('rounded-full px-2.5 py-1 transition-colors', unit === u ? 'bg-high text-fg' : 'text-muted hover:text-fg')}
            >
              {u}
            </button>
          ))}
        </div>
      </div>
      <input
        id="height"
        className={inputClass}
        type="number"
        inputMode="numeric"
        min={HEIGHT_LIMITS[unit].min}
        max={HEIGHT_LIMITS[unit].max}
        step={1}
        placeholder={unit === 'in' ? 'e.g. 68' : 'e.g. 173'}
        value={text}
        onChange={(e) => type(e.target.value)}
      />
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </div>
  )
}

const PACE_ICON: Record<Pace, ReactNode> = { slow: <TurtleIcon size={28} />, average: <WalkIcon size={28} />, fast: <RunIcon size={28} /> }
const MOBILITY_ICON: Record<Mobility, ReactNode> = {
  none: <SneakerIcon size={28} />,
  cane: <CaneIcon size={28} />,
  crutches: <CrutchesIcon size={28} />,
  wheelchair: <WheelchairIcon size={28} />,
  stroller: <StrollerIcon size={28} />,
}
const MOBILITY_SHORT: Record<Mobility, string> = { none: 'No aid', cane: 'Cane', crutches: 'Crutches', wheelchair: 'Wheelchair', stroller: 'Stroller' }

// Speed gauge range in m/s (covers every profile the model can produce).
const GAUGE_MIN = 0.5
const GAUGE_MAX = 2

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

  const speed = walkingSpeed(draft)
  const gauge = Math.min(1, Math.max(0, (speed - GAUGE_MIN) / (GAUGE_MAX - GAUGE_MIN)))
  // Walking pace measured from GPS this session: walking stretches only, never rides or bikes.
  const { walked } = useMotion()
  const measured = measuredPace(walked, speed)

  return (
    <>
      <div className="flex items-center gap-3 rounded-[var(--radius-sheet)] border border-line bg-surface p-4 shadow-[var(--shadow-float)]">
        <span aria-hidden className="grid size-13 shrink-0 place-items-center rounded-full bg-accent text-lg font-extrabold text-accent-ink">
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
                <span className="text-accent">{speed.toFixed(2)}</span>
                <span className="ml-1 text-xs font-bold text-muted">m/s</span>
              </span>
            </div>
            <div aria-hidden className="h-1.5 overflow-hidden rounded-full bg-high">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-500"
                style={{ width: `${Math.round(gauge * 100)}%` }}
              />
            </div>
            <p className="m-0 flex gap-1.5 text-xs text-muted">
              <LocateIcon size={14} className="mt-px shrink-0" />
              {measured
                ? `Your GPS measured ${measured.speed.toFixed(2)} m/s over ${Math.round(walked.meters)} m of walking (rides and bike stretches don't count). Rate your walk after a trip to teach DoorStep your pace.`
                : "Share your location and walk about 150 m to measure your real walking pace. Rides and bike stretches don't count."}
            </p>
          </div>
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
            <HeightField heightCm={draft.heightCm} onChange={(heightCm) => change({ heightCm })} />
          </div>
        </Card>

        {error && <Notice tone="error">{error}</Notice>}
        {saved && !dirty && <Notice tone="success">Saved. Arrival times on the map now use these settings.</Notice>}
        <Button type="submit" variant="primary" className="h-12" disabled={busy || !dirty}>
          {busy ? 'Saving…' : 'Save preferences'}
        </Button>
      </form>

      <Button variant="solid" className="h-12" onClick={onOpenMap}>
        Open map →
      </Button>
    </>
  )
}
