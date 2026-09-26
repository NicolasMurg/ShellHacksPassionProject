import { useCallback, useEffect, useMemo, useState } from 'react'
import * as api from '../api'
import { distanceMeters, rect } from '../geo'
import { visibleZones } from '../planner'
import type { Building, LatLng, RoadClosure, User, Zone } from '../types'

/** Buildings and default zones (loaded once). */
export function useCampus() {
  const [buildings, setBuildings] = useState<Building[]>([])
  const [defaults, setDefaults] = useState<Zone[]>([])
  const [error, setError] = useState<string>()

  useEffect(() => {
    Promise.all([api.getBuildings(), api.getDefaultZones()])
      .then(([b, z]) => {
        setBuildings(b)
        setDefaults(z)
      })
      .catch((e: Error) => setError(e.message))
  }, [])

  return { buildings, defaults, error }
}

/** The signed-in user's personal zones, merged over the defaults. */
export function useZones(defaults: Zone[], buildings: Building[], user?: User, token?: string) {
  const [mine, setMine] = useState<{ token?: string; zones: Zone[] }>({ zones: [] })

  useEffect(() => {
    if (!token) return
    api
      .getMyZones(token)
      .then((zones) => setMine({ token, zones }))
      .catch(() => setMine({ token, zones: [] }))
  }, [token])

  const personal = useMemo(() => (token && mine.token === token ? mine.zones : []), [mine, token])
  const zones = useMemo(() => visibleZones(defaults, personal), [defaults, personal])

  const upsert = useCallback(
    async (zone: Zone) => {
      if (!token) return
      setMine((m) => ({
        token,
        zones: m.zones.some((z) => z.id === zone.id) ? m.zones.map((z) => (z.id === zone.id ? zone : z)) : [...m.zones, zone],
      }))
      await api.saveMyZone(token, zone)
    },
    [token],
  )

  const remove = useCallback(
    async (zone: Zone) => {
      if (!token) return
      setMine((m) => ({ token, zones: m.zones.filter((z) => z.id !== zone.id) }))
      await api.deleteMyZone(token, zone.id)
    },
    [token],
  )

  /** Make an editable personal copy of a default zone. Returns the copy. */
  const customize = useCallback(
    (zone: Zone): Zone | undefined => {
      if (!user) return
      const copy: Zone = { ...zone, id: api.newId('zone'), ownerId: user.id, basedOnZoneId: zone.id, name: `${zone.name} (mine)` }
      void upsert(copy)
      return copy
    },
    [user, upsert],
  )

  /** Hide a default zone for this user only. */
  const hideDefault = useCallback(
    (zone: Zone) => {
      if (!user) return
      void upsert({ ...zone, id: api.newId('zone'), ownerId: user.id, basedOnZoneId: zone.id, hidden: true })
    },
    [user, upsert],
  )

  /** Undo a hide or customization so the default zone shows again. */
  const restoreDefault = useCallback(
    (defaultZoneId: string) => {
      personal.filter((z) => z.basedOnZoneId === defaultZoneId).forEach((z) => void remove(z))
    },
    [personal, remove],
  )

  /** Drop a brand-new personal zone where the user tapped. */
  const createAt = useCallback(
    (point: LatLng): Zone | undefined => {
      if (!user || buildings.length === 0) return
      const nearest = [...buildings].sort((a, b) => distanceMeters(point, a.location) - distanceMeters(point, b.location))[0]
      const zone: Zone = {
        id: api.newId('zone'),
        buildingId: nearest.id,
        name: `My spot at ${nearest.code}`,
        kinds: ['dropoff', 'pickup'],
        polygon: rect(point, 18, 7),
        stopPoint: point,
        entrance: { label: 'My entrance', location: nearest.location, accessible: true },
        rooms: [],
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

  return { zones, personal, hiddenDefaultIds, upsert, remove, customize, hideDefault, restoreDefault, createAt }
}

/** Road closures reported by anyone. */
export function useClosures(token?: string, reporter?: string) {
  const [closures, setClosures] = useState<RoadClosure[]>([])

  useEffect(() => {
    api.getClosures().then(setClosures).catch(() => setClosures([]))
  }, [])

  const report = useCallback(
    async (path: LatLng[], reason: string) => {
      if (!token || !reporter) return
      const closure = await api.reportClosure(token, reporter, path, reason)
      setClosures((c) => [...c, closure])
    },
    [token, reporter],
  )

  const remove = useCallback(
    async (id: string) => {
      if (!token) return
      setClosures((c) => c.filter((x) => x.id !== id))
      await api.removeClosure(token, id)
    },
    [token],
  )

  return { closures, report, remove }
}
