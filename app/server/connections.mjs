// Per-user source connections, through Composio.
//
// This is the piece that makes Badger multi-tenant rather than a demo with one
// hardcoded account. Each browser gets an opaque id in its signed session
// cookie (auth.mjs); that id is the Composio end-user id, so "connect GitHub"
// means *your* GitHub, and one visitor can never see another's.
//
// Badger never touches a GitHub credential in this flow. Composio issues the
// Connect Link, GitHub redirects back to Composio, and Composio holds the
// token. We only ever learn whether a connection exists.
//
// The demo connection remains as a fallback: a visitor who has connected
// nothing searches the seeded Arkind corpus instead of an empty app. Asking a
// stranger to grant `repo` scope before they can see anything would mean most
// of them see nothing. BADGER_REQUIRE_OWN_CONNECTION=1 turns that off.
import { Composio } from "@composio/core";
import { DEMO_REPO, DEMO_USER_ID } from "../../tools/scripts/_github.mjs";

const REQUIRE_OWN = process.env.BADGER_REQUIRE_OWN_CONNECTION === "1";

let composio = null;
function client() {
  composio ??= new Composio();
  return composio;
}

/** Which repository a given user's searches are scoped to, in memory. */
const repoChoice = new Map();

/**
 * Is this user connected in their own right?
 * Returns the connected account, or null.
 */
export async function githubConnection(userId) {
  try {
    const res = await client().connectedAccounts.list({ userIds: [userId] });
    const items = res?.items ?? [];
    return (
      items.find(
        (a) =>
          (a.toolkit?.slug ?? a.toolkitSlug)?.toLowerCase() === "github" &&
          String(a.status).toUpperCase() === "ACTIVE",
      ) ?? null
    );
  } catch (err) {
    console.error("[connections] list failed", err?.message);
    return null;
  }
}

/**
 * Resolve the identity a request's searches should run as.
 *
 * Returns the visitor's own connection when they have one, otherwise the
 * shared demo — and says which, because the UI has to be honest about whose
 * data is on screen.
 */
export async function resolveContext(userId) {
  const own = await githubConnection(userId);
  if (own) {
    return {
      userId,
      repo: repoChoice.get(userId) ?? null,
      mode: "own",
      account: own.id,
    };
  }
  if (REQUIRE_OWN) return { userId, repo: null, mode: "none", account: null };
  return { userId: DEMO_USER_ID, repo: DEMO_REPO, mode: "demo", account: null };
}

/**
 * The GitHub auth config, looked up once and cached.
 *
 * `toolkits.authorize()` is the obvious call and it is now wrong: for
 * Composio-managed OAuth it hits a deprecated endpoint that answers
 * "Creating connections on this endpoint ... is no longer supported. Use
 * POST /api/v3/connected_accounts/link instead." — which is what `link()`
 * calls. Taking their advice rather than pinning an old endpoint.
 */
let authConfigId = null;
async function githubAuthConfig() {
  if (authConfigId) return authConfigId;
  const configured = process.env.BADGER_GITHUB_AUTH_CONFIG;
  if (configured) return (authConfigId = configured);

  const list = await client().authConfigs.list({ toolkitSlug: "github" });
  const found = (list?.items ?? [])[0];
  if (!found?.id) throw new Error("no GitHub auth config exists in this Composio project");
  return (authConfigId = found.id);
}

/**
 * Begin an OAuth connection. Returns the Connect Link to send the browser to.
 *
 * `callbackUrl` is where Composio returns the visitor once GitHub has been
 * authorised. Nothing is read from that redirect — the app re-reads the real
 * connection state instead of trusting a query parameter.
 */
export async function beginGithubConnect(userId, callbackUrl) {
  const request = await client().connectedAccounts.link(userId, await githubAuthConfig(), {
    callbackUrl,
  });
  const url = request?.redirectUrl ?? request?.redirect_url;
  if (!url) throw new Error("Composio did not return a Connect Link");
  return { redirectUrl: url, connectionId: request?.id ?? null };
}

/** Drop this user's GitHub connection. Their own account, their own choice. */
export async function disconnectGithub(userId) {
  const own = await githubConnection(userId);
  if (!own) return false;
  await client().connectedAccounts.delete(own.id);
  repoChoice.delete(userId);
  return true;
}

/**
 * Repositories the connected account can see.
 *
 * A connection alone is not enough to search: we have to know which repository.
 * This is the only place Badger reads outside the five agent tools, and it is
 * still read-only.
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

export function chooseRepo(userId, slug) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(String(slug ?? ""))) throw new Error("not a repository slug");
  repoChoice.set(userId, slug);
}

export function chosenRepo(userId) {
  return repoChoice.get(userId) ?? null;
}
