// Lit backend/.env et écrit un prisma/.env minimal (sans BOM) pour que Prisma trouve DATABASE_URL
const path = require("path");
const fs = require("fs");

const backendDir = path.resolve(__dirname);
const envPath = path.join(backendDir, ".env");
const prismaEnvDir = path.join(backendDir, "prisma");
const prismaEnvPath = path.join(prismaEnvDir, ".env");

if (!fs.existsSync(envPath)) {
  console.error("Fichier .env introuvable:", envPath);
  process.exit(1);
}

let content = fs.readFileSync(envPath, "utf8");
content = content.replace(/^\uFEFF/, ""); // enlever BOM

let databaseUrl = null;
// Valeur entre guillemets doubles, ou entre simples, ou sans guillemets
const match =
  content.match(/DATABASE_URL\s*=\s*"([^"]*)"/) ||
  content.match(/DATABASE_URL\s*=\s*'([^']*)'/) ||
  content.match(/DATABASE_URL\s*=\s*(\S+)/);
if (match) databaseUrl = match[1].trim();

if (!databaseUrl) {
  console.error("DATABASE_URL manquante dans", envPath);
  process.exit(1);
}

// Écrire un .env minimal dans prisma/ (sans BOM, UTF-8)
const line = "DATABASE_URL=\"" + databaseUrl + "\"";
fs.writeFileSync(prismaEnvPath, line + "\n", "utf8");

const { execSync } = require("child_process");
const args = process.argv.slice(2).join(" ");
const cmd = args ? "npx prisma " + args : "npx prisma db push";

execSync(cmd, {
  stdio: "inherit",
  cwd: backendDir,
});
