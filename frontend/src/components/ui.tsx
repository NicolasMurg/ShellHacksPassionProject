import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cx } from './cx'


type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' | 'quiet' }

export function Button({ variant = 'ghost', className, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={cx(
        'inline-flex h-11 items-center justify-center gap-2 rounded-full px-4 font-bold transition-colors disabled:opacity-40',
        variant === 'primary' && 'bg-accent text-accent-ink hover:brightness-110',
        variant === 'ghost' && 'border border-line bg-high text-fg hover:border-accent',
        variant === 'danger' && 'border border-closed/40 bg-closed/10 text-closed hover:bg-closed/20',
        variant === 'quiet' && 'text-muted hover:text-fg',
        className,
      )}
      {...rest}
    />
  )
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="flex min-h-11 cursor-pointer select-none items-center gap-2.5">
      <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span
        aria-hidden
        className="relative h-[26px] w-[42px] rounded-full bg-high transition-colors after:absolute after:left-[3px] after:top-[3px] after:size-5 after:rounded-full after:bg-fg after:transition-transform peer-checked:bg-accent peer-checked:after:translate-x-4 peer-checked:after:bg-accent-ink peer-focus-visible:outline-2 peer-focus-visible:outline-accent"
      />
      <span className="font-semibold">{label}</span>
    </label>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: { value: T; label: ReactNode }[]
  onChange: (v: T) => void
  label: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-full bg-raised p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'h-10 flex-1 rounded-full px-3 font-semibold transition-colors',
            value === o.value ? 'bg-high text-fg' : 'text-muted hover:text-fg',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-semibold">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  )
}

export const inputClass =
  'h-11 w-full rounded-xl border border-line bg-raised px-3.5 font-medium placeholder:text-muted focus:border-accent focus:outline-none'

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'error' | 'success'; children: ReactNode }) {
  return (
    <p
      className={cx(
        'm-0 rounded-xl px-3.5 py-2.5 text-sm',
        tone === 'info' && 'bg-raised text-muted',
        tone === 'error' && 'bg-closed/10 text-closed',
        tone === 'success' && 'bg-accent/10 text-accent',
      )}
    >
      {children}
    </p>
  )
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-end bg-black/60 p-0 sm:place-items-center sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full flex-col gap-4 overflow-y-auto rounded-t-[var(--radius-sheet)] border border-line bg-surface p-5 pb-[max(20px,env(safe-area-inset-bottom))] shadow-[var(--shadow-float)] sm:max-w-md sm:rounded-[var(--radius-sheet)]"
      >
        <div className="flex items-center justify-between">
          <h2 className="m-0 text-lg font-extrabold tracking-tight">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="size-9 rounded-full text-xl text-muted hover:text-fg">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

/** Bottom sheet on phones, floating side panel on desktop. */
export function Sheet({ expanded, onToggle, children }: { expanded: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <section
      aria-label="Doorstep panel"
      className={cx(
        'absolute inset-x-0 bottom-0 z-20 flex flex-col rounded-t-[var(--radius-sheet)] border-t border-line bg-surface shadow-[var(--shadow-float)] transition-[max-height] duration-300',
        expanded ? 'max-h-[72vh]' : 'max-h-[30vh]',
        'min-[900px]:inset-y-4 min-[900px]:left-4 min-[900px]:right-auto min-[900px]:max-h-none min-[900px]:w-[420px] min-[900px]:rounded-[var(--radius-sheet)] min-[900px]:border',
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-label={expanded ? 'Collapse panel' : 'Expand panel'}
        className="relative h-6 w-16 shrink-0 self-center after:absolute after:left-1/2 after:top-2.5 after:h-[5px] after:w-10 after:-translate-x-1/2 after:rounded-full after:bg-high min-[900px]:hidden"
      />
      <div className="flex flex-col gap-4 overflow-y-auto overscroll-contain px-4 pb-5 pt-0.5 min-[900px]:px-5 min-[900px]:py-5">
        {children}
      </div>
    </section>
  )
}

