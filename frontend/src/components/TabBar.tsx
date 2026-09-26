import type { ReactNode } from 'react'
import { cx } from './cx'

export type Tab = 'preferences' | 'map'

const icon = (children: ReactNode) => (
  <svg aria-hidden viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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

/** The bar along the bottom of the screen that switches between the main pages. */
export function TabBar({ tab, onTab }: { tab: Tab; onTab: (tab: Tab) => void }) {
  return (
    <nav aria-label="Main" className="z-30 shrink-0 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto flex max-w-md">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-current={tab === t.id ? 'page' : undefined}
            onClick={() => onTab(t.id)}
            className={cx(
              'flex h-16 flex-1 flex-col items-center justify-center gap-1 text-xs font-bold transition-colors',
              tab === t.id ? 'text-accent' : 'text-muted hover:text-fg',
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
