/**
 * Payment service
 * Supports Fedapay and Stripe (selected by PAYMENT_PROVIDER).
 */

import Stripe from "stripe";
import { logger } from "../config/logger.js";
import { getPlan } from "../config/subscription.plans.js";

const PAYMENT_PROVIDER = (process.env.PAYMENT_PROVIDER || "fedapay").toLowerCase();

const FEDAPAY_SECRET = process.env.FEDAPAY_SECRET_KEY;
const FEDAPAY_ENV = process.env.FEDAPAY_ENVIRONMENT || "sandbox";
const FEDAPAY_BASE_URL =
  FEDAPAY_ENV === "production"
    ? "https://api.fedapay.com"
    : "https://sandbox-api.fedapay.com";

const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;
const stripe = STRIPE_SECRET ? new Stripe(STRIPE_SECRET) : null;
const STRIPE_DEFAULT_CURRENCY = normalizeCurrency(process.env.STRIPE_DEFAULT_CURRENCY || "XOF");
const ZERO_DECIMAL_CURRENCIES = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "JPY",
  "KMF",
  "KRW",
  "MGA",
  "PYG",
  "RWF",
  "UGX",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
]);

function normalizeCurrency(currency = "XOF") {
  return String(currency || "XOF").toUpperCase();
}

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

function resolveStripeCurrency(requestedCurrency, plan) {
  const requested = normalizeCurrency(requestedCurrency);
  if (plan?.price?.[requested] != null) return requested;
  if (plan?.price?.[STRIPE_DEFAULT_CURRENCY] != null) return STRIPE_DEFAULT_CURRENCY;
  if (plan?.price?.XOF != null) return "XOF";
  const first = Object.keys(plan?.price || {})[0];
  return normalizeCurrency(first || "XOF");
}

function toStripeMinorAmount(amount, currency) {
  const value = Number(amount || 0);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Montant Stripe invalide");
  }
  const ccy = normalizeCurrency(currency);
  if (ZERO_DECIMAL_CURRENCIES.has(ccy)) {
    return Math.round(value);
  }
  return Math.round(value * 100);
}

export function getPaymentProvider() {
  return PAYMENT_PROVIDER;
}

/**
 * Create payment and return redirect URL + transaction ID.
 * @returns {Promise<{paymentUrl:string,transactionId:string,paymentMethod:string,providerResponse?:object}>}
 */
export async function createPayment(params) {
  const provider = getPaymentProvider();
  if (provider === "stripe") return createStripePayment(params);
  return createFedapayPayment(params);
}

/**
 * Used by callbacks to validate payment status.
 */
export async function getTransactionStatus(transactionId, provider = getPaymentProvider()) {
  if (provider === "stripe") {
    const session = await getStripeSession(transactionId);
    const paid = session?.payment_status === "paid";
    return { status: paid ? "approved" : (session?.payment_status || "pending"), approved: paid };
  }
  return getFedapayTransactionStatus(transactionId);
}

export async function getStripeSession(sessionId) {
  if (!stripe) {
    throw new Error("STRIPE_SECRET_KEY manquant");
  }
  return stripe.checkout.sessions.retrieve(String(sessionId));
}

