import { afterAll, beforeAll, expect, test, spyOn } from "bun:test";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import type { Server } from "node:http";
import type { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
const entranceId = (slug: string) => createHash("sha256").update(`fiu-entrance:${slug}`).digest("hex").slice(0, 24);

let mongo: MongoMemoryReplSet;
let server: Server;
let prisma: PrismaClient;
let base: string;
let token: string, otherToken: string, zoneId: string, closureId: string, tripId: string;
const nativeFetch = globalThis.fetch;
const originalDb = process.env.DATABASE_URL;
const originalKey = process.env.GOOGLE_SERVER_KEY;
const originalLegacyKey = process.env.GOOGLE_MAPS_API_KEY;
const calls: { url: string; body: any; headers: any }[] = [];
let providerMode = "ok";
let mock: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;
const defaultZone = `gen-${entranceId("gc-east")}`;
function encode(points: { latitude: number; longitude: number }[]) {
  let lastLat = 0, lastLng = 0, result = "";
  const write = (delta: number) => {
    let n = delta < 0 ? ~(delta << 1) : delta << 1;
    while (n >= 32) { result += String.fromCharCode((32 | (n & 31)) + 63); n >>= 5; }
    result += String.fromCharCode(n + 63);
  };
  for (const p of points) {
    const lat = Math.round(p.latitude * 1e5), lng = Math.round(p.longitude * 1e5);
    write(lat - lastLat); write(lng - lastLng); lastLat = lat; lastLng = lng;
  }
  return result;
}
async function request(path: string, method = "GET", body?: unknown, bearer?: string) {
  const response = await nativeFetch(base + path, { method,
    headers: { "Content-Type": "application/json", ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: response.status === 204 ? null : await response.json() as any };
}
beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ binary: { version: "7.0.24" }, replSet: { count: 1 } });
  process.env.DATABASE_URL = mongo.getUri("api_tests");
  process.env.GOOGLE_SERVER_KEY = "test-key";
  delete process.env.GOOGLE_MAPS_API_KEY;
  const push = Bun.spawn(["bun", "run", "db:push"], { env: process.env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(push.stdout).text(), new Response(push.stderr).text(), push.exited]);
  if (code) throw new Error(stdout + stderr);
  prisma = (await import("../src/lib/prisma")).prisma;
  const { seed } = await import("../db/seed");
  await seed(); await seed();
  const provider = async (url: Parameters<typeof fetch>[0], options?: Parameters<typeof fetch>[1]) => {
    if (String(url).startsWith("/api/")) return nativeFetch(base.replace(/\/api$/, "") + url, options);
    const body = JSON.parse(String(options?.body));
    calls.push({ url: String(url), body, headers: options?.headers });
    if (providerMode === "error") return Response.json({ error: { message: "SECRET upstream detail" } }, { status: 403 });
    if (String(url).includes("places.googleapis.com") && body.textQuery === "123 Home Street") return Response.json({ places: [{ id: "house-place", displayName: { text: "123 Home Street" }, location: { latitude: 25.78, longitude: -80.39 } }, { id: "lower-campus-result", displayName: { text: "Campus result" }, location: { latitude: 25.75625, longitude: -80.37318 } }] });
    if (String(url).includes("places.googleapis.com")) return Response.json({ places: [{ id: "place-1", displayName: { text: "Campus cafe" }, location: { latitude: 25.75625, longitude: -80.37318 } }] });
    if (providerMode === "empty") return Response.json({ routes: [] });
    const from = body.origin.location.latLng, to = { ...(body.destination.location?.latLng ?? { latitude: 25.78, longitude: -80.39 }) };
    if (body.travelMode === "DRIVE") to.longitude -= 0.0002;
    return Response.json({ routes: [{ distanceMeters: providerMode === "distance" ? Math.hypot(from.latitude - to.latitude, from.longitude - to.longitude) * 100000 : providerMode === "longwalk" && body.travelMode === "WALK" ? 900 : 100, duration: "60s", polyline: { encodedPolyline: encode([from, to]) },
      legs: [{ endLocation: { latLng: to } }], warnings: ["Use caution"] }] });
  };
  mock = spyOn(globalThis, "fetch").mockImplementation(Object.assign(provider, { preconnect: nativeFetch.preconnect }));
  const { generateCurbs } = await import("../db/generate-curbs");
  expect(await generateCurbs()).toBe(10);
  expect(await generateCurbs()).toBe(0);
  const app = (await import("../src/app")).default;
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test port");
  base = `http://127.0.0.1:${address.port}/api`;
});
afterAll(async () => {
  mock?.mockRestore();
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  if (prisma) await prisma.$disconnect();
  if (mongo) await mongo.stop();
  for (const [key, value] of [["DATABASE_URL", originalDb], ["GOOGLE_SERVER_KEY", originalKey], ["GOOGLE_MAPS_API_KEY", originalLegacyKey]]) {
    if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
  }
});
test("campus seed and shared curb generation are idempotent and keep canonical types", async () => {
  const buildings = await request("/buildings");
  expect(buildings.status).toBe(200);
  expect(buildings.body).toHaveLength(6);
  const gc = buildings.body.find((b: any) => b.id === "gc");
  expect(gc.entrances).toHaveLength(3);
  expect(gc.entrances[0].id).toMatch(/^[a-f0-9]{24}$/);
  const zones = await request("/zones?buildingId=gc");
  expect(zones.body).toHaveLength(3);
  expect(zones.body[0].source).toBe("generated");
  expect(zones.body[0].kinds).toEqual(["BOTH"]);
  expect(zones.body[0].stopPoint.type).toBe("Point");
});
test("a building without zones reports unavailable data rather than a successful empty plan", async () => {
  await prisma.building.create({ data: { id: "unconfigured", code: "TEST", name: "Unconfigured building",
    location: { type: "Point", coordinates: [-80.373, 25.756] } } });
  const before = calls.length;
  for (const kind of ["DROPOFF", "PICKUP"]) {
    const response = await request("/plan", "POST", { buildingId: "unconfigured", kind });
    expect(response.status).toBe(503);
    expect(response.body.error).toContain("locations are not available");
    expect(response.body.options).toBeUndefined();
  }
  expect(calls.length).toBe(before);
});

