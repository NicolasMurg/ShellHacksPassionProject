import { z } from "zod";
import { HttpError, point } from "./validation";

async function googleRequest(path: string, mask: string, body: unknown): Promise<unknown> {
  const key = process.env.GOOGLE_SERVER_KEY?.trim() || process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!key) throw new HttpError(503, "Google Maps is not configured");
  let response: Response;
  try {
    response = await fetch(path, { method: "POST", signal: AbortSignal.timeout(10000),
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": mask },
      body: JSON.stringify(body) });
  } catch {
    throw new HttpError(502, "Google Maps could not be reached");
  }
  if (!response.ok) throw new HttpError(502, "Google Maps request failed");
  try { return await response.json(); }
  catch { throw new HttpError(502, "Google Maps returned an invalid response"); }
}
const placesResponse = z.object({ places: z.array(z.object({
  id: z.string(), displayName: z.object({ text: z.string() }).optional(), formattedAddress: z.string().optional(),
  location: z.object({ latitude: z.number(), longitude: z.number() }).optional(),
  googleMapsUri: z.string().optional(), attributions: z.array(z.object({ provider: z.string().optional(), providerUri: z.string().optional() })).optional(),
})).default([]) });
export async function searchPlaces(query: string, campusOnly = true) {
  const result = placesResponse.safeParse(await googleRequest("https://places.googleapis.com/v1/places:searchText",
    "places.id,places.displayName,places.formattedAddress,places.location,places.googleMapsUri,places.attributions",
    { textQuery: query, pageSize: 10, ...(campusOnly ? { locationRestriction: { rectangle: { low: { latitude: 25.745, longitude: -80.39 }, high: { latitude: 25.765, longitude: -80.365 } } } } : {}) }));
  if (!result.success) throw new HttpError(502, "Google Places returned an invalid response");
  return result.data.places.filter(p => p.location).map(p => ({
    id: p.id, name: p.displayName?.text ?? p.formattedAddress ?? p.id,
    address: p.formattedAddress ?? "", location: { type: "Point", coordinates: [p.location!.longitude, p.location!.latitude] },
    googleMapsUri: p.googleMapsUri, attributions: p.attributions ?? [],
  }));
}
const routeResponse = z.object({ routes: z.array(z.object({
  distanceMeters: z.number().nonnegative().default(0), duration: z.string().regex(/^\d+(\.\d+)?s$/),
  legs: z.array(z.object({ endLocation: z.object({ latLng: z.object({ latitude: z.number(), longitude: z.number() }) }) })).optional(),
  polyline: z.object({ encodedPolyline: z.string() }), warnings: z.array(z.string()).default([]),
})).default([]) });
export async function computeRoute(origin: z.infer<typeof point>, destination: z.infer<typeof point>, travelMode: "WALK" | "DRIVE", arrival?: { placeId?: string; stopover?: boolean }) {
  const waypoint = (p: z.infer<typeof point>) => ({ location: { latLng: { latitude: p.coordinates[1], longitude: p.coordinates[0] } } });
  const result = routeResponse.safeParse(await googleRequest("https://routes.googleapis.com/directions/v2:computeRoutes",
    "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.warnings,routes.legs.endLocation",
    { origin: waypoint(origin), destination: arrival?.placeId ? { placeId: arrival.placeId } : { ...waypoint(destination), ...(arrival?.stopover && travelMode === "DRIVE" ? { vehicleStopover: true, sideOfRoad: true } : {}) }, travelMode, units: "METRIC" }));
  if (!result.success) throw new HttpError(502, "Google Routes returned an invalid response");
  const route = result.data.routes[0];
  if (!route) throw new HttpError(404, "No route found");
  return { travelMode, distanceMeters: route.distanceMeters, durationSeconds: parseFloat(route.duration),
    encodedPolyline: route.polyline.encodedPolyline, path: decodePolyline(route.polyline.encodedPolyline),
    endLocation: route.legs?.at(-1)?.endLocation.latLng, warnings: route.warnings };
}

export function decodePolyline(encoded: string): z.infer<typeof point>[] {
  const path: z.infer<typeof point>[] = [];
  let index = 0, lat = 0, lng = 0;
  function read() {
    let value = 0, shift = 0, byte: number;
    do {
      if (index >= encoded.length || shift > 30) throw new HttpError(502, "Google returned an invalid route path");
      byte = encoded.charCodeAt(index++) - 63;
      if (byte < 0 || byte > 63) throw new HttpError(502, "Google returned an invalid route path");
      value |= (byte & 31) << shift;
      shift += 5;
    } while (byte >= 32);
    return value & 1 ? ~(value >> 1) : value >> 1;
  }
  while (index < encoded.length) {
    lat += read(); lng += read();
    const p = point.safeParse({ type: "Point", coordinates: [lng / 1e5, lat / 1e5] });
    if (!p.success) throw new HttpError(502, "Google returned invalid coordinates");
    path.push(p.data);
  }
  return path;
}
