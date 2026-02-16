/**
 * Serveur Proxy IPTV
 * - Playlist M3U masquee (URLs source chiffrees)
 * - Stream proxy (dechiffrement + forward)
 * - Authentification JWT, pas d'exposition de la source
 */

import "dotenv/config";
import express from "express";
import cors from "cors";
import axios from "axios";
import rateLimit from "express-rate-limit";
import {
  getMaskedPlaylist,
  getChannelsPage,
  getChannelGroups,
} from "./services/playlist.service.js";
import { decryptToken, encryptUrl } from "./services/crypto.service.js";
import { getXtreamDebugSummary } from "./services/xtream.service.js";
import { authenticate } from "./middleware/auth.middleware.js";
import {
  isIpBlocked,
  registerFailedAttempt,
} from "./services/security-guard.service.js";
import {
  tryAcquireStreamSlot,
  touchStreamSession,
  releaseStreamSession,
} from "./services/stream-session.service.js";

const app = express();
const PORT = process.env.PORT || 3001;
const PROXY_URL = (process.env.PROXY_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const DEBUG_HLS_CHECK = (process.env.DEBUG_HLS_CHECK || "").toLowerCase() === "true";
const DEBUG_XTREAM_CHECK = (process.env.DEBUG_XTREAM_CHECK || "").toLowerCase() === "true";
const STRICT_UPSTREAM_ALLOWLIST =
  (process.env.STRICT_UPSTREAM_ALLOWLIST || "false").toLowerCase() === "true";

app.disable("x-powered-by");

function parseHost(urlLike) {
  try {
    return new URL(String(urlLike || "").trim()).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function collectAllowedHosts() {
  const configured = String(process.env.UPSTREAM_ALLOWLIST || "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);

  const derived = [
    parseHost(process.env.XTREAM_BASE_URL),
    parseHost(process.env.ORIGINAL_PLAYLIST_URL),
  ].filter(Boolean);

  return new Set([...configured, ...derived]);
}

const ALLOWED_UPSTREAM_HOSTS = collectAllowedHosts();

function isAllowedUpstreamUrl(rawUrl) {
  try {
    const u = new URL(String(rawUrl || "").trim());
    if (!["http:", "https:"].includes(u.protocol)) return false;
    if (!STRICT_UPSTREAM_ALLOWLIST) return true;
    if (ALLOWED_UPSTREAM_HOSTS.size === 0) return false;
    return ALLOWED_UPSTREAM_HOSTS.has(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

// Rate limiting
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 min
  max: 120,
  message: { error: "Trop de requetes" },
});
app.use(limiter);

app.use(cors({ origin: process.env.CORS_ORIGIN || "*", credentials: true }));
app.use(express.json());
app.use((req, res, next) => {
  if (isIpBlocked(req.ip)) {
    return res.status(403).json({ error: "Acces temporairement bloque" });
  }
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  next();
});

// Sante
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "iptv-proxy" });
});

// Playlist M3U masquee (auth requise, token en header ou ?token=)
app.get("/playlist.m3u", authenticate, async (req, res) => {
  try {
    const masked = await getMaskedPlaylist(req.token);
    res.setHeader("Content-Type", "application/x-mpegURL");
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.send(masked);
  } catch (err) {
    console.error("Playlist error:", err.message);
    res.status(500).set("Content-Type", "text/plain").send("Erreur playlist");
  }
});

// Liste des chaines (paginee) - auth requise
// GET /api/channels?offset=0&limit=1000&q=...&group=...
app.get("/api/channels", authenticate, async (req, res) => {
  try {
    const { offset, limit, q, group } = req.query || {};
    const page = await getChannelsPage(req.token, { offset, limit, q, group });
    res.json(page);
  } catch (err) {
    console.error("Channels list error:", err.message);
    res.status(500).json({ error: "Erreur chargement chaines" });
  }
});

// Categories/groups (for fast UI)
app.get("/api/channels/groups", authenticate, async (req, res) => {
  try {
    const groups = await getChannelGroups(req.token);
    res.json({ groups });
  } catch (err) {
    console.error("Channels groups error:", err.message);
    res.status(500).json({ error: "Erreur chargement categories" });
  }
});

// Debug endpoint (dev only): verify a provider's HLS playlist AND first segment are reachable.
// Enable with DEBUG_HLS_CHECK=true in proxy-server/.env
app.get("/api/debug/hls-check", authenticate, async (req, res) => {
  if (!DEBUG_HLS_CHECK) {
    return res.status(404).json({ error: "Not found" });
  }

  const url = String(req.query.url || "").trim();
  if (!url) return res.status(400).json({ error: "Missing url" });
  if (!isAllowedUpstreamUrl(url)) {
    registerFailedAttempt(req.ip);
    return res.status(403).json({ error: "Upstream refuse" });
  }

  try {
    const plRes = await axios.get(url, {
      responseType: "text",
      proxy: false,
      timeout: 15000,
      headers: {
        "User-Agent": "VLC/3.0.0",
        Accept: "application/vnd.apple.mpegurl, application/x-mpegURL, text/plain, */*",
      },
      validateStatus: () => true,
    });

    const playlistStatus = plRes.status;
    if (playlistStatus < 200 || playlistStatus >= 300) {
      return res.json({ ok: false, playlistStatus });
    }

    const lines = String(plRes.data || "").split(/\r?\n/).map((l) => l.trim());
    const firstUri = lines.find((l) => l && !l.startsWith("#"));
    if (!firstUri) {
      return res.json({ ok: false, playlistStatus, error: "No segment URI found" });
    }

    const firstAbs = new URL(firstUri, url).toString();
    const segRes = await axios.get(firstAbs, {
      responseType: "arraybuffer",
      proxy: false,
      timeout: 15000,
      headers: {
        "User-Agent": "VLC/3.0.0",
        Accept: "*/*",
        Range: "bytes=0-65535",
      },
      validateStatus: () => true,
    });

    return res.json({
      ok: segRes.status >= 200 && segRes.status < 300,
      playlistStatus,
      firstSegmentStatus: segRes.status,
      firstSegmentUrl: firstAbs,
    });
  } catch (err) {
    return res.json({ ok: false, error: err.message });
  }
});

// Debug endpoint (dev only): check Xtream live/vod availability and account limits.
// Enable with DEBUG_XTREAM_CHECK=true in proxy-server/.env
app.get("/api/debug/xtream-summary", authenticate, async (req, res) => {
  if (!DEBUG_XTREAM_CHECK) {
    return res.status(404).json({ error: "Not found" });
  }

  try {
    const summary = await getXtreamDebugSummary();
    return res.json(summary);
  } catch (err) {
    return res.status(500).json({ error: err.message || "xtream debug failed" });
  }
});

function isLikelyM3u(url) {
  const u = String(url || "").toLowerCase();
  return u.includes(".m3u8") || u.endsWith(".m3u");
}

function isLikelyTs(url) {
  return /\.ts(\?|$)/i.test(String(url || ""));
}

function isLikelyDirectVideo(url) {
  return /\.(mp4|mkv|avi|mov|webm|m4v)(\?|$)/i.test(String(url || ""));
}

function shouldLimitStream(url) {
  return isLikelyM3u(url) || isLikelyTs(url) || isLikelyDirectVideo(url);
}

function buildProxiedUrl(absoluteUrl, authToken, sid) {
  const encrypted = encryptUrl(absoluteUrl);
  const params = new URLSearchParams();
  if (authToken) params.set("token", authToken);
  if (sid) params.set("sid", sid);
  const query = params.toString();
  return `${PROXY_URL}/stream/${encrypted}${query ? `?${query}` : ""}`;
}

function rewriteM3u(text, baseUrl, authToken, sid = "") {
  // Rewrite every URI so Hls.js fetches playlists/segments/keys through the proxy.
  const lines = String(text || "").split(/\r?\n/);
  const out = [];

  function toProxied(absoluteUrl) {
    return buildProxiedUrl(absoluteUrl, authToken, sid);
  }

  function abs(u) {
    return new URL(u, baseUrl).toString();
  }

  function rewriteAttributeUri(line, attrName) {
    // Example: #EXT-X-KEY:METHOD=AES-128,URI="key.key"
    // Example: #EXT-X-MAP:URI="init.mp4"
    const re = new RegExp(`${attrName}=\"([^\"]+)\"`);
    const m = line.match(re);
    if (!m) return line;
    try {
      const absoluteUrl = abs(m[1]);
      const proxied = toProxied(absoluteUrl);
      return line.replace(re, `${attrName}="${proxied}"`);
    } catch {
      return line;
    }
  }

  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      out.push(line);
      continue;
    }

    if (t.startsWith("#")) {
      // Rewrite URI="..." attributes in tags (keys, init segments, iframe playlists)
      let rewritten = line;
      rewritten = rewriteAttributeUri(rewritten, "URI");
      out.push(rewritten);
      continue;
    }
    let absolute;
    try {
      absolute = abs(t);
    } catch {
      out.push(line);
      continue;
    }
    out.push(toProxied(absolute));
  }
  return out.join("\n");
}

