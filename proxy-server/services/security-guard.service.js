const FAIL_WINDOW_MS = Math.max(
  30_000,
  Number(process.env.SECURITY_FAIL_WINDOW_SECONDS || 300) * 1000,
);
const BLOCK_DURATION_MS = Math.max(
  30_000,
  Number(process.env.SECURITY_BLOCK_SECONDS || 900) * 1000,
);
const MAX_FAILS = Math.max(3, Number(process.env.SECURITY_MAX_FAILS || 12));
const CLEANUP_MS = Math.max(15_000, Number(process.env.SECURITY_CLEANUP_SECONDS || 60) * 1000);

// ip -> { fails: number[], blockedUntil: number }
const ipState = new Map();

function nowMs() {
  return Date.now();
}

function normalizeIp(ip) {
  return String(ip || "").trim() || "unknown";
}

function getState(ip) {
  const key = normalizeIp(ip);
  if (!ipState.has(key)) {
    ipState.set(key, { fails: [], blockedUntil: 0 });
  }
  return ipState.get(key);
}

function pruneState(state, now = nowMs()) {
  const minTs = now - FAIL_WINDOW_MS;
  state.fails = state.fails.filter((ts) => ts >= minTs);
  if (state.blockedUntil && state.blockedUntil <= now) {
    state.blockedUntil = 0;
  }
}

export function registerFailedAttempt(ip) {
  const state = getState(ip);
  const now = nowMs();
  pruneState(state, now);
  state.fails.push(now);

  if (state.fails.length >= MAX_FAILS) {
    state.blockedUntil = now + BLOCK_DURATION_MS;
    state.fails = [];
  }
}

export function registerSuccessfulAuth(ip) {
  const state = getState(ip);
  pruneState(state);
  state.fails = [];
}

export function isIpBlocked(ip) {
  const state = getState(ip);
  pruneState(state);
  return state.blockedUntil > nowMs();
}

function cleanup() {
  const now = nowMs();
  for (const [ip, state] of ipState.entries()) {
    pruneState(state, now);
    if (!state.blockedUntil && state.fails.length === 0) {
      ipState.delete(ip);
    }
  }
}

const timer = setInterval(cleanup, CLEANUP_MS);
timer.unref?.();
