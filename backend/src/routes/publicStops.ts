import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import type { Prisma, Zone } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { sharedZoneWhere } from '../lib/publicStops';
import { HttpError, id, point } from '../lib/validation';
import { optionalAuth, requireAdmin, requireAuth } from '../middleware/auth';
import { distanceMeters } from '../../../shared/geo';
import type { ApiPublicStop } from '../contracts';

export const publicStopRoutes = Router();
const status = z.enum(['UNVERIFIED', 'VERIFIED', 'DISPUTED', 'RETIRED']);
const access = z.enum(['UNKNOWN', 'PERMITTED', 'RESTRICTED']);
const accessibility = z.enum(['UNKNOWN', 'STEP_FREE', 'NOT_STEP_FREE']);
const submission = z.object({ name: z.string().trim().min(2).max(120), instructions: z.string().trim().min(3).max(1000),
  location: point, kinds: z.array(z.enum(['DROPOFF', 'PICKUP'])).min(1).max(2),
  buildingId: id.optional(), placeId: z.string().min(1).max(300).optional(), suggestedZoneId: id.optional(),
  origin: z.enum(["manual", "suggestion"]).default("manual"),
  polygon: z.array(point).max(200).refine(p => !p.length || p.length >= 3).default([]),
  photoUrl: z.url().max(2000).refine(url => new URL(url).protocol === 'https:', 'Photo links must use HTTPS').optional(),
}).strict();
const mutationLimit = rateLimit({ windowMs: 60_000, limit: 30, keyGenerator: (_req, res) => res.locals.user.id, standardHeaders: 'draft-8', legacyHeaders: false,
  message: { error: 'Too many stop updates. Try again shortly.' } });

