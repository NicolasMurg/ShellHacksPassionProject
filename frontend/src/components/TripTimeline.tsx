import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { cx } from './cx'

// A video-style timeline for a simulated trip: one chapter per leg (walk, ride, walk),
// click or drag anywhere to jump there, hover to preview, play/pause, arrow keys.
// Times are real trip time (the simulation itself plays faster).

export type TimelineChapter = { label: string; icon: string; seconds: number }

type Props = {
  chapters: TimelineChapter[]
  /** Seconds into the whole trip right now. */
  elapsed: number
  playing: boolean
  onPlayPause: () => void
  /** Jump to this many seconds into the trip. `commit` is false while dragging, true on release/click/keys. */
  onSeek: (seconds: number, commit: boolean) => void
}

const KEY_STEP_S = 5

function formatTripTime(seconds: number) {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** Which chapter a moment falls in. */
function chapterAt(chapters: TimelineChapter[], seconds: number) {
  let start = 0
  for (const [i, c] of chapters.entries()) {
    if (seconds < start + c.seconds || i === chapters.length - 1) return c
    start += c.seconds
  }
  return chapters[0]
}

export function TripTimeline({ chapters, elapsed, playing, onPlayPause, onSeek }: Props) {
  const bar = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<number>() // seconds under the finger/cursor while dragging
  const [hover, setHover] = useState<{ seconds: number; x: number; width: number }>()
  const total = Math.max(1, chapters.reduce((sum, c) => sum + c.seconds, 0))
  const shown = Math.min(total, Math.max(0, drag ?? elapsed))

  const at = (clientX: number) => {
    const box = bar.current!.getBoundingClientRect()
    const x = Math.min(box.width, Math.max(0, clientX - box.left))
    return { seconds: (x / Math.max(1, box.width)) * total, x, width: box.width }
  }

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const { seconds } = at(e.clientX)
    setDrag(seconds)
    onSeek(seconds, false)
  }
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const p = at(e.clientX)
    setHover(p)
    if (drag === undefined) return
    setDrag(p.seconds)
    onSeek(p.seconds, false)
  }
  const up = (e: PointerEvent<HTMLDivElement>) => {
    if (drag === undefined) return
    const { seconds } = at(e.clientX)
    setDrag(undefined)
    onSeek(seconds, true)
  }
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const to =
      e.key === 'ArrowRight' || e.key === 'ArrowUp'
        ? elapsed + KEY_STEP_S
        : e.key === 'ArrowLeft' || e.key === 'ArrowDown'
          ? elapsed - KEY_STEP_S
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? total
              : undefined
    if (to !== undefined) {
      e.preventDefault()
      onSeek(Math.min(total, Math.max(0, to)), true)
    } else if (e.key === ' ' || e.key === 'k') {
      e.preventDefault()
      onPlayPause()
    }
  }

  // Chapter boundaries, as fractions of the trip.
  const boundaries: number[] = []
  chapters.slice(0, -1).reduce((start, c) => {
    boundaries.push((start + c.seconds) / total)
    return start + c.seconds
  }, 0)
  const preview = hover && (drag === undefined ? hover.seconds : drag)
  const previewChapter = preview !== undefined ? chapterAt(chapters, preview) : undefined
  const scrubbing = drag !== undefined

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={onPlayPause}
        aria-label={playing ? 'Pause the simulated trip' : 'Play the simulated trip'}
        className="grid size-10 shrink-0 place-items-center rounded-full bg-accent text-base font-black text-accent-ink hover:brightness-110"
      >
        <span aria-hidden>{playing ? '❚❚' : '▶'}</span>
      </button>

      <div className="min-w-0 flex-1">
        <div
          ref={bar}
          role="slider"
          tabIndex={0}
          aria-label="Trip timeline"
          aria-valuemin={0}
          aria-valuemax={Math.round(total)}
          aria-valuenow={Math.round(shown)}
          aria-valuetext={`${formatTripTime(shown)} of ${formatTripTime(total)}, ${chapterAt(chapters, shown).label}`}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onPointerLeave={() => !scrubbing && setHover(undefined)}
          onKeyDown={key}
          className="group relative h-7 cursor-pointer touch-none select-none rounded-full focus-visible:outline-2 focus-visible:outline-accent"
        >
          {/* Track: played part in accent, rest dim, with gaps between chapters. */}
          <div
            className={cx(
              'absolute inset-x-0 top-1/2 -translate-y-1/2 overflow-hidden rounded-full bg-high transition-[height]',
              scrubbing ? 'h-2' : 'h-1.5 group-hover:h-2',
            )}
          >
            {hover && !scrubbing && (
              <div className="absolute inset-y-0 left-0 bg-fg/15" style={{ width: `${(hover.seconds / total) * 100}%` }} />
            )}
            <div className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${(shown / total) * 100}%` }} />
            {boundaries.map((b) => (
              <div key={b} className="absolute inset-y-0 w-[3px] -translate-x-1/2 bg-surface" style={{ left: `${b * 100}%` }} />
            ))}
          </div>

          {/* Handle */}
          <div
            className={cx(
              'absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent shadow-[0_0_0_4px_rgb(46_230_214/0.25)] transition-transform',
              scrubbing ? 'scale-110' : 'scale-90 group-hover:scale-100',
            )}
            style={{ left: `${(shown / total) * 100}%` }}
          />

          {/* Hover / drag preview, like a video player's */}
          {hover && previewChapter && preview !== undefined && (
            <div
              className="pointer-events-none absolute bottom-full mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-lg border border-line bg-surface px-2 py-1 text-[11px] font-bold shadow-[var(--shadow-float)]"
              style={{ left: Math.min(Math.max(hover.x, 40), hover.width - 40) }}
            >
              <span aria-hidden>{previewChapter.icon}</span> {previewChapter.label} · {formatTripTime(preview)}
            </div>
          )}
        </div>

        <div className="flex justify-between text-[11px] font-semibold tabular-nums text-muted">
          <span>
            {formatTripTime(shown)} / {formatTripTime(total)}
          </span>
          <span>
            <span aria-hidden>{chapterAt(chapters, shown).icon}</span> {chapterAt(chapters, shown).label}
          </span>
        </div>
      </div>
    </div>
  )
}
