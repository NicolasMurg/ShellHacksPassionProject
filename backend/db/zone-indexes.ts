import { prisma } from '../src/lib/prisma';
// Additive only: never drops collections/indexes or changes documents or uniqueness.
try {
  const result = await prisma.$runCommandRaw({ createIndexes: 'Zone', indexes: [
    { key: { status: 1, verificationExpiresAt: 1 }, name: 'Zone_status_verificationExpiresAt_idx' },
    { key: { submittedBy: 1 }, name: 'Zone_submittedBy_idx' },
  ] });
  console.log(JSON.stringify(result));
} finally { await prisma.$disconnect(); }
