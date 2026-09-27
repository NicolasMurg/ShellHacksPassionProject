// Maps between a moment of a whole trip (seconds from the start) and a leg of it,
// for the video-style trip timeline.

type Chapter = { seconds: number }

/** Which leg a moment of the trip falls in, and how far into that leg (0–1). */
export function locateInTrip(chapters: Chapter[], seconds: number): { index: number; fraction: number } {
  if (chapters.length === 0) return { index: 0, fraction: 0 }
  let rest = Math.max(0, seconds)
  let index = 0
  while (index < chapters.length - 1 && rest >= chapters[index]!.seconds) {
    rest -= chapters[index]!.seconds
    index++
  }
  const length = Math.max(1e-9, chapters[index]!.seconds)
  return { index, fraction: Math.min(1, rest / length) }
}

/** Seconds from the start of the trip, given the current leg and time spent in it. */
export function tripElapsed(chapters: Chapter[], index: number, secondsIntoLeg: number): number {
  return chapters.slice(0, index).reduce((sum, c) => sum + c.seconds, 0) + Math.max(0, secondsIntoLeg)
}
