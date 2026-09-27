import { useMapsLibrary } from '@vis.gl/react-google-maps'
import { useEffect, useMemo, useState } from 'react'
import * as api from '../api'
import { distanceMeters } from '../geo'
import type { LatLng, StopOption } from '../types'
import { routeWalk, type CampusGraph } from '../walkRouter'

// Extra signals that make a stop smarter: Gemini's curb check, live weather,
// slope from elevation data, and how much walking DoorStep saves.

// ---------------------------------------------------------------------------
// AI curb check (Gemini + Street View, on the server). Cached per spot.
// ---------------------------------------------------------------------------

const curbChecks = new Map<string, Promise<api.CurbAudit>>()

export function useCurbCheck(stop?: LatLng, door?: LatLng) {
  const key = stop ? [stop, door].map((p) => (p ? `${p.lat.toFixed(5)},${p.lng.toFixed(5)}` : '')).join('|') : undefined
  const [result, setResult] = useState<{ key: string; audit?: api.CurbAudit; error?: string }>()
  useEffect(() => {
    if (!key || !stop) return
    let cancelled = false
    let request = curbChecks.get(key)
    if (!request) {
      request = api.curbCheck(stop, door)
      curbChecks.set(key, request)
      request.catch(() => curbChecks.delete(key))
    }
    request
      .then((audit) => !cancelled && setResult({ key, audit }))
      .catch((e: Error) => !cancelled && setResult({ key, error: e.message }))
    return () => {
      cancelled = true
    }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!key) return {}
  return result?.key === key ? { audit: result.audit, error: result.error } : { loading: true }
}

// ---------------------------------------------------------------------------
// Weather at FIU (Open-Meteo: free, no key). Rain or heat → shortest walk outside first.
// Add ?weather=rain or ?weather=heat to the URL to demo it on a clear day.
// ---------------------------------------------------------------------------

export type Weather = { kind: 'rain' | 'heat' | 'clear'; tempC?: number; label: string; demo: boolean }

const RAIN_CODES = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99])

function describe(kind: Weather['kind'], tempC: number | undefined, demo: boolean): Weather {
  const temp = tempC === undefined ? '' : ` · ${Math.round(tempC)}°C`
  const label = kind === 'rain' ? `Raining at FIU${temp}` : kind === 'heat' ? `Hot out at FIU${temp}` : `Clear at FIU${temp}`
  return { kind, tempC, label, demo }
}

export function useWeather(at: LatLng): Weather | undefined {
  const forced = new URLSearchParams(location.search).get('weather')
  const demo = forced === 'rain' || forced === 'heat' ? forced : undefined
  const [live, setLive] = useState<Weather>()
  useEffect(() => {
    if (demo) return
    const controller = new AbortController()
    const load = () =>
      fetch(`https://api.open-meteo.com/v1/forecast?latitude=${at.lat.toFixed(3)}&longitude=${at.lng.toFixed(3)}&current=temperature_2m,apparent_temperature,precipitation,weather_code`, { signal: controller.signal })
        .then((r) => r.json() as Promise<{ current?: { temperature_2m: number; apparent_temperature: number; precipitation: number; weather_code: number } }>)
        .then(({ current: c }) => {
          if (!c) return
          const kind = c.precipitation > 0.1 || RAIN_CODES.has(c.weather_code) ? 'rain' : c.apparent_temperature >= 35 ? 'heat' : 'clear'
          setLive(describe(kind, c.temperature_2m, false))
        })
        .catch(() => {})
    load()
    const id = setInterval(load, 15 * 60_000)
    return () => {
      controller.abort()
      clearInterval(id)
    }
  }, [demo, at.lat, at.lng])
  return demo ? describe(demo, undefined, true) : live
}

// ---------------------------------------------------------------------------
// Slope along a walk (Google Elevation). ADA: walks steeper than 5% need ramp design.
// ---------------------------------------------------------------------------

export type Slope = { maxGrade: number; climbM: number }

const WINDOW_M = 25 // grade is measured over ~25 m stretches to smooth out elevation noise

export function useSlope(path?: LatLng[], enabled = true): Slope | undefined {
  const lib = useMapsLibrary('elevation')
  const key = enabled && path && path.length > 1 ? JSON.stringify([path[0], path.at(-1), path.length]) : undefined
  const [result, setResult] = useState<{ key: string; slope?: Slope }>()
  useEffect(() => {
    if (!lib || !key || !path) return
    let cancelled = false
    let meters = 0
    for (let i = 1; i < path.length; i++) meters += distanceMeters(path[i - 1], path[i])
    const samples = Math.min(100, Math.max(2, Math.round(meters / 10) + 1))
    const step = Math.max(1, Math.ceil(path.length / 200)) // the API caps the path it accepts
    const thinned = path.filter((_, i) => i % step === 0 || i === path.length - 1)
    new lib.ElevationService()
      .getElevationAlongPath({ path: thinned, samples })
      .then(({ results }) => {
        if (cancelled || results.length < 2) return
        const spacing = meters / (results.length - 1)
        const span = Math.max(1, Math.round(WINDOW_M / Math.max(spacing, 1)))
        let maxGrade = 0
        let climbM = 0
        for (let i = 0; i + span < results.length; i++) {
          maxGrade = Math.max(maxGrade, Math.abs(results[i + span].elevation - results[i].elevation) / (span * spacing))
        }
        for (let i = 1; i < results.length; i++) climbM += Math.max(0, results[i].elevation - results[i - 1].elevation)
        setResult({ key, slope: { maxGrade, climbM } })
      })
      .catch(() => {}) // Elevation API not enabled for this key: just skip the badge
    return () => {
      cancelled = true
    }
  }, [lib, key]) // eslint-disable-line react-hooks/exhaustive-deps
  return result?.key === key ? result?.slope : undefined
}

// ---------------------------------------------------------------------------
// Time saved vs. the address pin: ride apps stop where Google's driving route to
// the building's single address pin ends; DoorStep stops at the curb for your door.
// ---------------------------------------------------------------------------

export function useTimeSaved(graph: CampusGraph | undefined, pinCurb: LatLng | undefined, options: StopOption[], stepFree: boolean, speedMps: number) {
  const key = options.map((o) => o.zone.id).join(',')
  return useMemo(() => {
    const saved = new Map<string, number>()
    if (!graph || !pinCurb) return saved
    const walk = (from: LatLng, to: LatLng) => routeWalk(graph, from, to, { stepFree })?.meters
    for (const o of options) {
      const fromPin = walk(pinCurb, o.entrance.location)
      const fromStop = walk(o.zone.stopPoint, o.entrance.location)
      if (fromPin === undefined || fromStop === undefined) continue
      saved.set(o.zone.id, (fromPin - fromStop) / speedMps)
    }
    return saved
  }, [graph, pinCurb?.lat, pinCurb?.lng, key, stepFree, speedMps]) // eslint-disable-line react-hooks/exhaustive-deps
}
