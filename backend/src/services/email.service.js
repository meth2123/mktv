/**
 * Service d'envoi d'emails (Brevo)
 * Confirmation d'inscription, abonnement active, rappel expiration
 */

import { logger } from "../config/logger.js";

const BREVO_API_KEY = process.env.BREVO_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || "IPTV <noreply@example.com>";

function parseFrom(raw) {
  const s = String(raw || "").trim();
  const m = s.match(/^\s*([^<]+?)\s*<\s*([^>]+)\s*>\s*$/);
  if (m) {
    return { name: m[1].trim(), email: m[2].trim() };
  }
  return { name: "IPTV", email: s || "noreply@example.com" };
}

/**
 * Envoie un email via l'API Brevo
 */
async function sendEmail({ to, subject, html }) {
  if (!BREVO_API_KEY) {
    logger.warn("BREVO_API_KEY non configure - email non envoye", { to, subject });
    return { ok: false, mock: true };
  }

  const sender = parseFrom(EMAIL_FROM);

  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": BREVO_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sender,
        to: [{ email: to }],
        subject,
        htmlContent: html,
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      logger.error("Brevo API error", { status: response.status, data });
      return { ok: false, error: data.message || "Erreur Brevo" };
    }

    logger.info("Email envoye", { to, subject, id: data.messageId || null });
    return { ok: true, id: data.messageId || null };
  } catch (err) {
    logger.error("Erreur envoi email", { error: err.message });
    return { ok: false, error: err.message };
  }
}

/**
 * Email de confirmation d'abonnement active
 */
export async function sendSubscriptionConfirmation(user, subscription) {
  const endDate = new Date(subscription.endDate).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const html = `
    <h2>Bienvenue sur IPTV</h2>
    <p>Votre abonnement a ete active avec succes.</p>
    <p><strong>Valide jusqu'au :</strong> ${endDate}</p>
    <p>Vous pouvez des maintenant acceder a toutes les chaines depuis votre tableau de bord.</p>
    <p>- L'equipe IPTV</p>
  `;

  return sendEmail({
    to: user.email,
    subject: "Votre abonnement IPTV est actif",
    html,
  });
}

