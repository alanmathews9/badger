#!/usr/bin/env node
// List the tools an MCP server actually exposes, without running the agent.
//
// Badger's security model is an allowlist of exact tool names
// (hooks/allowed-tools.txt), so those names have to come from the server
// itself, never from documentation or guesswork. This script asks.
//
// It needs no model and no LLM credits. Tool registration in most servers is
// static, so a placeholder token is usually enough to complete a tools/list
// handshake — which means the surface can be audited before any real
// credential exists.
//
//   node scripts/mcp-tools.mjs --stdio <command> [args...]
//   node scripts/mcp-tools.mjs --http <url> [bearer-token]
//
// Examples:
//   node scripts/mcp-tools.mjs --stdio github-mcp-server stdio --read-only
//   node scripts/mcp-tools.mjs --http https://api.githubcopilot.com/mcp/readonly "$GITHUB_TOKEN"
//
// Output is grouped and prefixed with the server namespace so lines can be
// pasted straight into hooks/allowed-tools.txt.

import { createRequire } from "node:module";

// Borrow the MCP SDK from the globally installed gitagent rather than adding a
// dependency to this repo — the agent is meant to stay a plain git repo.
const GITAGENT = "/opt/homebrew/lib/node_modules/@open-gitagent/gitagent";
const require_ = createRequire(GITAGENT + "/package.json");
const sdkPath = (p) => require_.resolve("@modelcontextprotocol/sdk/" + p);

const { Client } = await import(sdkPath("client/index.js"));

const argv = process.argv.slice(2);
const mode = argv[0];
if (!mode || !["--stdio", "--http", "--sse"].includes(mode)) {
  console.error("usage: mcp-tools.mjs --stdio <command> [args...]");
  console.error("       mcp-tools.mjs --http|--sse <url> [bearer-token]");
  process.exit(2);
}

let transport;
let label;

if (mode === "--stdio") {
  const [command, ...args] = argv.slice(1);
  if (!command) { console.error("missing command"); process.exit(2); }
  const { StdioClientTransport, getDefaultEnvironment } = await import(sdkPath("client/stdio.js"));
  transport = new StdioClientTransport({
    command,
    args,
    env: { ...getDefaultEnvironment(), ...process.env },
  });
  label = [command, ...args].join(" ");
} else {
  const [url, token] = argv.slice(1);
  if (!url) { console.error("missing url"); process.exit(2); }
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
  const mod = mode === "--http" ? "client/streamableHttp.js" : "client/sse.js";
  const { StreamableHTTPClientTransport, SSEClientTransport } = await import(sdkPath(mod));
  const T = StreamableHTTPClientTransport || SSEClientTransport;
  transport = new T(new URL(url), { requestInit: headers ? { headers } : undefined });
  label = url;
}

const client = new Client({ name: "badger-audit", version: "0.1.0" }, { capabilities: {} });

const timer = setTimeout(() => {
  console.error("timed out after 60s");
  process.exit(1);
}, 60_000);

try {
  await client.connect(transport);

  // Follow pagination cursors; a truncated list would mean a silently
  // incomplete audit, which is worse than no audit.
  const tools = [];
  let cursor;
  do {
    const res = await client.listTools(cursor ? { cursor } : undefined);
    tools.push(...res.tools);
    cursor = res.nextCursor;
  } while (cursor);

  tools.sort((a, b) => a.name.localeCompare(b.name));

  console.log(`# ${label}`);
  console.log(`# ${tools.length} tools exposed\n`);
  for (const t of tools) {
    const desc = (t.description || "").split("\n")[0].slice(0, 88);
    console.log(`${t.name}`);
    if (desc) console.log(`    # ${desc}`);
  }

  // gitagent registers MCP tools as <server>__<tool>, truncated at 64 chars.
  // Flag anything that would collide or be cut, since the allowlist matches
  // the post-truncation name.
  const NS = process.env.MCP_NS || "github";
  const long = tools.map((t) => `${NS}__${t.name}`).filter((n) => n.length > 64);
  if (long.length) {
    console.log(`\n# WARNING: ${long.length} name(s) exceed 64 chars and will be truncated:`);
    long.forEach((n) => console.log(`#   ${n}`));
  }
} catch (err) {
  console.error(`failed: ${err?.message || err}`);
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
  try { await client.close(); } catch { /* best effort */ }
}
