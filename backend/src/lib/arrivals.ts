import type { GeoPoint, PersonalStop, PublicStop, WalkingProfile } from '@prisma/client';
import { z } from 'zod';
import type { ApiArrivalPlan } from '../contracts';
import { prisma } from './prisma';
import { nearbyPublicStops, PUBLIC_STOP_RADIUS_METERS, needsAccessibleStop, publicStopRoutingStatus } from './publicStops';
import { touchesRestriction } from './restrictions';
export { touchesRestriction } from './restrictions';
import { computeRoute } from './google';
import { HttpError, point, objectId } from './validation';
import { asLatLng, paceProfile } from './planner';
import { walkSecondsForPath } from './walking';
import { distanceMeters, offset, type LatLng } from '../../../shared/geo';

export const arrivalDestination = z.object({ name: z.string().trim().min(1).max(200), location: point,
  placeId: z.string().trim().min(1).max(300).optional(), publicStopId: objectId.optional() }).strict();
export const arrivalInput = z.object({ destination: arrivalDestination, origin: point.optional(),
  stopPoint: point.optional(), stepFree: z.boolean().default(false), kind: z.enum(['DROPOFF', 'PICKUP']).default('DROPOFF') }).strict();
export const geoPoint = (p: LatLng): z.infer<typeof point> => ({ type: 'Point', coordinates: [p.lng, p.lat] });
export function destinationKey(destination: z.infer<typeof arrivalDestination>) {
  return destination.placeId ? `place:${destination.placeId}` : `point:${destination.location.coordinates.map(n => n.toFixed(4)).join(',')}`;
}
export function validateStopDistance(stop: GeoPoint, destination: GeoPoint) {
  if (distanceMeters(asLatLng(stop), asLatLng(destination)) > 500) throw new HttpError(400, 'Choose a stop within 500 m of the destination');
}
export function publicStop(stop: PersonalStop) {
  const { ownerId, ...result } = stop;
  return result;
}
export async function findSavedStop(destination: z.infer<typeof arrivalDestination>, ownerId?: string) {
  if (!ownerId) return null;
  const exact = await prisma.personalStop.findUnique({ where: { ownerId_destinationKey: { ownerId, destinationKey: destinationKey(destination) } } });
  if (exact) return exact;
  // A second tap on the same property rarely lands on the identical coordinate.
  const stops = await prisma.personalStop.findMany({ where: { ownerId } });
  return stops.filter(s => !(destination.placeId && s.placeId && destination.placeId !== s.placeId))
    .map(s => ({ s, distance: distanceMeters(asLatLng(s.destinationLocation), asLatLng(destination.location)) }))
    .filter(s => s.distance < 25).sort((a, b) => a.distance - b.distance)[0]?.s ?? null;
}

