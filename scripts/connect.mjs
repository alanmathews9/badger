#!/usr/bin/env node
// Connect this Composio key's accounts — GitHub, Gmail, Drive, Docs.
//
// This is the whole onboarding for a fresh Composio workspace: run it, open
// the printed links, authorise each service in the browser. Composio holds
// the tokens; Badger never sees one. Composio treats each Google product as
// its own toolkit with its own connected account — so one Google login still
// means three consent screens. This script walks all four toolkits in order
// rather than making anyone click through the dashboard.
//
//   npm run connect                            # print a Connect Link per toolkit
//   npm run connect status                     # report, connect nothing
//
// The links are printed all at once rather than waited on one at a time, so
// all three consent screens can be opened as tabs and worked through at a
// human pace. Re-run with `status` afterwards to confirm.
//
// Scopes, read back from the live auth configs on 2026-08-17 rather than
// taken from the docs, which do not state them:
//
//   gmail        https://mail.google.com/                     (full mailbox)
//   googledrive  .../auth/drive                               (full drive)
//   googledocs   .../auth/drive + .../auth/documents
//
// None of these is read-only, and Google offers no managed narrower option
// here. That is the same shape as GitHub, where `repo` is the narrowest scope
// that can read a private repository: the credential cannot enforce read-only,
// so the tool layer has to. Seeding uses the same grant, with write tools
// enabled in a session the agent's allowlist never names.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Composio } from "@composio/core";
import { loadEnvFile } from "../tools/scripts/_env.mjs";
import { indexStatus } from "../tools/scripts/_index.mjs";

loadEnvFile(new URL("../.env", import.meta.url));

const USER_ID = process.env.BADGER_USER_ID ?? "default";
const TOOLKITS = ["github", "gmail", "googledrive", "googledocs"];

const composio = new Composio();
const statusOnly = process.argv[2] === "status";

/**
 * The auth config for one toolkit, created if absent.
 *
 * Two traps, both hit for real on 2026-08-17:
 *
 * 1. The SDK's filter key is `toolkit`, not `toolkitSlug` — the unknown key is
 *    silently dropped and the call returns every config in the project. The
 *    slug is therefore checked again here rather than trusted.
 *
 * 2. An auth config created through the SDK defaults to
 *    `isEnabledForToolRouter: false`, and sessions are Tool Router — so every
 *    call fails with "No active connection found for toolkit(s) 'gmail' in
 *    this session" even though `connectedAccounts.list` reports ACTIVE. The
 *    error names the connection, but the connection is fine; the auth config
 *    is not exposed to sessions. The GitHub config predates this script and
 *    was created by the dashboard, which sets the flag, so the whole project
 *    looked healthy. Set it explicitly and verify the read-back.
 */
async function authConfigFor(slug) {
  const list = await composio.authConfigs.list({ toolkit: slug });
  let found = (list?.items ?? []).find((i) => i.toolkit?.slug === slug);
  if (!found?.id) {
    found = await composio.authConfigs.create(slug);
    console.log(`${slug.padEnd(12)} created auth config ${found.id}`);
  }
  const full = await composio.authConfigs.get(found.id);
  if (!full.isEnabledForToolRouter) {
    await composio.authConfigs.update(found.id, { type: "default", isEnabledForToolRouter: true });
    const after = await composio.authConfigs.get(found.id);
    if (!after.isEnabledForToolRouter) {
      throw new Error(`${slug} auth config is not exposed to sessions and would fail every call`);
    }
  }
  return found.id;
}

async function activeAccount(slug) {
  const res = await composio.connectedAccounts.list({ userIds: [USER_ID] });
  return (res?.items ?? []).find(
    (a) =>
      (a.toolkit?.slug ?? a.toolkitSlug)?.toLowerCase() === slug &&
      !a.isDisabled &&
      String(a.status ?? "").toUpperCase() === "ACTIVE",
  );
}

console.log(`user: ${USER_ID}\n`);

const connected = [];

for (const slug of TOOLKITS) {
  const existing = await activeAccount(slug);
  if (existing) {
    connected.push({ slug, createdAt: Date.parse(existing.createdAt ?? "") || null });
    // Report the Tool Router flag alongside the connection, because an ACTIVE
    // connection under an unexposed auth config fails every call while looking
    // perfectly healthy here.
    const list = await composio.authConfigs.list({ toolkit: slug });
    const cfg = (list?.items ?? []).find((i) => i.toolkit?.slug === slug);
    const exposed = cfg ? (await composio.authConfigs.get(cfg.id)).isEnabledForToolRouter : false;
    console.log(
      `${slug.padEnd(12)} connected  ${existing.id}` +
        (exposed ? "" : "  *** auth config NOT exposed to sessions — calls will fail"),
    );
    continue;
  }
  if (statusOnly) {
    console.log(`${slug.padEnd(12)} NOT CONNECTED`);
    continue;
  }

  const request = await composio.connectedAccounts.link(USER_ID, await authConfigFor(slug));
  const url = request?.redirectUrl ?? request?.redirect_url;
  if (!url) throw new Error(`Composio returned no Connect Link for ${slug}`);

  console.log(`${slug.padEnd(12)} authorise: ${url}`);
}

if (!statusOnly) {
  console.log("\nOpen each link and authorise with the account whose data Badger");
  console.log("should search, then confirm with:");
  console.log("  npm run connect status");
} else {
  // Connection-triggered indexing, Onyx's shape sized down: Onyx starts a
  // crawl within seconds of a connector being added (its beat scheduler picks
  // up the trigger); here, the moment `status` confirms a searchable source
  // is authorised is the first moment a build can succeed, so it runs right
  // here — and again whenever a source was connected AFTER the index was
  // built, because a copy that predates a connection cannot contain it.
  // The web server needs no telling: it watches the index file's mtime and
  // picks up a new build on the next search. The boot-time lazy build stays
  // as Cloud Run's safety net, `npm run index` as the manual override.
  const searchable = connected.filter((c) => ["github", "gmail", "googledrive"].includes(c.slug));
  const idx = indexStatus();
  const newestConnection = Math.max(0, ...searchable.map((c) => c.createdAt ?? 0));
  const needsBuild =
    searchable.length > 0 &&
    (!idx.exists || (newestConnection && Date.parse(idx.builtAt) < newestConnection));

  if (needsBuild) {
    console.log(
      idx.exists
        ? "\nA source was connected after the index was built — rebuilding it now…"
        : "\nBuilding the local search index from the connected sources…",
    );
    const script = fileURLToPath(new URL("./index-build.mjs", import.meta.url));
    const result = spawnSync(process.execPath, [script], { stdio: "inherit" });
    if (result.status !== 0) {
      console.log("Index build failed — search runs live until `npm run index` succeeds.");
    }
  } else if (searchable.length) {
    console.log(`\nindex: current (built ${idx.builtAt}) — \`npm run index\` rebuilds it.`);
  }
}
