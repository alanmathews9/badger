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
import { searchAll, SearchError } from "./search.mjs";
import { readAllowedTools } from "./allowed-tools.mjs";
import { authEnabled, clearSessionCookie, hasValidSession, issueSessionCookie, passphraseMatches, userIdFor } from "./auth.mjs";
import {
  TOOLKITS,
  TOOLKIT_LABELS,
  beginConnect,
  chooseRepo,
  disconnectSource,
  githubLogin,
  listConnections,
  listRepositories,
  resolveContext,
} from "./connections.mjs";
import { budgetStatus, claimAskSlot, clientIp, rateLimit } from "./limits.mjs";
import { splashPage } from "./splash.mjs";
import { annotateUnverified, extractCitations, verifyCitations } from "./verify-citations.mjs";

// The repo root, which is also the agent directory query() loads. The server
// lives two levels down under app/ precisely so that this is an explicit,
// one-way reach *upward* into the agent — never the reverse.
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const WEB_DIST = join(ROOT, "app", "web", "dist");
// Cloud Run injects PORT and expects the server to listen on it. BADGER_PORT
// is the local convention; PORT wins so the same image runs in both places.
const PORT = Number(process.env.PORT || process.env.BADGER_PORT) || 4000;

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
  setSecurityHeaders(res);

  try {
    // Unauthenticated and open to everyone: the gate itself, its icon, and a
    // liveness probe carrying no data. Everything else is behind the session.
    if (url.pathname === "/api/login" && req.method === "POST") return await handleLogin(req, res);
    if (url.pathname === "/api/logout") return logout(res);
    if (url.pathname === "/api/health") return json(res, 200, { ok: true, ...budgetStatus() });
    if (url.pathname === "/favicon.svg") return await serveStatic("/favicon.svg", res);

    if (!hasValidSession(req)) {
      // The app bundle and every API sit behind this, so an unauthenticated
      // visitor learns nothing beyond what the splash page chooses to say.
      if (url.pathname.startsWith("/api/")) return json(res, 401, { error: "not signed in" });
      return html(res, 401, splashPage());
    }

    if (url.pathname === "/api/search" && req.method === "POST") return await handleSearch(req, res);
    if (url.pathname === "/api/sources" && req.method === "GET") return await handleSources(req, res);
    if (url.pathname === "/api/connect" && req.method === "POST") return await handleConnect(req, res, url);
    if (url.pathname === "/api/connect/callback") return await handleConnectCallback(url, res);
    if (url.pathname === "/api/connections" && req.method === "GET") return await handleConnections(req, res);
    if (url.pathname === "/api/connections/disconnect" && req.method === "POST") return await handleDisconnect(req, res);
    if (url.pathname === "/api/repos" && req.method === "GET") return await handleRepos(req, res);
    if (url.pathname === "/api/repos" && req.method === "POST") return await handleChooseRepo(req, res);
    if (url.pathname === "/api/ask" && req.method === "GET") return await handleAsk(url, req, res);
    if (url.pathname.startsWith("/api/")) return json(res, 404, { error: "no such endpoint" });
    return await serveStatic(url.pathname, res);
  } catch (err) {
    // Log the detail, return none of it: an error message can carry file paths
    // and library internals, and this endpoint is public.
    console.error(`[${new Date().toISOString()}] ${url.pathname}`, err);
    if (!res.headersSent) json(res, 500, { error: "something went wrong on our side" });
    else res.end();
  }
});

/**
 * Headers that hold whether or not the tunnel is configured correctly.
 *
 * The CSP allows Google Fonts, which the design depends on, and nothing else —
 * no inline script anywhere in the app, no frames, and no third party can
 * embed this. `no-referrer` matters more than it looks: it stops the URL of a
 * private demo being handed to every site a user clicks through to.
 */
function setSecurityHeaders(res) {
  res.setHeader(
    "content-security-policy",
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "form-action 'self'",
    ].join("; "),
  );
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("x-frame-options", "DENY");
  res.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("strict-transport-security", "max-age=31536000; includeSubDomains");
}