test("auth supports multiple devices and protected profile fields", async () => {
  const first = await request("/auth/register", "POST", { name: "Alice", email: "Alice@example.com", password: "correct-password" });
  expect(first.status).toBe(201); token = first.body.token;
  expect(first.body.user.passwordHash).toBeUndefined();
  expect(first.body.user.profile.learnedFactor).toBe(1);
  const second = await request("/auth/register", "POST", { name: "Alice", email: "bob@example.com", password: "other-password" });
  otherToken = second.body.token;
  expect((await request("/auth/login", "POST", { email: "alice@example.com", password: "wrong-password" })).status).toBe(401);
  const login = await request("/auth/login", "POST", { email: "alice@example.com", password: "correct-password" });
  expect(login.status).toBe(200);
  expect(login.body.token).not.toBe(token);
  const changed = await request("/me", "PATCH", { profile: { pace: "slow", age: 65, mobility: "cane" } }, token);
  expect(changed.status).toBe(200);
  expect((await request("/me", "GET", undefined, login.body.token)).body.profile.age).toBe(65);
  const partial = await request("/me", "PATCH", { profile: { heightCm: 172 } }, token);
  expect(partial.body.profile.pace).toBe("slow");
  expect(partial.body.profile.mobility).toBe("cane");
  expect((await request("/me", "PATCH", { profile: { learnedFactor: 0.01 } }, token)).status).toBe(400);
  expect((await request("/me", "PATCH", { profile: { age: -1 } }, token)).status).toBe(400);
  await request("/auth/logout", "POST", {}, login.body.token);
  expect((await request("/me", "GET", undefined, login.body.token)).status).toBe(401);
  expect((await request("/me")).status).toBe(401);
});
test("zone upsert preserves the frontend ID and cannot overwrite another user's or a shared zone", async () => {
  const zone = await prisma.zone.findUniqueOrThrow({ where: { id: defaultZone } });
  const { zoneView } = await import("../src/lib/publicStops");
  const { id, source, ownerId, instructions, ...data } = zoneView(zone);
  zoneId = "personal-from-frontend";
  const created = await request(`/me/zones/${zoneId}`, "PUT", { ...data, basedOnZoneId: id, name: "Mine", ownerId: "forged-owner" }, token);
  expect(created.status).toBe(201);
  expect(created.body.id).toBe(zoneId);
  expect(created.body.ownerId).toBe((await request("/me", "GET", undefined, token)).body.id);
  expect(created.body.source).toBe("personal");
  expect((await request(`/me/zones/${zoneId}`, "PUT", { ...data, name: "Other" }, otherToken)).status).toBe(404);
  expect((await request(`/me/zones/${id}`, "PUT", data, token)).status).toBe(404);
  expect((await request(`/me/zones/${zoneId}`, "PATCH", { hidden: true }, token)).body.hidden).toBe(true);
  expect((await request("/me/zones", "GET", undefined, token)).body[0].hidden).toBe(true);
  expect((await request("/me/zones", "GET", undefined, otherToken)).body).toHaveLength(0);
  expect((await request(`/me/zones/${zoneId}`, "DELETE", undefined, otherToken)).status).toBe(404);
});
test("closure reports identify authors by ID even when display names match", async () => {
  const points = [{ type: "Point", coordinates: [-80.37295, 25.75624] }, { type: "Point", coordinates: [-80.373, 25.7563] }];
  const body = { type: "ROAD_CLOSED", geometryType: "PATH", points, reason: "Road works" };
  expect((await request("/closures", "POST", body)).status).toBe(401);
  expect((await request("/closures", "POST", { ...body, points: points.slice(0, 1) }, token)).status).toBe(400);
  const created = await request("/closures", "POST", body, token);
  expect(created.status).toBe(201); closureId = created.body.id;
  expect(created.body.owner.name).toBe("Alice");
  expect((await request(`/closures/${closureId}`, "DELETE", undefined, otherToken)).status).toBe(404);
});
test("search resolves rooms locally and supports Places beyond campus", async () => {
  const before = calls.length;
  const local = await request("/search?q=GC%20150");
  expect(local.body.building.id).toBe("gc"); expect(local.body.room).toBe("150");
  expect(local.body.building.entrances).toHaveLength(3);
  expect(calls.length).toBe(before);
  const fallback = await request("/search?q=campus%20cafe");
  expect(fallback.body.building.id).toBe("gc");
  expect(calls.at(-1)!.body.locationRestriction).toBeUndefined();
  providerMode = "error";
  const failed = await request("/search?q=campus%20cafe");
  expect(failed.status).toBe(502); expect(failed.body.error).not.toContain("SECRET");
  providerMode = "ok";
  delete process.env.GOOGLE_SERVER_KEY;
  delete process.env.GOOGLE_MAPS_API_KEY;
  expect((await request("/search?q=campus%20cafe")).status).toBe(503);
  process.env.GOOGLE_SERVER_KEY = "   ";
  process.env.GOOGLE_MAPS_API_KEY = "test-key";
  expect((await request("/search?q=campus%20cafe")).status).toBe(200);
  delete process.env.GOOGLE_MAPS_API_KEY;
  process.env.GOOGLE_SERVER_KEY = "test-key";
});
test("planning ranks real walking routes, respects hidden zones and step-free needs, and allows guests", async () => {
  await prisma.routeRestriction.deleteMany();
  await prisma.zone.updateMany({ where: { buildingId: 'gc', source: 'generated' }, data: {
    status: 'VERIFIED', access: 'PERMITTED', accessibility: 'STEP_FREE', verificationExpiresAt: new Date(Date.now() + 86400000) } });
  const input = { buildingId: "gc", room: "150", kind: "DROPOFF", stepFree: true };
  const guest = await request("/plan", "POST", input);
  expect(guest.status).toBe(200);
  expect(guest.body.options).toHaveLength(3);
  expect(guest.body.tripId).toBeUndefined();
  const mine = await request("/plan", "POST", input, token);
  expect(mine.status).toBe(200); tripId = mine.body.tripId;
  expect(mine.body.options).toHaveLength(2); // East zone is hidden by the personal marker.
  expect(mine.body.options[0].entrance.accessible).toBe(true);
  expect(mine.body.options[0].route.path[0].type).toBe("Point");
  expect(mine.body.options[0].walkSeconds).toBeGreaterThan(guest.body.options[0].walkSeconds);
  const walk = await request("/plan", "POST", { ...input, kind: "WALK", origin: { type: "Point", coordinates: [-80.373, 25.756] } });
  expect(walk.status).toBe(200); expect(walk.body.options[0].zone).toBeUndefined();
  expect((await request("/plan", "POST", { ...input, kind: "WALK" })).status).toBe(400);
  expect((await request("/plan", "POST", input, "invalid")).status).toBe(401);
  providerMode = "empty";
  expect((await request("/plan", "POST", input)).body.options).toHaveLength(0);
  providerMode = "ok";
});
test("feedback learns once per trip, returns the updated user, and prevents cross-account changes", async () => {
  const input = { tripId, rating: 3, paceFeedback: "slower" };
  const first = await request("/trips/feedback", "POST", input, token);
  expect(first.status).toBe(200); expect(first.body.user.profile.learnedFactor).toBe(1.06);
  const repeat = await request("/trips/feedback", "POST", input, token);
  expect(repeat.body.user.profile.learnedFactor).toBe(1.06);
  expect((await request("/trips/feedback", "POST", input, otherToken)).status).toBe(404);
  expect(await prisma.tripFeedback.count({ where: { tripId } })).toBe(1);
});
test("the real frontend API adapters work against the backend across the full map workflow", async () => {
  const api = await import("../../frontend/src/api");
  const session = await api.login("frontend@example.com", "frontend-password", "Frontend User");
  const buildings = await api.getBuildings();
  const gc = buildings.find(b => b.id === "gc")!;
  expect(gc.location).toEqual({ lat: 25.75625, lng: -80.37318 });
  expect(gc.entrances[0]!.rooms).toBeArray();
  const defaults = await api.getDefaultZones();
  const original = defaults.find(z => z.id === defaultZone)!;
  expect(original.kinds).toEqual(["dropoff", "pickup"]);
  const saved = await api.saveMyZone(session.token, { ...original, id: "adapter-zone", ownerId: session.user.id, source: "personal", basedOnZoneId: original.id });
  expect(saved.id).toBe("adapter-zone"); expect(saved.rooms).toEqual(original.rooms);
  const updated = await api.updateProfile(session.token, { ...session.user.profile, age: 42, pace: "fast" });
  expect(updated.profile.age).toBe(42);
  const cleared = await api.updateProfile(session.token, { ...updated.profile, age: undefined });
  expect(cleared.profile.age).toBeUndefined();
  const closed = await api.reportClosure(session.token, [{ lat: 25.756, lng: -80.373 }, { lat: 25.7561, lng: -80.373 }], "Adapter report");
  expect(closed.reportedBy).toBe("Frontend User"); expect(closed.ownerId).toBe(session.user.id);
  const destination = await api.search("GC 150");
  const plan = await api.plan({ buildingId: destination.building!.id, room: destination.room, kind: "dropoff", stepFree: true }, session.token);
  expect(plan.options[0]!.entrance.location.lat).toBeNumber();
  expect(plan.options[0]!.zone?.kinds).toContain("dropoff");
  expect(plan.options[0]!.route.path[0]!.lng).toBeNumber();
  const drive = await api.route("DRIVING", gc.location, original.stopPoint);
  expect(drive.path[0]!.lat).toBeCloseTo(gc.location.lat, 4);
  expect((await api.feedback(session.token, plan.tripId!, "faster")).profile.learnedFactor).toBe(0.955);
  await api.removeClosure(session.token, closed.id);
  await api.deleteMyZone(session.token, saved.id);
  await api.logout(session.token);
  await expect(api.getMe(session.token)).rejects.toThrow();
});
test("arrival planning supports arbitrary places, coordinate stops, and canonical frontend adapters", async () => {
  const api = await import("../../frontend/src/api");
  const found = await api.search("123 Home Street");
  expect(found.building).toBeUndefined();
  expect(found.destination!.location).toEqual({ lat: 25.78, lng: -80.39 });
  const result = await api.planArrival({ destination: found.destination!, kind: 'dropoff', stepFree: true });
  expect(result.options.length).toBeGreaterThan(0);
  expect(result.options[0]!.stopPoint.lat).toBeNumber();
  expect(result.options[0]!.drive).toBeUndefined(); // No fake ETA when GPS is unavailable.
  expect(result.options[0]!.warnings.join(' ')).toContain('step-free route could not be verified');
  expect(calls.some(c => c.body.destination?.placeId === 'house-place')).toBe(true);
  expect(calls.some(c => c.body.destination?.vehicleStopover === true && c.body.destination?.sideOfRoad === true)).toBe(true);
  const pickup = await api.planArrival({ destination: found.destination!, kind: 'pickup', stepFree: false,
    origin: { lat: 25.779, lng: -80.389 }, stopPoint: { lat: 25.78, lng: -80.3901 } });
  expect(pickup.options[0]!.walk.path[0]!.lat).toBeCloseTo(found.destination!.location.lat, 4);
  expect(pickup.options[0]!.drive).toBeDefined();
  const far = await request('/arrivals/plan', 'POST', { destination: { name: 'Home', location: { type: 'Point', coordinates: [-80.39, 25.78] } },
    stopPoint: { type: 'Point', coordinates: [-80, 25] } });
  expect(far.status).toBe(400);
  providerMode = 'error';
  try { expect((await request('/arrivals/plan', 'POST', { destination: { name: 'Home', location: { type: 'Point', coordinates: [-80.39, 25.78] } } })).status).toBe(502) }
  finally { providerMode = 'ok' }
});
test("saved arrival points remain private, update across sessions, and are rechecked against closures", async () => {
  const destination = { name: 'Home', placeId: 'home-private', location: { type: 'Point', coordinates: [-80.40, 25.79] } };
  const stopPoint = { type: 'Point', coordinates: [-80.401, 25.79] };
  const input = { destination, stopPoint, name: 'My driveway', instructions: 'Use the front gate' };
  expect((await request('/me/stops', 'PUT', input)).status).toBe(401);
  const saved = await request('/me/stops', 'PUT', input, token);
  expect(saved.status).toBe(200);
  expect(saved.body.ownerId).toBeUndefined();
  const again = await request('/me/stops', 'PUT', { ...input, instructions: 'Meet at gate' }, token);
  expect(again.body.id).toBe(saved.body.id);
  expect((await request('/me/stops', 'GET', undefined, otherToken)).body).toHaveLength(0);
  expect((await request(`/me/stops/${saved.body.id}`, 'DELETE', undefined, otherToken)).status).toBe(404);
  const login = await request('/auth/login', 'POST', { email: 'alice@example.com', password: 'correct-password' });
  const plan = await request('/arrivals/plan', 'POST', { destination: { ...destination, placeId: undefined } }, login.body.token);
  expect(plan.status).toBe(200);
  expect(plan.body.options[0].source).toBe('saved');
  expect(plan.body.options[0].instructions).toBe('Meet at gate');
  // A point report blocks the saved arrival while leaving the destination approach available.
  const restriction = await prisma.routeRestriction.create({ data: { type: 'ROAD_CLOSED', geometryType: 'POINT',
    points: [plan.body.options[0].stopPoint], reason: 'Gate temporarily blocked', ownerId: null } });
  const changed = await request('/arrivals/plan', 'POST', { destination: { ...destination, placeId: undefined } }, token);
  expect(changed.status).toBe(200);
  expect(changed.body.options.every((o: any) => o.source !== 'saved')).toBe(true);
  expect(changed.body.options.length).toBeGreaterThan(0);
  expect(changed.body.notices.join(' ')).toContain('Your saved spot was excluded');
  await prisma.routeRestriction.update({ where: { id: restriction.id }, data: { endsAt: new Date(Date.now() - 1000) } });
  expect((await request('/arrivals/plan', 'POST', { destination: { ...destination, placeId: undefined } }, token)).body.options[0].source).toBe('saved');
  await request(`/me/stops/${saved.body.id}`, 'DELETE', undefined, token);
  expect((await request('/me/stops', 'GET', undefined, token)).body).toHaveLength(0);
});
test("closure geometry detects segment crossings and area interiors rather than only vertices", async () => {
  const { touchesRestriction, geoPoint } = await import('../src/lib/arrivals');
  const point = (lat: number, lng: number) => geoPoint({ lat, lng });
  expect(touchesRestriction([point(25, -80.002), point(25, -79.998)], {
    geometryType: 'PATH', points: [point(24.998, -80), point(25.002, -80)],
  })).toBe(true);
  expect(touchesRestriction([point(25, -80)], { geometryType: 'AREA',
    points: [point(24.999, -80.001), point(25.001, -80.001), point(25.001, -79.999), point(24.999, -79.999)],
  })).toBe(true);
  expect(touchesRestriction([point(26, -81)], { geometryType: 'POINT', points: [point(25, -80)] })).toBe(false);
});
test("public stops enforce ownership, nearby confirmations, reports, and admin review", async () => {
  const location = { type: 'Point', coordinates: [-80.374, 25.756] };
  const submission = { name: 'Public library curb', instructions: 'Use the signed loading area.', location, kinds: ['DROPOFF', 'PICKUP'] };
  expect((await request('/public-stops', 'POST', submission)).status).toBe(401);
  expect((await request('/public-stops', 'POST', { ...submission, status: 'VERIFIED' }, token)).status).toBe(400);
  expect((await request('/public-stops', 'POST', { ...submission, photoUrl: 'javascript:alert(1)' }, token)).status).toBe(400);
  const created = await request('/public-stops', 'POST', submission, token);
  expect(created.status).toBe(201);
  const stopId = created.body.id;
  const path = `/public-stops/${stopId}`;
  expect(created.body.status).toBe('UNVERIFIED');
  expect(created.body.submittedBy).toBeUndefined();
  expect((await request('/public-stops')).body.stops.some((s: any) => s.id === stopId)).toBe(true);
  expect((await request('/me', 'PATCH', { role: 'ADMIN' }, otherToken)).status).toBe(400);
  expect((await request('/public-stops?review=true', 'GET', undefined, otherToken)).status).toBe(403);
  const fix = { location, accuracy: 5, timestamp: Date.now() };
  expect((await request(`${path}/confirm`, 'POST', fix, token)).status).toBe(403);
  expect((await request(`${path}/confirm`, 'POST', { ...fix, timestamp: Date.now() - 180000 }, otherToken)).status).toBe(400);
  expect((await request(`${path}/confirm`, 'POST', { ...fix, accuracy: 100 }, otherToken)).status).toBe(400);
  expect((await request(`${path}/confirm`, 'POST', { ...fix, location: { type: 'Point', coordinates: [-81, 26] } }, otherToken)).status).toBe(400);
  const confirmed = await request(`${path}/confirm`, 'POST', fix, otherToken);
  expect(confirmed.status).toBe(200);
  expect(confirmed.body.confirmationCount).toBe(1);
  expect(confirmed.body.status).toBe('UNVERIFIED');
  expect(confirmed.body.confirmations).toBeUndefined();
  expect((await request(`${path}/confirm`, 'POST', fix, otherToken)).status).toBe(409);
  const adminData = await request('/auth/register', 'POST', { name: 'Reviewer', email: 'reviewer@example.com', password: 'reviewer-password' });
  expect(adminData.status).toBe(201);
  const adminToken = adminData.body.token;
  const review = { status: 'VERIFIED', access: 'PERMITTED', accessibility: 'STEP_FREE', notes: 'Inspected public loading signs and level curb access.', validDays: 90, revision: confirmed.body.revision };
  expect((await request(`${path}/review`, 'POST', review, adminToken)).status).toBe(403);
  await prisma.user.update({ where: { id: adminData.body.user.id }, data: { role: 'ADMIN' } });
  expect((await request('/me', 'GET', undefined, adminToken)).body.role).toBe('ADMIN');
  expect((await request(`${path}/review`, 'POST', { ...review, access: 'UNKNOWN' }, adminToken)).status).toBe(400);
  expect((await request(`${path}/review`, 'POST', { ...review, revision: 0 }, adminToken)).status).toBe(409);
  const verified = await request(`${path}/review`, 'POST', review, adminToken);
  expect(verified.status).toBe(200);
  expect(verified.body.status).toBe('VERIFIED');
  expect(verified.body.verificationExpiresAt).toBeString();
  expect(verified.body.reviews.at(-1).actorName).toBe('Reviewer');
  const destination = { name: 'Public stop', location, publicStopId: stopId };
  const publicPlan = await request('/arrivals/plan', 'POST', { destination });
  expect(publicPlan.status).toBe(200);
  expect(publicPlan.body.options[0].source).toBe('public');
  expect(publicPlan.body.options[0].name).toBe(submission.name);
  const report = { category: 'CLOSED', details: 'Construction blocks the curb today.' };
  const reported = await request(`${path}/reports`, 'POST', report, otherToken);
  expect(reported.status).toBe(200);
  expect(reported.body.status).toBe('DISPUTED');
  expect(reported.body.access).toBe('UNKNOWN');
  expect(reported.body.reports[0].userId).toBeUndefined();
  expect((await request(`${path}/reports`, 'POST', report, otherToken)).status).toBe(409);
  expect((await request('/arrivals/plan', 'POST', { destination })).status).toBe(409);
  expect((await request(`${path}/review`, 'POST', { ...review, revision: verified.body.revision }, adminToken)).status).toBe(409);
  const queue = await request('/public-stops?review=true', 'GET', undefined, adminToken);
  expect(queue.body.stops.some((s: any) => s.id === stopId)).toBe(true);
  const reverified = await request(`${path}/review`, 'POST', { ...review, revision: reported.body.revision }, adminToken);
  expect(reverified.body.reports[0].resolvedAt).toBeString();
  await prisma.zone.update({ where: { id: stopId }, data: { verificationExpiresAt: new Date(Date.now() - 1000) } });
  const expiredPreview = await request('/arrivals/plan', 'POST', { destination });
  expect(expiredPreview.status).toBe(200);
  expect(expiredPreview.body.options[0].publicStopStatus).toBe('UNVERIFIED');
  const expired = await request(path);
  expect(expired.body.status).toBe('UNVERIFIED');
  expect(expired.body.accessibility).toBe('UNKNOWN');
  expect(expired.body.reviews.at(-1).actorName).toBe('System');
  expect((await prisma.zone.findUniqueOrThrow({ where: { id: stopId } })).status).toBe('UNVERIFIED');
  const retired = await request(`${path}/review`, 'POST', { ...review, status: 'RETIRED', revision: expired.body.revision }, adminToken);
  expect(retired.status).toBe(200);
  expect((await request('/public-stops')).body.stops.some((s: any) => s.id === stopId)).toBe(false);
  expect((await request('/public-stops?retired=true', 'GET', undefined, adminToken)).body.stops.some((s: any) => s.id === stopId)).toBe(true);
  expect((await request(`${path}/confirm`, 'POST', fix, otherToken)).status).toBe(409);
  const own = await request('/public-stops', 'POST', { ...submission, name: 'Reviewer new curb' }, adminToken);
  expect((await request(`/public-stops/${own.body.id}/review`, 'POST', { ...review, revision: 0 }, adminToken)).status).toBe(403);
});

