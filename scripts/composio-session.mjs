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

// The agent's allowlist, imported rather than copied.
//
// This file used to keep its own list of 12, so `npm run composio:status`
// reported a tool surface the agent did not have — the wrong number to give
// anyone auditing the read-only claim. ALLOW is now the single source of
// truth, and the diagnostic-only tools are declared separately and labelled
// in the output.
import { ALLOW } from "../tools/scripts/_github.mjs";

// Tools this script may call for status and probing, which the AGENT cannot.
// All read-only, and all deliberately outside the agent's reach: repository
// metadata is only needed to prove a connection works, and code search does
// not serve private repos at all (NOTES.md), so it must never become a
// dependency of a skill.
const DIAGNOSTIC_ONLY = [
  "GITHUB_GET_A_REPOSITORY",
  "GITHUB_SEARCH_CODE",
];

const SESSION_TOOLS = [...ALLOW, ...DIAGNOSTIC_ONLY];

const composio = new Composio();

const session = await composio.create(USER_ID, {
  toolkits: ["github"],
  tools: { github: { enable: SESSION_TOOLS } },
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
  // Label which of these the AGENT can actually reach. Printing one flat
  // count invites reading the diagnostic surface as Badger's surface.
  console.log(`\ntools registered in THIS session: ${names.length}`);
  console.log(`  the agent can reach ${ALLOW.length}; ${DIAGNOSTIC_ONLY.length} are diagnostic-only\n`);
  for (const n of names.sort()) {
    const tag = ALLOW.includes(n) ? "agent     " : DIAGNOSTIC_ONLY.includes(n) ? "diagnostic" : "UNEXPECTED";
    console.log(`  [${tag}] ${n}`);
  }
  // A tool in the session that is in neither list means the enable list is not
  // being honoured — that is a read-only failure, not a cosmetic one.
  const unexpected = names.filter((n) => !ALLOW.includes(n) && !DIAGNOSTIC_ONLY.includes(n));
  if (unexpected.length) {
    console.log(`\n*** UNEXPECTED TOOLS — the enable list is not holding: ${unexpected.join(", ")}`);
  }
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
