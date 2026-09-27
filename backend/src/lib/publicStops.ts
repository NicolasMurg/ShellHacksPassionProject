import type { GeoPoint, WalkingProfile, Zone } from '@prisma/client';
import { distanceMeters } from '../../../shared/geo';
import { prisma } from './prisma';
export const sharedZoneWhere = { OR: [{ ownerId: null }, { ownerId: { isSet: false } }] };
export function zoneView(z: Zone) {
  return { id: z.id, buildingId: z.buildingId, entranceId: z.entranceId, name: z.name, kinds: z.kinds, source: z.source,
    polygon: z.polygon, stopPoint: z.stopPoint, rooms: z.rooms, ownerId: z.ownerId, basedOnZoneId: z.basedOnZoneId, hidden: z.hidden, instructions: z.instructions,
    ...(z.source === 'public' || z.source === 'design' ? { publicStopId: z.id, publicStopStatus: publicStopRoutingStatus(z) ?? undefined } : {}) };
}

export const PUBLIC_STOP_RADIUS_METERS = 500;
export function needsAccessibleStop(stepFree?: boolean, profile?: WalkingProfile) {
  return Boolean(stepFree || profile?.avoidStairs || profile?.requireCurbCuts || profile?.avoidSteepSlopes
    || ['wheelchair', 'stroller'].includes(profile?.mobility ?? ''));
}

/** Routing availability is separate from review status; new submissions remain explicitly unverified. */
export function publicStopRoutingStatus(stop: Zone): 'VERIFIED' | 'UNVERIFIED' | null {
  if (!['VERIFIED', 'UNVERIFIED'].includes(stop.status) || stop.access === 'RESTRICTED') return null;
  return stop.status === 'VERIFIED' && stop.access === 'PERMITTED' && stop.verificationExpiresAt && stop.verificationExpiresAt > new Date()
    ? 'VERIFIED' : 'UNVERIFIED';
}

/** Shared zones can serve any nearby destination, regardless of their optional building association. */
export async function nearbyPublicStops(targets: GeoPoint[], kind: 'DROPOFF' | 'PICKUP', stepFree: boolean) {
  const stops = await prisma.zone.findMany({ where: { ...sharedZoneWhere, hidden: false,
    status: { in: ['VERIFIED', 'UNVERIFIED'] }, access: { not: 'RESTRICTED' },
    kinds: { hasSome: [kind, 'BOTH'] }, ...(stepFree && { status: 'VERIFIED', access: 'PERMITTED', verificationExpiresAt: { gt: new Date() }, accessibility: 'STEP_FREE' }),
  } });
  const location = (point: GeoPoint) => ({ lat: point.coordinates[1]!, lng: point.coordinates[0]! });
  // Stop coordinates remain authoritative; planners subsequently check actual Google routes.
  return stops.map(stop => ({ stop, distance: Math.min(...targets.map(target => distanceMeters(location(stop.stopPoint), location(target)))) }))
    .filter(candidate => candidate.distance <= PUBLIC_STOP_RADIUS_METERS)
    .sort((a, b) => Number(publicStopRoutingStatus(b.stop) === 'VERIFIED') - Number(publicStopRoutingStatus(a.stop) === 'VERIFIED') || a.distance - b.distance || a.stop.id.localeCompare(b.stop.id))
    .map(candidate => candidate.stop);
}
