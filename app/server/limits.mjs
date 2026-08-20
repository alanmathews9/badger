// Rate limits and spend caps.
//
// The gate stops drive-by traffic; this stops whoever is already through it
// from draining the demo for everyone after.
//
// Three scarce things, failing differently:
//
//   Vertex credits     real money, and silent. Capped by runs per day.
//   Composio quota     100k tool calls/month, hard-capped.
//   GitHub search      30 requests/minute, returning 403 rather than an empty
//                      list, so a burst is worse than it looks.
//
// In-memory, and correct ONLY because the service runs --max-instances 1:
// these counters are per process, so a second instance doubles every limit.
// A restart resets them, which re-opens rather than locking everyone out.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Per-IP sliding windows. Deliberately generous for a human, tight for a script. */
const RULES = {
  search: { limit: 40, windowMs: HOUR },
  ask: { limit: 15, windowMs: HOUR },
  login: { limit: 10, windowMs: 15 * MINUTE }, // brute force
};

/** Global ceilings, so one lenient per-IP budget times many IPs cannot add up. */
const DAILY_ASK_LIMIT = Number(process.env.BADGER_DAILY_ASK_LIMIT) || 250;
const MAX_CONCURRENT_ASKS = Number(process.env.BADGER_MAX_CONCURRENT_ASKS) || 3;

const buckets = new Map(); // "ip:kind" -> number[] of timestamps
let dailyAsks = { day: today(), count: 0 };
let liveAsks = 0;

function today() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The client's address. On Cloud Run the socket address is always the front
 * end, so `x-forwarded-for` is the only real signal.
 *
 * Take the LAST element of `x-forwarded-for`, never the first: Cloud Run
 * appends the real client to whatever the client sent, so the first hop is
 * attacker-chosen and a fresh one per request defeats every per-IP bucket,
 * including the login limiter that protects the passphrase.
 *
 * `cf-connecting-ip` and friends are deliberately not read: no proxy here sets
 * them, so they are raw client values with no honest reading.
 *
 * Behind a different proxy, this function is the one place that changes.
 */
export function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length) {
    const hops = forwarded.split(",");
    const last = hops[hops.length - 1].trim();
    if (last) return last;
  }
  return req.socket?.remoteAddress ?? "unknown";
}

/**
 * Take one token. Returns null when allowed, or a message when not.
 * The message is shown to the user, so it says what to do next.
 */
export function rateLimit(req, kind) {
  const rule = RULES[kind];
  if (!rule) return null;

  const key = `${clientIp(req)}:${kind}`;
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < rule.windowMs);

  if (hits.length >= rule.limit) {
    const retryInMin = Math.ceil((rule.windowMs - (now - hits[0])) / MINUTE);
    buckets.set(key, hits);
    return `Rate limit reached — ${rule.limit} ${kind} requests per ${Math.round(rule.windowMs / MINUTE)} minutes. Try again in about ${retryInMin} minute${retryInMin === 1 ? "" : "s"}.`;
  }

  hits.push(now);
  buckets.set(key, hits);
  return null;
}

/**
 * Claim a slot for one agent run. Returns a release function, or a message.
 *
 * Answers are the expensive path, so they are limited three ways: per IP
 * above, globally per day, and by how many may run at once.
 */
export function claimAskSlot() {
  if (dailyAsks.day !== today()) dailyAsks = { day: today(), count: 0 };

  if (dailyAsks.count >= DAILY_ASK_LIMIT) {
    return {
      error:
        "Badger has used its answer budget for today. Search still works — results are live from GitHub, Gmail and Drive, they just have no written answer above them.",
    };
  }
  if (liveAsks >= MAX_CONCURRENT_ASKS) {
    return { error: "Badger is answering a few questions already. Try again in a few seconds." };
  }

  dailyAsks.count += 1;
  liveAsks += 1;
  let released = false;
  return {
    release() {
      // Guard against a double release leaking slots — the handler can finish
      // both normally and through the client-disconnect path.
      if (released) return;
      released = true;
      liveAsks -= 1;
    },
  };
}

/** For /api/health — how much budget is left, without exposing internals. */
export function budgetStatus() {
  if (dailyAsks.day !== today()) dailyAsks = { day: today(), count: 0 };
  return {
    answersToday: dailyAsks.count,
    answersRemaining: Math.max(0, DAILY_ASK_LIMIT - dailyAsks.count),
    running: liveAsks,
  };
}
