import { z } from "zod";

export const id = z.string().min(1).max(100);
export const objectId = z.string().regex(/^[a-f0-9]{24}$/i, "Invalid ObjectId");
export const point = z.object({
  type: z.literal("Point"),
  coordinates: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]),
}).strict();
export const profile = z.object({
  pace: z.enum(["slow", "average", "fast"]),
  age: z.number().int().min(5).max(110).nullable().optional(),
  heightCm: z.number().int().min(80).max(230).nullable().optional(),
  mobility: z.enum(["none", "cane", "crutches", "wheelchair", "stroller"]),
  avoidStairs: z.boolean(), requireCurbCuts: z.boolean(), avoidSteepSlopes: z.boolean(),
  maxWalkMinutes: z.number().int().min(1).max(240).nullable().optional(),
  preferAccessibleEntrances: z.boolean(),
}).strict();
export const defaultProfile = { avoidStairs: false, requireCurbCuts: false,
  avoidSteepSlopes: false, maxWalkMinutes: null, preferAccessibleEntrances: false, pace: "average", mobility: "none", learnedFactor: 1 };
export const zoneInput = z.object({
  buildingId: id.nullable().optional(), entranceId: objectId.nullable().optional(), name: z.string().trim().min(1).max(200),
  kinds: z.array(z.enum(["DROPOFF", "PICKUP", "BOTH"])).min(1).max(3),
  polygon: z.array(point).max(200).refine(p => !p.length || p.length >= 3), stopPoint: point,
  rooms: z.array(z.string().trim().min(1).max(100)).max(100), hidden: z.boolean().optional(),
}).strict();
export const restrictionInput = z.object({
  type: z.enum(["ROAD_CLOSED", "SIDEWALK_CLOSED", "CONSTRUCTION", "STAIRS", "NO_CURB_CUT", "BLOCKED_PATH", "STEEP_SLOPE", "FLOODED", "TEMPORARY_OBSTACLE", "OTHER"]),
  geometryType: z.enum(["POINT", "PATH", "AREA"]), points: z.array(point).min(1).max(200),
  reason: z.string().trim().min(1).max(1000),
  startsAt: z.iso.datetime().nullable().optional(), endsAt: z.iso.datetime().nullable().optional(),
}).strict();
export function validateRestriction(data: z.infer<typeof restrictionInput>) {
  const minimum = { POINT: 1, PATH: 2, AREA: 3 }[data.geometryType];
  if (data.points.length < minimum || (data.geometryType === "POINT" && data.points.length !== 1)) {
    throw new HttpError(400, "Geometry has an invalid number of points");
  }
  if (data.startsAt && data.endsAt && new Date(data.startsAt) >= new Date(data.endsAt)) {
    throw new HttpError(400, "endsAt must be after startsAt");
  }
}
export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
