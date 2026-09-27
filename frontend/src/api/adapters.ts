import type { ApiBuilding, ApiClosure, ApiEntrance, ApiPoint, ApiRoute, ApiUser, ApiZone } from '../../../backend/src/contracts'
import type { Building, Entrance, LatLng, RoadClosure, User, Zone } from '../types'

// Google Maps consumes {lat,lng}; the API/database uses GeoJSON [longitude,latitude].
export const toPoint = (p: LatLng): ApiPoint => ({ type: 'Point', coordinates: [p.lng, p.lat] })
export function fromPoint(p: ApiPoint): LatLng {
  const [lng, lat] = p.coordinates
  if (p.type !== 'Point' || p.coordinates.length !== 2 || typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new Error('The server returned an invalid map coordinate')
  return { lat, lng }
}
export const fromEntrance = (e: ApiEntrance): Entrance => ({ ...e, location: fromPoint(e.location), rooms: e.rooms ?? [], hours: e.hours ?? undefined })
export const fromBuilding = (b: ApiBuilding): Building => ({ ...b, location: fromPoint(b.location), entrances: b.entrances.map(fromEntrance) })
export function fromZone(z: ApiZone): Zone {
  return {
    id: z.id, buildingId: z.buildingId, entranceId: z.entranceId, name: z.name,
    source: z.ownerId ? 'personal' : z.source === 'generated' ? 'generated' : 'design',
    kinds: z.kinds.includes('BOTH') ? ['dropoff', 'pickup'] : z.kinds.map(k => k === 'DROPOFF' ? 'dropoff' : 'pickup'),
    polygon: z.polygon.map(fromPoint), stopPoint: fromPoint(z.stopPoint), rooms: z.rooms,
    ownerId: z.ownerId, basedOnZoneId: z.basedOnZoneId ?? undefined, hidden: z.hidden
  }
}
export function toZone(z: Zone) {
  return {
    buildingId: z.buildingId, entranceId: z.entranceId, name: z.name,
    kinds: z.kinds.map(k => k === 'dropoff' ? 'DROPOFF' : 'PICKUP'), polygon: z.polygon.map(toPoint),
    stopPoint: toPoint(z.stopPoint), rooms: z.rooms ?? [], hidden: z.hidden ?? false, basedOnZoneId: z.basedOnZoneId ?? null
  }
}
export const fromClosure = (c: ApiClosure): RoadClosure => ({
  id: c.id, path: c.points.map(fromPoint), reason: c.reason,
  reportedBy: c.owner?.name ?? 'Campus report', ownerId: c.ownerId, createdAt: c.createdAt
})
export function fromUser(user: ApiUser): User {
  return {
    ...user, profile: {
      ...user.profile, age: user.profile.age ?? undefined, heightCm: user.profile.heightCm ?? undefined,
      pace: (user.profile.pace ?? 'average') as User['profile']['pace'], mobility: (user.profile.mobility ?? 'none') as User['profile']['mobility'],
      learnedFactor: user.profile.learnedFactor ?? 1
    }
  }
}
export const fromRoute = (r: ApiRoute) => ({ path: r.path.map(fromPoint), seconds: r.durationSeconds, meters: r.distanceMeters, warnings: r.warnings })
