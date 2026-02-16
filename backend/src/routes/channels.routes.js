/**
 * Routes chaînes (liste + URL playlist)
 * Toutes nécessitent une authentification
 */

import { Router } from "express";
import * as channelsController from "../controllers/channels.controller.js";
import { authenticate } from "../middleware/auth.middleware.js";
import { requireSubscription } from "../middleware/auth.middleware.js";

const router = Router();

router.use(authenticate);

router.get("/", channelsController.list);
router.get("/groups", channelsController.groups);
router.get("/playlist-url", requireSubscription, channelsController.playlistUrl);
router.get("/playlist-raw", requireSubscription, channelsController.playlistRaw);

export default router;
