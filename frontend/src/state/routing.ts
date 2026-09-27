import * as api from '../api'
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
