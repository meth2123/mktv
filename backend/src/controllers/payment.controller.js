/**
 * Payment controller
 * - Fedapay callback
 * - Stripe success return
 * - Mock success (dev)
 */

import * as paymentService from "../services/payment.service.js";
import * as subscriptionService from "../services/subscription.service.js";
import { prisma } from "../lib/prisma.js";
import { logger } from "../config/logger.js";

function getFrontendBaseUrl() {
  return (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/$/, "");
}

function toAbsoluteFrontendUrl(value, fallbackPath) {
  const raw = String(value || "").trim();
  const base = getFrontendBaseUrl();
  if (!raw) return `${base}${fallbackPath}`;
  if (/^https?:\/\//i.test(raw)) return raw;
  return `${base}${raw.startsWith("/") ? raw : `/${raw}`}`;
}

function getSuccessRedirectUrl() {
  return toAbsoluteFrontendUrl(process.env.PAYMENT_SUCCESS_REDIRECT, "/subscribe?success=1");
}

function getCancelRedirectUrl() {
  return toAbsoluteFrontendUrl(process.env.PAYMENT_CANCEL_REDIRECT, "/subscribe?cancel=1");
}

async function activateFromPayment({ payment, transactionId, planType, providerResponse }) {
  if (!payment) return false;
  if (payment.status === "approved") return true;

  const subscription = await subscriptionService.activateSubscription(payment.userId, planType || "ANNUAL", {
    transactionId,
    amount: payment.amount,
    currency: payment.currency,
    paymentMethod: payment.paymentMethod || "payment_gateway",
  });

  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status: "approved",
      subscriptionId: subscription.id,
      providerResponse: providerResponse || payment.providerResponse || null,
    },
  });

  logger.info("Abonnement active via paiement", {
    userId: payment.userId,
    transactionId,
  });

  return true;
}

/**
 * POST /api/payment/callback
 * Fedapay webhook callback.
 */
export async function callback(req, res) {
  try {
    const transactionId = req.body.transaction_id ?? req.query.transaction_id;
    if (!transactionId) {
      logger.warn("Callback paiement sans transaction_id", { body: req.body });
      return res.status(400).send("transaction_id manquant");
    }

    const { approved } = await paymentService.getTransactionStatus(transactionId, "fedapay");
    const payment = await prisma.payment.findFirst({
      where: { transactionId: String(transactionId) },
    });

    if (!payment) {
      logger.warn("Callback: paiement inconnu", { transactionId });
      return res.status(200).send("OK");
    }

    if (approved) {
      const planType =
        req.body?.metadata?.plan_type ||
        payment.providerResponse?.metadata?.plan_type ||
        "ANNUAL";

      await activateFromPayment({
        payment,
        transactionId: String(transactionId),
        planType,
        providerResponse: req.body,
      });
    } else if (payment.status !== "approved") {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: "failed", providerResponse: req.body },
      });
    }

    return res.status(200).send("OK");
  } catch (err) {
    logger.error("Erreur callback paiement", { error: err.message });
    return res.status(500).send("Error");
  }
}

/**
 * GET /api/payment/stripe/success?session_id=...
 * Stripe redirects here after checkout.
 */
export async function stripeSuccess(req, res) {
  const successRedirect = getSuccessRedirectUrl();
  const cancelRedirect = getCancelRedirectUrl();
  const sessionId = req.query.session_id;

  if (!sessionId) {
    return res.redirect(`${cancelRedirect}${cancelRedirect.includes("?") ? "&" : "?"}error=stripe_missing_session`);
  }

  try {
    const session = await paymentService.getStripeSession(sessionId);
    const paid = session?.payment_status === "paid";

    const payment = await prisma.payment.findFirst({
      where: { transactionId: String(sessionId) },
    });

    if (!payment) {
      logger.warn("Stripe success: paiement introuvable", { sessionId });
      return res.redirect(`${cancelRedirect}${cancelRedirect.includes("?") ? "&" : "?"}error=stripe_payment_not_found`);
    }

    if (!paid) {
      if (payment.status !== "approved") {
        await prisma.payment.update({
          where: { id: payment.id },
          data: { status: "failed", providerResponse: session || null },
        });
      }
      return res.redirect(`${cancelRedirect}${cancelRedirect.includes("?") ? "&" : "?"}error=stripe_not_paid`);
    }

    const planType = session?.metadata?.plan_type || "ANNUAL";
    await activateFromPayment({
      payment,
      transactionId: String(sessionId),
      planType,
      providerResponse: session || null,
    });

    return res.redirect(successRedirect);
  } catch (err) {
    logger.error("Erreur stripeSuccess", { error: err.message });
    return res.redirect(`${cancelRedirect}${cancelRedirect.includes("?") ? "&" : "?"}error=stripe_callback_failed`);
  }
}

/**
 * GET /api/payment/mock-success
 * Dev helper if no real provider key is configured.
 */
export async function mockSuccess(req, res) {
  const provider = paymentService.getPaymentProvider();
  const hasRealKey =
    provider === "stripe"
      ? !!process.env.STRIPE_SECRET_KEY
      : !!process.env.FEDAPAY_SECRET_KEY;

  if (hasRealKey) {
    return res.status(404).json({ error: "Mock desactive en production" });
  }

  const userId = req.query.user_id;
  const planType = req.query.plan || "ANNUAL";

  if (!userId) {
    return res.redirect(`${process.env.FRONTEND_URL || "/"}?error=mock_missing_user`);
  }

  try {
    await subscriptionService.activateSubscription(userId, planType, {
      transactionId: `mock_${Date.now()}`,
      paymentMethod: "mock",
    });
  } catch (e) {
    logger.error("Mock payment error", { error: e.message });
  }

  return res.redirect(getSuccessRedirectUrl());
}