test("public stop confirmation conflicts cannot double-count an account", async () => {
  const location = { type: 'Point', coordinates: [-80.372, 25.757] };
  const created = await request('/public-stops', 'POST', { name: 'East curb', instructions: 'Meet near the entrance.', location, kinds: ['PICKUP'] }, token);
  expect(created.status).toBe(201);
  const path = `/public-stops/${created.body.id}`;
  const fix = { location, accuracy: 5, timestamp: Date.now() };
  const results = await Promise.all([request(`${path}/confirm`, 'POST', fix, otherToken), request(`${path}/confirm`, 'POST', fix, otherToken)]);
  expect(results.map(r => r.status).sort()).toEqual([200, 409]);
  expect((await request(path)).body.confirmationCount).toBe(1);
  const me = await request('/me', 'GET', undefined, otherToken);
  await prisma.user.update({ where: { id: me.body.id }, data: { role: 'ADMIN' } });
  const latest = (await request(path)).body;
  const verified = await request(`${path}/review`, 'POST', { status: 'VERIFIED', access: 'PERMITTED', accessibility: 'UNKNOWN',
    notes: 'Confirmed marked public pickup curb; accessibility not yet inspected.', revision: latest.revision }, otherToken);
  expect(verified.status).toBe(200);
  const destination = { name: 'Wrong client-supplied location', location: { type: 'Point', coordinates: [0, 0] }, publicStopId: latest.id };
  expect((await request('/arrivals/plan', 'POST', { destination, kind: 'DROPOFF' })).status).toBe(400);
  expect((await request('/arrivals/plan', 'POST', { destination, kind: 'PICKUP', stepFree: true })).status).toBe(409);
  const plan = await request('/arrivals/plan', 'POST', { destination, kind: 'PICKUP' });
  expect(plan.status).toBe(200);
  expect(plan.body.options[0].stopPoint.coordinates[1]).toBeCloseTo(location.coordinates[1]!, 3);
  const frontend = await import('../../frontend/src/api');
  const page = await frontend.getPublicStops(otherToken);
  const stop = page.stops.find(s => s.id === latest.id)!;
  expect(stop.location.lat).toBeCloseTo(location.coordinates[1]!, 5);
  expect(stop.status).toBe('VERIFIED');
  expect(stop.confirmedByMe).toBe(true);
  expect(stop.accessibility).toBe('UNKNOWN');
  await prisma.user.update({ where: { id: me.body.id }, data: { role: 'USER' } });
  expect((await request(`${path}/review`, 'POST', { status: 'RETIRED', access: 'UNKNOWN', accessibility: 'UNKNOWN', notes: 'Role revoked, must not succeed.', revision: verified.body.revision }, otherToken)).status).toBe(403);
});

