// Rate limits and spend caps.
//
// The gate stops drive-by traffic. This stops the person who is already
// through it — a stuck loop, an enthusiastic evaluator, a shared passphrase —
// from draining the demo for everyone who comes after.
//
// Three separate things are scarce, and they fail differently:
//
//   Vertex credits     real money, and silent. Capped by run count per day.
//   Composio quota     100k tool calls/month, hard-capped.
//   GitHub search      30 requests/minute, and it returns 403 rather than an
//                      empty list, which is why a search burst is worse than
//                      it looks.
//
// In-memory on purpose, and correct only because the service runs with
// --max-instances 1: these counters are per process, so a second instance
// would silently double every limit. A restart resets them,
// which is the right failure direction for a demo — it re-opens rather than
// locking everyone out.

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
 * Two things this used to get wrong, both of which handed an attacker the
 * login limiter and with it the passphrase.
 *
 * It read `cf-connecting-ip` first. Nothing in this deployment sets that
 * header — there is no Cloudflare in front of Cloud Run — so it was a raw
 * client value taken in preference to everything else, and a fresh one per
 * request defeated every per-IP bucket including the 10-per-15-minutes on
 * login. The header is gone rather than reordered: a header no proxy here
 * sets has no honest reading.
 *
 * And it took the FIRST element of `x-forwarded-for`. Cloud Run appends the
 * real client to whatever the client sent, so the trustworthy value is the
 * LAST one; the first is whatever the caller chose to prepend.
 *
 * If this server were ever put behind a different proxy, or exposed
 * directly, this function is the one place that has to change.
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
