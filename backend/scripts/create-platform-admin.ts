/**
 * Create (or update) the platform admin account.
 *
 * Usage:
 *   bun scripts/create-platform-admin.ts <email> <password> [name]
 * or:
 *   bun run create:admin -- <email> <password> [name]
 */
import { PrismaClient, Role } from "@prisma/client";
import * as bcrypt from "bcryptjs";

const [, , email, password, name] = process.argv;

if (!email || !password) {
  console.error(
    "Usage: bun scripts/create-platform-admin.ts <email> <password> [name]",
  );
  process.exit(1);
}

const prisma = new PrismaClient();
const passwordHash = await bcrypt.hash(password, 10);

const user = await prisma.user.upsert({
  where: { email },
  update: {
    passwordHash,
    role: Role.PLATFORM_ADMIN,
    name: name ?? "Platform Admin",
  },
  create: {
    email,
    passwordHash,
    role: Role.PLATFORM_ADMIN,
    name: name ?? "Platform Admin",
  },
});

console.log(`✅ Platform admin ready: ${user.email} (role ${user.role})`);
await prisma.$disconnect();
