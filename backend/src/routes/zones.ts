import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { HttpError, id, zoneInput } from "../lib/validation";
import { requireAuth } from "../middleware/auth";

export const zoneRoutes = Router();
zoneRoutes.use(requireAuth);
async function checkEntrance(buildingId: string, entranceId: string) {
  if (!await prisma.entrance.findFirst({ where: { id: entranceId, buildingId } })) {
    throw new HttpError(400, "Entrance does not belong to this building");
  }
}
zoneRoutes.get("/", async (_req, res) => {
  res.json(await prisma.zone.findMany({ where: { ownerId: res.locals.user.id }, orderBy: { name: "asc" } }));
});
zoneRoutes.post("/", async (req, res) => {
  const input = zoneInput.partial().extend({ basedOnZoneId: id.optional() }).strict().parse(req.body);
  const base = input.basedOnZoneId ? await prisma.zone.findFirst({ where: {
    id: input.basedOnZoneId, OR: [{ ownerId: null }, { ownerId: { isSet: false } }, { ownerId: res.locals.user.id }],
  } }) : null;
  if (input.basedOnZoneId && !base) throw new HttpError(404, "Base zone not found");
  const { basedOnZoneId, ...overrides } = input;
  const data = zoneInput.parse({ ...(base ? { buildingId: base.buildingId, entranceId: base.entranceId,
    name: base.name, kinds: base.kinds, polygon: base.polygon, stopPoint: base.stopPoint,
    rooms: base.rooms, hidden: base.hidden } : {}), ...overrides });
  await checkEntrance(data.buildingId, data.entranceId);
  res.status(201).json(await prisma.zone.create({ data: {
    ...data, id: crypto.randomUUID(), ownerId: res.locals.user.id, basedOnZoneId,
  } }));
});
zoneRoutes.get("/:id", async (req, res) => {
  const zone = await prisma.zone.findFirst({ where: { id: id.parse(req.params.id), ownerId: res.locals.user.id } });
  if (!zone) throw new HttpError(404, "Zone not found");
  res.json(zone);
});
zoneRoutes.patch("/:id", async (req, res) => {
  const zoneId = id.parse(req.params.id);
  const data = zoneInput.partial().refine(v => Object.keys(v).length > 0, "Provide an update").parse(req.body);
  const existing = await prisma.zone.findFirst({ where: { id: zoneId, ownerId: res.locals.user.id } });
  if (!existing) throw new HttpError(404, "Zone not found");
  await checkEntrance(data.buildingId ?? existing.buildingId, data.entranceId ?? existing.entranceId);
  res.json(await prisma.zone.update({ where: { id: zoneId, ownerId: res.locals.user.id }, data }));
});
zoneRoutes.delete("/:id", async (req, res) => {
  const result = await prisma.zone.deleteMany({ where: { id: id.parse(req.params.id), ownerId: res.locals.user.id } });
  if (!result.count) throw new HttpError(404, "Zone not found");
  res.status(204).end();
});
