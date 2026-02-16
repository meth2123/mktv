/**
 * Subscription controller
 * Create payment link + get current status.
 */

import * as subscriptionService from "../services/subscription.service.js";
import * as paymentService from "../services/payment.service.js";
import { prisma } from "../lib/prisma.js";
import { getPlan } from "../config/subscription.plans.js";
import { logger } from "../config/logger.js";

export async function create(req, res, next) {
  try {
    const { planType = "ANNUAL", currency = "XOF" } = req.body;
    const userId = req.userId;
    const ccy = String(currency || "XOF").toUpperCase();

    const plan = getPlan(planType);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, firstname: true, lastname: true, phone: true },
    });

    if (!user) {
      return res.status(404).json({ error: "Utilisateur introuvable" });
    }

    const payment = await paymentService.createPayment({
      userId: user.id,
      planType,
      user: {
        email: user.email,
        firstname: user.firstname,
        lastname: user.lastname,
        phone: user.phone,
      },
      currency: ccy,
    });

    await prisma.payment.create({
      data: {
        userId: user.id,
        amount: plan.price[ccy] ?? plan.price.XOF,
        currency: ccy,
        transactionId: payment.transactionId,
        status: "pending",
        paymentMethod: payment.paymentMethod || paymentService.getPaymentProvider(),
        providerResponse: payment.providerResponse || null,
      },
    });

    res.json({
      paymentUrl: payment.paymentUrl,
      transactionId: payment.transactionId,
      provider: paymentService.getPaymentProvider(),
      plan: plan.name,
      amount: plan.price[ccy] ?? plan.price.XOF,
      currency: ccy,
    });
  } catch (err) {
    logger.error("Erreur create subscription", { error: err.message });
    next(err);
  }
}

export async function status(req, res, next) {
  try {
    const data = await subscriptionService.getSubscriptionStatus(req.userId);
    res.json(data);
  } catch (err) {
    logger.error("Erreur subscription status", { error: err.message });
    next(err);
  }
}

