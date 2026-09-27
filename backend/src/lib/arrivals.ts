import type { GeoPoint, PersonalStop, RouteRestriction, WalkingProfile } from '@prisma/client';
import { z } from 'zod';
import type { ApiArrivalPlan } from '../contracts';
import { prisma } from './prisma';
import { computeRoute } from './google';
import { HttpError, point } from './validation';
import { asLatLng, paceProfile } from './planner';
import { walkSecondsForPath } from './walking';
import { distanceMeters, distanceToPath, offset, type LatLng } from '../../../shared/geo';

export const arrivalDestination = z.object({ name: z.string().trim().min(1).max(200), location: point,
  placeId: z.string().trim().min(1).max(300).optional() }).strict();
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

function intersects(a: LatLng, b: LatLng, c: LatLng, d: LatLng) {
  const cross = (p: LatLng, q: LatLng, r: LatLng) => (q.lng - p.lng) * (r.lat - p.lat) - (q.lat - p.lat) * (r.lng - p.lng);
  return cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0;
}
function inside(p: LatLng, polygon: LatLng[]) {
  let contained = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!, b = polygon[j]!;
    if ((a.lat > p.lat) !== (b.lat > p.lat) && p.lng < (b.lng - a.lng) * (p.lat - a.lat) / (b.lat - a.lat) + a.lng) contained = !contained;
  }
  return contained;
}
/** Check both crossings and proximity, including the interior of an area report. */
export function touchesRestriction(path: GeoPoint[], restriction: Pick<RouteRestriction, 'points' | 'geometryType'>) {
  const route = path.map(asLatLng), points = restriction.points.map(asLatLng);
  if (!points.length || !route.length) return false;
  if (restriction.geometryType === 'AREA' && route.some(p => inside(p, points))) return true;
  const boundary = restriction.geometryType === 'AREA' ? [...points, points[0]!] : points;
  if (route.some(p => distanceToPath(p, boundary) < 12) || boundary.some(p => distanceToPath(p, route) < 12)) return true;
  for (let i = 1; i < route.length; i++) for (let j = 1; j < boundary.length; j++) {
    if (intersects(route[i - 1]!, route[i]!, boundary[j - 1]!, boundary[j]!)) return true;
  }
  return false;
}

export async function planArrival(input: z.infer<typeof arrivalInput>, user?: { id: string; profile: WalkingProfile }) {
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
  type Candidate = { point: GeoPoint; source: 'saved' | 'suggested' | 'manual'; name: string; instructions: string; placeId?: string; priority: number };
  const candidates: Candidate[] = [];
  if (input.stopPoint) candidates.push({ point: input.stopPoint, source: 'manual', priority: 0, name: 'Your chosen stop', instructions: '' });
  else {
    if (saved) candidates.push({ point: saved.stopPoint, source: 'saved', priority: 0, name: saved.name, instructions: saved.instructions });
    candidates.push({ point: input.destination.location, placeId: input.destination.placeId, source: 'suggested', priority: 1, name: 'Suggested arrival point', instructions: '' });
  }
  const options: (ApiArrivalPlan['options'][number] & { priority: number })[] = [];
  let providerFailure: unknown;
  // Add alternatives along the mapped approach, never fabricate permission to use a private driveway.
  let expanded = false;
  for (let i = 0; i < candidates.length && i < 5; i++) {
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
              candidates.push({ point: alternative, source: 'suggested', priority: 2, name: 'Nearby alternative', instructions: '' });
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
      if (options.some(o => distanceMeters(asLatLng(o.stopPoint), asLatLng(stopPoint)) < 20)) continue;
      const walk = input.kind === 'PICKUP'
        ? await computeRoute(point.parse(input.destination.location), stopPoint, 'WALK')
        : await computeRoute(stopPoint, point.parse(input.destination.location), 'WALK');
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
      const warnings = [...drive.warnings, ...walk.warnings, 'Stopping permission, property access, crossings, and sidewalk accessibility are unverified.'];
      if (stepFree) warnings.push('A step-free route could not be verified. Review the path before confirming.');
      const moved = candidate.source !== 'suggested' && distanceMeters(asLatLng(stopPoint), asLatLng(candidate.point)) > 5;
      if (moved) warnings.push('The preview pin was adjusted to the mapped road arrival point.');
      options.push({ id: `${candidate.source}:${stopPoint.coordinates.map(n => n.toFixed(6)).join(',')}`, stopPoint,
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