// Stream proxy : /stream/:token (token = URL chiffree)
app.get("/stream/:token", authenticate, async (req, res) => {
  let originalUrl;
  let sessionState = null;
  try {
    originalUrl = decryptToken(req.params.token);
  } catch {
    registerFailedAttempt(req.ip);
    return res.status(400).set("Content-Type", "text/plain").send("Lien invalide");
  }

  if (!isAllowedUpstreamUrl(originalUrl)) {
    registerFailedAttempt(req.ip);
    return res.status(403).set("Content-Type", "text/plain").send("Upstream refuse");
  }

  const streamNeedsLimit = shouldLimitStream(originalUrl);
  if (streamNeedsLimit) {
    const sidHint = String(req.query.sid || "").trim();
    const fingerprint = `${req.ip || ""}|${req.headers["user-agent"] || ""}`;
    const acquire = tryAcquireStreamSlot({
      userId: req.userId,
      streamKey: originalUrl,
      fingerprint,
      sessionIdHint: sidHint,
    });

    if (!acquire.allowed) {
      const msg =
        acquire.reason === "global_limit"
          ? `Un seul flux video est autorise sur ce proxy (${acquire.activeGlobal}/${acquire.maxGlobal}).`
          : `Trop de lectures simultanees (${acquire.active}/${acquire.max}).`;
      return res
        .status(429)
        .set("Content-Type", "text/plain")
        .send(`${msg} Fermez un lecteur puis reessayez.`);
    }

    sessionState = {
      sid: acquire.sid,
      releaseOnClose: isLikelyTs(originalUrl),
    };

    if (!acquire.created) {
      touchStreamSession(req.userId, acquire.sid);
    }
  }

  try {
    // If this is an HLS playlist, fetch as text and rewrite segment URIs to go through proxy.
    if (isLikelyM3u(originalUrl)) {
      const response = await axios.get(originalUrl, {
        responseType: "text",
        proxy: false,
        timeout: 30000,
        headers: {
          "User-Agent": "VLC/3.0.0",
          Accept: "application/vnd.apple.mpegurl, application/x-mpegURL, text/plain, */*",
        },
        validateStatus: () => true,
      });

      if (response.status < 200 || response.status >= 300) {
        return res.status(response.status).send("Stream indisponible");
      }

      const rewritten = rewriteM3u(response.data, originalUrl, req.token, sessionState?.sid || "");
      res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      res.setHeader("Cache-Control", "no-cache");
      return res.send(rewritten);
    }

    const response = await axios({
      method: "GET",
      url: originalUrl,
      responseType: "stream",
      proxy: false,
      timeout: 30000,
      headers: {
        "User-Agent": "VLC/3.0.0",
        Accept: "*/*",
        ...(req.headers.range ? { Range: req.headers.range } : {}),
      },
      validateStatus: () => true,
    });

    if (response.status < 200 || response.status >= 300) {
      return res.status(response.status).send("Stream indisponible");
    }

    // Forward content type when possible.
    const ct = response.headers?.["content-type"];
    if (ct) res.setHeader("Content-Type", ct);
    const ar = response.headers?.["accept-ranges"];
    if (ar) res.setHeader("Accept-Ranges", ar);
    const cr = response.headers?.["content-range"];
    if (cr) res.setHeader("Content-Range", cr);

    if (sessionState?.releaseOnClose && sessionState?.sid) {
      const release = () => {
        releaseStreamSession(req.userId, sessionState.sid);
      };
      req.once("close", release);
      res.once("close", release);
    }

    response.data.pipe(res);
  } catch (err) {
    if (sessionState?.releaseOnClose && sessionState?.sid) {
      releaseStreamSession(req.userId, sessionState.sid);
    }
    console.error("Stream proxy error:", err.message);
    res.status(502).set("Content-Type", "text/plain").send("Erreur stream");
  }
});

app.use((req, res) => {
  res.status(404).json({ error: "Non trouve" });
});

app.listen(PORT, () => {
  console.log(`Proxy IPTV sur le port ${PORT}`);
});
