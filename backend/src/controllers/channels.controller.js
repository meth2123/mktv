/**
 * Controleur chaines
 * Recupere la liste des chaines depuis le proxy (sans exposer l'URL source)
 */

import { logger } from "../config/logger.js";
import { getActiveSubscription } from "../services/subscription.service.js";

const PROXY_URL = process.env.PROXY_URL || "http://localhost:3001";

/**
 * GET /api/channels
 * Supporte pagination/recherche via query: offset, limit, q, group
 */
export async function list(req, res) {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "") || req.query.token;
    if (!token) return res.status(401).json({ error: "Token requis" });
    const activeSubscription = await getActiveSubscription(req.userId);
    const canWatch = !!activeSubscription;

    const qs = new URLSearchParams(req.query || {}).toString();
    const url = `${PROXY_URL}/api/channels${qs ? `?${qs}` : ""}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      if (response.status === 403) {
        return res.status(403).json({
          error: "Abonnement requis",
          code: "SUBSCRIPTION_REQUIRED",
        });
      }
      throw new Error(`Proxy error: ${response.status}`);
    }

    const data = await response.json().catch(() => ({}));
    const payload = Array.isArray(data?.channels)
      ? data
      : Array.isArray(data)
        ? { channels: data }
        : (data || { channels: [] });

    if (canWatch) {
      return res.json({
        ...payload,
        canWatch: true,
      });
    }

    const lockedChannels = Array.isArray(payload.channels)
      ? payload.channels.map(({ streamUrl, _streamPath, ...rest }) => ({
          ...rest,
          streamUrl: "",
          locked: true,
        }))
      : [];

    return res.json({
      ...payload,
      channels: lockedChannels,
      canWatch: false,
      message: "Abonnement requis pour lire les chaines.",
      code: "SUBSCRIPTION_REQUIRED",
    });
  } catch (err) {
    logger.error("Erreur list channels", { error: err.message });
    res.status(500).json({ error: "Impossible de charger les chaines" });
  }
}

/**
 * GET /api/channels/playlist-url
 * Retourne l'URL de la playlist M3U sur le proxy (avec token integre)
 */
export async function playlistUrl(req, res, next) {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) return res.status(401).json({ error: "Token requis" });

    const proxyUrl = PROXY_URL.replace(/\/$/, "");
    const playlistUrl = `${proxyUrl}/playlist.m3u?token=${encodeURIComponent(token)}`;

    res.json({
      playlistUrl,
      message: "Utilisez cette URL dans votre lecteur IPTV ou VLC",
    });
  } catch (err) {
    logger.error("Erreur playlist URL", { error: err.message });
    next(err);
  }
}

/**
 * GET /api/channels/playlist-raw
 * Retourne le contenu M3U brut (legacy)
 */
export async function playlistRaw(req, res) {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) return res.status(401).json({ error: "Token requis" });

    const response = await fetch(
      `${PROXY_URL}/playlist.m3u?token=${encodeURIComponent(token)}`,
      { headers: { Accept: "application/x-mpegURL, text/plain" } }
    );

    if (!response.ok) {
      if (response.status === 401) return res.status(401).json({ error: "Token invalide" });
      if (response.status === 403) return res.status(403).json({ error: "Abonnement requis" });
      throw new Error(`Proxy: ${response.status}`);
    }

    const text = await response.text();
    res.set("Content-Type", "application/x-mpegURL");
    res.send(text);
  } catch (err) {
    logger.error("Erreur playlist raw", { error: err.message });
    res.status(500).json({ error: "Impossible de charger la playlist" });
  }
}

/**
 * GET /api/channels/groups
 * Retourne la liste des categories (groupTitle) depuis le proxy
 */
export async function groups(req, res) {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "") || req.query.token;
    if (!token) return res.status(401).json({ error: "Token requis" });
    const activeSubscription = await getActiveSubscription(req.userId);
    const canWatch = !!activeSubscription;

    const response = await fetch(`${PROXY_URL}/api/channels/groups`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      if (response.status === 403) {
        return res.status(403).json({
          error: "Abonnement requis",
          code: "SUBSCRIPTION_REQUIRED",
        });
      }
      throw new Error(`Proxy error: ${response.status}`);
    }

    const data = await response.json().catch(() => ({}));
    res.json({
      ...(data || { groups: [] }),
      canWatch,
      code: canWatch ? undefined : "SUBSCRIPTION_REQUIRED",
    });
  } catch (err) {
    logger.error("Erreur groups", { error: err.message });
    res.status(500).json({ error: "Impossible de charger les categories" });
  }
}
