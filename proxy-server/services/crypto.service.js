/**
 * Cryptage / Décryptage des URLs source
 * AES-256-CBC - les tokens dans la playlist ne révèlent jamais l'URL réelle
 */

import crypto from "crypto";

const ALGO = "aes-256-cbc";
const KEY = process.env.ENCRYPTION_KEY;
const IV_LENGTH = 16;

if (!KEY || KEY.length < 32) {
  console.warn("ENCRYPTION_KEY doit faire au moins 32 caractères. Utilisation d'une clé dérivée.");
}

const key = KEY
  ? crypto.scryptSync(KEY, "salt", 32)
  : crypto.randomBytes(32);

/**
 * Chiffre une URL et retourne un token hexadécimal (safe pour URL si encodé)
 */
export function encryptUrl(url) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  let encrypted = cipher.update(url, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + encrypted;
}

/**
 * Déchiffre un token pour retrouver l'URL originale
 */
export function decryptToken(token) {
  try {
    const iv = Buffer.from(token.slice(0, IV_LENGTH * 2), "hex");
    const encrypted = token.slice(IV_LENGTH * 2);
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (err) {
    throw new Error("Token invalide ou expiré");
  }
}
