/**
 * Payment routes
 */

import { Router } from "express";
import * as paymentController from "../controllers/payment.controller.js";

const router = Router();

// Fedapay webhook
router.post("/callback", paymentController.callback);

// Stripe redirect success endpoint
router.get("/stripe/success", paymentController.stripeSuccess);

// Dev helper
router.get("/mock-success", paymentController.mockSuccess);

export default router;

