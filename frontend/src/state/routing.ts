import { useMapsLibrary } from '@vis.gl/react-google-maps'
import { useEffect, useState } from 'react'
import type { LatLng } from '../types'

export type Geo = { position?: LatLng; accuracy?: number; error?: string }

/** Live GPS position (asks the browser for permission once). */
export function useGeolocation(): Geo {
  const [geo, setGeo] = useState<Geo>(() => (navigator.geolocation ? {} : { error: 'Location is not supported in this browser' }))

  useEffect(() => {
    if (!navigator.geolocation) return
    const id = navigator.geolocation.watchPosition(
      ({ coords }) => setGeo({ position: { lat: coords.latitude, lng: coords.longitude }, accuracy: coords.accuracy }),
      (err) => setGeo((g) => ({ ...g, error: err.code === err.PERMISSION_DENIED ? 'Location permission denied' : 'Location unavailable' })),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 15_000 },
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [])

  return geo
}

export type RouteInfo = { path: LatLng[]; seconds: number; meters: number }

/** A driving or walking route from Google. Undefined while loading or if Google has no route. */
export function useRoute(mode: 'DRIVING' | 'WALKING', from?: LatLng, to?: LatLng): RouteInfo | undefined {
  const routes = useMapsLibrary('routes')
  const [result, setResult] = useState<{ key: string; info: RouteInfo }>()
  // Round so GPS jitter of a few meters doesn't trigger a new request.
  const key = from && to ? `${mode}|${from.lat.toFixed(4)},${from.lng.toFixed(4)}|${to.lat},${to.lng}` : undefined

  useEffect(() => {
    if (!key || !routes || !from || !to) return
    let cancelled = false
    new routes.DirectionsService()
      .route({ origin: from, destination: to, travelMode: google.maps.TravelMode[mode] })
      .then((res) => {
        const route = res.routes[0]
        const leg = route?.legs[0]
        if (cancelled || !route || !leg) return
        const path = route.overview_path.map((p) => p.toJSON())
        setResult({
          key,
          info: {
            // Tie the ends back to the real points (Google snaps to the nearest road/path).
            path: mode === 'WALKING' ? [from, ...path, to] : [from, ...path],
            seconds: leg.duration?.value ?? 0,
            meters: leg.distance?.value ?? 0,
          },
        })
      })
      .catch((err) => console.warn(`${mode} route unavailable:`, err))
    return () => {
      cancelled = true
    }
  }, [routes, key]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!from || !to) return undefined
  if (result && result.key === key) return result.info
  return undefined
}