test("nearby public stops serve different places while preserving each destination and eligibility rules", async () => {
  const owner = await prisma.user.findUniqueOrThrow({ where: { email: 'alice@example.com' } });
  const location = { type: 'Point', coordinates: [-81, 26] };
  const baseStop = { name: 'Shared neighborhood curb', source: 'public', polygon: [], stopPoint: location, instructions: 'Meet beside the public loading sign.',
    submittedBy: owner.id, kinds: ['DROPOFF', 'PICKUP'] as ('DROPOFF' | 'PICKUP')[], status: 'VERIFIED' as const,
    access: 'PERMITTED' as const, accessibility: 'STEP_FREE' as const, verificationExpiresAt: new Date(Date.now() + 86400000),
    confirmations: [], reports: [], reviews: [] };
  const shared = await prisma.zone.create({ data: baseStop });
  const excluded = await Promise.all([
    prisma.zone.create({ data: { ...baseStop, status: 'DISPUTED' } }),
    prisma.zone.create({ data: { ...baseStop, status: 'RETIRED' } }),
    prisma.zone.create({ data: { ...baseStop, access: 'RESTRICTED' } }),
    prisma.zone.create({ data: { ...baseStop, kinds: ['PICKUP'] } }),
    prisma.zone.create({ data: { ...baseStop, stopPoint: { type: 'Point', coordinates: [-81.02, 26] } } }),
  ]);
  const destinations = [
    { name: 'Neighborhood cafe', location: { type: 'Point', coordinates: [-81.0005, 26.0005] } },
    { name: 'Neighborhood library', location: { type: 'Point', coordinates: [-80.999, 26.001] } },
  ];
  for (const destination of destinations) {
    const result = await request('/arrivals/plan', 'POST', { destination });
    expect(result.status).toBe(200);
    const option = result.body.options[0];
    expect(option.publicStopId).toBe(shared.id);
    expect(option.name).toBe(shared.name);
    expect(option.instructions).toBe(shared.instructions);
    expect(option.walk.path.at(-1).coordinates).toEqual(destination.location.coordinates);
    expect(result.body.options.some((o: any) => excluded.some(s => s.id === o.publicStopId))).toBe(false);
  }
  const pickup = await request('/arrivals/plan', 'POST', { destination: destinations[0], kind: 'PICKUP' });
  expect(pickup.body.options.find((o: any) => o.publicStopId === shared.id).walk.path[0].coordinates).toEqual(destinations[0]!.location.coordinates);
  // A manually chosen pin continues to override automatic nearby discovery.
  const manual = await request('/arrivals/plan', 'POST', { destination: destinations[0], stopPoint: location });
  expect(manual.body.options[0].source).toBe('manual');
  expect(manual.body.options.some((o: any) => o.source === 'public')).toBe(false);
  await prisma.zone.update({ where: { id: shared.id }, data: { accessibility: 'UNKNOWN' } });
  const accessible = await request('/arrivals/plan', 'POST', { destination: destinations[0], stepFree: true });
  expect(accessible.body.options.some((o: any) => o.publicStopId === shared.id)).toBe(false);
  providerMode = 'longwalk';
  try {
    const long = await request('/arrivals/plan', 'POST', { destination: destinations[0] });
    expect(long.body.options.some((o: any) => o.source === 'public')).toBe(false);
    expect(long.body.notices.join(' ')).toContain('500 m');
  } finally { providerMode = 'ok' }
  const closure = await prisma.routeRestriction.create({ data: { type: 'ROAD_CLOSED', geometryType: 'POINT',
    points: [{ type: 'Point', coordinates: [-81.0002, 26] }], reason: 'Public curb temporarily closed' } });
  try {
    const blocked = await request('/arrivals/plan', 'POST', { destination: destinations[0] });
    expect(blocked.body.options.some((o: any) => o.publicStopId === shared.id)).toBe(false);
  } finally { await prisma.routeRestriction.delete({ where: { id: closure.id } }) }
});

