import { createHash } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { BUILDINGS } from "./campus";

export const entranceId = (slug: string) => createHash("sha256").update(`fiu-entrance:${slug}`).digest("hex").slice(0, 24);
export async function seed() {
  for (const b of BUILDINGS) {
    await prisma.building.upsert({ where: { id: b.id }, update: {}, create: {
      id: b.id, code: b.code, name: b.name,
      location: { type: "Point", coordinates: [b.location.lng, b.location.lat] },
    } });
    for (const e of b.entrances) {
      await prisma.entrance.upsert({ where: { id: entranceId(e.id) }, update: {}, create: {
        id: entranceId(e.id), buildingId: b.id, label: e.label, accessible: e.accessible, rooms: e.rooms,
        location: { type: "Point", coordinates: [e.location.lng, e.location.lat] },
      } });
    }
  }
}
if (import.meta.main) {
  try { await seed(); console.log("FIU building/entrance seed complete; existing records preserved. Run bun run db:curbs to generate shared zones."); }
  catch (error) { console.error(error instanceof Error ? error.message : "Seed failed"); process.exitCode = 1; }
  finally { await prisma.$disconnect(); }
}
