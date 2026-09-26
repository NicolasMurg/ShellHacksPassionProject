import { useState, type FormEvent } from 'react'
import { useAuth } from '../state/auth'
import type { Mobility, WalkingProfile } from '../types'
import { MOBILITY_LABEL, walkingSpeed } from '../walking'
import { Button, Field, Modal, Notice, inputClass } from './ui'

type MenuProps = {
  onSignIn: () => void
  onProfile: () => void
  onEditZones: () => void
  onReportClosure: () => void
}

/** Floating account button in the top-right corner. */
export function AccountMenu({ onSignIn, onProfile, onEditZones, onReportClosure }: MenuProps) {
  const { user, logout } = useAuth()
  const [open, setOpen] = useState(false)

  if (!user) {
    return (
      <Button variant="ghost" className="bg-surface shadow-[var(--shadow-float)]" onClick={onSignIn}>
        Sign in
      </Button>
    )
  }

  const initials = user.name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  const item = (label: string, action: () => void) => (
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        setOpen(false)
        action()
      }}
      className="w-full rounded-lg px-3 py-2.5 text-left font-semibold hover:bg-high"
    >
      {label}
    </button>
  )

  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account"
        onClick={() => setOpen((o) => !o)}
        className="grid size-11 place-items-center rounded-full bg-gradient-to-br from-accent to-[#2a8cff] font-extrabold text-accent-ink shadow-[var(--shadow-float)]"
      >
        {initials || '?'}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-13 w-60 rounded-2xl border border-line bg-surface p-1.5 shadow-[var(--shadow-float)]">
          <p className="m-0 px-3 py-2 text-sm">
            <span className="block font-bold">{user.name}</span>
            <span className="text-xs text-muted">{user.email}</span>
          </p>
          <hr className="my-1 border-line" />
          {item('Walking profile', onProfile)}
          {item('Edit my zones', onEditZones)}
          {item('Report a closed road', onReportClosure)}
          <hr className="my-1 border-line" />
          {item('Sign out', logout)}
        </div>
      )}
    </div>
  )
}

export function LoginModal({ onClose, onNewUser }: { onClose: () => void; onNewUser: () => void }) {
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
      const user = await login(name, email)
      onClose()
      if (!user.profile.age && !user.profile.heightCm) onNewUser()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Sign in to Doorstep" onClose={onClose}>
      <p className="m-0 text-sm text-muted">Save your own drop-off zones and get walk times based on your pace.</p>
      <form onSubmit={submit} className="flex flex-col gap-3.5">
        <Field label="Name">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
        </Field>
        <Field label="Email">
          <input className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </Field>
        {error && <Notice tone="error">{error}</Notice>}
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'Signing in…' : 'Continue'}
        </Button>
      </form>
    </Modal>
  )
}

export function ProfileModal({ onClose }: { onClose: () => void }) {
  const { user, saveProfile } = useAuth()
  const [draft, setDraft] = useState<WalkingProfile>(user?.profile ?? { mobility: 'none', learnedFactor: 1 })
  const [busy, setBusy] = useState(false)

  if (!user) return null

  const num = (v: string) => (v === '' ? undefined : Number(v))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await saveProfile(draft)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Your walking profile" onClose={onClose}>
      <p className="m-0 text-sm text-muted">We use this to estimate how long the walk from the curb to your room takes. It stays in your account.</p>
      <form onSubmit={submit} className="flex flex-col gap-3.5">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Age">
            <input className={inputClass} type="number" min={5} max={110} value={draft.age ?? ''} onChange={(e) => setDraft({ ...draft, age: num(e.target.value) })} />
          </Field>
          <Field label="Height (cm)">
            <input
              className={inputClass}
              type="number"
              min={80}
              max={230}
              value={draft.heightCm ?? ''}
              onChange={(e) => setDraft({ ...draft, heightCm: num(e.target.value) })}
            />
          </Field>
        </div>
        <Field label="How do you get around?" hint="Wheelchair and stroller users are only routed to step-free entrances.">
          <select className={inputClass} value={draft.mobility} onChange={(e) => setDraft({ ...draft, mobility: e.target.value as Mobility })}>
            {(Object.keys(MOBILITY_LABEL) as Mobility[]).map((m) => (
              <option key={m} value={m}>
                {MOBILITY_LABEL[m]}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex items-center justify-between rounded-xl bg-raised px-3.5 py-3">
          <span className="text-sm">
            <span className="block font-semibold">Estimated pace</span>
            <span className="text-xs text-muted">
              {draft.learnedFactor === 1 ? 'Adjusts as you rate your walks' : `Adjusted from your past trips (×${(1 / draft.learnedFactor).toFixed(2)})`}
            </span>
          </span>
          <span className="text-lg font-extrabold text-accent">{walkingSpeed(draft).toFixed(2)} m/s</span>
        </div>
        {draft.learnedFactor !== 1 && (
          <Button variant="quiet" className="h-8 self-start px-0 text-sm" onClick={() => setDraft({ ...draft, learnedFactor: 1 })}>
            Reset learned pace
          </Button>
        )}
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save profile'}
        </Button>
      </form>
    </Modal>
  )
}
