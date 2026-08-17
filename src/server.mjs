#!/usr/bin/env node
// The Badger web server.
//
// query() is a Node function, so the browser cannot call the agent directly —
// something has to sit in between. This is that, and nothing more: it serves
// the built frontend and exposes Badger's two passes as two endpoints.
//
//   POST /api/search   deterministic. Composio -> GitHub, live, no model.
//   GET  /api/ask      the agent, streamed over SSE.   [step 4]
//
// Deliberately plain node:http. The repo's only dependencies are the agent's
// own; adding a web framework to a submission whose thesis is "the agent is a
// git repo" buys nothing and costs a paragraph of explanation.
//
// Port 4000 by default, not 3000: 3333 is gitagent's own voice UI and 3000 and
// 5173 are commonly already taken on a dev machine. BADGER_PORT overrides.
//
//   node src/server.mjs          # http://localhost:4000
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { query } from "@open-gitagent/gitagent";
import { search, SearchError } from "./search.mjs";
import { annotateUnverified, extractCitations, verifyCitations } from "./verify-citations.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const WEB_DIST = join(ROOT, "web", "dist");
const PORT = Number(process.env.BADGER_PORT) || 4000;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".png": "image/png",
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
  try {
    if (url.pathname === "/api/search" && req.method === "POST") return await handleSearch(req, res);
    if (url.pathname === "/api/sources" && req.method === "GET") return json(res, 200, sources());
    if (url.pathname === "/api/ask" && req.method === "GET") return await handleAsk(url, req, res);
    if (url.pathname.startsWith("/api/")) return json(res, 404, { error: `no such endpoint: ${url.pathname}` });
    return await serveStatic(url.pathname, res);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) json(res, 500, { error: err?.message ?? "internal error" });
    else res.end();
  }
});

// Whether the boot-time warmup actually reached GitHub. The footer reports
// this rather than a hardcoded "connected", so the UI cannot claim a source it
// does not have — the mockup's "GitHub, Drive and Gmail connected" is exactly
// the sort of thing a reviewer checks.
let githubReachable = false;

/** GET /api/sources -> what Badger can actually search right now. */
function sources() {
  return {
    sources: [
      {
        id: "github",
        label: "GitHub",
        connected: githubReachable,
        detail: process.env.BADGER_GITHUB_REPO ?? "alanmathews9/arkind-internal",
      },
      { id: "drive", label: "Drive", connected: false, detail: "not connected" },
      { id: "gmail", label: "Gmail", connected: false, detail: "not connected" },
    ],
  };
}

/** POST /api/search  {query, limit} -> the results page. No LLM on this path. */
async function handleSearch(req, res) {
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return json(res, 400, { error: "body must be JSON" });
  }
  try {
    return json(res, 200, await search(body.query, { limit: body.limit }));
  } catch (err) {
    if (err instanceof SearchError) return json(res, err.status, { error: err.message });
    throw err;
  }
}

// The same allowlist hooks/allowed-tools.txt enforces, applied in-process.
// Unlike the shell hook this cannot fail open: allowedTools removes everything
// else from the model's schema, so a crashed script cannot leave a tool
// callable. No cli, write, edit, task_tracker or skill_learner.
const ALLOWED_TOOLS = [
  "github_search",
  "github_issue",
  "github_pr",
  "github_file",
  "github_commits",
  "read",
  "memory",
];

/**
 * GET /api/ask?q=… — the second pass, streamed.
 *
 * This is scripts/badger-sdk.mjs with an HTTP wrapper, deliberately: same
 * allowlist, same verification, same refusal to trust a citation nobody
 * retrieved. Watching Badger search is the demo, so tool calls and text
 * deltas are forwarded the moment they arrive rather than buffered into one
 * response at the end.
 *
 * Safe to run from a long-lived server: ensureRepo and its auto-commit live in
 * the CLI entry point (dist/index.js), and dist/sdk.js contains no git calls
 * at all. query() will not commit to the repo on each request.
 */
