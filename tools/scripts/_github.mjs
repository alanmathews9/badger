// Shared plumbing for Badger's GitHub tools.
//
// Every tool in tools/*.yaml is a thin script over this module. The agent never
// sees Composio — it sees four tools with names we chose, which is what makes
// hooks/allowed-tools.txt able to gate them.
//
// Read-only rests on two things here, and both must hold:
//   1. SessionPreset.DIRECT_TOOLS — drops Composio's generic meta-tools.
//      Without it a session registers COMPOSIO_MULTI_EXECUTE_TOOL, one name
//      that can invoke anything, which defeats name-based gating entirely.
//   2. ALLOW — an explicit per-tool enable list. Allow-by-name, never
//      deny-by-verb: GITHUB_LIST_REPOSITORY_SECRETS is a "read" tool that
//      reads credentials.
import { Composio, SessionPreset } from "@composio/core";
import { loadEnvFile } from "./_env.mjs";

// Optional: present on a laptop, absent in a container where the same values
// arrive as real environment variables.
loadEnvFile(new URL("../../.env", import.meta.url));

// The shared demo connection: the Arkind corpus, which anyone can search
// without connecting anything of their own. A visitor who has connected their
// own GitHub uses theirs instead.
export const DEMO_USER_ID = process.env.BADGER_USER_ID ?? "badger-demo-alan";
export const DEMO_REPO = process.env.BADGER_GITHUB_REPO ?? "alanmathews9/arkind-internal";

/**
 * Per-request context.
 *
 * The user id and repository used to be module constants read from the
 * environment. That is wrong the moment two people use the server at once:
 * declarative tools are spawned as subprocesses with a snapshot of
 * process.env (dist/tool-loader.js), so a request mutating it would leak into
 * whichever tool call happened to spawn next.
 *
 * They now arrive as arguments instead. The server injects them into every
 * tool call through a preToolUse closure, so they travel on stdin with the
 * rest of the args and nothing is shared between requests.
 */
export function contextFrom(args = {}) {
  const userId = args._badger_user || DEMO_USER_ID;
  const slug = args._badger_repo || DEMO_REPO;
  const [owner, repo] = String(slug).split("/");
  // Which connected account to run as. A user may hold several GitHub
  // accounts; without this Composio picks one of them for us.
  const accountId = args._badger_account || null;
  return { userId, slug, owner, repo, accountId };
}

// Kept for the CLI path, where there is one user by definition.
export const [OWNER, REPO] = DEMO_REPO.split("/");
export const REPO_SLUG = DEMO_REPO;

// Exported so scripts/composio-session.mjs reports the agent's real surface
// rather than a second, drifted copy of it. `npm run composio:status` printed
// 12 tools while the agent could reach 8, which is the wrong number to hand
// anyone auditing the read-only claim.
export const ALLOW = [
  "GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS",
  "GITHUB_GET_AN_ISSUE",
  "GITHUB_LIST_ISSUE_COMMENTS",
  "GITHUB_GET_REPOSITORY_CONTENT",
  "GITHUB_LIST_COMMITS",
  // A pull request's inline review comments are a different endpoint from its
  // conversation comments, and triage needs the inline ones — that is where
  // "you need to handle the null case" lives.
  "GITHUB_GET_A_PULL_REQUEST",
  "GITHUB_LIST_REVIEW_COMMENTS_ON_A_PULL_REQUEST",
  "GITHUB_LIST_PULL_REQUESTS_FILES",
];

// One session per end user, cached. Creating a session costs about four
// seconds, so it must not happen per call — but it must not be shared across
// users either, since the session is what binds tool calls to a connection.
const sessions = new Map();

function session(userId) {
  if (!sessions.has(userId)) {
    sessions.set(
      userId,
      new Composio().create(userId, {
        toolkits: ["github"],
        tools: { github: { enable: ALLOW } },
        sessionPreset: SessionPreset.DIRECT_TOOLS,
      }),
    );
  }
  return sessions.get(userId);
}

/**
 * Execute one allowlisted Composio tool as a given end user.
 * Response shape is { data, error, logId } — there is no `successful` field.
 */
export async function exec(slug, args, userId = DEMO_USER_ID, accountId = null) {
  if (!ALLOW.includes(slug)) throw new Error(`tool not allowlisted: ${slug}`);
  const s = await session(userId);
  const res = await s.execute(slug, accountId ? { ...args, connectedAccountId: accountId } : args);
  if (res?.error != null) {
    throw new Error(`${slug} failed: ${JSON.stringify(res.error).slice(0, 300)}`);
  }
  return res.data ?? {};
}

/**
 * Composio wraps each GitHub payload under a key named after the resource —
 * `content` for repository contents, `commits` for commits, `items` for search,
 * `details` for comments. Rather than hard-code every name, take the first
 * array-valued property. Falls back to the object itself if it is already an
 * array, and returns [] when there is nothing list-shaped.
 */
export function asList(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  for (const v of Object.values(data)) if (Array.isArray(v)) return v;
  return [];
}

/** Read the JSON argument object gitagent writes to stdin. */
export async function readArgs() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/** Collapse whitespace and clip, so one tool result cannot flood the context. */
export function clip(text, max = 600) {
  const t = String(text ?? "").replace(/\r/g, "").trim();
  if (t.length <= max) return t;
  return t.slice(0, max) + `\n… [truncated, ${t.length - max} more chars]`;
}

/**
 * Wrap a tool body. Errors become readable text rather than a stack trace, so
 * the model can act on them — a rate limit must never look like "no results".
 */
export async function run(fn) {
  try {
    const out = await fn(await readArgs());
    process.stdout.write(String(out ?? "").trim() + "\n");
  } catch (err) {
    const msg = err?.message ?? String(err);
    if (/rate limit|403/i.test(msg)) {
      process.stdout.write(
        "ERROR: rate limited by the GitHub search API (30 requests/minute).\n" +
          "This is NOT an empty result. Wait ~30s, then retry with a narrower query.\n",
      );
    } else {
      process.stdout.write(`ERROR: ${msg}\n`);
    }
  }
}