/** POST /api/login — the whole of the auth flow. */
async function handleLogin(req, res) {
  const limited = rateLimit(req, "login");
  if (limited) return html(res, 429, splashPage({ error: limited }));

  const body = await readBody(req);
  const passphrase = new URLSearchParams(body).get("passphrase") ?? "";

  if (!passphraseMatches(passphrase)) {
    console.warn(`[auth] failed passphrase from ${clientIp(req)}`);
    return html(res, 401, splashPage({ error: "That passphrase is not right." }));
  }

  // 303 so the browser follows with GET, and the submitted form is not in
  // history. The passphrase was in a POST body, so it never touched the URL.
  res.writeHead(303, { location: "/", "set-cookie": issueSessionCookie() });
  res.end();
}

function logout(res) {
  res.writeHead(303, { location: "/", "set-cookie": clearSessionCookie() });
  res.end();
}

function html(res, status, body) {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

// Whether the boot-time warmup actually reached GitHub. The footer reports
// this rather than a hardcoded "connected", so the UI cannot claim a source it
// does not have — the mockup's "GitHub, Drive and Gmail connected" is exactly
// the sort of thing a reviewer checks.
let githubReachable = false;

/**
 * GET /api/sources -> what THIS visitor can search right now.
 *
 * `mode` is the honest part: "own" when they have connected their own GitHub,
 * "demo" when they are looking at the shared Arkind corpus, "none" when they
 * must connect before anything works. The UI says which, because a search
 * result page that does not tell you whose data it is is a trap.
 */
async function handleSources(req, res) {
  const userId = userIdFor(req);
  const ctx = await resolveContext(userId);
  // Drive and Gmail used to be hardcoded as "not connected" here, which stayed
  // in place after they were wired up — so the Tools page claimed two of the
  // three sources were missing while the agent was searching them.
  const own = ctx.mode === "own" ? await listConnections(userId) : null;
  const demo = ctx.mode === "demo" ? await listConnections(ctx.userId) : null;
  const state = own ?? demo ?? {};

  return json(res, 200, {
    mode: ctx.mode,
    repo: ctx.repo,
    sources: TOOLKITS.map((id) => {
      const connected = Boolean(state[id]) && (id !== "github" || githubReachable);
      return {
        id: id === "googledrive" ? "drive" : id,
        label: TOOLKIT_LABELS[id],
        connected,
        own: ctx.mode === "own",
        detail:
          id === "github"
            ? connected
              ? (ctx.repo ?? "no repository chosen")
              : "not connected"
            : connected
              ? "connected"
              : "not connected",
      };
    }),
  });
}

/** POST /api/connect {toolkit} -> the Composio Connect Link to send the browser to. */
async function handleConnect(req, res, url) {
  const limited = rateLimit(req, "search");
  if (limited) return json(res, 429, { error: limited });
  try {
    const { toolkit } = JSON.parse(await readBody(req));
    const callbackUrl = `${url.origin}/api/connect/callback?source=${encodeURIComponent(toolkit)}`;
    const { redirectUrl } = await beginConnect(userIdFor(req), toolkit, callbackUrl);
    return json(res, 200, { redirectUrl });
  } catch (err) {
    // "already connected" is the caller's mistake and safe to repeat back;
    // anything else could carry internals, so it stays in the log.
    if (/already connected|unknown source/.test(err?.message ?? "")) {
      return json(res, 409, { error: err.message });
    }
    console.error("[connect]", err);
    return json(res, 502, { error: "could not start the connection" });
  }
}

/**
 * Where Composio sends the browser back after authorising.
 *
 * Composio has already stored the credential by this point; there is nothing
 * to receive. Bounce back into the app, which re-reads /api/connections rather
 * than trusting a query parameter it did not sign.
 */
async function handleConnectCallback(url, res) {
  const source = url.searchParams.get("source") ?? "";
  const safe = TOOLKITS.includes(source) ? source : "";
  res.writeHead(303, { location: safe ? `/?connected=${safe}` : "/" });
  res.end();
}

/** GET /api/connections — one connection per source, or none. */
async function handleConnections(req, res) {
  const userId = userIdFor(req);
  try {
    const connections = await listConnections(userId);
    const ctx = await resolveContext(userId);
    return json(res, 200, {
      mode: ctx.mode,
      repo: ctx.repo,
      login: connections.github ? await githubLogin(userId) : null,
      sources: TOOLKITS.map((id) => ({
        id,
        label: TOOLKIT_LABELS[id],
        connected: Boolean(connections[id]),
        connectedAt: connections[id]?.createdAt ?? null,
      })),
    });
  } catch (err) {
    console.error("[connections]", err);
    return json(res, 502, { error: "could not read your connections" });
  }
}

/**
 * POST /api/connections/disconnect {toolkit} — remove one of *your* sources.
 *
 * The caller names a source, never an account id. There is therefore no id a
 * visitor could post to reach someone else's connection: connections.mjs looks
 * up the asking session's own and deletes only that.
 */
async function handleDisconnect(req, res) {
  try {
    const { toolkit } = JSON.parse(await readBody(req));
    const removed = await disconnectSource(userIdFor(req), toolkit);
    return json(res, removed ? 200 : 404, removed ? { disconnected: true } : { error: "not connected" });
  } catch (err) {
    console.error("[disconnect]", err);
    return json(res, 502, { error: "could not disconnect" });
  }
}

async function handleRepos(req, res) {
  try {
    return json(res, 200, { repos: await listRepositories(userIdFor(req)) });
  } catch (err) {
    console.error("[repos]", err);
    return json(res, 502, { error: "could not list repositories — is GitHub connected?" });
  }
}

async function handleChooseRepo(req, res) {
  try {
    const { repo } = JSON.parse(await readBody(req));
    await chooseRepo(userIdFor(req), repo);
    return json(res, 200, { repo });
  } catch (err) {
    return json(res, 400, { error: err?.message ?? "bad request" });
  }
}

/** POST /api/search  {query, limit} -> the results page. No LLM on this path. */
async function handleSearch(req, res) {
  const limited = rateLimit(req, "search");
  if (limited) return json(res, 429, { error: limited });

  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return json(res, 400, { error: "body must be JSON" });
  }
  const ctx = await resolveContext(userIdFor(req));
  if (ctx.mode === "none") {
    return json(res, 409, { error: "Connect GitHub from the Tools page before searching." });
  }
  if (ctx.mode === "own" && !ctx.repo) {
    return json(res, 409, { error: "Choose a repository on the Tools page before searching." });
  }

  try {
    // All three sources, merged and re-scored locally. A source that fails
    // comes back reported rather than omitted — see searchAll.
    return json(res, 200, await searchAll(body.query, { limit: body.limit, ...ctx }));
  } catch (err) {
    if (err instanceof SearchError) return json(res, err.status, { error: err.message });
    throw err;
  }
}

