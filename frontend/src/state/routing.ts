import { useMapsLibrary } from '@vis.gl/react-google-maps'
import { useCallback, useEffect, useState } from 'react'
import type { LatLng } from '../types'
import { inCampus, loadCampusGraph, routeWalk, type CampusGraph } from '../walkRouter'

export type Geo = {
  position?: LatLng
  accuracy?: number
  /** Direction you're facing or moving, in degrees from north (compass, or GPS course). */
  heading?: number
  error?: string
  /** Phones that need permission for the compass (iOS) expose this; call it from a tap. */
  enableCompass?: () => void
}

type Compass = { heading?: number; needsPermission: boolean }

// iOS exposes a compass heading on orientation events and needs a permission prompt.
type OrientationEventIOS = DeviceOrientationEvent & { webkitCompassHeading?: number }
type OrientationCtorIOS = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<'granted' | 'denied'> }

/** Which way the phone is pointing (undefined on laptops / without permission). */
function useCompass(): Compass & { enable: () => void } {
  const needsPermission = typeof (window.DeviceOrientationEvent as OrientationCtorIOS | undefined)?.requestPermission === 'function'
  const [granted, setGranted] = useState(!needsPermission)
  const [heading, setHeading] = useState<number>()

  useEffect(() => {
    if (!granted || !('DeviceOrientationEvent' in window)) return
    const onOrient = (e: Event) => {
      const o = e as OrientationEventIOS
      if (typeof o.webkitCompassHeading === 'number') setHeading(o.webkitCompassHeading)
      else if (o.absolute && o.alpha !== null) setHeading((360 - o.alpha) % 360)
    }
    // Android Chrome sends true-north headings on 'deviceorientationabsolute'.
    window.addEventListener('deviceorientationabsolute', onOrient)
    window.addEventListener('deviceorientation', onOrient)
    return () => {
      window.removeEventListener('deviceorientationabsolute', onOrient)
      window.removeEventListener('deviceorientation', onOrient)
    }
  }, [granted])

  const enable = useCallback(() => {
    const ctor = window.DeviceOrientationEvent as OrientationCtorIOS | undefined
    ctor
      ?.requestPermission?.()
      .then((r) => setGranted(r === 'granted'))
      .catch(() => setGranted(false))
  }, [])

  return { heading, needsPermission: needsPermission && !granted, enable }
}

/** Live GPS position and heading (asks the browser for permission once). */
export function useGeolocation(): Geo {
  const [geo, setGeo] = useState<Geo>(() => (navigator.geolocation ? {} : { error: 'Location is not supported in this browser' }))
  const compass = useCompass()

  useEffect(() => {
    if (!navigator.geolocation) return
    const id = navigator.geolocation.watchPosition(
      ({ coords }) =>
        setGeo((g) => ({
          position: { lat: coords.latitude, lng: coords.longitude },
          accuracy: coords.accuracy,
          // GPS only knows your course while you're moving; keep the last one otherwise.
          heading: coords.heading !== null && !Number.isNaN(coords.heading) && (coords.speed ?? 0) > 0.5 ? coords.heading : g.heading,
        })),
      (err) => setGeo((g) => ({ ...g, error: err.code === err.PERMISSION_DENIED ? 'Location permission denied' : 'Location unavailable' })),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 15_000 },
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [])

  return {
    ...geo,
    heading: compass.heading ?? geo.heading,
    enableCompass: compass.needsPermission ? compass.enable : undefined,
  }
}

/** The campus footpath network, once it has loaded. */
export function useCampusGraph(): CampusGraph | undefined {
  const [graph, setGraph] = useState<CampusGraph>()
  useEffect(() => {
    loadCampusGraph()
      .then(setGraph)
      .catch((err) => console.warn('Campus walkways unavailable, using Google for walks:', err))
  }, [])
  return graph
}

export type RouteInfo = {
  path: LatLng[]
  seconds: number
  meters: number
  /** Driving only: where the route actually starts on the road (Google snaps you to the nearest drivable point). */
  roadStart?: LatLng
}

/**
 * A driving or walking route. Walks on campus use our own footpath router
 * (shorter, knows stairs); everything else asks Google. Undefined while loading.
 */
export function useRoute(mode: 'DRIVING' | 'WALKING', from?: LatLng, to?: LatLng, opts: { stepFree?: boolean } = {}): RouteInfo | undefined {
  const routes = useMapsLibrary('routes')
  const graph = useCampusGraph()
  const [result, setResult] = useState<{ key: string; info: RouteInfo }>()
  // Round so GPS jitter of a few meters doesn't trigger a new request.
  const key = from && to ? `${mode}|${from.lat.toFixed(4)},${from.lng.toFixed(4)}|${to.lat},${to.lng}` : undefined

  // Campus walks: computed locally and instantly, no request needed.
  const campus =
    mode === 'WALKING' && graph && from && to && inCampus(graph, from) && inCampus(graph, to)
      ? routeWalk(graph, from, to, { stepFree: opts.stepFree })
      : undefined

  const onCampusWalk = !!campus
  useEffect(() => {
    if (!key || !routes || !from || !to || onCampusWalk) return
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
            roadStart: mode === 'DRIVING' ? leg.start_location?.toJSON() : undefined,
          },
        })
      })
      .catch((err) => console.warn(`${mode} route unavailable:`, err))
    return () => {
      cancelled = true
    }
  }, [routes, key, onCampusWalk]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!from || !to) return undefined
  if (campus) return { path: campus.path, meters: campus.meters, seconds: campus.meters / 1.34 }
  if (result && result.key === key) return result.info
  return undefined
}
