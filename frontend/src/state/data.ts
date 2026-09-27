import { useCallback, useEffect, useMemo, useState, useRef } from 'react'
import * as api from '../api'
import { distanceMeters, rect } from '../geo'
import { visibleZones } from '../planner'
import type { Building, LatLng, RoadClosure, User, Zone } from '../types'

/** Buildings, their entrances, and the shared zones (generated curbs + design-team zones). */
export function useCampus() {
  const [buildings, setBuildings] = useState<Building[]>([])
  const [defaults, setDefaults] = useState<Zone[]>([])
  const [error, setError] = useState<string>()
  useEffect(() => {
    let active = true
    Promise.all([api.getBuildings(), api.getDefaultZones()]).then(([b, z]) => {
      if (active) { setBuildings(b); setDefaults(z) }
    }).catch((e: Error) => { if (active) setError(e.message) })
    return () => { active = false }
  }, [])
  const entrances = useMemo(() => new Map(buildings.flatMap(b => b.entrances.map(e => [e.id, e] as const))), [buildings])
  return { buildings, entrances, defaults, error }
}

/** The signed-in user's personal zones, merged over the shared ones. */
export function useZones(defaults: Zone[], buildings: Building[], user?: User, token?: string) {
  const [mine, setMine] = useState<{ token?: string; zones: Zone[] }>({ zones: [] })
  const [error, setError] = useState<string>()
  const writes = useRef(new Map<string, Promise<void>>())

  useEffect(() => {
    if (!token) return
    let active = true
    api.getMyZones(token).then(zones => { if (active) setMine({ token, zones }) })
      .catch((e: Error) => { if (active) setError(e.message) })
    return () => { active = false }
  }, [token])

  const personal = useMemo(() => (token && mine.token === token ? mine.zones : []), [mine, token])
  const zones = useMemo(() => visibleZones(defaults, personal), [defaults, personal])

  const upsert = useCallback(async (zone: Zone) => {
    if (!token) return
    const key = `${token}:${zone.id}`
    const task = (writes.current.get(key) ?? Promise.resolve()).then(async () => {
      try {
        const saved = await api.saveMyZone(token, zone)
        setMine(m => {
          const previous = m.token === token ? m.zones : []; return {
            token,
            zones: previous.some(z => z.id === saved.id) ? previous.map(z => z.id === saved.id ? saved : z) : [...previous, saved]
          }
        })
        setError(undefined)
      } catch (e) { setError((e as Error).message) }
    })
    writes.current.set(key, task)
    await task
    if (writes.current.get(key) === task) writes.current.delete(key)
  }, [token])

  const remove = useCallback(async (zone: Zone) => {
    if (!token) return
    try {
      await writes.current.get(`${token}:${zone.id}`)
      await api.deleteMyZone(token, zone.id)
      setMine(m => m.token === token ? { token, zones: m.zones.filter(z => z.id !== zone.id) } : m)
      setError(undefined)
    } catch (e) { setError((e as Error).message) }
  }, [token])

  const personalCopy = useCallback(
    (zone: Zone, extra: Partial<Zone>): Zone | undefined =>
      user ? { ...zone, id: api.newId('zone'), source: 'personal', ownerId: user.id, basedOnZoneId: zone.id, ...extra } : undefined,
    [user],
  )

  /** Make an editable personal copy of a shared zone. Returns the copy. */
  const customize = useCallback(
    (zone: Zone): Zone | undefined => {
      const copy = personalCopy(zone, { name: `${zone.name} (mine)` })
      if (copy) void upsert(copy)
      return copy
    },
    [personalCopy, upsert],
  )

  /** Hide a shared zone for this user only. */
  const hideDefault = useCallback(
    (zone: Zone) => {
      const marker = personalCopy(zone, { hidden: true })
      if (marker) void upsert(marker)
    },
    [personalCopy, upsert],
  )

  /** Undo a hide or customization so the shared zone shows again. */
  const restoreDefault = useCallback(
    (defaultZoneId: string) => {
      personal.filter((z) => z.basedOnZoneId === defaultZoneId).forEach((z) => void remove(z))
    },
    [personal, remove],
  )

  /** Drop a brand-new personal zone where the user tapped, linked to the nearest door. */
  const createAt = useCallback(
    (point: LatLng): Zone | undefined => {
      if (!user) return
      const doors = buildings.flatMap((b) => b.entrances)
      if (doors.length === 0) return
      const nearest = doors.reduce((a, b) => (distanceMeters(point, a.location) <= distanceMeters(point, b.location) ? a : b))
      const zone: Zone = {
        id: api.newId('zone'),
        buildingId: nearest.buildingId,
        entranceId: nearest.id,
        source: 'personal',
        name: 'My spot',
        kinds: ['dropoff', 'pickup'],
        polygon: rect(point, 18, 7),
        stopPoint: point,
        ownerId: user.id,
      }
      void upsert(zone)
      return zone
    },
    [user, buildings, upsert],
  )

  const hiddenDefaultIds = useMemo(
    () => new Set(personal.filter((z) => z.hidden && z.basedOnZoneId).map((z) => z.basedOnZoneId as string)),
    [personal],
  )

  return { error, zones, personal, hiddenDefaultIds, upsert, remove, customize, hideDefault, restoreDefault, createAt }
}

/** Road closures reported by anyone. */
export function useClosures(token?: string) {
  const [closures, setClosures] = useState<RoadClosure[]>([])
  const [error, setError] = useState<string>()
  useEffect(() => {
    let active = true
    const refresh = () => api.getClosures().then(c => { if (active) setClosures(c) })
      .catch((e: Error) => { if (active) setError(e.message) })
    void refresh()
    const timer = setInterval(refresh, 30000)
    return () => { active = false; clearInterval(timer) }
  }, [])
  const report = useCallback(async (path: LatLng[], reason: string) => {
    if (!token) throw new Error('Sign in to report a closure')
    const closure = await api.reportClosure(token, path, reason)
    setClosures(c => [...c.filter(x => x.id !== closure.id), closure])
  }, [token])
  const remove = useCallback(async (id: string) => {
    if (!token) return
    try {
      await api.removeClosure(token, id)
      setClosures(c => c.filter(x => x.id !== id))
      setError(undefined)
    } catch (e) { setError((e as Error).message) }
  }, [token])
  return { error, closures, report, remove }
}