test("one public curb serves different campus buildings and uses the destination's entrance", async () => {
  const owner = await prisma.user.findUniqueOrThrow({ where: { email: 'alice@example.com' } });
  const buildings = [];
  for (let i = 0; i < 2; i++) buildings.push(await prisma.building.create({ data: {
    id: `public-stop-building-${i}`, code: `PS${i}`, name: `Public stop test building ${i}`,
    location: { type: 'Point', coordinates: [-81.1, 26.1005 + i * 0.001] }, entrances: { create: {
      label: 'Main door', accessible: true, rooms: [], location: { type: 'Point', coordinates: [-81.1, 26.1005 + i * 0.001] },
    } },
  }, include: { entrances: true } }));
  const shared = await prisma.zone.create({ data: { source: 'public', polygon: [], name: 'Shared campus curb', instructions: 'Use the marked loading bay.',
    stopPoint: { type: 'Point', coordinates: [-81.1, 26.1] }, submittedBy: owner.id, kinds: ['DROPOFF', 'PICKUP'],
    status: 'VERIFIED', access: 'PERMITTED', accessibility: 'STEP_FREE', verificationExpiresAt: new Date(Date.now() + 86400000),
    confirmations: [], reports: [], reviews: [] } });
  for (const building of buildings) {
    const result = await request('/plan', 'POST', { buildingId: building.id, kind: 'DROPOFF' });
    expect(result.status).toBe(200);
    expect(result.body.options).toHaveLength(1);
    expect(result.body.options[0].zone.publicStopId).toBe(shared.id);
    expect(result.body.options[0].zone.source).toBe('public');
    expect(result.body.options[0].entrance.id).toBe(building.entrances[0]!.id);
    expect(result.body.options[0].route.path.at(-1).coordinates[1]).toBeCloseTo(building.location.coordinates[1]!, 5);
  }
  const frontend = await import('../../frontend/src/api');
  const plan = await frontend.plan({ buildingId: buildings[0]!.id, room: '', kind: 'pickup', stepFree: true });
  expect(plan.options[0]!.zone!.source).toBe('public');
  expect(plan.options[0]!.zone!.publicStopId).toBe(shared.id);
  expect(plan.options[0]!.route.path[0]!.lat).toBeCloseTo(buildings[0]!.location.coordinates[1]!, 5);
  expect(plan.options[0]!.route.path.at(-1)!.lat).toBeCloseTo(26.1, 5);
  providerMode = 'longwalk';
  try {
    const long = await request('/plan', 'POST', { buildingId: buildings[0]!.id, kind: 'DROPOFF' });
    expect(long.body.options).toHaveLength(0);
  } finally { providerMode = 'ok' }
  await prisma.zone.update({ where: { id: shared.id }, data: { status: 'DISPUTED' } });
  expect((await request('/plan', 'POST', { buildingId: buildings[0]!.id, kind: 'DROPOFF' })).status).toBe(503);
});