export async function planArrival(input: z.infer<typeof arrivalInput>, user?: { id: string; profile: WalkingProfile }) {
  let reviewedStop: PublicStop | undefined;
  if (input.destination.publicStopId) {
    const stop = await prisma.publicStop.findUnique({ where: { id: input.destination.publicStopId } });
    if (!stop || !publicStopRoutingStatus(stop)) {
      throw new HttpError(409, 'This public stop is disputed, retired, or restricted. Choose another stop.');
    }
    if (!stop.kinds.includes('BOTH') && !stop.kinds.includes(input.kind)) throw new HttpError(400, 'This stop does not support this trip type.');
    const needsAccessible = needsAccessibleStop(input.stepFree, user?.profile);
    if (needsAccessible && (stop.accessibility !== 'STEP_FREE' || publicStopRoutingStatus(stop) !== 'VERIFIED')) throw new HttpError(409, 'Step-free access at this public stop has not been verified.');
    reviewedStop = stop;
    input = { ...input, destination: { name: stop.name, location: point.parse(stop.location), publicStopId: stop.id }, stopPoint: point.parse(stop.location) };
  }
  const target = asLatLng(input.destination.location);
  if (input.stopPoint) validateStopDistance(input.stopPoint, input.destination.location);
  const saved = await findSavedStop(input.destination, user?.id);
  const now = new Date();
  const restrictions = await prisma.routeRestriction.findMany({ where: { AND: [
    { OR: [{ startsAt: null }, { startsAt: { isSet: false } }, { startsAt: { lte: now } }] },
    { OR: [{ endsAt: null }, { endsAt: { isSet: false } }, { endsAt: { gt: now } }] },
  ] } });
  const notices = new Set<string>();
  const profile = paceProfile(user?.profile);
  const stepFree = input.stepFree || user?.profile.avoidStairs || ['wheelchair', 'stroller'].includes(profile?.mobility ?? '');
  const driveRestrictions = restrictions.filter(r => ['ROAD_CLOSED', 'CONSTRUCTION', 'BLOCKED_PATH', 'FLOODED', 'TEMPORARY_OBSTACLE', 'OTHER'].includes(r.type));
  const walkRestrictions = restrictions.filter(r => !['STAIRS', 'NO_CURB_CUT', 'STEEP_SLOPE'].includes(r.type) || stepFree ||
    (r.type === 'NO_CURB_CUT' && user?.profile.requireCurbCuts) || (r.type === 'STEEP_SLOPE' && user?.profile.avoidSteepSlopes));
  // Without GPS this short approach is used only to discover arrival points, never as a displayed trip ETA.
  const origin = input.origin ?? geoPoint(offset(target, 0, -300));
  type Candidate = { point: GeoPoint; source: 'saved' | 'suggested' | 'manual' | 'public'; name: string; instructions: string; placeId?: string; publicStopId?: string; publicStopStatus?: 'VERIFIED' | 'UNVERIFIED'; priority: number };
  const candidates: Candidate[] = [];
  if (reviewedStop) candidates.push({ point: reviewedStop.location, source: 'public', publicStopId: reviewedStop.id, publicStopStatus: publicStopRoutingStatus(reviewedStop)!, priority: 0, name: reviewedStop.name, instructions: reviewedStop.instructions });
  else if (input.stopPoint) candidates.push({ point: input.stopPoint, source: 'manual', priority: 0, name: 'Your chosen stop', instructions: '' });
  else {
    if (saved) candidates.push({ point: saved.stopPoint, source: 'saved', priority: 0, name: saved.name, instructions: saved.instructions });
    const nearby = await nearbyPublicStops([input.destination.location], input.kind, needsAccessibleStop(input.stepFree, user?.profile));
    candidates.push(...nearby.map(stop => ({ point: stop.location, source: 'public' as const, publicStopId: stop.id, publicStopStatus: publicStopRoutingStatus(stop)!, priority: publicStopRoutingStatus(stop) === 'VERIFIED' ? 1 : 2, name: stop.name, instructions: stop.instructions })));
    candidates.push({ point: input.destination.location, placeId: input.destination.placeId, source: 'suggested', priority: 3, name: 'Suggested arrival point', instructions: '' });
  }
  const options: (ApiArrivalPlan['options'][number] & { priority: number })[] = [];
  let providerFailure: unknown;
  // Add alternatives along the mapped approach, never fabricate permission to use a private driveway.
  let expanded = false;
  for (let i = 0; i < candidates.length && i < 9; i++) {
    const candidate = candidates[i]!;
    try {
      let drive = await computeRoute(point.parse(origin), point.parse(candidate.point), 'DRIVE', candidate.placeId ? { placeId: candidate.placeId } : { stopover: true });
      let end = drive.endLocation;
      if (!end) throw new HttpError(502, 'Google did not provide an arrival point');
      // vehicleStopover is supported only for coordinate waypoints. Resolve place access first, then check that point.
      if (candidate.placeId) {
        drive = await computeRoute(point.parse(origin), geoPoint({ lat: end.latitude, lng: end.longitude }), 'DRIVE', { stopover: true });
        end = drive.endLocation;
        if (!end) throw new HttpError(502, 'Google did not provide an arrival point');
      }
      const stopPoint = geoPoint({ lat: end.latitude, lng: end.longitude });
      if (!expanded && !input.stopPoint && candidate.source === 'suggested') {
        expanded = true;
        const last = asLatLng(stopPoint);
        const approach = [last, ...drive.path.map(asLatLng).reverse()];
        let traversed = 0, nextDistance = 65;
        for (let j = 1; j < approach.length && nextDistance <= 130; j++) {
          const a = approach[j - 1]!, b = approach[j]!;
          const segmentLength = distanceMeters(a, b);
          while (segmentLength > 0 && traversed + segmentLength >= nextDistance && nextDistance <= 130) {
            const ratio = (nextDistance - traversed) / segmentLength;
            const alternative = geoPoint({ lat: a.lat + (b.lat - a.lat) * ratio, lng: a.lng + (b.lng - a.lng) * ratio });
            if (!candidates.some(c => distanceMeters(asLatLng(c.point), asLatLng(alternative)) < 30)) {
              candidates.push({ point: alternative, source: 'suggested', priority: 4, name: 'Nearby alternative', instructions: '' });
            }
            nextDistance += 65;
          }
          traversed += segmentLength;
        }
      }
      if (distanceMeters(asLatLng(stopPoint), target) > 500) continue;
      if (candidate.source !== 'suggested' && distanceMeters(asLatLng(stopPoint), asLatLng(candidate.point)) > 35) {
        notices.add(`${candidate.source === 'saved' ? 'Your saved spot' : 'The chosen pin'} could not be reached closely by road. Choose another point.`);
        continue;
      }
      if (options.some(o => candidate.publicStopId ? o.publicStopId === candidate.publicStopId : distanceMeters(asLatLng(o.stopPoint), asLatLng(stopPoint)) < 20)) continue;
      const walk = input.kind === 'PICKUP'
        ? await computeRoute(point.parse(input.destination.location), stopPoint, 'WALK')
        : await computeRoute(stopPoint, point.parse(input.destination.location), 'WALK');
      if (candidate.source === 'public' && walk.distanceMeters > PUBLIC_STOP_RADIUS_METERS) {
        notices.add(`${candidate.name} is more than 500 m away by walking route.`); continue;
      }
      const blocked = restrictions.filter(r => (driveRestrictions.includes(r) && touchesRestriction([...drive.path, stopPoint], r)) ||
        (walkRestrictions.includes(r) && touchesRestriction([...(input.kind === 'PICKUP' ? [input.destination.location] : [stopPoint]), ...walk.path, ...(input.kind === 'PICKUP' ? [stopPoint] : [input.destination.location])], r)));
      if (blocked.length) {
        notices.add(`${candidate.source === 'saved' ? 'Your saved spot' : 'A candidate stop'} was excluded because of a report: ${blocked.map(r => r.reason).join('; ')}.`);
        continue;
      }
      const walkSeconds = walkSecondsForPath(walk.distanceMeters, profile);
      if (user?.profile.maxWalkMinutes && walkSeconds > user.profile.maxWalkMinutes * 60) {
        notices.add('A stop exceeded your maximum walking time.'); continue;
      }
      const warnings = [...drive.warnings, ...walk.warnings, candidate.source === 'public'
        ? candidate.publicStopStatus === 'VERIFIED'
          ? 'The public stop was reviewed. Walking-route accessibility and any adjusted road arrival point are not covered by that review.'
          : 'Unverified public stop: submitted by a community member. Stopping permission, access, and accessibility have not been verified.'
        : 'Stopping permission, property access, crossings, and sidewalk accessibility are unverified.'];
      if (stepFree) warnings.push('A step-free route could not be verified. Review the path before confirming.');
      const moved = candidate.source !== 'suggested' && distanceMeters(asLatLng(stopPoint), asLatLng(candidate.point)) > 5;
      if (moved) warnings.push('The preview pin was adjusted to the mapped road arrival point.');
      options.push({ id: candidate.publicStopId ? `public:${candidate.publicStopId}` : `${candidate.source}:${stopPoint.coordinates.map(n => n.toFixed(6)).join(',')}`, stopPoint, publicStopId: candidate.publicStopId, publicStopStatus: candidate.publicStopStatus,
        source: candidate.source, priority: candidate.priority, name: candidate.name, instructions: candidate.instructions, walkSeconds, walk,
        drive: input.origin ? drive : undefined, warnings: [...new Set(warnings)] });
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) {
        if (candidate.source !== 'suggested') notices.add('No route could be found to your preferred stop.');
        continue;
      }
      providerFailure = error;
    }
  }
  if (providerFailure) throw providerFailure;
  options.sort((a, b) => a.priority - b.priority || a.walkSeconds - b.walkSeconds);
  if (!options.length) notices.add('No usable route was found. Move the stop pin or choose another destination.');
  return { options: options.map(({ priority, ...option }) => option), notices: [...notices], savedStop: saved ? publicStop(saved) : null, accessibilityVerified: false as const };
}
