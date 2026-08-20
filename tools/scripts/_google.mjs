// Shared plumbing for Badger's Gmail and Google Drive tools.
//
// The same shape as _github.mjs: the agent never sees Composio, only tools
// with names we chose, auditable in one place.
//
// Read-only rests on two things:
//   1. SessionPreset.DIRECT_TOOLS — drops Composio's generic meta-tools.
//      COMPOSIO_MULTI_EXECUTE_TOOL alone can invoke anything, which defeats
//      name-based gating completely.
//   2. ALLOW — an explicit per-tool enable list.
//
// Allow-by-name, never deny-by-verb: a "does this sound like a write?" filter
// over Drive's 90 tools classified GOOGLEDRIVE_EDIT_FILE as read-only, along
// with HIDE_DRIVE and WATCH_CHANGES. SEND_EMAIL, TRASH_MESSAGE and
// DELETE_DRAFT share a namespace with FETCH_EMAILS.
import { Composio, SessionPreset } from "@composio/core";
import { loadEnvFile } from "./_env.mjs";

// Re-exported so the Google tools keep one import.
export { CROSS_SOURCE } from "./_search-query.mjs";

loadEnvFile(new URL("../../.env", import.meta.url));

// A label inside whichever Composio workspace the key opens — see _github.mjs.
export const USER_ID = process.env.BADGER_USER_ID ?? "default";

/**
 * The eight read tools, audited one at a time against the live toolkits.
 *
 * Gmail exposes 63 tools and Drive 90. Everything not named here — every
 * write, label change and permission change — is unreachable.
 */
export const GMAIL_ALLOW = [
  "GMAIL_FETCH_EMAILS",
  "GMAIL_FETCH_MESSAGE_BY_THREAD_ID",
  "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID",
];

export const DRIVE_ALLOW = [
  "GOOGLEDRIVE_FIND_FILE",
  "GOOGLEDRIVE_GET_FILE_METADATA",
  "GOOGLEDRIVE_EXPORT_GOOGLE_WORKSPACE_FILE",
  "GOOGLEDRIVE_LIST_COMMENTS",
  "GOOGLEDRIVE_LIST_REPLIES",
];

export const ALLOW = [...GMAIL_ALLOW, ...DRIVE_ALLOW];

/**
 * Per-request context.
 *
 * Identity travels in tool arguments, never in the environment: declarative
 * tools are spawned with a snapshot of process.env, so a mutation would leak
 * into whichever tool call spawned next.
 *
 * No account id, unlike GitHub — one connected account per Google toolkit, so
 * Composio resolves it without being told.
 */
export function contextFrom(args = {}) {
  return { userId: args._badger_user || USER_ID };
}

// One session per end user, cached: creation costs seconds, and the session is
// what binds a tool call to a connection, so it cannot be shared.
const sessions = new Map();

function session(userId) {
  if (!sessions.has(userId)) {
    sessions.set(
      userId,
      new Composio().create(userId, {
        toolkits: ["gmail", "googledrive"],
        tools: {
          gmail: { enable: GMAIL_ALLOW },
          googledrive: { enable: DRIVE_ALLOW },
        },
        sessionPreset: SessionPreset.DIRECT_TOOLS,
      }),
    );
  }
  return sessions.get(userId);
}

/** Execute one allowlisted Composio tool as a given end user. */
export async function exec(slug, args, userId = USER_ID) {
  if (!ALLOW.includes(slug)) throw new Error(`tool not allowlisted: ${slug}`);
  const s = await session(userId);
  const res = await s.execute(slug, args);
  if (res?.error != null) {
    throw new Error(`${slug} failed: ${JSON.stringify(res.error).slice(0, 300)}`);
  }
  return res.data ?? {};
}

/**
 * Read a Google Doc or Sheet as text.
 *
 * GOOGLEDRIVE_EXPORT_GOOGLE_WORKSPACE_FILE returns a short-lived signed URL
 * to object storage, not the document, so a read is two hops. Not stated in
 * the tool schema.
 *
 * Docs export to text/plain, Sheets only to text/csv, and the wrong one fails
 * with "not supported for this file type" — so the mime type is chosen from
 * the file's own.
 */
export async function exportText(fileId, mimeType, userId = USER_ID) {
  const isSheet = String(mimeType ?? "").includes("spreadsheet");
  const data = await exec(
    "GOOGLEDRIVE_EXPORT_GOOGLE_WORKSPACE_FILE",
    { file_id: fileId, mime_type: isSheet ? "text/csv" : "text/plain" },
    userId,
  );
  const url = data?.file?.s3url ?? data?.file?.url;
  if (!url) throw new Error(`export returned no file url: ${JSON.stringify(data).slice(0, 200)}`);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`export download failed: HTTP ${res.status}`);
  return await res.text();
}

/** Human label for a Drive mime type. Folders and Workspace types only. */
export function kindOf(mimeType = "") {
  if (mimeType.includes("folder")) return "folder";
  if (mimeType.includes("spreadsheet")) return "sheet";
  if (mimeType.includes("presentation")) return "slides";
  if (mimeType.includes("document")) return "doc";
  if (mimeType.includes("pdf")) return "pdf";
  return "file";
}

/** Is this something export can read at all? */
export const isWorkspaceFile = (mimeType = "") =>
  mimeType.startsWith("application/vnd.google-apps.") && !mimeType.includes("folder");

// `run` is deliberately NOT shared: the GitHub one turns a 403 into advice
// about GitHub's search rate limit, which would be a lie on a Gmail failure.
export { readArgs, clip } from "./_github.mjs";

import { readArgs as _readArgs } from "./_github.mjs";

/**
 * Wrap a tool body: errors become readable text the model can act on. A quota
 * failure must never look like an empty result — "nothing matched" and "we did
 * not look" are different facts.
 */
export async function run(fn) {
  try {
    const out = await fn(await _readArgs());
    process.stdout.write(String(out ?? "").trim() + "\n");
  } catch (err) {
    const msg = err?.message ?? String(err);
    if (/quota|rate.?limit|\b429\b/i.test(msg)) {
      process.stdout.write(
        "ERROR: Google returned a quota or rate-limit error.\n" +
          "This is NOT an empty result. Wait ~30s, then retry with a narrower query.\n",
      );
    } else if (/no active connection|not connected/i.test(msg)) {
      process.stdout.write(
        "ERROR: this Composio key has no Gmail/Drive account connected.\n" +
          "This is NOT an empty result — the source was never reached. To connect one:\n" +
          "run `npm run connect` in this repository. It prints an authorise link per\n" +
          "service; opening each in a browser completes OAuth, and Composio holds the\n" +
          "token. Offer to run it for the user, then retry this call afterwards.\n",
      );
    } else {
      process.stdout.write(`ERROR: ${msg}\n`);
    }
  }
}