test("newly submitted public stops appear by name for nearby clicks and named buildings without admin approval", async () => {
  const location = { type: 'Point', coordinates: [-82, 27] };
  const building = await prisma.building.create({ data: { id: 'new-stop-demo', name: 'Named demo location', code: 'NEW',
    location: { type: 'Point', coordinates: [-82, 27.001] }, entrances: { create: {
      label: 'Premade entrance', accessible: true, rooms: [], location: { type: 'Point', coordinates: [-82, 27.001] },
    } } }, include: { entrances: true } });
  await prisma.zone.create({ data: { id: 'new-stop-default', buildingId: building.id, entranceId: building.entrances[0]!.id,
    name: 'Premade entrance zone', kinds: ['BOTH'], source: 'generated', polygon: [], stopPoint: location, rooms: [] } });
  const submitted = await request('/public-stops', 'POST', { name: 'My parking lot', instructions: 'Meet at the painted curb.', location, kinds: ['DROPOFF', 'PICKUP'] }, token);
  expect(submitted.status).toBe(201);
  expect(submitted.body.status).toBe('UNVERIFIED');
  const other = await request('/public-stops', 'POST', { name: 'Named neighboring curb', instructions: 'Beside the same road arrival.', location, kinds: ['DROPOFF'] }, token);
  expect(other.status).toBe(201);
  const destination = { name: 'Clicked location next door', location: { type: 'Point', coordinates: [-82.0002, 27.0002] } };
  const clicked = await request('/arrivals/plan', 'POST', { destination });
  expect(clicked.status).toBe(200);
  for (const stop of [submitted.body, other.body]) {
    const option = clicked.body.options.find((o: any) => o.publicStopId === stop.id);
    expect(option.name).toBe(stop.name);
    expect(option.publicStopStatus).toBe('UNVERIFIED');
    expect(option.warnings.join(' ')).toContain('Unverified public stop');
  }
  // Public identity is preserved even when Google snaps multiple stops to the same road endpoint.
  expect(clicked.body.options.filter((o: any) => o.source === 'public')).toHaveLength(2);
  const direct = await request('/arrivals/plan', 'POST', { destination: { ...destination, publicStopId: submitted.body.id } });
  expect(direct.status).toBe(200);
  expect(direct.body.options[0].name).toBe('My parking lot');
  expect(direct.body.options[0].publicStopStatus).toBe('UNVERIFIED');
  const frontend = await import('../../frontend/src/api');
  const named = await frontend.plan({ buildingId: building.id, room: '', kind: 'dropoff', stepFree: false });
  expect(named.options.some(o => o.zone?.name === 'Premade entrance zone')).toBe(true);
  const publicOption = named.options.find(o => o.zone?.publicStopId === submitted.body.id)!;
  expect(publicOption.zone!.name).toBe('My parking lot');
  expect(publicOption.zone!.source).toBe('public');
  expect(publicOption.zone!.publicStopStatus).toBe('UNVERIFIED');
  const accessible = await frontend.plan({ buildingId: building.id, room: '', kind: 'dropoff', stepFree: true });
  expect(accessible.options.some(o => o.zone?.publicStopId === submitted.body.id)).toBe(false);
  expect((await prisma.zone.findUniqueOrThrow({ where: { id: submitted.body.id } })).status).toBe('UNVERIFIED');
});

