import crypto from "crypto";

const MAX_STREAMS_PER_USER = Math.max(
  1,
  Number(process.env.MAX_STREAMS_PER_USER || process.env.MAX_DEVICES_PER_USER || 1),
);
const MAX_GLOBAL_STREAMS = Number(process.env.MAX_GLOBAL_STREAMS || 0);
const GLOBAL_LIMIT_ENABLED = Number.isFinite(MAX_GLOBAL_STREAMS) && MAX_GLOBAL_STREAMS > 0;
const STREAM_SESSION_TTL_MS = Math.max(
  15_000,
  Number(process.env.STREAM_SESSION_TTL_SECONDS || 90) * 1000,
);
const STREAM_SESSION_CLEANUP_MS = Math.max(
  5_000,
  Number(process.env.STREAM_SESSION_CLEANUP_SECONDS || 15) * 1000,
);

// userId -> Map(sessionId -> session)
const sessionsByUser = new Map();

function nowMs() {
  return Date.now();
}

function isExpired(session, now = nowMs()) {
  return now - session.lastSeenAt > STREAM_SESSION_TTL_MS;
}

function ensureUserMap(userId) {
  if (!sessionsByUser.has(userId)) {
    sessionsByUser.set(userId, new Map());
  }
  return sessionsByUser.get(userId);
}

function countActiveSessions() {
  let total = 0;
  for (const userMap of sessionsByUser.values()) {
    total += userMap.size;
  }
  return total;
}

function cleanupExpiredSessions() {
  const now = nowMs();
  for (const [userId, userMap] of sessionsByUser.entries()) {
    for (const [sid, session] of userMap.entries()) {
      if (isExpired(session, now)) {
        userMap.delete(sid);
      }
    }
    if (userMap.size === 0) {
      sessionsByUser.delete(userId);
    }
  }
}

function findReusableSession(userMap, streamKey, fingerprint) {
  const now = nowMs();
  for (const session of userMap.values()) {
    if (isExpired(session, now)) continue;
    if (session.streamKey !== streamKey) continue;
    if (session.fingerprint !== fingerprint) continue;
    return session;
  }
  return null;
}

function touch(session) {
  session.lastSeenAt = nowMs();
}

export function tryAcquireStreamSlot({ userId, streamKey, fingerprint = "", sessionIdHint = "" }) {
  cleanupExpiredSessions();

  const userMap = ensureUserMap(String(userId));
  const sidHint = String(sessionIdHint || "").trim();

  if (sidHint) {
    const existing = userMap.get(sidHint);
    if (existing) {
      // Same player can switch stream without consuming an extra slot.
      existing.streamKey = streamKey;
      existing.fingerprint = fingerprint;
      touch(existing);
      return {
        allowed: true,
        sid: existing.sid,
        created: false,
        active: userMap.size,
        max: MAX_STREAMS_PER_USER,
        activeGlobal: countActiveSessions(),
        maxGlobal: MAX_GLOBAL_STREAMS,
      };
    }
  }

  const reusable = findReusableSession(userMap, streamKey, fingerprint);
  if (reusable) {
    touch(reusable);
    return {
      allowed: true,
      sid: reusable.sid,
      created: false,
      active: userMap.size,
      max: MAX_STREAMS_PER_USER,
      activeGlobal: countActiveSessions(),
      maxGlobal: MAX_GLOBAL_STREAMS,
    };
  }

  const activeGlobal = countActiveSessions();
  if (GLOBAL_LIMIT_ENABLED && activeGlobal >= MAX_GLOBAL_STREAMS) {
    return {
      allowed: false,
      reason: "global_limit",
      sid: "",
      created: false,
      active: userMap.size,
      max: MAX_STREAMS_PER_USER,
      activeGlobal,
      maxGlobal: GLOBAL_LIMIT_ENABLED ? MAX_GLOBAL_STREAMS : 0,
    };
  }

  if (userMap.size >= MAX_STREAMS_PER_USER) {
    return {
      allowed: false,
      reason: "user_limit",
      sid: "",
      created: false,
      active: userMap.size,
      max: MAX_STREAMS_PER_USER,
      activeGlobal,
      maxGlobal: GLOBAL_LIMIT_ENABLED ? MAX_GLOBAL_STREAMS : 0,
    };
  }

  const sid = crypto.randomUUID().replace(/-/g, "");
  userMap.set(sid, {
    sid,
    userId: String(userId),
    streamKey,
    fingerprint,
    lastSeenAt: nowMs(),
  });

  return {
    allowed: true,
    sid,
    created: true,
    active: userMap.size,
    max: MAX_STREAMS_PER_USER,
    activeGlobal: countActiveSessions(),
    maxGlobal: GLOBAL_LIMIT_ENABLED ? MAX_GLOBAL_STREAMS : 0,
  };
}

export function touchStreamSession(userId, sid) {
  cleanupExpiredSessions();
  const userMap = sessionsByUser.get(String(userId));
  if (!userMap) return false;
  const session = userMap.get(String(sid || ""));
  if (!session) return false;
  touch(session);
  return true;
}

export function releaseStreamSession(userId, sid) {
  const userMap = sessionsByUser.get(String(userId));
  if (!userMap) return false;
  const deleted = userMap.delete(String(sid || ""));
  if (userMap.size === 0) {
    sessionsByUser.delete(String(userId));
  }
  return deleted;
}

const cleanupTimer = setInterval(cleanupExpiredSessions, STREAM_SESSION_CLEANUP_MS);
cleanupTimer.unref?.();
