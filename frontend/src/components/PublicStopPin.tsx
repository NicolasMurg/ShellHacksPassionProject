import type { PublicStop } from '../api'

/** A curbside car symbol keeps shared stopping points distinct from destination labels. */
export function PublicStopPin({ name, status, selected = false }: { name: string; status: PublicStop['status']; selected?: boolean }) {
  const statusLabel = status === 'VERIFIED' ? 'Verified' : status === 'DISPUTED' ? 'Disputed' : 'Unverified'
  return <div className="public-stop-pin" data-selected={selected} data-status={status} aria-label={`${name}, ${statusLabel.toLowerCase()} public stop`}>
    <svg aria-hidden viewBox="0 0 28 28" fill="none" className="size-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="m7 11 2-5h10l2 5M6 11h16v9H6zM6 16h16M9 13.5h1M18 13.5h1M8 20v2M20 20v2M5 25h18" />
    </svg>
    <span aria-hidden className="public-stop-status">{status === 'VERIFIED' ? '✓' : status === 'DISPUTED' ? '!' : '?'}</span>
    <span className="public-stop-caption"><span className="block text-[9px] font-extrabold uppercase tracking-wider">Public stop · {statusLabel}</span>{name}</span>
  </div>
}
