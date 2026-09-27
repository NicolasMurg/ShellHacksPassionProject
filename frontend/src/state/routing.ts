import * as api from '../api'
import { useCallback, useEffect, useState } from 'react'
import type { LatLng } from '../types'
import { loadCampusGraph, type CampusGraph } from '../walkRouter'

export type Geo = {
  position?: LatLng
  accuracy?: number
  /** Direction you're facing or moving, in degrees from north (compass, or GPS course). */
  heading?: number
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

  return { ...geo, heading: compass.heading ?? geo.heading, enableCompass: compass.needsPermission ? compass.enable : undefined }
}

/** The campus footpath network (for in-app walking navigation), once it has loaded. */
export function useCampusGraph(): CampusGraph | undefined {
  const [graph, setGraph] = useState<CampusGraph>()
  useEffect(() => {
    loadCampusGraph()
      .then(setGraph)
      .catch((err) => console.warn('Campus walkways unavailable, using Google for walks:', err))
  }, [])
  return graph
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
