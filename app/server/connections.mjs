// Per-user source connections, through Composio.
//
// This is what makes Badger multi-tenant rather than a demo with one hardcoded
// account. Each browser gets an opaque id in its signed session cookie
// (auth.mjs); that id is the Composio end-user id, so "connect GitHub" means
// *your* GitHub, and one visitor can never see another's.
//
// Badger never touches a source credential. Composio issues the Connect Link,
// the provider redirects back to Composio, and Composio holds the token. We
// only ever learn whether a connection exists.
//
// ── One connection per source, and why ────────────────────────────────────
//
// This module used to model several accounts per source, with a picker in the
// UI. That was wrong, and wrong in the worst way — it looked like it worked.
// Measured 2026-08-18:
//
//   * `connectedAccountId` passed inside a tool's arguments is silently
//     dropped. Composio forwards it to the provider as an unknown field.
//   * The real parameter is execute()'s third argument, `{ account }`, and on
//     this project it answers 400: "Multi-account selection is not enabled."
//
// So with two connections attached, Composio picks one and nothing can
// override it. It picked the newest: every call resolved to the wrong account,
// and `GET_THE_AUTHENTICATED_USER` returned that account's login for *both*
// ids, so the UI cheerfully labelled two rows with one name.
//
// What is left is what the platform actually supports: one connection per
// source, disconnect to switch. Less of a feature, and true.
import { Composio } from "@composio/core";
import { DEMO_REPO, DEMO_USER_ID } from "../../tools/scripts/_github.mjs";

/**
 * Whether a visitor who has connected nothing sees the seeded demo corpus.
 *
 * On by default. The corpus *is* the demo: an evaluator opening the link
 * should be able to ask a question immediately rather than authorise four
 * OAuth flows first. Anyone who connects their own account uses theirs instead.
 * BADGER_DEMO_FALLBACK=0 shows an empty app instead.
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

/** Which repository a given user's GitHub searches are scoped to, in memory. */
const repoChoice = new Map();

/** GitHub login per user, so the UI can say whose account is connected. */
const loginCache = new Map();

/**
 * Every active connection this user holds, keyed by toolkit.
 *
 * At most one per toolkit. If Composio somehow reports two — which it will
 * accept via `allowMultiple` — the newest wins here, because that is what
 * Composio itself does when resolving a tool call. Reporting anything else
 * would put the UI out of step with where the calls actually go.
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

/** The user's connection for one toolkit, or null. */
export async function connectionFor(userId, toolkit) {
  return (await listConnections(userId))[toolkit] ?? null;
}

/**
 * Whose account each source is connected as — a GitHub login, or the Google
 * address behind Gmail and Drive.
 *
 * This is the question the Tools page is actually asking. "Connected" alone
 * does not tell you whether you are searching the right mailbox, and with more
 * than one repository reachable, a repository slug does not tell you which
 * account can reach it.
 *
 * One call per toolkit, cached for the process, because /api/sources is
 * requested on every screen change and none of these answers moves. The cache
 * is cleared on disconnect, which is the only way the answer changes without a
 * restart.
 *
 * Composio carries none of this in its connected-account metadata — measured,
 * so it has to be asked of each provider. These three tools are server-side
 * identity lookups and appear in no agent allowlist: the agent has no business
 * knowing whose mailbox it is reading, only what is in it.
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
  if (loginCache.has(key)) return loginCache.get(key);
  if (!(await connectionFor(userId, toolkit))) return null;

  try {
    const session = await client().create(userId, {
      toolkits: [toolkit],
      tools: { [toolkit]: { enable: [spec.tool] } },
    });
    const res = await session.execute(spec.tool, spec.args);
    const value = spec.read(res?.data);
    if (value) loginCache.set(key, value);
    return value;
  } catch (err) {
    console.error(`[connections] ${toolkit} identity lookup failed`, err?.message);
    return null;
  }
}

/** Which GitHub account this user is connected as. */
export const githubLogin = (userId) => accountFor(userId, "github");

/**
 * Resolve the identity a request's searches should run as.
 *
 * Returns the visitor's own connection when they have one, otherwise the
 * shared demo — and says which, because the UI has to be honest about whose
 * data is on screen.
 */
export async function resolveContext(userId) {
  const own = await connectionFor(userId, "github");
  if (own) {
    return {
      userId,
      repo: repoChoice.get(userId) ?? null,
      mode: "own",
      label: (await githubLogin(userId)) ?? "your account",
    };
  }
  if (DEMO_FALLBACK) {
    return { userId: DEMO_USER_ID, repo: DEMO_REPO, mode: "demo", label: "demo" };
  }
  return { userId, repo: null, mode: "none", label: null };
}