test('all nearby zones are paired with every entrance and the shortest valid pair wins', async () => {
  const building = await prisma.building.create({ data: { id: 'all-pairs', name: 'General hospital', code: 'HOSP',
    location: { type: 'Point', coordinates: [-83, 28] }, entrances: { create: [
      { label: 'West', accessible: true, rooms: ['1xx'], location: { type: 'Point', coordinates: [-83.001, 28] } },
      { label: 'East', accessible: true, rooms: ['2xx'], location: { type: 'Point', coordinates: [-83, 28] } },
    ] } }, include: { entrances: true } });
  const west = building.entrances.find(e => e.label === 'West')!, east = building.entrances.find(e => e.label === 'East')!;
  const zones: { id: string }[] = [];
  for (let i = 0; i < 7; i++) zones.push(await prisma.zone.create({ data: {
    id: `all-pairs-${i}`, name: `Hospital stop ${i}`, source: 'public', buildingId: building.id,
    entranceId: west.id, rooms: ['1xx'], kinds: ['BOTH'], polygon: [],
    stopPoint: { type: 'Point', coordinates: [-83 + (i + 1) * 0.0001, 28] },
  } }));
  providerMode = 'distance';
  try {
    const before = calls.length;
    const plan = await request('/plan', 'POST', { buildingId: building.id, kind: 'DROPOFF' });
    expect(plan.status).toBe(200);
    expect(calls.slice(before).filter(c => c.body.travelMode === 'WALK')).toHaveLength(14);
    expect(plan.body.options).toHaveLength(7);
    expect(plan.body.options[0].zone.id).toBe(zones[0]!.id);
    expect(plan.body.options.every((o: any) => o.entrance.id === east.id)).toBe(true);
    expect(plan.body.options[0].zone.submittedBy).toBeUndefined();
    expect(plan.body.options[0].zone.confirmations).toBeUndefined();
    const room = await request('/plan', 'POST', { buildingId: building.id, room: '101', kind: 'DROPOFF' });
    expect(room.body.options.every((o: any) => o.entrance.id === west.id)).toBe(true);
    const pickup = await request('/plan', 'POST', { buildingId: building.id, kind: 'PICKUP' });
    expect(pickup.body.options[0].route.path[0].coordinates).toEqual(east.location.coordinates);
    const place = await request('/arrivals/plan', 'POST', { destination: { name: 'Nearby pharmacy', location: building.location } });
    expect(place.body.options.filter((o: any) => o.source === 'public')).toHaveLength(7);
    await prisma.zone.update({ where: { id: zones[0]!.id }, data: { status: 'DISPUTED' } });
    const disputed = await request('/plan', 'POST', { buildingId: building.id, kind: 'DROPOFF' });
    expect(disputed.body.options.some((o: any) => o.zone.id === zones[0]!.id)).toBe(false);
  } finally { providerMode = 'ok' }
});

