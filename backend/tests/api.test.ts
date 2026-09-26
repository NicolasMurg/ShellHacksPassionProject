import { afterAll, beforeAll, expect, test, spyOn } from "bun:test";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import type { Server } from "node:http";
import type { PrismaClient } from "@prisma/client";

let mongo: MongoMemoryReplSet;
let server: Server;
let prisma: PrismaClient;
let base: string;
const nativeFetch = globalThis.fetch;
const asFetch = (fn: (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => Promise<Response>) =>
  Object.assign(fn, { preconnect: nativeFetch.preconnect });
const originalDatabaseUrl = process.env.DATABASE_URL;
const originalGoogleKey = process.env.GOOGLE_MAPS_API_KEY;
let token: string;
let otherToken: string;
let zoneId: string;
let closureId: string;
let tripId: string;
const point = { type: "Point", coordinates: [-80.3732, 25.7562] };
async function request(path: string, method = "GET", body?: unknown, bearer?: string) {
  const response = await nativeFetch(base + path, { method,
    headers: { "Content-Type": "application/json", ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: response.status === 204 ? null : await response.json() as any };
}
beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ binary: { version: "7.0.24" }, replSet: { count: 1 } });
  process.env.DATABASE_URL = mongo.getUri("api_tests");
  const push = Bun.spawn(["bun", "run", "db:push"], { env: process.env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(push.stdout).text(), new Response(push.stderr).text(), push.exited]);
  if (code) throw new Error(stdout + stderr);
  prisma = (await import("../src/lib/prisma")).prisma;
  const { seed } = await import("../db/seed");
  await seed();
  await seed();
  const app = (await import("../src/app")).default;
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test port");
  base = `http://127.0.0.1:${address.port}/api`;
});
afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  if (prisma) await prisma.$disconnect();
  if (mongo) await mongo.stop();
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originalDatabaseUrl;
  if (originalGoogleKey === undefined) delete process.env.GOOGLE_MAPS_API_KEY; else process.env.GOOGLE_MAPS_API_KEY = originalGoogleKey;
});

