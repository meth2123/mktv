/**
 * Seed optionnel : données de test
 * Exécution : node prisma/seed.js (après db:push)
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const hash = await bcrypt.hash("password123", 12);
  const user = await prisma.user.upsert({
    where: { email: "test@iptv.local" },
    update: {},
    create: {
      email: "test@iptv.local",
      passwordHash: hash,
      firstname: "Test",
      lastname: "User",
      country: "SN",
    },
  });
  console.log("Utilisateur de test créé:", user.email);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
