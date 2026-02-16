/**
 * Service Xtream Codes API
 * Live + Films (VOD) via player_api.php.
 */

import axios from "axios";
import { encryptUrl } from "./crypto.service.js";

const XTREAM_BASE = process.env.XTREAM_BASE_URL || ""; // ex: http://server:8080
const XTREAM_USER = process.env.XTREAM_USERNAME || "";
const XTREAM_PASS = process.env.XTREAM_PASSWORD || "";
const PROXY_URL = (process.env.PROXY_URL || "").replace(/\/$/, "");
const XTREAM_LIVE_FORMAT = (process.env.XTREAM_LIVE_FORMAT || "m3u8").toLowerCase(); // m3u8 | ts
const XTREAM_INCLUDE_VOD = (process.env.XTREAM_INCLUDE_VOD || "true").toLowerCase() !== "false";

const CACHE_MS = 6 * 60 * 60 * 1000; // 6h
let cache = { channels: null, lastUpdate: null };

function isXtreamConfigured() {
  return !!(XTREAM_BASE && XTREAM_USER && XTREAM_PASS);
}

function xtreamUrl() {
  const base = XTREAM_BASE.replace(/\/$/, "");
  return `${base}/player_api.php`;
}

function buildLiveUrl(streamId) {
  const base = XTREAM_BASE.replace(/\/$/, "");
  const ext = XTREAM_LIVE_FORMAT === "ts" ? "ts" : "m3u8";
  return `${base}/live/${XTREAM_USER}/${XTREAM_PASS}/${streamId}.${ext}`;
}

function sanitizeVodExtension(ext = "mp4") {
  const cleaned = String(ext || "mp4")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return cleaned || "mp4";
}

function buildVodUrl(streamId, containerExt = "mp4") {
  const base = XTREAM_BASE.replace(/\/$/, "");
  const ext = sanitizeVodExtension(containerExt);
  return `${base}/movie/${XTREAM_USER}/${XTREAM_PASS}/${streamId}.${ext}`;
}

async function fetchXtream(extraParams = {}) {
  const url = xtreamUrl();
  const params = { username: XTREAM_USER, password: XTREAM_PASS, ...extraParams };
  const res = await axios.get(url, {
    params,
    proxy: false,
    timeout: 15000,
    headers: { "User-Agent": "Mozilla/5.0 (compatible; IPTV-Proxy/1.0)" },
    validateStatus: () => true,
  });
  if (res.status < 200 || res.status >= 300) return null;
  return res.data;
}

function arrayFromXtream(data, candidateKeys = []) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  for (const key of candidateKeys) {
    const v = data[key];
    if (Array.isArray(v)) return v;
  }
  const values = Object.values(data || {});
  return Array.isArray(values) ? values : [];
}

async function fetchLiveCategoriesMap() {
  const data = await fetchXtream({ action: "get_live_categories" });
  const list = arrayFromXtream(data, ["categories", "live_categories"]);
  const map = new Map();
  for (const c of list) {
    const id = String(c?.category_id ?? c?.id ?? "").trim();
    const name = String(c?.category_name ?? c?.name ?? "").trim();
    if (id && name) map.set(id, name);
  }
  return map;
}

async function fetchVodCategoriesMap() {
  const data = await fetchXtream({ action: "get_vod_categories" });
  const list = arrayFromXtream(data, ["categories", "vod_categories"]);
  const map = new Map();
  for (const c of list) {
    const id = String(c?.category_id ?? c?.id ?? "").trim();
    const name = String(c?.category_name ?? c?.name ?? "").trim();
    if (id && name) map.set(id, name);
  }
  return map;
}

async function fetchLiveStreams() {
  const data = await fetchXtream({ action: "get_live_streams" });
  return arrayFromXtream(data, ["live_streams", "streams"]);
}

async function fetchVodStreams() {
  const data = await fetchXtream({ action: "get_vod_streams" });
  return arrayFromXtream(data, ["vod_streams", "movie_streams", "streams"]);
}