/**
 * The auth config for a toolkit, looked up once and cached.
 *
 * The SDK's filter key is `toolkit`, not `toolkitSlug` — the unknown key is
 * dropped and the call returns every config in the project, so the slug is
 * checked again here. With four auth configs in this project, trusting the
 * filter would hand the GitHub button a Google consent screen.
 *
 * `toolkits.authorize()` is the obvious call and it is wrong: for
 * Composio-managed OAuth it hits a deprecated endpoint whose own error names
 * `connected_accounts/link` as the replacement, which is what `link()` calls.
 */
const authConfigIds = new Map();
async function authConfigFor(toolkit) {
  if (authConfigIds.has(toolkit)) return authConfigIds.get(toolkit);

  const configured = process.env[`BADGER_${toolkit.toUpperCase()}_AUTH_CONFIG`];
  if (configured) {
    authConfigIds.set(toolkit, configured);
    return configured;
  }

  const list = await client().authConfigs.list({ toolkit });
  const found = (list?.items ?? []).find((i) => i.toolkit?.slug === toolkit);
  if (!found?.id) throw new Error(`no ${toolkit} auth config exists in this Composio project`);
  authConfigIds.set(toolkit, found.id);
  return found.id;
}

/**
 * Begin an OAuth connection for one source. Returns the Connect Link.
 *
 * Refuses when a connection already exists, rather than passing
 * `allowMultiple`. A second connection cannot be targeted and would silently
 * take over every tool call — the exact failure this module was rewritten to
 * remove. Disconnect first.
 *
 * `callbackUrl` is where Composio returns the visitor. Nothing is read from
 * that redirect: the app re-reads real connection state instead of trusting a
 * query parameter it did not sign.
 */
export async function beginConnect(userId, toolkit, callbackUrl) {
  if (!TOOLKITS.includes(toolkit)) throw new Error("unknown source");
  if (await connectionFor(userId, toolkit)) {
    throw new Error(`${TOOLKIT_LABELS[toolkit]} is already connected — disconnect it first`);
  }

  const request = await client().connectedAccounts.link(userId, await authConfigFor(toolkit), {
    callbackUrl,
  });
  const url = request?.redirectUrl ?? request?.redirect_url;
  if (!url) throw new Error("Composio did not return a Connect Link");
  return { redirectUrl: url };
}

/**
 * Disconnect one source.
 *
 * The lookup is the security boundary, not a nicety: the caller names a
 * *toolkit*, never an account id, so there is no id a visitor could post to
 * reach someone else's connection. Only this user's own connections are ever
 * passed to Composio's delete.
 */
export async function disconnectSource(userId, toolkit) {
  if (!TOOLKITS.includes(toolkit)) throw new Error("unknown source");
  const connection = await connectionFor(userId, toolkit);
  if (!connection) return false;

  await client().connectedAccounts.delete(connection.id);
  if (toolkit === "github") {
    // Keyed by `${userId}:${toolkit}` since identity is looked up per source.
    for (const key of loginCache.keys()) {
      if (key.startsWith(`${userId}:`)) loginCache.delete(key);
    }
    repoChoice.delete(userId);
  }
  return true;
}

/**
 * Repositories the connected GitHub account can see.
 *
 * A connection alone is not enough to search: we have to know which
 * repository. This is the only place the server reads outside the agent's
 * tools, and it is still read-only.
 */
export async function listRepositories(userId) {
  const session = await client().create(userId, {
    toolkits: ["github"],
    tools: { github: { enable: ["GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER"] } },
  });
  const res = await session.execute("GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER", {
    per_page: 100,
    sort: "updated",
  });
  if (res?.error != null) throw new Error(String(res.error).slice(0, 200));

  const data = res.data ?? {};
  const list = Array.isArray(data) ? data : (Object.values(data).find(Array.isArray) ?? []);
  return list
    .map((r) => ({
      slug: r.full_name,
      private: Boolean(r.private),
      updatedAt: (r.updated_at ?? "").slice(0, 10),
    }))
    .filter((r) => r.slug);
}

/** Which repository this user searches. */
export async function chooseRepo(userId, slug) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(String(slug ?? ""))) throw new Error("not a repository slug");
  if (!(await connectionFor(userId, "github"))) throw new Error("connect a GitHub account first");
  repoChoice.set(userId, slug);
}
