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

const DEMO_FALLBACK = process.env.BADGER_DEMO_FALLBACK === "1";

let composio = null;
function client() {
  composio ??= new Composio();
  return composio;
}

/** Which repository a given user's searches are scoped to, in memory. */
const repoChoice = new Map();

/** Which connected account each user has selected, and their repo choice. */
const accountChoice = new Map();
/** GitHub login per connected account, so the UI can label them usefully. */
const loginCache = new Map();

/**
 * Every GitHub account this user has connected.
 *
 * Composio allows several per toolkit, and tool calls can target one by id, so
 * a person with a work account and a personal account can hold both and switch
 * between them rather than disconnecting and reconnecting.
 */
export async function listGithubAccounts(userId) {
  try {
    const res = await client().connectedAccounts.list({ userIds: [userId] });
    return (res?.items ?? [])
      .filter((a) => (a.toolkit?.slug ?? a.toolkitSlug)?.toLowerCase() === "github")
      .filter((a) => !a.isDisabled)
      .map((a) => ({
        id: a.id,
        status: String(a.status ?? "").toUpperCase(),
        // `alias` is user-set and usually null; `wordId` is Composio's own
        // readable handle. The GitHub login replaces both once we know it.
        label: loginCache.get(a.id) ?? a.alias ?? a.wordId ?? a.id,
        login: loginCache.get(a.id) ?? null,
        createdAt: (a.createdAt ?? a.created_at ?? "").slice(0, 10),
      }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  } catch (err) {
    console.error("[connections] list failed", err?.message);
    return [];
  }
}

/**
 * Ask GitHub who each account belongs to, so accounts are labelled by login
 * rather than by an opaque id. One call per account, cached for the process,
 * and only ever made for accounts belonging to the asking user.
 */
export async function labelAccounts(userId, accounts) {
  const unknown = accounts.filter((a) => !loginCache.has(a.id) && a.status === "ACTIVE");
  if (!unknown.length) return accounts;

  const session = await client().create(userId, {
    toolkits: ["github"],
    tools: { github: { enable: ["GITHUB_GET_THE_AUTHENTICATED_USER"] } },
  });

  await Promise.allSettled(
    unknown.map(async (account) => {
      const res = await session.execute("GITHUB_GET_THE_AUTHENTICATED_USER", {
        connectedAccountId: account.id,
      });
      const login = res?.data?.login ?? res?.data?.details?.login;
      if (login) loginCache.set(account.id, login);
    }),
  );

  return accounts.map((a) => ({
    ...a,
    login: loginCache.get(a.id) ?? a.login,
    label: loginCache.get(a.id) ?? a.label,
  }));
}

/** The account this user is currently searching as, or the first active one. */
export async function activeAccount(userId) {
  const accounts = (await listGithubAccounts(userId)).filter((a) => a.status === "ACTIVE");
  if (!accounts.length) return null;
  const chosen = accountChoice.get(userId);
  return accounts.find((a) => a.id === chosen) ?? accounts[0];
}

/** Is this user connected in their own right? */
export async function githubConnection(userId) {
  return await activeAccount(userId);
}

/**
 * Resolve the identity a request's searches should run as.
 *
 * Returns the visitor's own connection when they have one, otherwise the
 * shared demo — and says which, because the UI has to be honest about whose
 * data is on screen.
 */
export async function resolveContext(userId) {
  const own = await activeAccount(userId);
  if (own) {
    return {
      userId,
      repo: repoChoice.get(`${userId}:${own.id}`) ?? null,
      mode: "own",
      account: own.id,
      label: own.label,
    };
  }
  // The shared demo corpus, when one is configured. Off by default now that
  // visitors connect their own accounts: BADGER_DEMO_FALLBACK=1 restores it.
  if (DEMO_FALLBACK) {
    return { userId: DEMO_USER_ID, repo: DEMO_REPO, mode: "demo", account: null, label: "demo" };
  }
  return { userId, repo: null, mode: "none", account: null, label: null };
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

  // The SDK's filter parameter is `toolkit`, not `toolkitSlug` — it maps to
  // `toolkit_slug` on the wire (node_modules/@composio/core/src/models/
  // AuthConfigs.ts:100), and the Zod schema silently drops the unknown key.
  // With one auth config in the project that mistake was invisible. It stops
  // being invisible the moment Gmail and Drive configs exist: an unfiltered
  // list plus `[0]` would hand the "Connect GitHub" button a Google consent
  // screen. Filter server-side, then verify client-side rather than trust it.
  const list = await client().authConfigs.list({ toolkit: "github" });
  const found = (list?.items ?? []).find((i) => i.toolkit?.slug === "github");
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

/**
 * Disconnect one account.
 *
 * The ownership check is the security boundary, not a nicety: account ids are
 * guessable-ish strings, and without it any signed-in visitor could delete
 * anyone else's connection by posting an id. Only accounts belonging to the
 * asking user are ever passed to Composio's delete.
 */
export async function disconnectAccount(userId, accountId) {
  const mine = await listGithubAccounts(userId);
  const target = mine.find((a) => a.id === accountId);
  if (!target) return false;

  await client().connectedAccounts.delete(target.id);
  loginCache.delete(target.id);
  repoChoice.delete(`${userId}:${target.id}`);
  if (accountChoice.get(userId) === target.id) accountChoice.delete(userId);
  return true;
}

/** Switch which connected account this user searches as. */
export async function selectAccount(userId, accountId) {
  const mine = await listGithubAccounts(userId);
  if (!mine.some((a) => a.id === accountId)) throw new Error("not your account");
  accountChoice.set(userId, accountId);
}

/**
 * Repositories the connected account can see.
 *
 * A connection alone is not enough to search: we have to know which repository.
 * This is the only place Badger reads outside the five agent tools, and it is
 * still read-only.
 */
export async function listRepositories(userId) {
  const account = await activeAccount(userId);
  const session = await client().create(userId, {
    toolkits: ["github"],
    tools: { github: { enable: ["GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER"] } },
  });
  const res = await session.execute("GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER", {
    per_page: 100,
    sort: "updated",
    // Target the account in use, not whichever Composio would pick.
    ...(account ? { connectedAccountId: account.id } : {}),
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

/** Repositories are chosen per connected account, since each sees different ones. */
export async function chooseRepo(userId, slug) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(String(slug ?? ""))) throw new Error("not a repository slug");
  const account = await activeAccount(userId);
  if (!account) throw new Error("connect a GitHub account first");
  repoChoice.set(`${userId}:${account.id}`, slug);
}
