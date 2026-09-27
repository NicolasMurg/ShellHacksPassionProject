import type { Building } from './types'

export type Destination = { building: Building; room: string }

/** Everyday names students use, by FIU building code. */
const ALIASES: Record<string, string[]> = {
  GC: ['graham', 'student union', 'food court'],
  GL: ['green library', 'library'],
  PC: ['primera casa', 'charles perry', 'perry'],
  DM: ['deuxieme', 'deuxième'],
  RB: ['ryder'],
  CBC: ['business complex', 'college of business'],
  OBCC: ['ocean bank', 'arena', 'convocation'],
  CASE: ['computing arts'],
  PG5: ['market station'],
  PG6: ['tech station'],
  RDB: ['law school', 'diaz-balart', 'diaz balart'],
  WPAC: ['performing arts'],
  RC: ['rec center', 'recreation'],
  WFC: ['gym', 'wellness', 'fitness'],
  SHC: ['health center', 'student health'],
  UT: ['university towers'],
  PBST: ['stadium', 'pitbull'],
  PPFAM: ['frost museum', 'art museum'],
  SASC: ['success center'],
  IC: ['information center'],
  ZEB: ['ziff', 'education building'],
  PCA: ['architecture', 'cejas'],
  SIPA: ['international and public affairs'],
  ASTRO: ['astroscience', 'stocker', 'planetarium'],
}

const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** "GC 150" / "green library 420" / "rec center" → building + room. Local stand-in for a backend Places lookup. */
export function parseDestination(text: string, buildings: Building[]): Destination {
  const q = normalize(text.replace(/\b\d{1,2}(:\d{2})?\s*(am|pm)\b/i, ' '))
  const tokens = q.split(' ')

  const byCode = (code: string) => buildings.find((b) => b.code.toLowerCase() === code)
  const building =
    // 1. The first word is a building code ("gc 150", "case 241").
    byCode(tokens[0]) ??
    // 2. A full building name or a known nickname appears in the text.
    buildings.find((b) => q.includes(normalize(b.name))) ??
    buildings.find((b) => (ALIASES[b.code] ?? []).some((a) => q.includes(normalize(a)))) ??
    // 3. Any code appears as its own word (skipping short ones that are also English words).
    buildings.find((b) => b.code.length >= 3 && tokens.includes(b.code.toLowerCase())) ??
    // 4. Every word typed appears in the building's name ("business building").
    buildings.find((b) => {
      const words = tokens.filter((t) => t.length >= 3 && !/^\d/.test(t))
      const name = normalize(b.name)
      return words.length > 0 && words.every((w) => name.includes(w))
    })

  if (!building) throw new Error("Couldn't find that building. Try “GC 150”, “CASE 241” or “Green Library”.")
  const room = text.match(/\b([a-z]?\d{2,4}[a-z]?)\b/i)?.[1]?.toUpperCase() ?? ''
  return { building, room }
}
