import type { PrismaClient, Prisma } from '@prisma/client';

type Doc = Record<string, any>;
async function documents(db: PrismaClient, collection: string): Promise<Doc[]> {
  let result = await db.$runCommandRaw({ find: collection, filter: {}, batchSize: 500 }) as any;
  const rows: Doc[] = [...result.cursor.firstBatch];
  while (String(result.cursor.id?.$numberLong ?? result.cursor.id) !== '0') {
    result = await db.$runCommandRaw({ getMore: result.cursor.id, collection, batchSize: 500 }) as any;
    rows.push(...result.cursor.nextBatch);
  }
  return rows;
}
export function zoneDefaults(doc: Doc, now: string): Doc {
  return { ownerId: null, buildingId: null, entranceId: null, polygon: [], rooms: [], hidden: false,
    instructions: '', origin: doc.source === 'generated' ? 'suggestion' : 'manual', status: 'UNVERIFIED',
    access: 'UNKNOWN', accessibility: 'UNKNOWN', confirmations: [], reports: [], reviews: [], revision: 0,
    createdAt: { $date: now }, updatedAt: { $date: now }, ...doc };
}
/** Additive migration: legacy PublicStop documents remain archived; Zone IDs never change. */
export async function unifyZones(db: PrismaClient, apply = false) {
  const [zones, stops] = await Promise.all([documents(db, 'Zone'), documents(db, 'PublicStop')]);
  const byId = new Map(zones.map(z => [String(z._id), z]));
  const now = new Date().toISOString();
  const operations: Prisma.InputJsonObject[] = [];
  let backfilled = 0, imported = 0;
  for (const zone of zones) {
    const defaults = zoneDefaults(zone, now);
    for (const [key, value] of Object.entries(defaults)) {
      if (key in zone) continue;
      operations.push({ q: { _id: zone._id, [key]: { $exists: false } }, u: { $set: { [key]: value } } });
    }
    if (Object.keys(defaults).some(key => !(key in zone))) backfilled++;
  }
  for (const stop of stops) {
    const id = stop._id?.$oid;
    if (typeof id !== 'string') throw new Error('Unexpected legacy stop ID; stopped before writes.');
    const existing = byId.get(id);
    if (existing) {
      if (existing.legacyPublicStopId !== id) throw new Error(`Zone ID collision: ${id}; stopped before writes.`);
      continue;
    }
    const { _id, location, ...fields } = stop;
    const migrated = zoneDefaults({ ...fields, _id: id, legacyPublicStopId: id, source: 'public', stopPoint: location }, now);
    operations.push({ q: { _id: id }, u: { $setOnInsert: migrated }, upsert: true });
    imported++;
  }
  if (apply) {
    for (let i = 0; i < operations.length; i += 100) {
      const result = await db.$runCommandRaw({ update: 'Zone', updates: operations.slice(i, i + 100), ordered: true }) as any;
      if (result.writeErrors?.length || result.writeConcernError || result.ok !== 1) throw new Error('Migration write failed; rerun after resolving database availability.');
    }
  }
  return { mode: apply ? 'applied' : 'dry-run', existingZones: zones.length, legacyStops: stops.length, zonesToBackfill: backfilled, stopsToImport: imported };
}
if (import.meta.main) {
  const { prisma } = await import('../src/lib/prisma');
  try { console.log(JSON.stringify(await unifyZones(prisma, process.argv.includes('--apply')), null, 2)); }
  finally { await prisma.$disconnect(); }
}