test("seed is idempotent; public read routes return the related map data", async () => {
  const buildings = await request("/buildings");
  expect(buildings.status).toBe(200);
  expect(buildings.body).toHaveLength(1);
  expect(buildings.body[0].entrances).toHaveLength(1);
  const zones = await request("/zones?buildingId=demo-building");
  expect(zones.body).toHaveLength(1);
  expect(zones.body[0].stopPoint.coordinates).toHaveLength(2);
  expect((await request("/zones?buildingId=missing")).body).toEqual([]);
});
test("register, login, profile, and independent sessions work without leaking credentials", async () => {
  const first = await request("/auth/register", "POST", { name: "Alice", email: "Alice@example.com", password: "correct-password" });
  expect(first.status).toBe(201);
  token = first.body.token;
  expect(first.body.user.passwordHash).toBeUndefined();
  expect(first.body.user.email).toBe("alice@example.com");
  const second = await request("/auth/register", "POST", { name: "Bob", email: "bob@example.com", password: "other-password" });
  otherToken = second.body.token;
  expect((await request("/auth/register", "POST", { name: "Alice", email: "alice@example.com", password: "correct-password" })).status).toBe(409);
  expect((await request("/auth/login", "POST", { email: "alice@example.com", password: "wrong-password" })).status).toBe(401);
  const login = await request("/auth/login", "POST", { email: "alice@example.com", password: "correct-password" });
  expect(login.status).toBe(200);
  expect(login.body.token).not.toBe(token);
  const changed = await request("/me", "PATCH", { name: "Alice Updated" }, login.body.token);
  expect(changed.status).toBe(200);
  expect((await request("/me", "GET", undefined, token)).body.name).toBe("Alice Updated");
  expect((await request("/me")).status).toBe(401);
  expect((await request("/me", "GET", undefined, "invalid")).status).toBe(401);
  await request("/auth/logout", "POST", {}, login.body.token);
  expect((await request("/me", "GET", undefined, login.body.token)).status).toBe(401);
  expect((await request("/me", "GET", undefined, token)).status).toBe(200);
  const user = await prisma.user.findUniqueOrThrow({ where: { email: "alice@example.com" } });
  expect(user.passwordHash).not.toBe("correct-password");
  expect(await prisma.session.findFirst({ where: { tokenHash: token } })).toBeNull();
});
test("personal zone edits persist, stay private, and enforce ownership", async () => {
  const created = await request("/me/zones", "POST", { basedOnZoneId: "demo-zone", name: "My stop" }, token);
  expect(created.status).toBe(201);
  zoneId = created.body.id;
  expect((await request("/zones")).body).toHaveLength(1);
  expect((await request("/me/zones", "GET", undefined, token)).body).toHaveLength(1);
  expect((await request("/me/zones", "GET", undefined, otherToken)).body).toHaveLength(0);
  expect((await request(`/me/zones/${zoneId}`, "PATCH", { hidden: true }, token)).body.hidden).toBe(true);
  expect((await request(`/me/zones/${zoneId}`, "PATCH", { name: "Stolen" }, otherToken)).status).toBe(404);
  expect((await request(`/me/zones/${zoneId}`, "DELETE", undefined, otherToken)).status).toBe(404);
  expect((await request("/me/zones", "POST", { basedOnZoneId: zoneId }, otherToken)).status).toBe(404);
  expect((await request(`/me/zones/${zoneId}`, "PATCH", { ownerId: "000000000000000000000001" }, token)).status).toBe(400);
  expect((await request(`/me/zones/${zoneId}`, "PATCH", { buildingId: "missing" }, token)).status).toBe(400);
});
test("closures validate geometry and dates, and only the author can edit", async () => {
  const data = { type: "BLOCKED_PATH", geometryType: "POINT", points: [point], reason: "Reported obstruction" };
  expect((await request("/closures", "POST", data)).status).toBe(401);
  expect((await request("/closures", "POST", { ...data, geometryType: "AREA" }, token)).status).toBe(400);
  expect((await request("/closures", "POST", { ...data, startsAt: "2026-09-26T12:00:00Z", endsAt: "2026-09-25T12:00:00Z" }, token)).status).toBe(400);
  const created = await request("/closures", "POST", data, token);
  expect(created.status).toBe(201);
  closureId = created.body.id;
  expect((await request("/closures")).body).toHaveLength(1);
  expect((await request(`/closures/${closureId}`)).body.id).toBe(closureId);
  expect((await request(`/closures/${closureId}`, "PATCH", { reason: "Updated" }, otherToken)).status).toBe(404);
  expect((await request(`/closures/${closureId}`, "PATCH", { reason: "Updated" }, token)).body.reason).toBe("Updated");
  expect((await request("/closures/not-an-id", "DELETE", undefined, token)).status).toBe(400);
});
test("Google requests use field masks, normalize coordinates, and handle failures", async () => {
  delete process.env.GOOGLE_MAPS_API_KEY;
  expect((await request("/search?q=library")).status).toBe(503);
  expect((await request("/search?q=")).status).toBe(400);
  process.env.GOOGLE_MAPS_API_KEY = "test-key";
  const calls: { url: string; data: any; headers: any }[] = [];
  const mock = spyOn(globalThis, "fetch").mockImplementation(asFetch(async (url, options) => {
    calls.push({ url: String(url), data: JSON.parse(String(options?.body)), headers: options?.headers });
    if (String(url).includes("places.googleapis.com")) return Response.json({ places: [{ id: "place-1", displayName: { text: "Library" }, location: { latitude: 25.75, longitude: -80.37 } }] });
    return Response.json({ routes: [{ distanceMeters: 100, duration: "60s", polyline: { encodedPolyline: "abc" }, warnings: ["Use caution"] }] });
  }));
  try {
    const found = await request("/search?q=library");
    expect(found.body[0].location.coordinates).toEqual([-80.37, 25.75]);
    const planned = await request("/plan", "POST", { origin: point, zoneId: "demo-zone" }, token);
    expect(planned.status).toBe(200);
    tripId = planned.body.tripId;
    expect(planned.body.segments).toHaveLength(2);
    expect(planned.body.segments[0].travelMode).toBe("DRIVE");
    expect(planned.body.segments[1].travelMode).toBe("WALK");
    expect(planned.body.accessibilityVerified).toBe(false);
    expect(planned.body.closures).toHaveLength(1);
    expect(calls[1]!.data.origin.location.latLng).toEqual({ latitude: 25.7562, longitude: -80.3732 });
    expect(calls[1]!.headers["X-Goog-FieldMask"]).toContain("routes.warnings");
    expect((await request("/plan", "POST", { origin: point, destination: point, zoneId: "demo-zone" }, token)).status).toBe(400);
    mock.mockImplementation(asFetch(async () => Response.json({ error: { message: "SECRET upstream detail" } }, { status: 403 })));
    const failed = await request("/search?q=library");
    expect(failed.status).toBe(502);
    expect(failed.body.error).not.toContain("SECRET");
    mock.mockImplementation(asFetch(async () => Response.json({ routes: [] })));
    expect((await request("/plan", "POST", { origin: point, destination: point }, token)).status).toBe(404);
  } finally { mock.mockRestore(); }
});
test("feedback persists only for owned trips; deletion and expiry work", async () => {
  expect((await request("/trips/feedback", "POST", { tripId, rating: 4, comment: "Helpful" }, token)).status).toBe(200);
  expect((await request("/trips/feedback", "POST", { tripId, rating: 1 }, otherToken)).status).toBe(404);
  expect((await request("/trips/feedback", "POST", { tripId, rating: 6 }, token)).status).toBe(400);
  await request("/trips/feedback", "POST", { tripId, rating: 5 }, token);
  expect(await prisma.tripFeedback.count({ where: { tripId } })).toBe(1);
  expect((await request(`/me/zones/${zoneId}`, "DELETE", undefined, token)).status).toBe(204);
  expect((await request(`/closures/${closureId}`, "DELETE", undefined, token)).status).toBe(204);
  await prisma.session.updateMany({ data: { expiresAt: new Date(0) } });
  expect((await request("/me", "GET", undefined, token)).status).toBe(401);
});
test("CORS and JSON error shape are preserved", async () => {
  const response = await nativeFetch(base + "/buildings", { method: "OPTIONS", headers: {
    Origin: "http://localhost:8080", "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization" } });
  expect(response.status).toBe(204);
  expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:8080");
  const malformed = await nativeFetch(base + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" });
  expect(malformed.status).toBe(400);
  expect((await malformed.json() as { error: string }).error).toBeString();
  expect((await request("/unknown")).body).toEqual({ error: "Route not found" });
});