async function handleAsk(url, req, res) {
  const prompt = (url.searchParams.get("q") ?? "").trim();
  if (!prompt) return json(res, 400, { error: "q is required" });

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const startedAt = Date.now();
  const toolOutputs = [];
  const toolCalls = [];
  const opened = [];
  let answer = "";

  const run = query({ prompt, dir: ROOT, allowedTools: ALLOWED_TOOLS });
  // A browser that navigates away should stop the agent, not leave it burning
  // tokens into a closed socket.
  req.on("close", () => run.abort?.());

  try {
    for await (const msg of run) {
      switch (msg.type) {
        case "tool_use":
          toolCalls.push(msg.toolName);
          recordOpened(opened, msg);
          send("tool", { name: msg.toolName, args: msg.args ?? {} });
          break;
        case "tool_result":
          // Everything Badger actually retrieved. This is the corpus a
          // citation has to appear in to count as verified.
          toolOutputs.push(
            typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
          );
          break;
        case "delta":
          if (msg.deltaType === "text" && msg.content) send("delta", { text: msg.content });
          break;
        case "assistant":
          if (msg.content) answer = msg.content;
          break;
        case "system":
          if (msg.subtype === "error") send("warning", { message: msg.content });
          break;
      }
    }
  } catch (err) {
    send("error", { message: err?.message ?? "the agent failed" });
    return res.end();
  }

  const verification = verifyCitations(answer, toolOutputs);
  const cited = extractCitations(answer);
  const costs = typeof run.costs === "function" ? run.costs() : null;

  send("done", {
    // Bad citations are marked inline rather than withholding the answer: the
    // reader needs to know which claim to distrust, not that something
    // somewhere is wrong.
    answer: annotateUnverified(answer, verification),
    verification,
    toolCalls,
    // What Badger opened, and which of those it went on to cite. The gap
    // between the two is the honesty signal the design asks for: "N items
    // were opened but not cited".
    opened,
    cited: opened.filter((item) => isCited(item, cited)),
    tookMs: Date.now() - startedAt,
    costUsd: costs?.totalCostUsd ?? null,
    inputTokens: costs?.totalInputTokens ?? null,
    outputTokens: costs?.totalOutputTokens ?? null,
  });
  res.end();
}

/** Note what a tool call opened, so the answer can be compared against it. */
function recordOpened(opened, msg) {
  const args = msg.args ?? {};
  const add = (kind, ref, label) => {
    if (ref == null || opened.some((o) => o.kind === kind && o.ref === String(ref))) return;
    opened.push({ kind, ref: String(ref), label: label ?? String(ref) });
  };
  if (msg.toolName === "github_issue") add("issue", args.number, `issue #${args.number}`);
  if (msg.toolName === "github_pr") add("pr", args.number, `PR #${args.number}`);
  if (msg.toolName === "github_file") add("file", args.path, args.path);
}

/** Did the answer actually cite this opened item? */
function isCited(item, cited) {
  if (item.kind === "file") return cited.paths.includes(item.ref);
  return cited.numbers.includes(item.ref);
}

/**
 * Serve the Vite build, falling back to index.html so client-side routes
 * survive a reload. Before `npm run build` has ever run there is no dist, and
 * saying so beats a bare 404.
 */
async function serveStatic(pathname, res) {
  const rel = normalize(pathname).replace(/^(\.\.[/\\])+/, "").replace(/^\/+/, "");
  const candidate = join(WEB_DIST, rel || "index.html");
  const file = (await isFile(candidate)) ? candidate : join(WEB_DIST, "index.html");

  if (!(await isFile(file))) {
    return json(res, 503, {
      error: "the frontend has not been built yet — run `npm run build` in web/, or use the Vite dev server",
    });
  }
  res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
  res.end(await readFile(file));
}

async function isFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/** Read a request body, capped so a stray upload cannot exhaust memory. */
function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body) });
  res.end(body);
}

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`port ${PORT} is already in use — set BADGER_PORT to something else`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, async () => {
  console.log(`badger  http://localhost:${PORT}`);
  // Creating the Composio session costs about four seconds, once per process.
  // Pay it at boot rather than making the first person to search wait for it.
  try {
    await search("badger-warmup", { limit: 1 });
    githubReachable = true;
    console.log("github session warm");
  } catch (err) {
    console.error(`github unreachable — search will fail until this is fixed: ${err.message}`);
  }
});
