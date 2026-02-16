import { normalizeStreamUrl, stripVolatileParams, withCurrentToken } from "./stream-url.service";
import { getUser } from "./auth";
const HISTORY_KEY_BASE = "prismplay_watch_history_v1";
const MAX_ITEMS = 30;

function normalizeText(v) {
  return String(v || "").trim().toLowerCase();
}

function dedupKey(entry) {
  const id = String(entry?.id || "").trim();
  if (id) return `id:${id}`;

  const name = normalizeText(entry?.name);
  if (name) return `name:${name}`;

  const normUrl = normalizeStreamUrl(entry?.streamUrl);
  if (normUrl) return `url:${normUrl}`;

  return "";
}

function readRaw() {
  try {
    const raw = localStorage.getItem(getHistoryKey());
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRaw(items) {
  localStorage.setItem(getHistoryKey(), JSON.stringify(items));
}

function getHistoryKey() {
  const userId = String(getUser()?.id || "").trim();
  return `${HISTORY_KEY_BASE}:${userId || "anonymous"}`;
}

export function getWatchHistory() {
  const list = readRaw();
  const seen = new Set();
  const out = [];

  for (const item of list) {
    const normalizedItem = {
      ...item,
      streamUrl: stripVolatileParams(item?.streamUrl),
    };
    const key = dedupKey(normalizedItem);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      ...normalizedItem,
      streamUrl: withCurrentToken(normalizedItem.streamUrl),
    });
  }
  return out;
}

export function clearWatchHistory() {
  writeRaw([]);
}

export function pushWatchHistory(entry) {
  if (!entry?.streamUrl) return;
  const now = Date.now();
  const stableStreamUrl = stripVolatileParams(entry.streamUrl);
  const item = {
    id: String(entry.id || stableStreamUrl),
    name: String(entry.name || "Chaine"),
    groupTitle: String(entry.groupTitle || ""),
    tvgLogo: String(entry.tvgLogo || ""),
    streamUrl: stableStreamUrl,
    format: String(entry.format || ""),
    watchedAt: now,
  };
  const key = dedupKey(item);

  const list = readRaw();
  const filtered = list.filter((x) => {
    const sameUrl = normalizeStreamUrl(x?.streamUrl) === normalizeStreamUrl(item.streamUrl);
    if (sameUrl) return false;
    return dedupKey({
      ...x,
      streamUrl: stripVolatileParams(x?.streamUrl),
    }) !== key;
  });
  filtered.unshift(item);
  writeRaw(filtered.slice(0, MAX_ITEMS));
}