test('suggestions promote in place, retain boundaries and remain unverified until review', async () => {
  const original = await prisma.zone.findUniqueOrThrow({ where: { id: defaultZone } });
  // Undo the accessibility fixture's review: this is an ordinary generated suggestion.
  await prisma.zone.update({ where: { id: original.id }, data: { status: 'UNVERIFIED', access: 'UNKNOWN', accessibility: 'UNKNOWN', verificationExpiresAt: null } });
  const before = await prisma.zone.count();
  const proposal = { name: 'General hospital loading zone', instructions: 'Use the marked loading bay.', location: original.stopPoint,
    kinds: ['DROPOFF', 'PICKUP'], suggestedZoneId: original.id, origin: 'suggestion' };
  expect((await request('/public-stops', 'POST', proposal)).status).toBe(401);
  const promoted = await request('/public-stops', 'POST', proposal, token);
  expect(promoted.status).toBe(200);
  expect(promoted.body.id).toBe(original.id);
  expect(promoted.body.status).toBe('UNVERIFIED');
  expect(promoted.body.origin).toBe('suggestion');
  expect(await prisma.zone.count()).toBe(before);
  const stored = await prisma.zone.findUniqueOrThrow({ where: { id: original.id } });
  expect(stored.polygon).toEqual(original.polygon);
  expect(stored.source).toBe('public');
  expect(stored.buildingId).toBe(original.buildingId);
  expect(stored.reviews.at(-1)!.notes).toContain('proposed');
  expect((await request('/public-stops', 'POST', proposal, token)).body.id).toBe(original.id);
  expect((await prisma.zone.findUniqueOrThrow({ where: { id: original.id } })).revision).toBe(stored.revision);
  expect((await request('/public-stops', 'POST', { ...proposal, suggestedZoneId: zoneId }, otherToken)).status).toBe(404);
  expect((await request(`/public-stops/${zoneId}`)).status).toBe(404);
  expect((await request('/arrivals/plan', 'POST', { destination: { name: 'Private', location: original.stopPoint, publicStopId: zoneId } })).status).toBe(409);
  const manual = { name: 'Suggested roadside spot', instructions: 'Use the public curb.', location: { type: 'Point', coordinates: [-84, 29] }, kinds: ['PICKUP'], origin: 'suggestion' };
  const created = await request('/public-stops', 'POST', manual, token);
  expect(created.status).toBe(201);
  expect((await request('/public-stops', 'POST', manual, token)).body.id).toBe(created.body.id);
  expect((await request('/public-stops')).body.stops.some((s: any) => s.id === promoted.body.id)).toBe(true);
});

test('unified-zone migration preserves IDs, ownership and review history and is repeatable', async () => {
  const { unifyZones } = await import('../db/unify-zones');
  const legacyId = '1234567890abcdef12345678';
  const now = new Date().toISOString();
  await prisma.$runCommandRaw({ insert: 'PublicStop', documents: [{ _id: { $oid: legacyId },
    name: 'Legacy shared curb', instructions: 'Wait beside the sign.', location: { type: 'Point', coordinates: [-85, 30] },
    kinds: ['BOTH'], status: 'DISPUTED', access: 'UNKNOWN', accessibility: 'UNKNOWN', revision: 4,
    submittedBy: { $oid: 'abcdef1234567890abcdef12' }, confirmations: [{ userId: 'confirm-user', distanceMeters: 8, createdAt: { $date: now } }],
    reports: [{ id: 'report-1', userId: 'report-user', category: 'CLOSED', details: 'Blocked curb', createdAt: { $date: now } }],
    reviews: [{ actorName: 'Inspector', status: 'DISPUTED', notes: 'Temporarily closed', access: 'UNKNOWN', accessibility: 'UNKNOWN', createdAt: { $date: now } }],
    createdAt: { $date: now }, updatedAt: { $date: now } }] });
  await prisma.$runCommandRaw({ insert: 'Zone', documents: [{ _id: 'legacy-private-zone', name: 'Private original',
    ownerId: { $oid: 'abcdef1234567890abcdef12' }, kinds: ['BOTH'], stopPoint: { type: 'Point', coordinates: [-85, 30] }, source: 'personal' }] });
  const dry = await unifyZones(prisma);
  expect(dry.stopsToImport).toBe(1);
  expect(await prisma.zone.findUnique({ where: { id: legacyId } })).toBeNull();
  await unifyZones(prisma, true);
  const migrated = await prisma.zone.findUniqueOrThrow({ where: { id: legacyId } });
  expect(migrated.status).toBe('DISPUTED');
  expect(migrated.revision).toBe(4);
  expect(migrated.submittedBy).toBe('abcdef1234567890abcdef12');
  expect(migrated.reports[0]!.id).toBe('report-1');
  expect(migrated.confirmations[0]!.distanceMeters).toBe(8);
  expect(migrated.reviews[0]!.notes).toBe('Temporarily closed');
  expect((await prisma.zone.findUniqueOrThrow({ where: { id: 'legacy-private-zone' } })).ownerId).toBe('abcdef1234567890abcdef12');
  await prisma.zone.update({ where: { id: legacyId }, data: { name: 'Edited after migration', revision: { increment: 1 } } });
  const repeat = await unifyZones(prisma, true);
  expect(repeat.stopsToImport).toBe(0);
  expect(repeat.zonesToBackfill).toBe(0);
  expect((await prisma.zone.findUniqueOrThrow({ where: { id: legacyId } })).name).toBe('Edited after migration');
  const archived = await prisma.$runCommandRaw({ count: 'PublicStop' }) as any;
  expect(archived.n).toBe(1);
});

test("CORS, JSON errors, and expired sessions remain correct", async () => {
  const response = await nativeFetch(base + "/buildings", { method: "OPTIONS", headers: {
    Origin: "http://localhost:8080", "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization" } });
  expect(response.status).toBe(204);
  expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:8080");
  const malformed = await nativeFetch(base + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" });
  expect(malformed.status).toBe(400);
  expect((await malformed.json() as { error: string }).error).toBeString();
  await prisma.session.updateMany({ data: { expiresAt: new Date(0) } });
  expect((await request("/me", "GET", undefined, token)).status).toBe(401);
});
