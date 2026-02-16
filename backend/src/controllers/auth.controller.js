/**
 * Contrôleur d'authentification
 * Inscription, connexion, profil
 */

import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma.js";
import { logger } from "../config/logger.js";

function getJwtOptions() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET manquant dans .env");
  return { secret, expiresIn: process.env.JWT_EXPIRES_IN || "7d" };
}

/**
 * POST /api/auth/register
 * Inscription d'un nouvel utilisateur
 */
export async function register(req, res, next) {
  try {
    const { email, phone, password, firstname, lastname, country = "SN" } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email et mot de passe requis" });
    }

    const existing = await prisma.user.findFirst({
      where: {
        OR: [
          { email: email.toLowerCase() },
          ...(phone ? [{ phone }] : []),
        ],
      },
    });

    if (existing) {
      return res.status(409).json({
        error: existing.email === email.toLowerCase() ? "Email déjà utilisé" : "Numéro déjà utilisé",
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        phone: phone || null,
        passwordHash,
        firstname: firstname || null,
        lastname: lastname || null,
        country,
      },
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

    const { secret, expiresIn } = getJwtOptions();
    const token = jwt.sign(
      { userId: user.id },
      secret,
      { expiresIn }
    );

    logger.info("Nouvel utilisateur inscrit", { userId: user.id, email: user.email });

    res.status(201).json({
      user,
      token,
      expiresIn,
    });
  } catch (err) {
    logger.error("Erreur register", { error: err.message });
    next(err);
  }
}

/**
 * POST /api/auth/login
 * Connexion email/téléphone + mot de passe
 */
export async function login(req, res, next) {
  try {
    const { email, phone, password } = req.body;
    const loginId = email || phone;

    if (!loginId || !password) {
      return res.status(400).json({ error: "Email/téléphone et mot de passe requis" });
    }

    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: loginId.toLowerCase() },
          { phone: loginId },
        ],
      },
    });

    if (!user) {
      return res.status(401).json({ error: "Identifiants incorrects" });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: "Identifiants incorrects" });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    const { secret, expiresIn } = getJwtOptions();
    const token = jwt.sign(
      { userId: user.id },
      secret,
      { expiresIn }
    );

    const userResponse = {
      id: user.id,
      email: user.email,
      phone: user.phone,
      firstname: user.firstname,
      lastname: user.lastname,
      country: user.country,
      createdAt: user.createdAt,
    };

    logger.info("Connexion utilisateur", { userId: user.id });

    res.json({
      user: userResponse,
      token,
      expiresIn,
    });
  } catch (err) {
    logger.error("Erreur login", { error: err.message });
    next(err);
  }
}

/**
 * GET /api/auth/profile
 * Profil de l'utilisateur connecté (avec statut abonnement)
 */
export async function profile(req, res, next) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: {
        id: true,
        email: true,
        phone: true,
        firstname: true,
        lastname: true,
        country: true,
        createdAt: true,
        lastLogin: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: "Utilisateur introuvable" });
    }

    const activeSubscription = await prisma.subscription.findFirst({
      where: {
        userId: req.userId,
        isActive: true,
        endDate: { gte: new Date() },
      },
      orderBy: { endDate: "desc" },
    });

    res.json({
      ...user,
      hasActiveSubscription: !!activeSubscription,
      subscription: activeSubscription
        ? {
            planType: activeSubscription.planType,
            endDate: activeSubscription.endDate,
            startDate: activeSubscription.startDate,
          }
        : null,
    });
  } catch (err) {
    logger.error("Erreur profile", { error: err.message });
    next(err);
  }
}
