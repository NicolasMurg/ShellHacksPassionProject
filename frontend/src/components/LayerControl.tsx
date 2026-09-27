import { useEffect, useRef, useState } from 'react'
import { MAP_STYLES, type MapLayers, type MapStyle } from '../mapLayers'
import { cx } from './cx'
import { Switch } from './ui'

// Small painted previews of each base map.
const SWATCH: Record<MapStyle, string> = {
  dark: 'linear-gradient(135deg, #1a1e24 0 44%, #4a525e 44% 56%, #262b34 56%)',
  light: 'linear-gradient(135deg, #e4e8ed 0 44%, #ffffff 44% 56%, #d7dde5 56%)',
  satellite: 'radial-gradient(circle at 30% 30%, #6b8a52, #3d5234 60%, #2c3a27)',
  hybrid:
    'linear-gradient(135deg, transparent 0 46%, #f5d77a 46% 54%, transparent 54%), radial-gradient(circle at 30% 30%, #6b8a52, #3d5234 60%, #2c3a27)',
}

/** Floating button in the top-right corner that picks the base map and overlays. */
export function LayerControl({ value, onChange }: { value: MapLayers; onChange: (layers: MapLayers) => void }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  // Close when clicking anywhere else or pressing Escape.
  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Map layers"
        title="Map layers"
        onClick={() => setOpen((o) => !o)}
        className={cx(
          'grid size-11 place-items-center rounded-full border bg-surface shadow-[var(--shadow-float)] transition-colors hover:border-accent',
          open ? 'border-accent text-accent' : 'border-line text-fg',
        )}
      >
        <svg aria-hidden viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
          <path d="M12 3 2 8.5 12 14l10-5.5L12 3Z" />
          <path d="m2 13.5 10 5.5 10-5.5" />
        </svg>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Map layers"
          className="absolute right-0 top-13 flex w-72 flex-col gap-3 rounded-2xl border border-line bg-surface p-3 shadow-[var(--shadow-float)]"
        >
          <div className="flex flex-col gap-2">
            <span className="px-1 text-xs font-bold uppercase tracking-wide text-muted">Map style</span>
            <div role="radiogroup" aria-label="Map style" className="grid grid-cols-2 gap-2">
              {(Object.keys(MAP_STYLES) as MapStyle[]).map((style) => {
                const checked = value.style === style
                return (
                  <button
                    key={style}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    onClick={() => onChange({ ...value, style })}
                    className={cx(
                      'flex flex-col gap-1.5 rounded-xl border-2 p-1.5 text-xs font-semibold transition-colors',
                      checked ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg',
                    )}
                  >
                    <span aria-hidden className="h-11 w-full rounded-lg border border-line" style={{ background: SWATCH[style] }} />
                    {MAP_STYLES[style].label}
                  </button>
                )
              })}
            </div>
          </div>

          <hr className="m-0 border-line" />

          <div className="flex flex-col px-1">
            <span className="text-xs font-bold uppercase tracking-wide text-muted">Overlays</span>
            <Switch checked={value.traffic} onChange={(traffic) => onChange({ ...value, traffic })} label="Traffic" />
            <Switch checked={value.transit} onChange={(transit) => onChange({ ...value, transit })} label="Transit lines" />
          </div>
        </div>
      )}
    </div>
  )
}
