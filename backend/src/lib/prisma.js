/**
 * Client Prisma singleton
 * Évite les connexions multiples en dev
 */

import { PrismaClient } from "@prisma/client";
import { logger } from "../config/logger.js";

const prisma = new PrismaClient({
  log: [
    { emit: "event", level: "query" },
    { emit: "stdout", level: "error" },
  ],
});

prisma.$on("query", (e) => {
  if (process.env.LOG_QUERIES === "true") {
    logger.debug("Prisma query", { query: e.query, duration: e.duration });
  }
});

export { prisma };
