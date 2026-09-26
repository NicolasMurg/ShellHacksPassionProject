import { z } from "zod";
import { HttpError, point } from "./validation";

async function googleRequest(path: string, mask: string, body: unknown): Promise<unknown> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
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
export async function searchPlaces(query: string) {
  const result = placesResponse.safeParse(await googleRequest("https://places.googleapis.com/v1/places:searchText",
    "places.id,places.displayName,places.formattedAddress,places.location,places.googleMapsUri,places.attributions",
    { textQuery: query, pageSize: 10 }));
  if (!result.success) throw new HttpError(502, "Google Places returned an invalid response");
  return result.data.places.filter(p => p.location).map(p => ({
    id: p.id, name: p.displayName?.text ?? p.formattedAddress ?? p.id,
    address: p.formattedAddress ?? "", location: { type: "Point", coordinates: [p.location!.longitude, p.location!.latitude] },
    googleMapsUri: p.googleMapsUri, attributions: p.attributions ?? [],
  }));
}
const routeResponse = z.object({ routes: z.array(z.object({
  distanceMeters: z.number().nonnegative().default(0), duration: z.string().regex(/^\d+(\.\d+)?s$/),
  polyline: z.object({ encodedPolyline: z.string() }), warnings: z.array(z.string()).default([]),
})).default([]) });
export async function computeRoute(origin: z.infer<typeof point>, destination: z.infer<typeof point>, travelMode: "WALK" | "DRIVE") {
  const waypoint = (p: z.infer<typeof point>) => ({ location: { latLng: { latitude: p.coordinates[1], longitude: p.coordinates[0] } } });
  const result = routeResponse.safeParse(await googleRequest("https://routes.googleapis.com/directions/v2:computeRoutes",
    "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.warnings",
    { origin: waypoint(origin), destination: waypoint(destination), travelMode, units: "METRIC" }));
  if (!result.success) throw new HttpError(502, "Google Routes returned an invalid response");
  const route = result.data.routes[0];
  if (!route) throw new HttpError(404, "No route found");
  return { travelMode, distanceMeters: route.distanceMeters, durationSeconds: parseFloat(route.duration),
    encodedPolyline: route.polyline.encodedPolyline, warnings: route.warnings };
}
