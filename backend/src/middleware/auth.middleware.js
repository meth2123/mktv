/**
 * Middleware d'authentification JWT
 * Vérifie le token et attache l'utilisateur à req.user
 */

import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma.js";
import { logger } from "../config/logger.js";

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET manquant dans .env");
  }
  return secret;
}

/**
 * Vérifie le token JWT et charge l'utilisateur
 */
export async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7)
      : req.query?.token;

    if (!token) {
      return res.status(401).json({ error: "Token d'authentification requis" });
    }

    const decoded = jwt.verify(token, getJwtSecret());

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        email: true,
        phone: true,
        firstname: true,
        lastname: true,
        country: true,
        createdAt: true,
      },
    });

    if (!user) {
      return res.status(401).json({ error: "Utilisateur introuvable" });
    }

    req.user = user;
    req.userId = user.id;
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Token expiré" });
    }
    if (err.name === "JsonWebTokenError") {
      return res.status(401).json({ error: "Token invalide" });
    }
    logger.error("Erreur auth middleware", { error: err.message });
    res.status(500).json({ error: "Erreur d'authentification" });
  }
}

/**
 * Optionnel : vérifie que l'utilisateur a un abonnement actif
 * À utiliser sur les routes qui nécessitent un abonnement
 */
export async function requireSubscription(req, res, next) {
  if (!req.userId) return res.status(401).json({ error: "Non authentifié" });

  try {
    const active = await prisma.subscription.findFirst({
      where: {
        userId: req.userId,
        isActive: true,
        endDate: { gte: new Date() },
      },
      orderBy: { endDate: "desc" },
    });

    if (!active) {
      return res.status(403).json({
        error: "Abonnement requis",
        code: "SUBSCRIPTION_REQUIRED",
      });
    }

    req.subscription = active;
    next();
  } catch (err) {
    logger.error("Erreur vérification abonnement", { error: err.message });
    res.status(500).json({ error: "Erreur serveur" });
  }
}
