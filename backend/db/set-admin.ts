import { prisma } from '../src/lib/prisma';

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error('Usage: bun db/set-admin.ts account@example.com [--revoke]');
  process.exit(1);
}
try {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) throw new Error('Register this account in the app before assigning its role.');
  const role = process.argv.includes('--revoke') ? 'USER' : 'ADMIN';
  await prisma.user.update({ where: { id: user.id }, data: { role } });
  console.log(`Account role updated to ${role}. Refresh the app to load the new role.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Role update failed');
  process.exitCode = 1;
} finally { await prisma.$disconnect(); }
