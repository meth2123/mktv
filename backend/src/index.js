/**
 * Point d'entrée API Backend - Application IPTV
 * Authentification, abonnements, paiements Fedapay
 */

import "./env.js";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { logger } from "./config/logger.js";
import authRoutes from "./routes/auth.routes.js";
import subscriptionRoutes from "./routes/subscription.routes.js";
import paymentRoutes from "./routes/payment.routes.js";
import channelsRoutes from "./routes/channels.routes.js";

const app = express();
const PORT = process.env.PORT || 4000;

// Sécurité
app.use(helmet());
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "*",
    credentials: true,
  })
);

// Limite de requêtes (anti-abus)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 100,
  message: { error: "Trop de requêtes, réessayez plus tard." },
});
app.use("/api/", limiter);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "iptv-api" });
});

app.use("/api/auth", authRoutes);
app.use("/api/subscription", subscriptionRoutes);
app.use("/api/payment", paymentRoutes);
app.use("/api/channels", channelsRoutes);

// 404
app.use((req, res) => {
  res.status(404).json({ error: "Route non trouvée" });
});

// Gestion d'erreurs globale
app.use((err, req, res, next) => {
  logger.error("Erreur API", { error: err.message, stack: err.stack });
  res.status(err.status || 500).json({
    error: err.message || "Erreur serveur",
  });
});

if (!process.env.JWT_SECRET) {
  logger.error("JWT_SECRET manquant. Vérifiez que backend/.env existe et contient JWT_SECRET=...");
  process.exit(1);
}

app.listen(PORT, () => {
  logger.info(`API IPTV démarrée sur le port ${PORT}`);
});

export default app;