// The same allowlist hooks/allowed-tools.txt enforces, applied in-process.
// Unlike the shell hook this cannot fail open: allowedTools removes everything
// else from the model's schema, so a crashed script cannot leave a tool
// callable. No cli, write, edit, task_tracker or skill_learner.
//
// Read from the file rather than restated, so that adding a source in one
// place cannot leave the agent unable to reach it here.
const ALLOWED_TOOLS = readAllowedTools();

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
  const question = (url.searchParams.get("q") ?? "").trim();
  if (!question) return json(res, 400, { error: "q is required" });

  // Follow-ups carry their own context, because the runtime has nowhere to
  // keep it. `sessionId` looks like conversation resumption but is only a
  // logging label — dist/sdk.js never loads prior messages. Real multi-turn
  // would mean holding one query() open and feeding it the AsyncIterable
  // prompt form, which needs server-side session state and its own expiry;
  // this is the honest version until that exists. Each follow-up re-retrieves,
  // which costs about a third of a cent.
  if (question.length > 500) return json(res, 400, { error: "that question is too long" });

  const limited = rateLimit(req, "ask");
  if (limited) return json(res, 429, { error: limited });

  // Answers are the expensive path: real Vertex credits, real Composio quota.
  // The slot is claimed before any work starts and released exactly once.
  const slot = claimAskSlot();
  if (slot.error) return json(res, 429, { error: slot.error });

  const context = (url.searchParams.get("context") ?? "").trim().slice(0, 4000);
  const prompt = context ? `${context}\n\nFollow-up question: ${question}` : question;

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

  const ctx = await resolveContext(userIdFor(req));
  if (ctx.mode === "none" || (ctx.mode === "own" && !ctx.repo)) {
    send("error", { message: "Connect GitHub and choose a repository on the Tools page first." });
    slot.release();
    return res.end();
  }

  // maxTurns bounds a runaway loop, which is the failure mode that costs money
  // rather than time.
  const run = query({
    prompt,
    dir: ROOT,
    allowedTools: ALLOWED_TOOLS,
    maxTurns: 12,
    // Whose GitHub this run reads. Declarative tools are spawned as
    // subprocesses with a snapshot of process.env, so an environment variable
    // would race between concurrent visitors. A preToolUse closure carries the
    // identity in the call's own arguments instead — per request, in process,
    // and invisible to the model.
    hooks: {
      preToolUse: (hookCtx) => ({
        action: "modify",
        args: {
          ...hookCtx.args,
          _badger_user: ctx.userId,
          _badger_repo: ctx.repo,
        },
      }),
    },
  });

  // A browser that navigates away should stop the agent, not leave it burning
  // tokens into a closed socket.
  req.on("close", () => {
    run.abort?.();
    slot.release();
  });

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
    console.error("[ask]", err);
    send("error", { message: "Badger could not finish that answer." });
    slot.release();
    return res.end();
  } finally {
    slot.release();
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
    // Sources come from what the answer actually cites, not from what was
    // opened in full. An answer can legitimately cite an issue it only saw in
    // search results, and an earlier version of this — which listed only
    // explicitly-opened threads — reported "0 sources" under an answer
    // carrying four verified citations.
    cited: resolveCitations(cited, toolOutputs),
    // Threads Badger opened in full and then did not cite. This is the gap the
    // design asks for: "N items were opened but not cited". It is deliberately
    // not "everything that appeared in a search result" — those were listed,
    // not read, and calling them opened would overstate the work.
    opened,
    uncited: opened.filter((item) => !isCited(item, cited)),
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

/**
 * Turn the answer's citations into source cards, recovering each one's title
 * from the tool output that produced it.
 *
 * The tools print issues as "#12 [issue, open] Title", so the title is
 * available without a further API call. When it cannot be recovered the card
 * falls back to the bare reference rather than inventing a name.
 */
function resolveCitations(cited, toolOutputs) {
  const corpus = toolOutputs.join("\n");
  const items = [];

  for (const number of cited.numbers) {
    const match = corpus.match(new RegExp(`#${number} \\[(issue|PR), ([^\\]]*)\\] (.+)`));
    items.push({
      kind: match?.[1] === "PR" ? "pr" : "issue",
      ref: number,
      label: match?.[3]?.trim() || `#${number}`,
      detail: match ? `${match[1] === "PR" ? "pull request" : "issue"} #${number}, ${match[2]}` : `#${number}`,
    });
  }

  for (const path of cited.paths) {
    items.push({ kind: "file", ref: path, label: path, detail: "file" });
  }

  return items;
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

// Cloud Run sends SIGTERM before stopping an instance. Close the listener so
// in-flight answers finish streaming instead of being cut off mid-sentence.
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    console.log(`${signal} — shutting down`);
    server.close(() => process.exit(0));
    // Do not wait forever on a client holding an SSE stream open.
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`port ${PORT} is already in use — set BADGER_PORT to something else`);
    process.exit(1);
  }
  throw err;
});

// Fail safe, not open. With no passphrase configured the gate is off, so the
// server refuses to accept connections from anywhere but this machine. The
// alternative — a default passphrase — is how a gate becomes decorative.
const HOST = authEnabled ? (process.env.BADGER_HOST ?? "0.0.0.0") : "127.0.0.1";

server.listen(PORT, HOST, async () => {
  console.log(`badger  http://localhost:${PORT}`);
  if (authEnabled) {
    console.log("gate: on (BADGER_PASSPHRASE set)");
  } else {
    console.warn("gate: OFF — no BADGER_PASSPHRASE, so binding to 127.0.0.1 only.");
    console.warn("      Set BADGER_PASSPHRASE before exposing this anywhere.");
  }
  // Creating the Composio session costs about four seconds, once per process.
  // Pay it at boot rather than making the first person to search wait for it.
  try {
    await searchAll("badger-warmup", { limit: 1 });
    githubReachable = true;
    console.log("github session warm");
  } catch (err) {
    console.error(`github unreachable — search will fail until this is fixed: ${err.message}`);
  }
});
