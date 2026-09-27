import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { computeRoute, searchPlaces } from "../lib/google";
import { HttpError, id, objectId, point } from "../lib/validation";
import { optionalAuth, publicUser, requireAuth } from "../middleware/auth";
import { parseDestination } from "../lib/search";
import { asLatLng, paceProfile, rankPlan } from "../lib/planner";
import { distanceMeters } from "../../../shared/geo";
import { learn } from "../lib/walking";

export const googleRoutes = Router();
const googleLimit = rateLimit({ windowMs: 60000, limit: 60, standardHeaders: "draft-8", legacyHeaders: false,
  message: { error: "Too many map requests. Please try again shortly." } });
googleRoutes.get("/search", googleLimit, async (req, res) => {
  const { q } = z.object({ q: z.string().trim().min(1).max(200) }).parse(req.query);
  const buildings = await prisma.building.findMany({ include: { entrances: true } });
  try { res.json(parseDestination(q, buildings)); return; } catch { /* Try campus Places search. */ }
  const places = await searchPlaces(q, false);
  // Preserve the top Places match; a lower-ranked campus result must not replace a searched address.
  for (const place of places.slice(0, 1)) {
    const location = asLatLng(point.parse(place.location));
    const nearest = buildings.map(building => ({ building, distance: distanceMeters(location, asLatLng(building.location)) }))
      .sort((a, b) => a.distance - b.distance)[0];
    if (nearest && nearest.distance <= 150) {
      res.json({ building: nearest.building, room: q.match(/\b([a-z]?\d{2,4}[a-z]?)\b/i)?.[1]?.toUpperCase() ?? "",
        matchedBy: "nearby-place", attributions: place.attributions });
      return;
    }
  }
  const place = places[0];
  if (place) {
    res.json({ destination: { name: place.name, location: place.location, placeId: place.id }, room: "",
      attributions: place.attributions });
    return;
  }
  throw new HttpError(404, "Could not find that location. Try a full address or select a point on the map.");
});
googleRoutes.post("/plan", optionalAuth, googleLimit, async (req, res) => {
  const input = z.object({ buildingId: id, room: z.string().trim().max(100).default(""),
    kind: z.enum(["DROPOFF", "PICKUP", "WALK"]), stepFree: z.boolean().optional(), origin: point.optional() }).strict().parse(req.body);
  res.json(await rankPlan(input, res.locals.user));
});
googleRoutes.post("/route", googleLimit, async (req, res) => {
  const input = z.object({ origin: point, destination: point, travelMode: z.enum(["WALK", "DRIVE"]) }).strict().parse(req.body);
  res.json(await computeRoute(input.origin, input.destination, input.travelMode));
});
googleRoutes.post("/trips/feedback", requireAuth, async (req, res) => {
  const input = z.object({ tripId: objectId, rating: z.number().int().min(1).max(5),
    comment: z.string().trim().max(2000).optional(), paceFeedback: z.enum(["faster", "right", "slower"]).optional() }).strict().parse(req.body);
  for (let attempt = 0; ; attempt++) {
    try {
      const result = await prisma.$transaction(async tx => {
        const trip = await tx.trip.findFirst({ where: { id: input.tripId, userId: res.locals.user.id }, include: { feedback: true } });
        if (!trip) throw new HttpError(404, "Trip not found");
        let user = await tx.user.findUniqueOrThrow({ where: { id: res.locals.user.id }, select: publicUser });
        // A trip teaches the model once. Retries or repeated button presses cannot compound learning.
        if (input.paceFeedback && !trip.feedback?.paceFeedback) {
          const learnedFactor = learn(paceProfile(user.profile)!, input.paceFeedback).learnedFactor;
          user = await tx.user.update({ where: { id: user.id }, data: { profile: { update: { learnedFactor } } }, select: publicUser });
        }
        const feedback = await tx.tripFeedback.upsert({ where: { tripId: trip.id }, create: input,
          update: { rating: input.rating, comment: input.comment ?? null, paceFeedback: trip.feedback?.paceFeedback ?? input.paceFeedback } });
        return { user, feedback };
      });
      res.json(result); return;
    } catch (error) {
      if (attempt < 2 && error instanceof Prisma.PrismaClientKnownRequestError && ["P2034", "P2002"].includes(error.code)) continue;
      throw error;
    }
  }
});
