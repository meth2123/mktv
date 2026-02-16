/**
 * Service d'abonnement
 * Activation, vérification, renouvellement
 */

import { prisma } from "../lib/prisma.js";
import { logger } from "../config/logger.js";
import {
  getPlan,
  getEndDate,
  SUBSCRIPTION_PLANS,
} from "../config/subscription.plans.js";

/**
 * Active un abonnement après paiement confirmé
 * @param {string} userId
 * @param {string} planType - ANNUAL | TRIAL
 * @param {Object} paymentInfo - transactionId, amount, currency, paymentMethod
 */
export async function activateSubscription(userId, planType, paymentInfo = {}) {
  const plan = getPlan(planType);
  const startDate = new Date();
  const endDate = getEndDate(startDate, plan.duration);

  const subscription = await prisma.subscription.create({
    data: {
      userId,
      planType,
      amountPaid: paymentInfo.amount ?? plan.price.XOF,
      currency: paymentInfo.currency || "XOF",
      startDate,
      endDate,
      isActive: true,
      paymentMethod: paymentInfo.paymentMethod || null,
      transactionId: paymentInfo.transactionId || null,
    },
  });

  logger.info("Abonnement activé", {
    subscriptionId: subscription.id,
    userId,
    planType,
    endDate: endDate.toISOString(),
  });

  return subscription;
}

/**
 * Vérifie si l'utilisateur a un abonnement actif
 */
export async function getActiveSubscription(userId) {
  return prisma.subscription.findFirst({
    where: {
      userId,
      isActive: true,
      endDate: { gte: new Date() },
    },
    orderBy: { endDate: "desc" },
  });
}

/**
 * Retourne le statut d'abonnement pour l'API
 */
export async function getSubscriptionStatus(userId) {
  const active = await getActiveSubscription(userId);
  const plans = Object.keys(SUBSCRIPTION_PLANS).map((key) => ({
    type: key,
    name: SUBSCRIPTION_PLANS[key].name,
    price: SUBSCRIPTION_PLANS[key].price,
    features: SUBSCRIPTION_PLANS[key].features,
  }));

  return {
    hasActiveSubscription: !!active,
    current: active
      ? {
          id: active.id,
          planType: active.planType,
          startDate: active.startDate,
          endDate: active.endDate,
          features: getPlan(active.planType).features,
        }
      : null,
    availablePlans: plans,
  };
}
