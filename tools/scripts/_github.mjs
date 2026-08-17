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
import { readFileSync } from "node:fs";
import { Composio, SessionPreset } from "@composio/core";

const ENV = new URL("../../.env", import.meta.url).pathname;
for (const line of readFileSync(ENV, "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2].trim().replace(/^["']|["']$/g, "");
}

// One end user for now. In the hosted product this is the logged-in user's id,
// which is the whole reason the session model was chosen over a static token.
export const USER_ID = process.env.BADGER_USER_ID ?? "badger-demo-alan";

// The repository Badger is scoped to. Single-repo by design — least privilege,
// and it keeps search qualifiers honest.
const SLUG = process.env.BADGER_GITHUB_REPO ?? "alanmathews9/arkind-internal";
export const [OWNER, REPO] = SLUG.split("/");
export const REPO_SLUG = SLUG;

const ALLOW = [
  "GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS",
  "GITHUB_GET_AN_ISSUE",
  "GITHUB_LIST_ISSUE_COMMENTS",
  "GITHUB_GET_REPOSITORY_CONTENT",
  "GITHUB_LIST_COMMITS",
];

let sessionPromise = null;

function session() {
  sessionPromise ??= new Composio().create(USER_ID, {
    toolkits: ["github"],
    tools: { github: { enable: ALLOW } },
    sessionPreset: SessionPreset.DIRECT_TOOLS,
  });
  return sessionPromise;
}

/**
 * Execute one allowlisted Composio tool.
 * Response shape is { data, error, logId } — there is no `successful` field.
 */
export async function exec(slug, args) {
  if (!ALLOW.includes(slug)) throw new Error(`tool not allowlisted: ${slug}`);
  const s = await session();
  const res = await s.execute(slug, args);
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
