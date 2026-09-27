import type { Building } from './types'
export type Destination = { building: Building; room: string }

/** Sentences ("drop me at the library at 9") go to Gemini; short queries like "GC 150" use the normal search. */
export const looksLikeSentence = (text: string) => text.trim().split(/\s+/).length >= 4
