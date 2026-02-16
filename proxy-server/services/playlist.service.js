/**
 * Service de parsing et masquage de la playlist M3U
 * Source : Xtream API (prioritaire si configure), sinon fichier local ou URL M3U.
 * Seul le proxy lit la source; les clients ne voient que les URLs masquees.
 */

import fs from "fs/promises";
import path from "path";
import axios from "axios";
import { encryptUrl } from "./crypto.service.js";
import {
  getXtreamChannels,
  buildMaskedM3uFromXtreamChannels,
  isXtreamEnabled,
} from "./xtream.service.js";

const ORIGINAL_PLAYLIST_URL = process.env.ORIGINAL_PLAYLIST_URL;
const ORIGINAL_PLAYLIST_FILE = process.env.ORIGINAL_PLAYLIST_FILE;
const PROXY_URL = (process.env.PROXY_URL || "").replace(/\/$/, "");

const CACHE_MS = 6 * 60 * 60 * 1000; // 6 heures
let cache = { originalContent: null, channels: null, lastUpdate: null };

/**
 * Recupere le contenu M3U depuis la source.
 * Soit fichier local (ORIGINAL_PLAYLIST_FILE), soit URL (ORIGINAL_PLAYLIST_URL).
 * Seul le proxy fait cette requete - jamais exposee au client.
 */
async function fetchOriginalPlaylist() {
  if (ORIGINAL_PLAYLIST_FILE) {
    const filePath = path.resolve(process.cwd(), ORIGINAL_PLAYLIST_FILE);
    const content = await fs.readFile(filePath, "utf8");
    return content;
  }
  if (ORIGINAL_PLAYLIST_URL) {
    const response = await axios.get(ORIGINAL_PLAYLIST_URL, {
      responseType: "text",
      proxy: false,
      timeout: 30000,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; IPTV-Proxy/1.0)",
      },
    });
    return response.data;
  }
  throw new Error(
    "Configurer ORIGINAL_PLAYLIST_FILE (fichier local, ex: xtream_playlist.m3u) ou ORIGINAL_PLAYLIST_URL. Seul le proxy se connecte a cette source."
  );
}

/**
 * Parse le M3U et remplace chaque URL de stream par une URL proxy (token chiffre)
 * @param {string} content - Contenu M3U original
 * @param {string} [authToken] - JWT a ajouter en query pour que VLC/lecteurs puissent s'authentifier
 */
function maskPlaylist(content, authToken = "") {
  const lines = content.split("\n");
  const result = [];
  const tokenParam = authToken ? `?token=${encodeURIComponent(authToken)}` : "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    result.push(line);

    // Ligne suivant #EXTINF : c'est l'URL du stream
    if (line.startsWith("#EXTINF")) {
      const nextLine = lines[i + 1];
      if (
        nextLine &&
        (nextLine.startsWith("http://") || nextLine.startsWith("https://"))
      ) {
        const encrypted = encryptUrl(nextLine.trim());
        result.push(`${PROXY_URL}/stream/${encrypted}${tokenParam}`);
        i++; // skip la ligne URL qu'on a remplacee
      }
    }
  }

  return result.join("\n");
}

/**
 * Retourne la playlist masquee (cache 6h)
 * Si Xtream est configure, utilise l'API Xtream. Sinon M3U fichier/URL.
 */
export async function getMaskedPlaylist(authToken = "") {
  if (isXtreamEnabled()) {
    const channels = await getXtreamChannels(authToken);
    return channels ? buildMaskedM3uFromXtreamChannels(channels) : "";
  }
  const now = Date.now();
  if (!cache.originalContent || !cache.lastUpdate || now - cache.lastUpdate > CACHE_MS) {
    cache.originalContent = await fetchOriginalPlaylist();
    cache.channels = parseChannelsFromM3u(cache.originalContent);
    cache.lastUpdate = now;
  }
  return maskPlaylist(cache.originalContent, authToken);
}

/**
 * Extrait la liste des chaines (meta) a partir du M3U
 * Format: #EXTINF:-1 tvg-id="..." tvg-logo="..." group-title="..." ,Nom
 *         http://...
 */
