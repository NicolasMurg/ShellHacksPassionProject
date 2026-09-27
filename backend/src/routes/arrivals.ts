import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { optionalAuth, requireAuth } from '../middleware/auth';
import { HttpError, objectId, point } from '../lib/validation';
import { arrivalDestination, arrivalInput, destinationKey, findSavedStop, planArrival, publicStop, validateStopDistance } from '../lib/arrivals';

export const arrivalRoutes = Router();
arrivalRoutes.post('/arrivals/plan', optionalAuth, rateLimit({ windowMs: 60000, limit: 30,
  standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many arrival requests. Try again shortly.' } }), async (req, res) => {
  res.json(await planArrival(arrivalInput.parse(req.body), res.locals.user));
});
arrivalRoutes.get('/me/stops', requireAuth, async (_req, res) => {
  res.json((await prisma.personalStop.findMany({ where: { ownerId: res.locals.user.id }, orderBy: { updatedAt: 'desc' } })).map(publicStop));
});
arrivalRoutes.put('/me/stops', requireAuth, async (req, res) => {
  const input = z.object({ destination: arrivalDestination, stopPoint: point,
    name: z.string().trim().min(1).max(100), instructions: z.string().trim().max(500).default('') }).strict().parse(req.body);
  validateStopDistance(input.stopPoint, input.destination.location);
  const ownerId = res.locals.user.id;
  const existing = await findSavedStop(input.destination, ownerId);
  const key = existing?.destinationKey ?? destinationKey(input.destination);
  const data = { stopPoint: input.stopPoint, name: input.name, instructions: input.instructions };
  const stop = await prisma.personalStop.upsert({ where: { ownerId_destinationKey: { ownerId, destinationKey: key } },
    create: { ...data, ownerId, destinationKey: key, destinationLocation: input.destination.location, placeId: input.destination.placeId }, update: data });
  res.json(publicStop(stop));
});
arrivalRoutes.delete('/me/stops/:id', requireAuth, async (req, res) => {
  const result = await prisma.personalStop.deleteMany({ where: { id: objectId.parse(req.params.id), ownerId: res.locals.user.id } });
  if (!result.count) throw new HttpError(404, 'Saved spot not found');
  res.status(204).end();
});
