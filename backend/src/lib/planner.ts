import type { GeoPoint, WalkingProfile } from "@prisma/client";
import { prisma } from "./prisma";
import { computeRoute } from "./google";
import { point, HttpError } from "./validation";
import { walkSecondsForPath } from "./walking";
import { distanceToPath } from "../../../shared/geo";

export const asLatLng = (p: GeoPoint) => { const [lng, lat] = point.parse(p).coordinates; return { lat, lng }; };
export function paceProfile(p?: WalkingProfile) {
  return p ? { pace: p.pace as "slow" | "average" | "fast", age: p.age ?? undefined,
    heightCm: p.heightCm ?? undefined, mobility: p.mobility as "none" | "cane" | "crutches" | "wheelchair" | "stroller",
    learnedFactor: p.learnedFactor } : undefined;
}
export function servesRoom(patterns: string[], room: string) {
  return !room || !patterns.length || patterns.some(p => room.toUpperCase().startsWith(p.replace(/x+$/i, "").toUpperCase()));
}
export const floorOf = (room: string) => Math.max(0, (parseInt(room[0] ?? "", 10) || 1) - 1);
export async function rankPlan(input: { buildingId: string; room: string; kind: "DROPOFF" | "PICKUP" | "WALK"; stepFree?: boolean; origin?: GeoPoint }, user?: { id: string; profile: WalkingProfile }) {
  const building = await prisma.building.findUnique({ where: { id: input.buildingId }, include: { entrances: true } });
  if (!building) throw new HttpError(404, "Building not found");
  const shared = await prisma.zone.findMany({ where: { buildingId: input.buildingId,
    OR: [{ ownerId: null }, { ownerId: { isSet: false } }] } });
  const personal = user ? await prisma.zone.findMany({ where: { ownerId: user.id } }) : [];
  if (input.kind !== "WALK" && shared.length === 0 && !personal.some(z => z.buildingId === building.id)) {
    throw new HttpError(503, "Pickup and drop-off locations are not available for this building yet.");
  }
  const replaced = new Set(personal.map(z => z.basedOnZoneId).filter(Boolean));
  const zones = [...shared.filter(z => !replaced.has(z.id)), ...personal.filter(z => z.buildingId === building.id)]
    .filter(z => !z.hidden && (z.kinds.includes("BOTH") || z.kinds.some(k => k === input.kind)));
  const profile = paceProfile(user?.profile);
  const stepFree = input.stepFree || user?.profile.avoidStairs || profile?.mobility === "wheelchair" || profile?.mobility === "stroller";
  let candidates = input.kind === "WALK"
    ? building.entrances.map(entrance => ({ entrance, zone: undefined as typeof zones[number] | undefined }))
    : zones.flatMap(zone => { const entrance = building.entrances.find(e => e.id === zone.entranceId); return entrance ? [{ entrance, zone }] : []; });
  if (stepFree) candidates = candidates.filter(c => c.entrance.accessible);
  const matching = candidates.filter(c => servesRoom(c.zone?.rooms.length ? c.zone.rooms : c.entrance.rooms, input.room));
  if (matching.length) candidates = matching;
  if (input.kind === "WALK" && !input.origin) throw new HttpError(400, "origin is required for walking plans");
  const now = new Date();
  const closures = await prisma.routeRestriction.findMany({ where: { AND: [
    { OR: [{ startsAt: null }, { startsAt: { isSet: false } }, { startsAt: { lte: now } }] },
    { OR: [{ endsAt: null }, { endsAt: { isSet: false } }, { endsAt: { gt: now } }] },
  ] } });
  const results = [];
  // Bound requests per batch; every candidate uses a real walking route before ranking.
  for (let i = 0; i < candidates.length; i += 3) {
    const batch = await Promise.all(candidates.slice(i, i + 3).map(async ({ entrance, zone }) => {
      const origin = point.parse(zone?.stopPoint ?? input.origin);
      let route;
      try { route = await computeRoute(origin, point.parse(entrance.location), "WALK"); }
      catch (error) { if (error instanceof HttpError && error.status === 404) return null; throw error; }
      const seconds = walkSecondsForPath(route.distanceMeters, profile, { floors: floorOf(input.room), stairs: !entrance.accessible });
      if (user?.profile.maxWalkMinutes && seconds > user.profile.maxWalkMinutes * 60) return null;
      const nearby = closures.filter(c => distanceToPath(asLatLng(origin), c.points.map(asLatLng)) < 40);
      const warnings = [...route.warnings, "Walking routes may lack sidewalks; accessibility along the full path is unverified."];
      if (zone?.source === "generated") warnings.push("This generated stop has not been checked for legal or safe stopping.");
      if (!entrance.accessible) warnings.push("Stairs at this entrance");
      if (nearby.length) warnings.push(...nearby.map(c => `Nearby closure report: ${c.reason}`));
      if (closures.length) warnings.push("Reported closures are not automatically avoided by Google directions.");
      if (user?.profile.requireCurbCuts || user?.profile.avoidSteepSlopes) warnings.push("Curb cuts and slopes have not been verified.");
      const personal = Boolean(zone?.ownerId);
      const penalty = nearby.length * 900 + (user?.profile.preferAccessibleEntrances && !entrance.accessible ? 1800 : 0) - (personal ? 20 : 0);
      return { zone, entrance, walkSeconds: seconds, reason: `${personal ? "Your saved spot" : "Entrance"} for ${input.room ? `room ${input.room}` : building.name}`,
        warnings, route, score: seconds + penalty };
    }));
    results.push(...batch.filter(x => x !== null));
  }
  results.sort((a, b) => a.score - b.score);
  const options = results.map(({ score, ...option }) => option);
  const trip = user && options.length ? await prisma.trip.create({ data: { userId: user.id } }) : undefined;
  return { tripId: trip?.id, options, accessibilityVerified: false };
}