export async function getXtreamChannels(authToken = "") {
  if (!isXtreamConfigured()) return null;

  const now = Date.now();
  if (cache.channels && cache.lastUpdate && now - cache.lastUpdate < CACHE_MS) {
    return applyTokenToChannels(cache.channels, authToken);
  }

  const jobs = [fetchLiveStreams(), fetchLiveCategoriesMap()];
  if (XTREAM_INCLUDE_VOD) {
    jobs.push(fetchVodStreams(), fetchVodCategoriesMap());
  }

  const results = await Promise.all(jobs);
  const liveStreams = results[0] || [];
  const liveCats = results[1] || new Map();
  const vodStreams = XTREAM_INCLUDE_VOD ? (results[2] || []) : [];
  const vodCats = XTREAM_INCLUDE_VOD ? (results[3] || new Map()) : new Map();

  const liveChannels = liveStreams.map((s) => {
    const streamId = s?.num_id ?? s?.stream_id ?? s?.id ?? 0;
    const originalUrl = buildLiveUrl(streamId);
    const encrypted = encryptUrl(originalUrl);
    const categoryId = String(s?.category_id ?? s?.cid ?? "").trim();
    const groupTitle = (categoryId && liveCats.get(categoryId)) || s?.category_name || "Live";

    return {
      id: `live-${streamId}`,
      type: "live",
      name: s?.name || "Chaine",
      tvgId: s?.epg_channel_id || String(streamId),
      tvgLogo: s?.stream_icon || s?.logo || "",
      groupTitle,
      format: XTREAM_LIVE_FORMAT === "ts" ? "ts" : "hls",
      _streamPath: `${PROXY_URL}/stream/${encrypted}`,
    };
  });

  const vodChannels = vodStreams.map((s) => {
    const streamId = s?.stream_id ?? s?.num_id ?? s?.id ?? 0;
    const originalUrl = buildVodUrl(streamId, s?.container_extension || "mp4");
    const encrypted = encryptUrl(originalUrl);
    const categoryId = String(s?.category_id ?? s?.cid ?? "").trim();
    const categoryName = (categoryId && vodCats.get(categoryId)) || s?.category_name || "Films";

    return {
      id: `movie-${streamId}`,
      type: "movie",
      name: s?.name || "Film",
      tvgId: `movie-${streamId}`,
      tvgLogo: s?.stream_icon || s?.cover || s?.logo || "",
      groupTitle: `Films / ${categoryName}`,
      format: "direct",
      _streamPath: `${PROXY_URL}/stream/${encrypted}`,
    };
  });

  cache.channels = [...liveChannels, ...vodChannels];
  cache.lastUpdate = now;
  return applyTokenToChannels(cache.channels, authToken);
}

function applyTokenToChannels(channels, authToken) {
  const tokenParam = authToken ? `?token=${encodeURIComponent(authToken)}` : "";
  return channels.map((ch) => ({
    ...ch,
    streamUrl: (ch._streamPath || ch.streamUrl || "") + tokenParam,
  }));
}

export function buildMaskedM3uFromXtreamChannels(channels) {
  const lines = ["#EXTM3U"];
  channels.forEach((ch) => {
    lines.push(
      `#EXTINF:-1 tvg-id="${ch.tvgId}" tvg-logo="${ch.tvgLogo || ""}" group-title="${ch.groupTitle || "Live"}",${ch.name}`,
    );
    lines.push(ch.streamUrl || "");
  });
  return lines.join("\n");
}

export function isXtreamEnabled() {
  return isXtreamConfigured();
}

export async function getXtreamDebugSummary() {
  if (!isXtreamConfigured()) {
    return {
      configured: false,
      includeVod: XTREAM_INCLUDE_VOD,
      error: "Xtream non configure",
    };
  }

  const [accountInfo, liveStreams, liveCats, vodStreams, vodCats] = await Promise.all([
    fetchXtream({}),
    fetchLiveStreams(),
    fetchLiveCategoriesMap(),
    XTREAM_INCLUDE_VOD ? fetchVodStreams() : Promise.resolve([]),
    XTREAM_INCLUDE_VOD ? fetchVodCategoriesMap() : Promise.resolve(new Map()),
  ]);

  const userInfo = accountInfo?.user_info || null;
  const serverInfo = accountInfo?.server_info || null;

  return {
    configured: true,
    includeVod: XTREAM_INCLUDE_VOD,
    baseUrl: XTREAM_BASE,
    username: XTREAM_USER,
    live: {
      streams: Array.isArray(liveStreams) ? liveStreams.length : 0,
      categories: liveCats instanceof Map ? liveCats.size : 0,
    },
    vod: {
      streams: Array.isArray(vodStreams) ? vodStreams.length : 0,
      categories: vodCats instanceof Map ? vodCats.size : 0,
    },
    account: {
      auth: userInfo?.auth ?? null,
      status: userInfo?.status ?? null,
      maxConnections: userInfo?.max_connections ?? null,
      activeCons: userInfo?.active_cons ?? null,
      expDate: userInfo?.exp_date ?? null,
    },
    server: {
      url: serverInfo?.url ?? null,
      port: serverInfo?.port ?? null,
      httpsPort: serverInfo?.https_port ?? null,
      serverProtocol: serverInfo?.server_protocol ?? null,
    },
  };
}
