// Which sources Badger can reach, and whose account it reaches them as.
//
// Badger never touches a source credential. Composio holds the token; we only
// ever learn whether a connection exists and which account is behind it.
//
// There is no per-visitor connect, and it is not coming back cheaply.
// Composio cannot target a second connection on this project:
// `connectedAccountId` in a tool's arguments is silently dropped, and
// execute()'s `{ account }` option answers 400 "Multi-account selection is not
// enabled". With two connections attached Composio picks the newest.
//
// Restoring it means `connectedAccounts.link`, a callback route and a repo
// picker together; half of it is worse than none.
import { Composio } from "@composio/core";
import { REPO_SLUG, USER_ID } from "../../tools/scripts/_github.mjs";

/**
 * Whether a visitor sees the seeded demo corpus.
 *
 * On by default: an evaluator opening the link should be able to ask a
 * question immediately. BADGER_DEMO_FALLBACK=0 shows an empty app, which is
 * only useful for proving the gate.
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
 * At most one per toolkit. If Composio reports two the newest wins, because
 * that is what Composio does when resolving a tool call — anything else puts
 * the UI out of step with where calls go.
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
 * "Connected" alone does not tell you whether you are searching the right
 * mailbox.
 *
 * One call per toolkit, cached for the process: /api/sources is requested on
 * every screen change and none of these answers moves. Composio does not carry
 * this in its connected-account metadata, so each provider must be asked.
 *
 * These three tools are server-side lookups and appear in no agent allowlist:
 * the agent has no business knowing whose mailbox it reads, only what is in
 * it.
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
 * `mode` is what the UI reports: "demo" for the seeded corpus, "none" when
 * the fallback is off. A results page that hides whose data it is is a trap.
 */
export async function resolveContext() {
  if (DEMO_FALLBACK) return { userId: USER_ID, repo: REPO_SLUG, mode: "demo" };
  return { userId: null, repo: null, mode: "none" };
}
