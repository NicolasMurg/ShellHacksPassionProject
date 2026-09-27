import { prisma } from "../src/lib/prisma";

try {
  if (!process.env.DATABASE_URL) {
    throw new Error("Set DATABASE_URL in backend/.env before checking the database.");
  }
  await prisma.$connect();
  await prisma.$runCommandRaw({ ping: 1 });
  console.log("MongoDB connection successful");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Database connection failed");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