export function parseChannelsFromM3u(content) {
  const channels = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith("#EXTINF")) continue;

    const urlLine = lines[i + 1];
    if (!urlLine || (!urlLine.startsWith("http://") && !urlLine.startsWith("https://"))) {
      continue;
    }

    const originalUrl = urlLine.trim();
    const nameMatch = line.match(/,(.+)$/);
    const tvgIdMatch = line.match(/tvg-id="([^"]*)"/);
    const tvgLogoMatch = line.match(/tvg-logo="([^"]*)"/);
    const groupMatch = line.match(/group-title="([^"]*)"/);

    channels.push({
      id: String(channels.length),
      name: (nameMatch && nameMatch[1].trim()) || "Chaine",
      tvgId: (tvgIdMatch && tvgIdMatch[1]) || "",
      tvgLogo: (tvgLogoMatch && tvgLogoMatch[1]) || "",
      groupTitle: (groupMatch && groupMatch[1]) || "General",
      // Server-only (never returned to clients)
      _originalUrl: originalUrl,
    });
  }

  return channels;
}

function normalizeOpts(opts = {}) {
  const offset = Math.max(parseInt(opts.offset ?? "0", 10) || 0, 0);
  const limitRaw = parseInt(opts.limit ?? "0", 10) || 0;
  const limit = Math.min(Math.max(limitRaw || 1000, 1), 5000);
  const q = (opts.q || "").toString().trim().toLowerCase();
  const group = (opts.group || "").toString().trim();
  return { offset, limit, q, group };
}

/**
 * Liste des chaines (pagine + streamUrl masquee prete pour HLS)
 */
export async function getChannelsPage(authToken = "", opts = {}) {
  const { offset, limit, q, group } = normalizeOpts(opts);

  if (isXtreamEnabled()) {
    const channels = await getXtreamChannels(authToken);
    const list = Array.isArray(channels) ? channels : [];
    const filtered = list.filter((c) => {
      if (group && c.groupTitle !== group) return false;
      if (!q) return true;
      const name = (c.name || "").toLowerCase();
      const grp = (c.groupTitle || "").toLowerCase();
      return name.includes(q) || grp.includes(q);
    });
    const page = filtered.slice(offset, offset + limit);
    return {
      total: filtered.length,
      offset,
      limit,
      channels: page.map(({ _streamPath, ...ch }) => ch),
    };
  }

  if (!cache.channels) {
    await getMaskedPlaylist(authToken);
  }

  const list = cache.channels || [];
  const filtered = list.filter((c) => {
    if (group && c.groupTitle !== group) return false;
    if (!q) return true;
    const name = (c.name || "").toLowerCase();
    const grp = (c.groupTitle || "").toLowerCase();
    return name.includes(q) || grp.includes(q);
  });

  const tokenParam = authToken ? `?token=${encodeURIComponent(authToken)}` : "";
  const page = filtered.slice(offset, offset + limit).map((c) => {
    const encrypted = c._originalUrl ? encryptUrl(c._originalUrl) : "";
    return {
      id: c.id,
      name: c.name,
      tvgId: c.tvgId,
      tvgLogo: c.tvgLogo,
      groupTitle: c.groupTitle,
      streamUrl: encrypted ? `${PROXY_URL}/stream/${encrypted}${tokenParam}` : "",
    };
  });

  return { total: filtered.length, offset, limit, channels: page };
}

// Backward-compat: keep old name but return first page
export async function getChannelsList(authToken = "") {
  const page = await getChannelsPage(authToken, {});
  return page.channels || [];
}

export async function getChannelGroups(authToken = "") {
  // For categories we don't need streamUrl; use cached channels.
  if (isXtreamEnabled()) {
    const channels = await getXtreamChannels(authToken);
    const list = Array.isArray(channels) ? channels : [];
    const counts = new Map();
    for (const ch of list) {
      const g = ch.groupTitle || "Live";
      counts.set(g, (counts.get(g) || 0) + 1);
    }
    return [...counts.entries()]
      .map(([title, count]) => ({ title, count }))
      .sort((a, b) => a.title.localeCompare(b.title));
  }

  if (!cache.channels) {
    await getMaskedPlaylist(authToken);
  }

  const list = cache.channels || [];
  const counts = new Map();
  for (const ch of list) {
    const g = ch.groupTitle || "General";
    counts.set(g, (counts.get(g) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([title, count]) => ({ title, count }))
    .sort((a, b) => a.title.localeCompare(b.title));
}
