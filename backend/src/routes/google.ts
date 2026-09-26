import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { computeRoute, searchPlaces } from "../lib/google";
import { HttpError, id, objectId, point } from "../lib/validation";
import { requireAuth } from "../middleware/auth";

export const googleRoutes = Router();
const googleLimit = rateLimit({ windowMs: 60000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false,
  message: { error: "Too many Google Maps requests" } });
googleRoutes.get("/search", googleLimit, async (req, res) => {
  const { q } = z.object({ q: z.string().trim().min(1).max(200) }).parse(req.query);
  res.json(await searchPlaces(q));
});
googleRoutes.post("/plan", requireAuth, googleLimit, async (req, res) => {
  const input = z.object({ origin: point, destination: point.optional(), zoneId: id.optional(),
    travelMode: z.enum(["WALK", "DRIVE"]).default("WALK") }).strict()
    .refine(v => Boolean(v.destination) !== Boolean(v.zoneId), "Provide exactly one of destination or zoneId").parse(req.body);
  const segments = [];
  if (input.zoneId) {
    const zone = await prisma.zone.findFirst({ where: { id: input.zoneId, hidden: false,
      OR: [{ ownerId: null }, { ownerId: { isSet: false } }, { ownerId: res.locals.user.id }] }, include: { entrance: true } });
    if (!zone) throw new HttpError(404, "Zone not found");
    const stop = point.parse(zone.stopPoint);
    segments.push(await computeRoute(input.origin, stop, "DRIVE"));
    segments.push(await computeRoute(stop, point.parse(zone.entrance.location), "WALK"));
  } else {
    segments.push(await computeRoute(input.origin, input.destination!, input.travelMode));
  }
  const now = new Date();
  const closures = await prisma.routeRestriction.findMany({ where: { AND: [
    { OR: [{ startsAt: null }, { startsAt: { isSet: false } }, { startsAt: { lte: now } }] },
    { OR: [{ endsAt: null }, { endsAt: { isSet: false } }, { endsAt: { gt: now } }] },
  ] } });
  // Persist only an ownership record; do not cache Google's route content.
  const trip = await prisma.trip.create({ data: { userId: res.locals.user.id } });
  res.json({ tripId: trip.id, segments, closures, accessibilityVerified: false,
    warnings: ["Walking directions may be missing sidewalks or pedestrian paths.",
      "Accessibility preferences and local closure reports are not enforced by this route.",
      ...segments.flatMap(s => s.warnings)] });
});
googleRoutes.post("/trips/feedback", requireAuth, async (req, res) => {
  const input = z.object({ tripId: objectId, rating: z.number().int().min(1).max(5),
    comment: z.string().trim().max(2000).optional() }).strict().parse(req.body);
  if (!await prisma.trip.findFirst({ where: { id: input.tripId, userId: res.locals.user.id } })) {
    throw new HttpError(404, "Trip not found");
  }
  res.json(await prisma.tripFeedback.upsert({ where: { tripId: input.tripId }, create: input,
    update: { rating: input.rating, comment: input.comment ?? null } }));
});
