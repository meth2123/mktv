/**
 * Middleware d'authentification pour le proxy
 * Verifie le JWT (partage avec le backend) - pas d'appel API
 */

import jwt from "jsonwebtoken";
import {
  registerFailedAttempt,
  registerSuccessfulAuth,
} from "../services/security-guard.service.js";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.warn("JWT_SECRET manquant - les requetes protegees echoueront");
}

/**
 * Accepte le token dans Authorization: Bearer ou dans query ?token=
 */
export function authenticate(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "") || req.query.token;

  if (!token) {
    registerFailedAttempt(req.ip);
    return res.status(401).json({ error: "Token requis" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET || "dummy");
    req.userId = decoded.userId;
    req.token = token;
    registerSuccessfulAuth(req.ip);
    next();
  } catch (err) {
    registerFailedAttempt(req.ip);
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Token expire" });
    }
    return res.status(401).json({ error: "Token invalide" });
  }
}
