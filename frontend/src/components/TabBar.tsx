import type { ReactNode } from 'react'
import { cx } from './cx'

export type Tab = 'preferences' | 'map'

const icon = (children: ReactNode) => (
  <svg aria-hidden viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
)

const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  {
    id: 'preferences',
    label: 'Preferences',
    icon: icon(
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21a8 8 0 0 1 16 0" />
      </>,
    ),
  },
  {
    id: 'map',
    label: 'Map',
    icon: icon(
      <>
        <path d="M9 4 3 6.5v13L9 17l6 3 6-2.5v-13L15 7 9 4Z" />
        <path d="M9 4v13M15 7v13" />
      </>,
    ),
  },
]

/**
 * Floating glass pill that switches between the main pages. Centered on
 * phones; on desktop it centers in the map area to the right of the side panel.
 */
export function TabBar({ tab, onTab }: { tab: Tab; onTab: (tab: Tab) => void }) {
  return (
    <nav
      aria-label="Main"
      className={cx(
        'absolute bottom-[max(12px,env(safe-area-inset-bottom))] left-1/2 z-50 -translate-x-1/2',
        // On the map (desktop), center it in the space right of the side panel.
        tab === 'map' && 'min-[900px]:left-[calc(452px+(100%-452px)/2)]',
      )}
    >
      <div className="flex gap-1 rounded-full border border-line bg-surface p-1.5 shadow-[var(--shadow-float)]">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-current={tab === t.id ? 'page' : undefined}
            onClick={() => onTab(t.id)}
            className={cx(
              'flex h-12 items-center gap-2 rounded-full px-5 text-sm font-bold transition-all',
              tab === t.id
                ? 'bg-accent/15 text-accent ring-1 ring-inset ring-accent/40'
                : 'text-muted hover:text-fg',
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>
    </nav>
  )
}
