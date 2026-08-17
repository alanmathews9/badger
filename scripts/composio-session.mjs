#!/usr/bin/env node
// Badger <-> Composio: create a read-only GitHub session and prove one real call.
//
// Read-only is enforced by the DIRECT_TOOLS preset (drops Composio's generic
// meta-tools, which would otherwise let one tool name execute anything) plus an
// explicit per-tool allowlist. Allow-by-name, never deny-by-verb: GitHub has
// "read" tools like GITHUB_LIST_REPOSITORY_SECRETS that a verb rule would pass.
//
//   node badger-session.mjs status    -> session + connection state, tool list
//   node badger-session.mjs connect   -> print the Connect Link, wait for auth
//   node badger-session.mjs call      -> one real read-only call + log id
import { readFileSync } from "node:fs";
import { Composio, SessionPreset } from "@composio/core";

// The SDK reads COMPOSIO_API_KEY from env; load it from the repo's .env.
const ENV = new URL("../.env", import.meta.url).pathname;
for (const line of readFileSync(ENV, "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2].trim().replace(/^["']|["']$/g, "");
}

// Stable per-end-user id. In the product this is the logged-in user's id.
const USER_ID = process.env.BADGER_USER_ID ?? "badger-demo-alan";
const REPO = { owner: "alanmathews9", repo: "arkind-internal" };

// Badger's GitHub allowlist: 12 of 823 tools. Mirrors the retrieval paths
// already verified against the raw API (NOTES.md) — issue search is primary,
// file contents and commits are the known-path fallbacks, comments matter
// because semantic issue search cannot see them.
const ALLOW = [
  "GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS",
  "GITHUB_LIST_REPOSITORY_ISSUES",
  "GITHUB_GET_AN_ISSUE",
  "GITHUB_LIST_ISSUE_COMMENTS",
  "GITHUB_LIST_PULL_REQUESTS",
  "GITHUB_GET_A_PULL_REQUEST",
  "GITHUB_LIST_REVIEW_COMMENTS_ON_A_PULL_REQUEST",
  "GITHUB_GET_REPOSITORY_CONTENT",
  "GITHUB_LIST_COMMITS",
  "GITHUB_GET_A_COMMIT",
  "GITHUB_GET_A_REPOSITORY",
  "GITHUB_SEARCH_CODE", // public repos only — see NOTES.md, never a dependency
];

const composio = new Composio();

const session = await composio.create(USER_ID, {
  toolkits: ["github"],
  tools: { github: { enable: ALLOW } },
  sessionPreset: SessionPreset.DIRECT_TOOLS,
});

const mode = process.argv[2] ?? "status";
console.log(`session: ${session.sessionId ?? "(no id)"}  user: ${USER_ID}  mode: ${mode}\n`);

async function connectionState() {
  const tk = await session.toolkits();
  return (tk.items ?? []).map((t) => ({
    name: t.name ?? t.slug,
    active: Boolean(t.connection?.isActive ?? t.connection?.connectedAccount?.id),
    account: t.connection?.connectedAccount?.id ?? null,
  }));
}

if (mode === "status") {
  console.log("connections:", JSON.stringify(await connectionState(), null, 1));
  const tools = await session.tools();
  const names = (Array.isArray(tools) ? tools : (tools?.items ?? [])).map(
    (t) => t.slug ?? t.name ?? t.function?.name,
  );
  console.log(`\ntools registered: ${names.length}`);
  for (const n of names.sort()) console.log("  " + n);
  // The whole read-only guarantee dies if a generic executor is present.
  const danger = names.filter((n) => /MULTI_EXECUTE|REMOTE_BASH|WORKBENCH|MANAGE_CONNECTIONS/i.test(n ?? ""));
  console.log(
    danger.length
      ? `\n*** META-TOOLS PRESENT — read-only is VOID: ${danger.join(", ")}`
      : "\nOK: no generic execute/bash meta-tools registered.",
  );
} else if (mode === "connect") {
  const req = await session.authorize("github");
  console.log("Open this Connect Link and authorize:\n");
  console.log("  " + (req.redirectUrl ?? req.redirect_url));
  console.log("\nwaiting for authorization...");
  const acct = await req.waitForConnection();
  console.log("connected account:", acct?.id ?? JSON.stringify(acct).slice(0, 200));
} else if (mode === "call") {
  // One real read-only call through the session's own execution path.
  // Response shape is { data, error, logId } — there is no `successful` field.
  const res = await session.execute("GITHUB_GET_A_REPOSITORY", REPO);
  const ok = res?.error == null;
  console.log("ok:", ok, "| log id:", res?.logId ?? "(none)");
  if (!ok) {
    console.log("error:", JSON.stringify(res.error).slice(0, 500));
    process.exit(1);
  }
  const d = res.data ?? {};
  console.log(`repo: ${d.full_name} | private: ${d.private} | open issues: ${d.open_issues_count}`);
}
