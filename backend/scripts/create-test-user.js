/**
 * Crée un utilisateur de test (sans supprimer les tokens existants).
 * Usage: node scripts/create-test-user.js
 * Depuis la racine backend: node scripts/create-test-user.js
 */

import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Charger .env avec dotenv (chemin explicite) AVANT tout import Prisma
const envPaths = [
  path.join(process.cwd(), ".env"),
  path.resolve(__dirname, "..", ".env"),
  path.join(process.cwd(), "prisma", ".env"),
];

let loaded = false;
const dotenv = (await import("dotenv")).default;
for (const envPath of envPaths) {
  const r = dotenv.config({ path: envPath });
  if (r.parsed && r.parsed.DATABASE_URL) {
    process.env.DATABASE_URL = r.parsed.DATABASE_URL;
    loaded = true;
    break;
  }
  if (process.env.DATABASE_URL) {
    loaded = true;
    break;
  }
}

if (!loaded || !process.env.DATABASE_URL) {
  console.error("DATABASE_URL introuvable. Chemins testés:", envPaths.join(" | "));
  process.exit(1);
}

const { PrismaClient } = await import("@prisma/client");
const bcrypt = (await import("bcryptjs")).default;

const prisma = new PrismaClient();

const TEST_EMAIL = "methndiaye43@gmail.com";
const TEST_PASSWORD = "Alamine123";

async function main() {
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 12);
  const user = await prisma.user.upsert({
    where: { email: TEST_EMAIL },
    update: { passwordHash },
    create: {
      email: TEST_EMAIL,
      passwordHash,
      firstname: "Test",
      lastname: "User",
      country: "SN",
    },
  });
  console.log("Utilisateur de test créé/mis à jour:", user.email);
  console.log("Mot de passe:", TEST_PASSWORD);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
