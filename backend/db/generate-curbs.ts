import { prisma } from "../src/lib/prisma";
import { computeRoute } from "../src/lib/google";
import { point } from "../src/lib/validation";
import { asLatLng } from "../src/lib/planner";
import { bearing, orientedRect } from "../../shared/geo";
import { CAMPUS_GATE } from "./campus";

export async function generateCurbs() {
  const entrances = await prisma.entrance.findMany();
  let created = 0;
  for (const entrance of entrances) {
    if (await prisma.zone.findFirst({ where: { entranceId: entrance.id,
      OR: [{ ownerId: null }, { ownerId: { isSet: false } }] } })) continue;
    const origin = point.parse({ type: "Point", coordinates: [CAMPUS_GATE.lng, CAMPUS_GATE.lat] });
    const route = await computeRoute(origin, point.parse(entrance.location), "DRIVE");
    if (!route.endLocation) throw new Error(`No road endpoint returned for ${entrance.label}`);
    const stop = { lat: route.endLocation.latitude, lng: route.endLocation.longitude };
    const previous = route.path.at(-2);
    const heading = bearing(previous ? asLatLng(previous) : CAMPUS_GATE, stop);
    await prisma.zone.upsert({ where: { id: `gen-${entrance.id}` }, update: {}, create: {
      id: `gen-${entrance.id}`, buildingId: entrance.buildingId, entranceId: entrance.id,
      source: "generated", name: `${entrance.label} curb (unverified)`,  kinds: ["BOTH"], rooms: entrance.rooms,
      ownerId: null, stopPoint: { type: "Point", coordinates: [stop.lng, stop.lat] },
      polygon: orientedRect(stop, 20, 6, heading).map(p => ({ type: "Point", coordinates: [p.lng, p.lat] })),
    } });
    created++;
  }
  return created;
}
if (import.meta.main) {
  try { console.log(`Generated ${await generateCurbs()} shared curb zones`); }
  catch (error) { console.error(error instanceof Error ? error.message : "Curb generation failed"); process.exitCode = 1; }
  finally { await prisma.$disconnect(); }
}
