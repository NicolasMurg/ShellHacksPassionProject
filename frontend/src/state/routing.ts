import * as api from '../api'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LatLng, Place } from '../types'
import { loadCampusGraph, withShortcuts, type CampusGraph } from '../walkRouter'
import { shortcutsOf, useDoorways } from './doorways'
import type { WalkSample } from '../walkedPaths'

export type Geo = {
  position?: LatLng
  accuracy?: number
  /** Direction you're facing or moving, in degrees from north (compass, or GPS course). */
  heading?: number
  /** The phone's own (Doppler) speed in m/s, when it reports one. */
  speed?: number
  /** When this fix was taken (ms), so each one is only counted once. */
  timestamp?: number
  error?: string
  /** Phones that need permission for the compass (iOS) expose this; call it from a tap. */
  enableCompass?: () => void
}

// iOS exposes a compass heading on orientation events and needs a permission prompt.
type OrientationEventIOS = DeviceOrientationEvent & { webkitCompassHeading?: number }
type OrientationCtorIOS = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<'granted' | 'denied'> }

/** Which way the phone is pointing (undefined on laptops / without permission). */
function useCompass() {
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

/**
 * Turns a typed address into a point. It asks for a driving route from the
 * address to `toward` and reads where Google placed the start, so it works with
 * the same Directions access the rest of the app already uses (no Geocoding API).
 */
export async function findAddress(routes: google.maps.RoutesLibrary, address: string, toward: LatLng): Promise<Place> {
  let result: google.maps.DirectionsResult
  try {
    result = await new routes.DirectionsService().route({
      origin: address,
      destination: toward,
      travelMode: google.maps.TravelMode.DRIVING,
      region: 'us',
    })
  } catch {
    throw new Error('Couldn’t find that address. Try adding the city, e.g. “Dolphin Mall, Miami”.')
  }
  const leg = result.routes[0]?.legs[0]
  if (!leg?.start_location) throw new Error('Couldn’t find that address.')
  return { location: leg.start_location.toJSON(), label: leg.start_address || address }
}

/** Live GPS position (asks the browser for permission once). */
export function useGeolocation(onSample?: (sample: WalkSample) => void): Geo {
  const sampleHandler = useRef(onSample)
  useEffect(() => { sampleHandler.current = onSample }, [onSample])
  const [geo, setGeo] = useState<Geo>(() => (navigator.geolocation ? {} : { error: 'Location is not supported in this browser' }))
  const compass = useCompass()

  useEffect(() => {
    if (!navigator.geolocation) return
    const id = navigator.geolocation.watchPosition(
      ({ coords, timestamp }) => {
        setGeo((g) => ({
          position: { lat: coords.latitude, lng: coords.longitude },
          accuracy: coords.accuracy,
          speed: coords.speed !== null && !Number.isNaN(coords.speed) ? coords.speed : undefined,
          timestamp,
          // GPS only knows your course while you're moving; keep the last one otherwise.
          heading: coords.heading !== null && !Number.isNaN(coords.heading) && (coords.speed ?? 0) > 0.5 ? coords.heading : g.heading,
        }));
        sampleHandler.current?.({ lat: coords.latitude, lng: coords.longitude, timestamp, accuracy: coords.accuracy, speed: coords.speed })
      },
      (err) => setGeo((g) => ({ ...g, error: err.code === err.PERMISSION_DENIED ? 'Location permission denied' : 'Location unavailable' })),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [])

  return { ...geo, heading: compass.heading ?? geo.heading, enableCompass: compass.needsPermission ? compass.enable : undefined }
}

/**
 * The campus footpath network, once it has loaded: `base` is the mapped paths alone,
 * `graph` also has the user's linked doorways as shortcuts through buildings.
 */
export function useCampusGraphs(): { base?: CampusGraph; graph?: CampusGraph } {
  const [base, setBase] = useState<CampusGraph>()
  const doorways = useDoorways()
  useEffect(() => {
    loadCampusGraph()
      .then(setBase)
      .catch((err) => console.warn('Campus walkways unavailable, using Google for walks:', err))
  }, [])
  const graph = useMemo(() => base && withShortcuts(base, shortcutsOf(doorways)), [base, doorways])
  return { base, graph }
}

/** The campus footpath network with doorway shortcuts (for in-app walking navigation). */
export function useCampusGraph(): CampusGraph | undefined {
  return useCampusGraphs().graph
}

export type RouteInfo = { path: LatLng[]; seconds: number; meters: number; warnings: string[] }

/** Route calculation runs on the server; the browser only renders its path. */
export function useRoute(mode: 'DRIVING' | 'WALKING', from?: LatLng, to?: LatLng) {
  const key = from && to ? JSON.stringify({ mode, from: { lat: +from.lat.toFixed(4), lng: +from.lng.toFixed(4) }, to }) : undefined
  const [result, setResult] = useState<{ key: string; info?: RouteInfo; error?: string }>()
  useEffect(() => {
    if (!key) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      const input = JSON.parse(key) as { mode: 'DRIVING' | 'WALKING'; from: LatLng; to: LatLng }
      api.route(input.mode, input.from, input.to, controller.signal).then(info => {
        if (!controller.signal.aborted) setResult({ key, info })
      }).catch((e: Error) => { if (!controller.signal.aborted) setResult({ key, error: e.message }) })
    }, 300)
    return () => { clearTimeout(timer); controller.abort() }
  }, [key])
  return result?.key === key ? { info: result?.info, error: result?.error } : {}
}

export function useServerPlan(input: api.PlanInput | undefined, token: string | undefined, revision: string) {
  const key = input ? JSON.stringify({ input, token, revision }) : undefined
  const [result, setResult] = useState<{ key: string; data?: Awaited<ReturnType<typeof api.plan>>; error?: string }>()
  useEffect(() => {
    if (!key) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      const request = JSON.parse(key) as { input: api.PlanInput; token?: string }
      api.plan(request.input, request.token, controller.signal).then(data => {
        if (!controller.signal.aborted) setResult({ key, data })
      }).catch((e: Error) => { if (!controller.signal.aborted) setResult({ key, error: e.message }) })
    }, 300)
    return () => { clearTimeout(timer); controller.abort() }
  }, [key])
  return {
    data: result?.key === key ? result?.data : undefined, error: result?.key === key ? result?.error : undefined,
    loading: Boolean(key) && result?.key !== key
  }
}
