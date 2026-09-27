import type { Building, LatLng } from './types'
export type Destination = { building: Building; room: string }

/** Resolve map clicks without changing the point the user selected. */
export async function resolveLocationName(point: LatLng, placeId?: string): Promise<string> {
  if (placeId) {
    try {
      const { Place } = await google.maps.importLibrary('places') as google.maps.PlacesLibrary
      const place = new Place({ id: placeId })
      await place.fetchFields({ fields: ['displayName', 'formattedAddress'] })
      const name = place.displayName || place.formattedAddress
      if (name) return name
    } catch {
      // Try an address if Places details are unavailable.
    }
  }
  const { Geocoder } = await google.maps.importLibrary('geocoding') as google.maps.GeocodingLibrary
  const { results } = await new Geocoder().geocode(placeId ? { placeId } : { location: point })
  return results[0]?.formatted_address || `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`
}
