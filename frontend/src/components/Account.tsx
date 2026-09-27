import { useState } from 'react'
import { useAuth } from '../state/auth'
import { Button } from './ui'

type MenuProps = {
  onSignIn: () => void
  onPreferences: () => void
  onEditZones: () => void
  onReportClosure: () => void
}

/** Floating account button in the top-right corner. Sign-in and settings live on the Preferences tab. */
export function AccountMenu({ onSignIn, onPreferences, onEditZones, onReportClosure }: MenuProps) {
  const { user, logout } = useAuth()
  const [open, setOpen] = useState(false)

  if (!user) {
    return (
      <Button variant="ghost" className="border-line bg-surface shadow-[var(--shadow-float)]" onClick={onSignIn}>
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
        className="grid size-11 place-items-center rounded-full bg-accent font-extrabold text-accent-ink shadow-[var(--shadow-float)]"
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
          {item('Preferences', onPreferences)}
          {item('Edit my zones', onEditZones)}
          {item('Report a closed road', onReportClosure)}
          <hr className="my-1 border-line" />
          {item('Sign out', logout)}
        </div>
      )}
    </div>
  )
}
