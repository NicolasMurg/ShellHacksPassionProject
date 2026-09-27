// JSON response contracts derived from the canonical Prisma models.
// The frontend imports these as types only; no database client enters its bundle.
import type { Building, Entrance, GeoPoint, User, Zone, RouteRestriction } from "@prisma/client";
export type ApiPoint = GeoPoint;
export type ApiBuilding = Building & { entrances: Entrance[] };
export type ApiEntrance = Entrance;
export type ApiZone = Zone;
export type ApiUser = Pick<User, "id" | "name" | "email" | "profile">;
export type ApiClosure = Omit<RouteRestriction, "createdAt" | "startsAt" | "endsAt"> & {
  createdAt: string; startsAt: string | null; endsAt: string | null; owner?: { id: string; name: string } | null;
};
export type ApiRoute = {
  travelMode: "WALK" | "DRIVE"; distanceMeters: number; durationSeconds: number;
  encodedPolyline: string; path: GeoPoint[]; warnings: string[];
};
export type ApiPlan = {
  tripId?: string; accessibilityVerified: boolean;
  options: { zone?: ApiZone; entrance: Entrance; walkSeconds: number; reason: string; warnings: string[]; route: ApiRoute }[];
};

export type ApiArrivalDestination = { name: string; location: GeoPoint; placeId?: string };
export type ApiPersonalStop = {
  id: string; destinationKey: string; destinationLocation: GeoPoint; placeId: string | null;
  stopPoint: GeoPoint; name: string; instructions: string; updatedAt: string;
};
export type ApiArrivalPlan = {
  options: { id: string; stopPoint: GeoPoint; source: "saved" | "suggested" | "manual";
    name: string; instructions: string; walkSeconds: number; walk: ApiRoute; drive?: ApiRoute;
    warnings: string[] }[];
  notices: string[]; savedStop: ApiPersonalStop | null; accessibilityVerified: false;
};
