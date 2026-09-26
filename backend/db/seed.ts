import { prisma } from "../src/lib/prisma";

// Synthetic demo locations near FIU. These are not verified accessibility data.
export async function seed() {
  await prisma.building.upsert({ where: { id: "demo-building" }, update: {}, create: {
    id: "demo-building", code: "DEMO", name: "Demo building (unverified)",
    location: { type: "Point", coordinates: [-80.3732, 25.7562] },
  } });
  await prisma.entrance.upsert({ where: { id: "000000000000000000000001" }, update: {}, create: {
    id: "000000000000000000000001", buildingId: "demo-building", label: "Demo entrance (unverified)",
    accessible: false, location: { type: "Point", coordinates: [-80.3733, 25.7562] },
  } });
  await prisma.zone.upsert({ where: { id: "demo-zone" }, update: {}, create: {
    id: "demo-zone", buildingId: "demo-building", entranceId: "000000000000000000000001",
    name: "Demo pickup/dropoff (unverified)", kinds: ["BOTH"], ownerId: null,
    polygon: [[-80.3735, 25.7561], [-80.3734, 25.7561], [-80.3734, 25.7563], [-80.3735, 25.7563]]
      .map(coordinates => ({ type: "Point", coordinates })),
    stopPoint: { type: "Point", coordinates: [-80.37345, 25.7562] }, rooms: [],
  } });
}
if (import.meta.main) {
  try { await seed(); console.log("Demo seed complete (existing records preserved)"); }
  catch (error) { console.error(error instanceof Error ? error.message : "Seed failed"); process.exitCode = 1; }
  finally { await prisma.$disconnect(); }
}
