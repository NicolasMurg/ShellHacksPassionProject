import { useMapsLibrary } from '@vis.gl/react-google-maps'
import { useCallback, useEffect, useMemo, useState } from 'react'
import * as api from '../api'
import { generateCurbs } from '../curbs'
import { distanceMeters, rect } from '../geo'
import { visibleZones } from '../planner'
import type { Building, Entrance, LatLng, RoadClosure, User, Zone } from '../types'

/**
 * Buildings, their entrances, and the shared zones (generated curbs + design-team zones).
 * Curbs are generated for the destination building only, as you pick one (and cached).
 */
export function useCampus(destinationId?: string) {
  const [buildings, setBuildings] = useState<Building[]>([])
  const [designZones, setDesignZones] = useState<Zone[]>([])
  const [generated, setGenerated] = useState<Zone[]>([])
  const [error, setError] = useState<string>()
  const routes = useMapsLibrary('routes')

  useEffect(() => {
    Promise.all([api.getBuildings(), api.getDefaultZones()])
      .then(([b, z]) => {
        setBuildings(b)
        setDesignZones(z)
      })
      .catch((e: Error) => setError(e.message))
  }, [])

  // Entrances the design team already covered don't get a generated curb.
  const covered = useMemo(() => new Set(designZones.map((z) => z.entranceId)), [designZones])

  // In mock mode the frontend generates curbs; with the real backend, /api/zones already includes them.
  const destination = buildings.find((b) => b.id === destinationId)
  useEffect(() => {
    if (!api.USE_MOCK || !routes || !destination) return
    let cancelled = false
    void generateCurbs(
      new routes.DirectionsService(),
      [destination],
      covered,
      (zone) => setGenerated((g) => [...g.filter((z) => z.id !== zone.id), zone]),
      () => cancelled,
    )
    return () => {
      cancelled = true
    }
  }, [routes, destination, covered])

  const entrances = useMemo(() => {
    const byId = new Map<string, Entrance>()
    for (const b of buildings) for (const e of b.entrances) byId.set(e.id, e)
    return byId
  }, [buildings])

  const defaults = useMemo(() => [...designZones, ...generated], [designZones, generated])
  const expected = destination ? destination.entrances.filter((e) => !covered.has(e.id)).length : 0
  const have = destination ? generated.filter((z) => z.buildingId === destination.id).length : 0
  const generating = api.USE_MOCK && !!destination && have < expected

  return { buildings, entrances, defaults, generating, error }
}

/** The signed-in user's personal zones, merged over the shared ones. */
export function useZones(defaults: Zone[], buildings: Building[], user?: User, token?: string) {
  const [mine, setMine] = useState<{ token?: string; zones: Zone[] }>({ zones: [] })

  useEffect(() => {
    if (!token) return
    api
      .getMyZones(token)
      .then((zones) => setMine({ token, zones }))
      .catch(() => setMine({ token, zones: [] }))
  }, [token])

  const personal = useMemo(() => {
    const saved = token && mine.token === token ? mine.zones : []
    // Spots saved against doors that no longer exist (e.g. before the campus data
    // was updated) get relinked to the closest real door.
    const doors = buildings.flatMap((b) => b.entrances)
    if (doors.length === 0) return saved
    const known = new Set(doors.map((d) => d.id))
    return saved.map((z) => {
      if (known.has(z.entranceId)) return z
      const closest = doors.reduce((a, b) => (distanceMeters(z.stopPoint, a.location) <= distanceMeters(z.stopPoint, b.location) ? a : b))
      return { ...z, buildingId: closest.buildingId, entranceId: closest.id }
    })
  }, [mine, token, buildings])
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
