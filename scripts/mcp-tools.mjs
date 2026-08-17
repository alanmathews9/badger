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
//
// ---------------------------------------------------------------------------
// Two extra modes, both driven by env vars rather than flags. Stdio mode takes
// a variadic command line, so any new flag would be ambiguous with the server's
// own arguments — env vars sidestep that entirely.
//
//   MCP_SCHEMA=<tool>              print one tool's input schema and exit
//   MCP_CALL=<tool> MCP_ARGS=<json>  actually invoke a tool and print the result
//
// Examples:
//   MCP_SCHEMA=search_issues \
//     node scripts/mcp-tools.mjs --stdio github-mcp-server stdio --read-only
//
//   MCP_CALL=search_issues MCP_ARGS='{"query":"repo:o/r is:issue thing"}' \
//     node scripts/mcp-tools.mjs --stdio github-mcp-server stdio --read-only
//
// Why this matters: a tool can be present in tools/list and still fail when
// called, because the server builds the upstream request itself. Listing proves
// a name exists; only calling proves the path works. Use it to test a source
// before wiring a live credential into agent.yaml.
//
// SAFETY: this will call whatever you name, including a mutating tool. It runs
// outside the agent, so hooks/allow-read-only.sh does NOT apply here. Point it
// at read tools, and keep --read-only on the server.

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

  // --- MCP_SCHEMA: show one tool's parameters -------------------------------
  if (process.env.MCP_SCHEMA) {
    const t = tools.find((x) => x.name === process.env.MCP_SCHEMA);
    if (!t) {
      console.error(`no such tool: ${process.env.MCP_SCHEMA}`);
      process.exitCode = 1;
    } else {
      console.log(`# ${t.name}\n${t.description || ""}\n`);
      console.log(JSON.stringify(t.inputSchema, null, 2));
    }
  }

  // --- MCP_CALL: invoke a tool for real -------------------------------------
  else if (process.env.MCP_CALL) {
    const name = process.env.MCP_CALL;
    if (!tools.some((x) => x.name === name)) {
      console.error(`no such tool: ${name}`);
      process.exitCode = 1;
    } else {
      let args;
      try {
        args = JSON.parse(process.env.MCP_ARGS || "{}");
      } catch (e) {
        console.error(`MCP_ARGS is not valid JSON: ${e.message}`);
        process.exit(2);
      }
      console.log(`# calling ${name} with ${JSON.stringify(args)}\n`);
      const res = await client.callTool({ name, arguments: args });

      // An MCP tool reports failure two different ways: a thrown protocol error,
      // or a normal response carrying isError. The second is easy to mistake for
      // a successful empty result, which is exactly the silent-failure class
      // Badger has to avoid — so say which one happened.
      if (res.isError) console.log("# isError: true — the tool reported failure\n");

      // Report the block TYPE, not just its content. gitagent's
      // flattenToolResult keeps text blocks and replaces binary ones with a
      // placeholder (NOTES.md §6), so a tool that answers in a non-text block
      // may deliver nothing to Badger even though the call succeeded here.
      for (const block of res.content || []) {
        if (block.type === "text") {
          console.log(block.text);
        } else if (block.type === "resource") {
          const r = block.resource || {};
          const kind = r.text !== undefined ? "TEXT" : r.blob !== undefined ? "BLOB (binary)" : "unknown";
          console.log(`[resource block: ${kind}] uri=${r.uri || "-"} mime=${r.mimeType || "-"}`);
          if (r.text !== undefined) console.log(r.text);
          else if (r.blob !== undefined) console.log(`  <${r.blob.length} base64 chars, dropped by flattenToolResult>`);
        } else {
          console.log(`[${block.type} block, not text]`);
        }
      }
      if (res.structuredContent) {
        console.log("\n# structuredContent:");
        console.log(JSON.stringify(res.structuredContent, null, 2));
      }
      if (!res.content?.length && !res.structuredContent) console.log("# empty result");
    }
  }

  // --- default: list the whole surface --------------------------------------
  else {

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
  }
} catch (err) {
  console.error(`failed: ${err?.message || err}`);
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
  try { await client.close(); } catch { /* best effort */ }
}
