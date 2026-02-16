/**
 * Routes abonnements
 */

import { Router } from "express";
import * as subscriptionController from "../controllers/subscription.controller.js";
import { authenticate } from "../middleware/auth.middleware.js";

const router = Router();

router.use(authenticate);

router.post("/create", subscriptionController.create);
router.get("/status", subscriptionController.status);

export default router;
