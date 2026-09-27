import { PrismaClient } from "@prisma/client";

// Reuse the client across Bun hot reloads to avoid extra connection pools.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
