import type { ReactNode } from 'react'
import { cx } from './cx'
import { MapIcon, PersonIcon } from './icons'

export type Tab = 'preferences' | 'map'

const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  { id: 'preferences', label: 'Preferences', icon: <PersonIcon size={20} /> },
  { id: 'map', label: 'Map', icon: <MapIcon size={20} /> },
]

/**
 * Compact switch between the main pages, pinned to the top-right corner so it
 * sits in exactly the same spot on the map and on Preferences.
 */
export function TabBar({ tab, onTab }: { tab: Tab; onTab: (tab: Tab) => void }) {
  return (
    <nav aria-label="Main" className="absolute right-4 top-[max(16px,env(safe-area-inset-top))] z-50">
      <div className="flex gap-1 rounded-full border border-line bg-surface p-1 shadow-[var(--shadow-float)]">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-label={t.label}
            title={t.label}
            aria-current={tab === t.id ? 'page' : undefined}
            onClick={() => onTab(t.id)}
            className={cx(
              'grid size-9 place-items-center rounded-full transition-colors',
              tab === t.id ? 'bg-accent/15 text-accent ring-1 ring-inset ring-accent/40' : 'text-muted hover:text-fg',
            )}
          >
            {t.icon}
          </button>
        ))}
      </div>
    </nav>
  )
}
