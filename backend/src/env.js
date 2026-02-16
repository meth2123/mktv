/**
 * Charge les variables d'environnement en premier (avant tout autre module).
 * Nécessaire en ESM car les import sont hoistés.
 */
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, "..", ".env");
dotenv.config({ path: envPath });
if (!process.env.JWT_SECRET) {
  dotenv.config({ path: path.resolve(process.cwd(), ".env") });
}
