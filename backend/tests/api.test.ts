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
    if (String(url).includes("places.googleapis.com")) return Response.json({ places: [{ id: "place-1", displayName: { text: "Campus cafe" }, location: { latitude: 25.75625, longitude: -80.37318 } }] });
    if (providerMode === "empty") return Response.json({ routes: [] });
    const from = body.origin.location.latLng, to = { ...body.destination.location.latLng };
    if (body.travelMode === "DRIVE") to.longitude -= 0.0002;
    return Response.json({ routes: [{ distanceMeters: 100, duration: "60s", polyline: { encodedPolyline: encode([from, to]) },
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
  const { id, source, ownerId, ...data } = zone;
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
test("search resolves rooms locally and uses campus-restricted Places only as fallback", async () => {
  const before = calls.length;
  const local = await request("/search?q=GC%20150");
  expect(local.body.building.id).toBe("gc"); expect(local.body.room).toBe("150");
  expect(local.body.building.entrances).toHaveLength(3);
  expect(calls.length).toBe(before);
  const fallback = await request("/search?q=campus%20cafe");
  expect(fallback.body.building.id).toBe("gc");
  expect(calls.at(-1)!.body.locationRestriction.rectangle).toBeDefined();
  providerMode = "error";
  const failed = await request("/search?q=campus%20cafe");
  expect(failed.status).toBe(502); expect(failed.body.error).not.toContain("SECRET");
  providerMode = "ok";
  delete process.env.GOOGLE_SERVER_KEY;
  expect((await request("/search?q=campus%20cafe")).status).toBe(503);
  process.env.GOOGLE_SERVER_KEY = "   ";
  process.env.GOOGLE_MAPS_API_KEY = "test-key";
  expect((await request("/search?q=campus%20cafe")).status).toBe(200);
  delete process.env.GOOGLE_MAPS_API_KEY;
  process.env.GOOGLE_SERVER_KEY = "test-key";
});
test("planning ranks real walking routes, respects hidden zones and step-free needs, and allows guests", async () => {
  const input = { buildingId: "gc", room: "150", kind: "DROPOFF", stepFree: true };
  const guest = await request("/plan", "POST", input);
  expect(guest.status).toBe(200);
  expect(guest.body.options).toHaveLength(2);
  expect(guest.body.tripId).toBeUndefined();
  const mine = await request("/plan", "POST", input, token);
  expect(mine.status).toBe(200); tripId = mine.body.tripId;
  expect(mine.body.options).toHaveLength(1); // East zone is hidden by the personal marker.
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
  const plan = await api.plan({ buildingId: destination.building.id, room: destination.room, kind: "dropoff", stepFree: true }, session.token);
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
