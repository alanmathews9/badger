// Which sources Badger can reach, and whose account it reaches them as.
//
// Badger never touches a source credential. Composio holds the token; we only
// ever learn whether a connection exists and which account is behind it.
//
// ── This module used to do much more, and none of it was reachable ────────
//
// It once modelled per-visitor OAuth: the signed cookie's opaque id was the
// Composio end-user id, so "connect GitHub" meant *your* GitHub, with a repo
// picker beside it. Two things killed it.
//
// First, Composio cannot target a second connection on this project. Measured
// 2026-08-18: `connectedAccountId` in a tool's arguments is silently dropped,
// and execute()'s `{ account }` option answers 400 "Multi-account selection is
// not enabled". With two connections attached Composio picks the newest and
// nothing can override it.
//
// Second, the UI that drove it was deleted when the seeded corpus became the
// product. That left ~180 lines of connect, disconnect, list-repositories and
// choose-repository with no caller — untested surface sitting behind the gate.
//
// So this is now what it always actually did: read the seeded demo's
// connections and report them honestly. Restoring per-user connect means
// restoring `connectedAccounts.link`, a callback route and a repo picker
// together; half of it is worse than none, which is how it got here.
import { Composio } from "@composio/core";
import { DEMO_REPO, DEMO_USER_ID } from "../../tools/scripts/_github.mjs";

/**
 * Whether a visitor sees the seeded demo corpus.
 *
 * On by default. The corpus *is* the demo: an evaluator opening the link
 * should be able to ask a question immediately. BADGER_DEMO_FALLBACK=0 shows
 * an empty app instead, which is only useful for proving the gate.
 */
const DEMO_FALLBACK = process.env.BADGER_DEMO_FALLBACK !== "0";

/** The sources Badger can search, as Composio names them. */
export const TOOLKITS = /** @type {const} */ (["github", "gmail", "googledrive"]);

/** Display names, so the server does not spell these out in three places. */
export const TOOLKIT_LABELS = { github: "GitHub", gmail: "Gmail", googledrive: "Drive" };

let composio = null;
function client() {
  composio ??= new Composio();
  return composio;
}

/** Account identity per `${userId}:${toolkit}`, so the UI can say whose it is. */
const accountCache = new Map();

/**
 * Every active connection this user holds, keyed by toolkit.
 *
 * At most one per toolkit. If Composio somehow reports two, the newest wins
 * here, because that is what Composio itself does when resolving a tool call.
 * Reporting anything else would put the UI out of step with where calls go.
 *
 * @returns {Promise<Record<string, {id: string, status: string, createdAt: string} | null>>}
 */
export async function listConnections(userId) {
  const empty = Object.fromEntries(TOOLKITS.map((t) => [t, null]));
  try {
    const res = await client().connectedAccounts.list({ userIds: [userId] });
    const found = { ...empty };

    for (const a of res?.items ?? []) {
      const slug = (a.toolkit?.slug ?? a.toolkitSlug ?? "").toLowerCase();
      if (!TOOLKITS.includes(slug) || a.isDisabled) continue;
      if (String(a.status ?? "").toUpperCase() !== "ACTIVE") continue;

      const createdAt = (a.createdAt ?? a.created_at ?? "").slice(0, 10);
      const current = found[slug];
      if (!current || createdAt >= current.createdAt) {
        found[slug] = { id: a.id, status: "ACTIVE", createdAt };
      }
    }
    return found;
  } catch (err) {
    console.error("[connections] list failed", err?.message);
    return empty;
  }
}

/**
 * Whose account each source is connected as — a GitHub login, or the Google
 * address behind Gmail and Drive.
 *
 * This is the question the Tools page is actually asking. "Connected" alone
 * does not tell you whether you are searching the right mailbox.
 *
 * One call per toolkit, cached for the process, because /api/sources is
 * requested on every screen change and none of these answers moves. Composio
 * carries none of this in its connected-account metadata — measured — so it
 * has to be asked of each provider. These three tools are server-side identity
 * lookups and appear in no agent allowlist: the agent has no business knowing
 * whose mailbox it is reading, only what is in it.
 */
const IDENTITY = {
  github: {
    tool: "GITHUB_GET_THE_AUTHENTICATED_USER",
    args: {},
    read: (d) => d?.login ?? d?.details?.login ?? null,
  },
  gmail: {
    tool: "GMAIL_GET_PROFILE",
    args: { user_id: "me" },
    read: (d) => d?.emailAddress ?? null,
  },
  googledrive: {
    tool: "GOOGLEDRIVE_GET_ABOUT",
    args: { fields: "user" },
    read: (d) => d?.user?.emailAddress ?? null,
  },
};

export async function accountFor(userId, toolkit) {
  const spec = IDENTITY[toolkit];
  if (!spec) return null;

  const key = `${userId}:${toolkit}`;
  if (accountCache.has(key)) return accountCache.get(key);

  try {
    const session = await client().create(userId, {
      toolkits: [toolkit],
      tools: { [toolkit]: { enable: [spec.tool] } },
    });
    const res = await session.execute(spec.tool, spec.args);
    const value = spec.read(res?.data);
    if (value) accountCache.set(key, value);
    return value;
  } catch (err) {
    console.error(`[connections] ${toolkit} identity lookup failed`, err?.message);
    return null;
  }
}

/**
 * Resolve the identity a request's searches run as.
 *
 * `mode` is the honest part, and the UI reports it: "demo" when the seeded
 * Arkind corpus is what is on screen, "none" when the fallback is switched off
 * and there is nothing to search. A results page that does not say whose data
 * it is showing is a trap.
 */
export async function resolveContext() {
  if (DEMO_FALLBACK) return { userId: DEMO_USER_ID, repo: DEMO_REPO, mode: "demo" };
  return { userId: null, repo: null, mode: "none" };
}
