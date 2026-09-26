import type { Building } from './types'

export type Destination = { building: Building; room: string }

const EXTRA_ALIASES: Record<string, string[]> = {
  gc: ['graham', 'graham center', 'student union'],
  gl: ['green library', 'library', 'green'],
  pc: ['primera casa', 'primera'],
  dm: ['deuxieme', 'deuxième', 'deuxieme maison'],
  rb: ['ryder', 'business', 'cbc'],
  obc: ['ocean bank', 'convocation', 'arena'],
}

/** "GC 150" → Graham Center, room 150. Local stand-in until GET /api/search exists. */
export function parseDestination(text: string, buildings: Building[]): Destination {
  const lower = text.toLowerCase().replace(/\b\d{1,2}(:\d{2})?\s*(am|pm)\b/, ' ')
  const building = buildings.find((b) =>
    [b.code.toLowerCase(), b.name.toLowerCase(), ...(EXTRA_ALIASES[b.id] ?? [])].some((alias) =>
      new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lower),
    ),
  )
  if (!building) throw new Error("Couldn't find that building. Try “GC 150” or “Green Library”.")
  const room = lower.match(/\b([a-z]?\d{2,4}[a-z]?)\b/)?.[1]?.toUpperCase() ?? ''
  return { building, room }
}