/** A revision check keeps simultaneous reports, confirmations and reviews from overwriting one another. */
async function update(stop: Zone, data: Prisma.ZoneUpdateManyMutationInput): Promise<Zone> {
  const changed = await prisma.zone.updateMany({ where: { id: stop.id, revision: stop.revision },
    data: { ...data, revision: { increment: 1 } } });
  if (!changed.count) throw new HttpError(409, 'This stop changed. Refresh it and try again.');
  return (await prisma.zone.findUniqueOrThrow({ where: { id: stop.id } }));
}
async function expire(stop: Zone): Promise<Zone> {
  if (stop.status !== 'VERIFIED' || (stop.verificationExpiresAt && stop.verificationExpiresAt > new Date())) return stop;
  try {
    return await update(stop, { status: 'UNVERIFIED', access: 'UNKNOWN', accessibility: 'UNKNOWN', reviews: { push: {
      actorId: null, actorName: 'System', status: 'UNVERIFIED', notes: 'Verification expired; a new access review is required.',
      access: 'UNKNOWN', accessibility: 'UNKNOWN', createdAt: new Date(),
    } } });
  } catch (error) {
    if (error instanceof HttpError && error.status === 409) return prisma.zone.findUniqueOrThrow({ where: { id: stop.id } });
    throw error;
  }
}
async function getStop(id: unknown) {
  const stop = await prisma.zone.findFirst({ where: { id: z.string().min(1).max(100).parse(id), AND: [sharedZoneWhere], source: { not: "generated" } } });
  if (!stop) throw new HttpError(404, 'Public stop not found');
  return expire(stop);
}
function response(stop: Zone, userId?: string): ApiPublicStop {
  return { id: stop.id, name: stop.name, instructions: stop.instructions, location: stop.stopPoint, buildingId: stop.buildingId, placeId: stop.placeId, origin: stop.origin, kinds: stop.kinds,
    photoUrl: stop.photoUrl, status: stop.status, access: stop.access, accessibility: stop.accessibility,
    confirmationCount: stop.confirmations.length, confirmedByMe: stop.confirmations.some(c => c.userId === userId),
    submittedByMe: stop.submittedBy === userId, reportedByMe: stop.reports.some(r => r.userId === userId && !r.resolvedAt),
    reports: stop.reports.map(r => ({ id: r.id, category: r.category, details: r.details, createdAt: r.createdAt.toISOString(), resolvedAt: r.resolvedAt?.toISOString() ?? null })),
    reviews: stop.reviews.map(r => ({ actorName: r.actorName, status: r.status, notes: r.notes, access: r.access,
      accessibility: r.accessibility, createdAt: r.createdAt.toISOString() })),
    verifiedAt: stop.verifiedAt?.toISOString() ?? null, verificationExpiresAt: stop.verificationExpiresAt?.toISOString() ?? null,
    revision: stop.revision, createdAt: stop.createdAt.toISOString() };
}
publicStopRoutes.get('/', optionalAuth, async (req, res) => {
  const query = z.object({ before: id.optional(), review: z.enum(['true', 'false']).optional(),
    retired: z.enum(['true', 'false']).optional() }).strict().parse(req.query);
  const admin = res.locals.user?.role === 'ADMIN';
  if ((query.review === 'true' || query.retired === 'true') && !admin) throw new HttpError(403, 'Administrator access required');
  const stops = await prisma.zone.findMany({ where: { AND: [sharedZoneWhere], source: { not: "generated" },
    ...(query.before && { id: { lt: query.before } }),
    ...(query.review === 'true' ? { OR: [ { status: { in: ['UNVERIFIED', 'DISPUTED'] } },
      { status: 'VERIFIED', verificationExpiresAt: { lte: new Date() } } ] } : query.retired === 'true' ? {} : { status: { not: 'RETIRED' } }),
  }, orderBy: { id: 'desc' }, take: 101 });
  const page = await Promise.all(stops.slice(0, 100).map(expire));
  res.json({ stops: page.map(s => response(s, res.locals.user?.id)), nextCursor: stops.length > 100 ? page.at(-1)!.id : null });
});
publicStopRoutes.get('/:id', optionalAuth, async (req, res) => res.json(response(await getStop(req.params.id), res.locals.user?.id)));
publicStopRoutes.post('/', requireAuth, mutationLimit, async (req, res) => {
  const input = submission.parse(req.body);
  const user = res.locals.user;
  const { location, suggestedZoneId, ...fields } = input;
  if (input.buildingId && !await prisma.building.findUnique({ where: { id: input.buildingId } })) throw new HttpError(400, 'Building not found');
  const original = suggestedZoneId ? await prisma.zone.findFirst({ where: { id: suggestedZoneId, ...sharedZoneWhere } }) : null;
  if (suggestedZoneId && !original) throw new HttpError(404, 'Suggested zone not found');
  if (original && original.source !== 'generated') return res.status(200).json(response(await expire(original), user.id));
  const stopPoint = original?.stopPoint ?? location;
  // Reusing the same named proposal is idempotent; nearby distinct named curbs remain possible.
  const duplicates = await prisma.zone.findMany({ where: { AND: [sharedZoneWhere], source: { not: 'generated' }, status: { not: 'RETIRED' } } });
  const duplicate = duplicates.find(stop => stop.name.toLowerCase() === input.name.toLowerCase() && distanceMeters(
    { lat: stop.stopPoint.coordinates[1]!, lng: stop.stopPoint.coordinates[0]! },
    { lat: stopPoint.coordinates[1]!, lng: stopPoint.coordinates[0]! }) < 15);
  if (duplicate) return res.status(200).json(response(await expire(duplicate), user.id));
  const data = { ...fields, stopPoint, source: 'public', status: 'UNVERIFIED' as const, access: 'UNKNOWN' as const, accessibility: 'UNKNOWN' as const, verifiedBy: null, verifiedAt: null, verificationExpiresAt: null, origin: original ? 'suggestion' : input.origin,
    buildingId: fields.buildingId ?? original?.buildingId, submittedBy: user.id,
    reviews: [...(original?.reviews ?? []), { actorId: user.id, actorName: user.name, status: 'UNVERIFIED' as const, notes: original || input.origin === 'suggestion' ? 'Suggested spot proposed as a public zone.' : 'Submitted for public review.',
      access: 'UNKNOWN' as const, accessibility: 'UNKNOWN' as const, createdAt: new Date() }] };
  let stop;
  if (original) {
    const changed = await prisma.zone.updateMany({ where: { id: original.id, source: 'generated', revision: original.revision },
      data: { ...data, polygon: original.polygon, revision: { increment: 1 } } });
    if (!changed.count) throw new HttpError(409, 'This suggestion changed. Refresh and try again.');
    stop = await prisma.zone.findUniqueOrThrow({ where: { id: original.id } });
  } else stop = await prisma.zone.create({ data: { ...data, confirmations: [], reports: [] } });
  res.status(original ? 200 : 201).json(response(stop, user.id));
});
publicStopRoutes.post('/:id/confirm', requireAuth, mutationLimit, async (req, res) => {
  const input = z.object({ location: point, accuracy: z.number().min(0).max(50), timestamp: z.number().int().positive() }).strict().parse(req.body);
  if (Math.abs(Date.now() - input.timestamp) > 120_000) throw new HttpError(400, 'Get a fresh GPS location to confirm this stop.');
  const stop = await getStop(req.params.id);
  const userId = res.locals.user.id;
  if (stop.status === 'RETIRED') throw new HttpError(409, 'This stop has been retired.');
  if (stop.submittedBy === userId) throw new HttpError(403, 'Another person must confirm your submitted stop.');
  if (stop.confirmations.some(c => c.userId === userId)) throw new HttpError(409, 'You have already confirmed this stop.');
  if (stop.confirmations.length >= 1000) throw new HttpError(409, 'This stop has enough confirmations; it is ready for review.');
  const distance = distanceMeters({ lat: input.location.coordinates[1], lng: input.location.coordinates[0] },
    { lat: stop.stopPoint.coordinates[1]!, lng: stop.stopPoint.coordinates[0]! });
  if (distance + input.accuracy > 100) throw new HttpError(400, 'You must be within 100 meters, including GPS accuracy, to confirm this stop.');
  res.json(response(await update(stop, { confirmations: { push: { userId, createdAt: new Date(), distanceMeters: distance } } }), userId));
});
publicStopRoutes.post('/:id/reports', requireAuth, mutationLimit, async (req, res) => {
  const input = z.object({ category: z.enum(['MISPLACED', 'INACCESSIBLE', 'PRIVATE_PROPERTY', 'CLOSED', 'UNSAFE', 'OTHER']),
    details: z.string().trim().min(5).max(1000) }).strict().parse(req.body);
  const stop = await getStop(req.params.id);
  const user = res.locals.user;
  if (stop.status === 'RETIRED') throw new HttpError(409, 'This stop has already been retired.');
  if (stop.reports.some(r => r.userId === user.id && !r.resolvedAt)) throw new HttpError(409, 'Your report is already awaiting review.');
  if (stop.reports.length >= 1000) throw new HttpError(409, 'Report limit reached; administrator review is required.');
  const now = new Date();
  res.json(response(await update(stop, { status: 'DISPUTED', access: 'UNKNOWN', accessibility: 'UNKNOWN',
    reports: { push: { ...input, id: crypto.randomUUID(), userId: user.id, createdAt: now, resolvedAt: null } },
    reviews: { push: { actorId: user.id, actorName: 'Community report', status: 'DISPUTED', notes: `Reported: ${input.category.toLowerCase().replaceAll('_', ' ')}.`,
      access: 'UNKNOWN', accessibility: 'UNKNOWN', createdAt: now } },
  }), user.id));
});
publicStopRoutes.post('/:id/review', requireAuth, requireAdmin, mutationLimit, async (req, res) => {
  const input = z.object({ status, access, accessibility, notes: z.string().trim().min(10).max(2000),
    validDays: z.number().int().min(1).max(180).default(90), revision: z.number().int().min(0) }).strict().parse(req.body);
  const stop = await getStop(req.params.id);
  const user = res.locals.user;
  if (input.revision !== stop.revision) throw new HttpError(409, 'New evidence arrived. Refresh and review the latest stop details.');
  if (input.status === 'VERIFIED' && stop.submittedBy === user.id) throw new HttpError(403, 'A different administrator must verify your own submission.');
  if (input.status === 'VERIFIED' && input.access !== 'PERMITTED') throw new HttpError(400, 'Verify that public stopping is permitted before approving this stop.');
  const now = new Date();
  const verified = input.status === 'VERIFIED';
  res.json(response(await update(stop, { status: input.status, access: input.access,
    accessibility: input.accessibility,
    verifiedBy: verified ? user.id : null, verifiedAt: verified ? now : null,
    verificationExpiresAt: verified ? new Date(now.getTime() + input.validDays * 86_400_000) : null,
    reports: { set: stop.reports.map(r => ({ ...r, resolvedAt: input.status === 'DISPUTED' ? r.resolvedAt : r.resolvedAt ?? now })) },
    reviews: { push: { actorId: user.id, actorName: user.name, status: input.status, notes: input.notes,
      access: input.access, accessibility: input.accessibility, createdAt: now } },
  }), user.id));
});
