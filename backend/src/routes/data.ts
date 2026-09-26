import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { id } from "../lib/validation";

export const publicZones = { OR: [{ ownerId: null }, { ownerId: { isSet: false } }] };
export const dataRoutes = Router();
dataRoutes.get("/buildings", async (_req, res) => {
  res.json(await prisma.building.findMany({ include: { entrances: true }, orderBy: { name: "asc" } }));
});
dataRoutes.get("/zones", async (req, res) => {
  const query = z.object({ buildingId: id.optional() }).parse(req.query);
  res.json(await prisma.zone.findMany({ where: { ...publicZones, hidden: false, ...query }, orderBy: { name: "asc" } }));
});