async function createStripePayment(params) {
  const { userId, planType, user, currency = "XOF" } = params;
  const plan = getPlan(planType);
  const ccy = resolveStripeCurrency(currency, plan);
  const amount = Number(plan.price[ccy] ?? plan.price.XOF);

  if (!stripe) {
    logger.warn("STRIPE_SECRET_KEY non configure - mode mock");
    return {
      ...getMockPaymentUrl(userId, planType),
      paymentMethod: "mock",
      providerResponse: { provider: "stripe", mode: "mock" },
    };
  }

  const successUrl = `${process.env.APP_URL}/api/payment/stripe/success?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = getCancelRedirectUrl();
  const stripeCurrency = ccy.toLowerCase();
  const unitAmount = toStripeMinorAmount(amount, ccy);

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    success_url: successUrl,
    cancel_url: cancelUrl,
    customer_email: user.email || undefined,
    metadata: {
      user_id: String(userId),
      plan_type: String(planType),
      currency: ccy,
    },
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: stripeCurrency,
          unit_amount: unitAmount,
          product_data: {
            name: plan.name,
            description: `IPTV - ${planType}`,
          },
        },
      },
    ],
  });

  if (!session?.url || !session?.id) {
    throw new Error("Stripe session invalide");
  }

  logger.info("Paiement Stripe cree", {
    transactionId: session.id,
    userId,
    amount,
    currency: ccy,
  });

  return {
    paymentUrl: session.url,
    transactionId: session.id,
    paymentMethod: "stripe",
    providerResponse: {
      provider: "stripe",
      checkoutSessionId: session.id,
      amountTotal: session.amount_total ?? null,
      currency: session.currency ?? stripeCurrency,
      amountMinor: unitAmount,
    },
  };
}

async function createFedapayPayment(params) {
  const { userId, planType, user, currency = "XOF" } = params;
  const ccy = normalizeCurrency(currency);

  if (!FEDAPAY_SECRET) {
    logger.warn("FEDAPAY_SECRET_KEY non configure - mode mock");
    return {
      ...getMockPaymentUrl(userId, planType),
      paymentMethod: "mock",
      providerResponse: { provider: "fedapay", mode: "mock" },
    };
  }

  const plan = getPlan(planType);
  const amount = plan.price[ccy] ?? plan.price.XOF;

  const callbackUrl = `${process.env.APP_URL}/api/payment/callback`;
  const successUrl = getSuccessRedirectUrl();
  const cancelUrl = getCancelRedirectUrl();

  const body = {
    transaction: {
      amount,
      currency: ccy,
      description: `IPTV - ${plan.name}`,
      callback_url: callbackUrl,
      redirect_url: successUrl,
      cancel_url: cancelUrl,
      customer: {
        firstname: user.firstname || "Client",
        lastname: user.lastname || "IPTV",
        email: user.email,
        phone_number: user.phone || "",
      },
      metadata: {
        user_id: userId,
        plan_type: planType,
      },
    },
  };

  const response = await fetch(`${FEDAPAY_BASE_URL}/v1/transactions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${FEDAPAY_SECRET}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();
  if (!response.ok) {
    logger.error("Fedapay create transaction error", { status: response.status, data });
    throw new Error(data.message || "Erreur creation paiement");
  }

  const transaction = data.transaction || data;
  const token = transaction.token;
  if (!token) throw new Error("Pas de token retourne par Fedapay");

  const paymentUrl =
    FEDAPAY_ENV === "production"
      ? `https://pay.fedapay.com/${token}`
      : `https://sandbox-pay.fedapay.com/${token}`;

  logger.info("Paiement Fedapay cree", {
    transactionId: transaction.id,
    userId,
    amount,
    currency: ccy,
  });

  return {
    paymentUrl,
    transactionId: String(transaction.id),
    paymentMethod: "fedapay",
    providerResponse: {
      provider: "fedapay",
      transactionId: String(transaction.id),
      token,
    },
  };
}

async function getFedapayTransactionStatus(transactionId) {
  if (!FEDAPAY_SECRET) return { status: "approved", approved: true };

  try {
    const response = await fetch(`${FEDAPAY_BASE_URL}/v1/transactions/${transactionId}`, {
      headers: { Authorization: `Bearer ${FEDAPAY_SECRET}` },
    });
    const data = await response.json();
    const transaction = data.transaction || data;
    const status = transaction.status || "pending";
    return {
      status,
      approved: status === "approved" || status === "approved_merchant",
    };
  } catch (err) {
    logger.error("getFedapayTransactionStatus", { error: err.message });
    return { status: "unknown", approved: false };
  }
}

function getMockPaymentUrl(userId, planType) {
  const base = process.env.APP_URL || "http://localhost:4000";
  return {
    paymentUrl: `${base}/api/payment/mock-success?user_id=${userId}&plan=${planType}`,
    transactionId: `mock_${Date.now()}`,
  };
}
