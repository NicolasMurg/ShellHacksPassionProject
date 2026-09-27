import { Router } from "express";
import { prisma } from "../lib/prisma";
import { HttpError, objectId, restrictionInput, validateRestriction } from "../lib/validation";
import { requireAuth } from "../middleware/auth";

export const closureRoutes = Router();
closureRoutes.get("/", async (_req, res) => {
  res.json(await prisma.routeRestriction.findMany({ orderBy: { createdAt: "desc" }, include: { owner: { select: { id: true, name: true } } } }));
});
closureRoutes.get("/:id", async (req, res) => {
  const closure = await prisma.routeRestriction.findUnique({ where: { id: objectId.parse(req.params.id) } });
  if (!closure) throw new HttpError(404, "Closure not found");
  res.json(closure);
});
closureRoutes.post("/", requireAuth, async (req, res) => {
  const data = restrictionInput.parse(req.body);
  validateRestriction(data);
  res.status(201).json(await prisma.routeRestriction.create({ data: { ...data, ownerId: res.locals.user.id }, include: { owner: { select: { id: true, name: true } } } }));
});
closureRoutes.patch("/:id", requireAuth, async (req, res) => {
  const restrictionId = objectId.parse(req.params.id);
  const data = restrictionInput.partial().refine(v => Object.keys(v).length > 0, "Provide an update").parse(req.body);
  const existing = await prisma.routeRestriction.findFirst({ where: { id: restrictionId, ownerId: res.locals.user.id } });
  if (!existing) throw new HttpError(404, "Closure not found");
  const merged = restrictionInput.parse({ type: existing.type, geometryType: existing.geometryType,
    points: existing.points, reason: existing.reason, startsAt: existing.startsAt?.toISOString() ?? null,
    endsAt: existing.endsAt?.toISOString() ?? null, ...data });
  validateRestriction(merged);
  res.json(await prisma.routeRestriction.update({ where: { id: restrictionId, ownerId: res.locals.user.id }, data: merged }));
});
closureRoutes.delete("/:id", requireAuth, async (req, res) => {
  const result = await prisma.routeRestriction.deleteMany({ where: { id: objectId.parse(req.params.id), ownerId: res.locals.user.id } });
  if (!result.count) throw new HttpError(404, "Closure not found");
  res.status(204).end();
});
