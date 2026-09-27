import type { Zone } from './types'

/** Shared zones, with the user's personal versions replacing the ones they customized or hid. */
export function visibleZones(defaults: Zone[], personal: Zone[]): Zone[] {
  const replaced = new Set(personal.map((z) => z.basedOnZoneId).filter(Boolean))
  return [...defaults.filter((z) => !replaced.has(z.id)), ...personal.filter((z) => !z.hidden)]
}
