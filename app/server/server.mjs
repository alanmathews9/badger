#!/usr/bin/env node
// The Badger web server.
//
// Serves the built frontend and exposes Badger's two passes as two endpoints:
//
//   POST /api/search   deterministic. GitHub, Gmail and Drive, live, no model.
//   POST /api/ask      the agent, streamed over SSE.
//
// Plain node:http, so the repo's only dependencies stay the agent's own.
//
// Port 4000 by default: 3333 is gitagent's own voice UI, 3000 and 5173 are
// commonly taken. BADGER_PORT overrides.
//
//   npm run serve                # http://localhost:4000
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { searchAll, SearchError } from "./search.mjs";
import { hydrateFromDb, startRefreshTimer } from "./index-search.mjs";
import { migrate } from "../../scripts/db-migrate.mjs";
import { authEnabled, clearSessionCookie, hasValidSession, issueSessionCookie, passphraseMatches, sessionUid, tickEnabled, tickTokenMatches } from "./auth.mjs";
import * as historyStore from "./history.mjs";
import { TOOLKITS, TOOLKIT_LABELS, accountFor, listConnections, resolveContext } from "./connections.mjs";
import { budgetStatus, claimAskSlot, clientIp, rateLimit } from "./limits.mjs";
import { splashPage } from "./splash.mjs";
import { parseAskBody } from "./transcript.mjs";
import { RunError, runAgent } from "./run-agent.mjs";
import {
  createSkillFromFile,
  deleteSkill,
  listSkills,
  readSkill,
  updateSkill,
} from "./skills-store.mjs";
import {
  createAgent,
  deleteAgent,
  listAgents,
  listToolCatalog,
  readAgent,
  updateAgent,
} from "./agents-store.mjs";
import { openAgentRepo } from "./agent-repo.mjs";
import { readSchedule, removeSchedule, writeSchedule } from "./schedules-store.mjs";
import { TIMEZONE_LABEL } from "./schedule-cron.mjs";
import { listRuns, readRun, renameAgentRuns } from "./executions.mjs";
import { runDue, runOnce } from "./scheduler.mjs";

// The repo root, which is also the agent directory query() loads. The reach
// from app/ upward into the agent is one-way and never the reverse.
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const WEB_DIST = join(ROOT, "app", "web", "dist");
// Where the agent runs from: a git clone on a long-lived learning branch when
// a repo URL and token are set, ROOT otherwise. See agent-repo.mjs.
const AGENT = openAgentRepo(ROOT);
// The skills the product lists, adds to and edits — always the same directory
// the agent reads, whichever mode is in play.
const SKILLS_DIR = join(AGENT.agentDir, "skills");
// The sub-agents, in the same directory the runtime discovers them from. Each
// one is a full agent folder: its own SOUL.md, tools/ and skills/.
const AGENTS_DIR = join(AGENT.agentDir, "agents");
// The tools a sub-agent may be given, read from the agent's own tools/ — the
// catalogue is whatever Badger itself can call, never a superset.
const TOOLS_DIR = join(AGENT.agentDir, "tools");
// Everything a run needs to find the agent on disk, in one object, because a
// typed question and a scheduled one must resolve to the same four paths.
const RUN_PATHS = { root: ROOT, agentDir: AGENT.agentDir, agentsDir: AGENTS_DIR, skillsDir: SKILLS_DIR, repo: AGENT };
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
    // The splash page's own two brand marks. They carry nothing about the
    // corpus or the sources; the door has to be able to draw itself.
    if (url.pathname === "/favicon.svg") return await serveStatic("/favicon.svg", res);
    if (url.pathname === "/logo.svg") return await serveStatic("/logo.svg", res);
    // Cloud Scheduler cannot hold a session cookie, so the tick carries a
    // shared secret in a header instead and is matched before the gate. It
    // fails closed: with no BADGER_TICK_SECRET configured it refuses
    // everything rather than accepting anything.
    if (url.pathname === "/api/schedules/tick" && req.method === "POST") {
      return await handleTick(req, res);
    }

    if (!hasValidSession(req)) {
      // The app bundle and every API sit behind this.
      if (url.pathname.startsWith("/api/")) return json(res, 401, { error: "not signed in" });
      return html(res, 401, splashPage());
    }

    if (url.pathname === "/api/search" && req.method === "POST") return await handleSearch(req, res);
    if (url.pathname === "/api/skills" && req.method === "GET") return handleSkillsList(res);
    if (url.pathname === "/api/skills" && req.method === "POST") return await handleSkillsCreate(req, res);
    if (url.pathname.startsWith("/api/skills/")) return await handleSkillOne(req, res, url);
    if (url.pathname === "/api/tools-catalog" && req.method === "GET") return handleToolCatalog(res);
    if (url.pathname === "/api/agents" && req.method === "GET") return handleAgentsList(res);
    if (url.pathname === "/api/agents" && req.method === "POST") return await handleAgentsCreate(req, res);
    if (url.pathname.startsWith("/api/agents/")) return await handleAgentOne(req, res, url);
    if (url.pathname === "/api/sources" && req.method === "GET") return await handleSources(req, res);
    if (url.pathname === "/api/ask" && req.method === "POST") return await handleAsk(req, res);
    if (url.pathname.startsWith("/api/chats")) return await handleChats(req, res, url);
    if (url.pathname === "/api/searches") return await handleSearches(req, res);
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
 * The CSP allows Google Fonts and nothing else: no inline script, no frames,
 * no third-party embedding. `no-referrer` stops the URL of a private demo
 * reaching every site a user clicks through to.
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
  // microphone=(self) or dictation is blocked with no prompt and no error.
  res.setHeader("permissions-policy", "camera=(), microphone=(self), geolocation=()");
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
// this rather than a hardcoded "connected".
let githubReachable = false;

/**
 * GET /api/sources -> what THIS visitor can search right now.
 *
 * `mode` is "own" when they have connected their own GitHub, "demo" for the
 * shared Arkind corpus, "none" when they must connect first. The UI says
 * which: a result page that hides whose data it is is a trap.
 */
async function handleSources(req, res) {
  const ctx = await resolveContext();
  const state = ctx.userId ? await listConnections(ctx.userId) : {};

  return json(res, 200, {
    mode: ctx.mode,
    sources: await Promise.all(
      TOOLKITS.map(async (id) => {
        const connected = Boolean(state[id]) && (id !== "github" || githubReachable);
        // Whose account: "connected" does not say which mailbox.
        return {
          id: id === "googledrive" ? "drive" : id,
          label: TOOLKIT_LABELS[id],
          connected,
          account: connected ? await accountFor(ctx.userId, id) : null,
        };
      }),
    ),
  });
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
  const ctx = await resolveContext();
  if (ctx.mode === "none") {
    return json(res, 409, { error: "No sources are configured, so there is nothing to search." });
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


/**
 * POST /api/ask  {question, history} — the second pass, streamed over SSE.
 *
 * scripts/badger-sdk.mjs with an HTTP wrapper: same allowlist, same
 * verification, same refusal to trust an unretrieved citation. Tool calls and
 * text deltas are forwarded as they arrive rather than buffered.
 *
 * Safe from a long-lived server: ensureRepo and its auto-commit live in the
 * CLI entry point, and dist/sdk.js contains no git calls at all.
 */
async function handleAsk(req, res) {
  // Follow-ups carry the conversation in the request: dist/sdk.js never loads
  // prior messages and `sessionId` is only a logging label. Each follow-up
  // therefore re-retrieves, at about a third of a cent. transcript.mjs owns
  // validation and the character budget.
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return json(res, 400, { error: "body must be JSON" });
  }
  const parsed = parseAskBody(body);
  if (parsed.error) return json(res, 400, { error: parsed.error });

  const limited = rateLimit(req, "ask");
  if (limited) return json(res, 429, { error: limited });

  // Answers are the expensive path: real Vertex credits, real Composio quota.
  // The slot is claimed before any work starts and released exactly once.
  const slot = claimAskSlot();
  if (slot.error) return json(res, 429, { error: slot.error });

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    const result = await runAgent({
      question: parsed.question,
      history: parsed.history,
      skill: parsed.skill,
      agent: parsed.agent,
      emit: send,
      // `res`, not `req`: an IncomingMessage emits 'close' when the request
      // BODY is done, which already happened in readBody, so the listener
      // never fired and a stopped run held its concurrency slot.
      // `writableEnded` distinguishes a real disconnect from our own end();
      // slot.release() is idempotent.
      onRun: (run) =>
        res.on("close", () => {
          if (!res.writableEnded) run.abort?.();
          slot.release();
        }),
      paths: RUN_PATHS,
    });
    send("done", result);
  } catch (err) {
    send("error", {
      message: err instanceof RunError ? err.message : "Badger could not finish that answer.",
    });
  } finally {
    slot.release();
    res.end();
  }
}


/**
 * GET /api/skills — what the agent knows how to do, for the picker.
 * POST /api/skills — a person adds a skill through the UI. The file lands in
 * the agent's own skills/ tree and the next question can use it.
 */
function handleSkillsList(res) {
  return json(res, 200, { skills: listSkills(SKILLS_DIR) });
}

/**
 * GET, PUT and DELETE /api/skills/:slug — the manage-skills page.
 *
 * PUT carries a whole SKILL.md, never a set of fields: a server that merges
 * fields silently drops whatever it does not know about.
 *
 * The slug is never joined onto a path here — `skills-store` validates it
 * against a kebab-case regex first, so traversal fails before reaching disk.
 *
 * Every write is rate-limited on the same bucket as asking.
 */
async function handleSkillOne(req, res, url) {
  const slug = decodeURIComponent(url.pathname.slice("/api/skills/".length));
  const dir = SKILLS_DIR;
  try {
    if (req.method === "GET") return json(res, 200, readSkill(dir, slug));

    const limited = rateLimit(req, "ask");
    if (limited) return json(res, 429, { error: limited });

    if (req.method === "PUT") {
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        return json(res, 400, { error: "body must be JSON" });
      }
      const saved = updateSkill(dir, slug, body?.content);
      await AGENT.saveEdit("skill", "update", slug);
      return json(res, 200, saved);
    }
    if (req.method === "DELETE") {
      const removed = deleteSkill(dir, slug);
      await AGENT.saveEdit("skill", "delete", slug);
      return json(res, 200, removed);
    }
    return json(res, 405, { error: "method not allowed" });
  } catch (err) {
    // Every throw from the store is a message written for a person — an
    // invalid slug, a missing skill, a refused delete. 404 only for the one
    // that genuinely means "not here".
    const missing = err.message === "no such skill";
    return json(res, missing ? 404 : 400, { error: err.message });
  }
}

async function handleSkillsCreate(req, res) {
  const limited = rateLimit(req, "ask");
  if (limited) return json(res, 429, { error: limited });
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return json(res, 400, { error: "body must be JSON" });
  }
  try {
    // One way in: a whole SKILL.md. Written in the box or loaded from a file,
    // it is the same string by the time it arrives here.
    const { slug } = createSkillFromFile(SKILLS_DIR, body?.file);
    await AGENT.saveEdit("skill", "create", slug);
    return json(res, 201, { slug });
  } catch (err) {
    return json(res, 400, { error: err.message });
  }
}


/**
 * The sub-agents.
 *
 *   GET    /api/agents          every agent, for the list and the picker
 *   POST   /api/agents          create one from the editor's fields
 *   GET    /api/agents/<slug>   one agent, with its instructions
 *   PUT    /api/agents/<slug>   replace its definition
 *   DELETE /api/agents/<slug>   remove the folder
 *
 * Unlike a skill, which is one file a person writes, an agent is a directory
 * of generated files — so this takes fields rather than a document. The store
 * owns validation and slug safety; the slug is never joined onto a path here.
 *
 * Every write shares the answer bucket's rate limit.
 */
function handleAgentsList(res) {
  return json(res, 200, { agents: listAgents(AGENTS_DIR) });
}

/** GET /api/tools-catalog — the tools an agent can be given. */
function handleToolCatalog(res) {
  return json(res, 200, { tools: listToolCatalog(TOOLS_DIR) });
}

async function handleAgentsCreate(req, res) {
  const limited = rateLimit(req, "ask");
  if (limited) return json(res, 429, { error: limited });
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return json(res, 400, { error: "body must be JSON" });
  }
  try {
    const { slug } = createAgent(AGENTS_DIR, body, { rootDir: AGENT.agentDir });
    await AGENT.saveEdit("agent", "create", slug);
    return json(res, 201, { slug });
  } catch (err) {
    return json(res, 400, { error: err.message });
  }
}

async function handleAgentOne(req, res, url) {
  // /api/agents/<slug>, and the two collections that hang off one agent:
  // /api/agents/<slug>/schedule and /api/agents/<slug>/executions[/<id>].
  const [rawSlug, section, item] = url.pathname
    .slice("/api/agents/".length)
    .split("/")
    .map((part) => decodeURIComponent(part));
  const slug = rawSlug;
  try {
    if (section === "schedule") return await handleSchedule(req, res, slug);
    if (section === "executions") return await handleExecutions(req, res, slug, item);
    if (section) return json(res, 404, { error: "no such endpoint" });

    if (req.method === "GET") return json(res, 200, readAgent(AGENTS_DIR, slug));

    const limited = rateLimit(req, "ask");
    if (limited) return json(res, 429, { error: limited });

    if (req.method === "PUT") {
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        return json(res, 400, { error: "body must be JSON" });
      }
      const saved = updateAgent(AGENTS_DIR, slug, body, { rootDir: AGENT.agentDir });
      // A rename moved the folder; the Playground conversations filed under
      // the old name have to follow it or they are listed by no page.
      await AGENT.saveEdit("agent", "update", saved.slug);
      if (saved.renamedFrom && historyStore.dbConfigured()) {
        try {
          await historyStore.renameAgentChats(saved.renamedFrom, saved.slug);
          // Its executions too. The schedule YAML travels inside the folder
          // and needs no help; its history is in Postgres and does.
          await renameAgentRuns(saved.renamedFrom, saved.slug);
        } catch (err) {
          // The agent is already renamed and that is the important half.
          console.warn(`[agents] chat sessions not moved: ${err.message}`);
        }
      }
      return json(res, 200, saved);
    }
    if (req.method === "DELETE") {
      const removed = deleteAgent(AGENTS_DIR, slug, { rootDir: AGENT.agentDir });
      await AGENT.saveEdit("agent", "delete", removed.slug);
      return json(res, 200, removed);
    }
    return json(res, 405, { error: "method not allowed" });
  } catch (err) {
    const missing = err.message === "no such agent";
    return json(res, missing ? 404 : 400, { error: err.message });
  }
}


/**
 * A sub-agent's schedule — the saved question it asks itself on an interval.
 *
 *   GET    /api/agents/<slug>/schedule   the one schedule, or null
 *   PUT    /api/agents/<slug>/schedule   create or replace it
 *   POST   /api/agents/<slug>/schedule   run it now, whether or not it is due
 *   DELETE /api/agents/<slug>/schedule   remove it
 *
 * Every write calls AGENT.saveEdit, exactly as the agent and skill routes do.
 * In repo mode the agent directory is a clone under tmpdir() and the instance
 * recycles after a few minutes of quiet, so without it the schedule is gone
 * before anyone comes back to read what it produced.
 */
async function handleSchedule(req, res, slug) {
  if (req.method === "GET") {
    return json(res, 200, { schedule: await readSchedule(AGENTS_DIR, slug), timezone: TIMEZONE_LABEL });
  }

  // Everything below either writes to the repo or spends an answer. Same
  // limit as asking a question, for the same reason.
  const limited = rateLimit(req, "ask");
  if (limited) return json(res, 429, { error: limited });

  if (req.method === "PUT") {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return json(res, 400, { error: "body must be JSON" });
    }
    const saved = await writeSchedule(AGENTS_DIR, slug, body);
    await AGENT.saveEdit("schedule", "update", slug);
    return json(res, 200, { schedule: saved, timezone: TIMEZONE_LABEL });
  }

  if (req.method === "POST") {
    // Run now. The same code path the tick takes, with the waiting removed —
    // so what a reviewer sees demonstrated is what actually runs unattended.
    const ran = await runOnce(RUN_PATHS, slug);
    return json(res, 200, { ran, schedule: await readSchedule(AGENTS_DIR, slug) });
  }

  if (req.method === "DELETE") {
    const removed = await removeSchedule(AGENTS_DIR, slug);
    if (removed) await AGENT.saveEdit("schedule", "delete", slug);
    return json(res, 200, { removed });
  }

  return json(res, 405, { error: "method not allowed" });
}

/**
 * What the schedule has produced.
 *
 *   GET /api/agents/<slug>/executions        the runs, newest first
 *   GET /api/agents/<slug>/executions/<id>   one of them in full
 *
 * `persisted: false` is a normal answer here for the same reason it is on
 * chats: Badger runs without a database, and a scheduler that keeps no
 * history is a smaller product rather than a broken one. It does mean the
 * Executions tab has nothing to show, which is what the flag says.
 */
async function handleExecutions(req, res, slug, id) {
  if (req.method !== "GET") return json(res, 405, { error: "method not allowed" });
  // Checked even though nothing here joins it onto a path, so an unknown
  // agent is a 404 rather than an empty list that reads as "never run".
  readAgent(AGENTS_DIR, slug);
  if (!historyStore.dbConfigured()) return json(res, 200, { persisted: false, runs: [], run: null });
  try {
    if (id) return json(res, 200, { persisted: true, run: await readRun(slug, id) });
    return json(res, 200, { persisted: true, runs: await listRuns(slug) });
  } catch (err) {
    console.warn(`[executions] unavailable: ${err.message}`);
    return json(res, 200, { persisted: false, runs: [], run: null });
  }
}

/**
 * POST /api/schedules/tick — Cloud Scheduler, every 15 minutes, forever.
 *
 * One job for the whole product. It never changes as schedules come and go,
 * so the files stay the only place a schedule exists. See scheduler.mjs.
 */
async function handleTick(req, res) {
  if (!tickEnabled) return json(res, 404, { error: "no such endpoint" });
  // A header rather than a query string: a URL is logged by every proxy
  // between Cloud Scheduler and here, and a secret in a log is not a secret.
  if (!tickTokenMatches(req.headers["x-badger-tick"])) {
    return json(res, 401, { error: "not authorised" });
  }
  try {
    return json(res, 200, await runDue(RUN_PATHS));
  } catch (err) {
    // The tick answering 500 makes Cloud Scheduler retry, which would spend
    // the budget again on work that already half happened. It reports the
    // failure with a 200 instead, and the failed runs are recorded as rows.
    console.error("[tick]", err);
    return json(res, 200, { error: "the tick failed", ran: [] });
  }
}

/**
 * Chat history.
 *
 *   GET    /api/chats        this browser's conversations, titles only
 *   GET    /api/chats/<id>   one conversation, as turns
 *   PUT    /api/chats/<id>   write it, replacing what was there
 *
 * **`persisted: false` is a normal answer, not an error.** With no
 * DATABASE_URL the client keeps its history in localStorage and the product
 * works unchanged — which is what lets a clone of this repo run with nothing
 * but a Composio key. Every response carries the flag so the client never has
 * to guess from a status code.
 */
async function handleChats(req, res, url) {
  if (!historyStore.dbConfigured()) return json(res, 200, { persisted: false, chats: [] });
  try {
    return await chatsRoute(req, res, url);
  } catch (err) {
    // Configured but unreachable is not the same as absent, and it used to be
    // worse than absent: the query threw, the generic 500 handler answered,
    // and the client's catch turned that into an empty array — so the pane
    // asserted "No conversations yet" to someone who has plenty. Degrade to
    // the shape the client already understands for a server with no database
    // at all, so it falls back to localStorage rather than lying.
    console.warn(`[history] chats unavailable: ${err.message}`);
    return json(res, 200, { persisted: false, chats: [], chat: null, saved: false });
  }
}

async function chatsRoute(req, res, url) {

  const uid = sessionUid(req);
  const id = url.pathname.slice("/api/chats/".length);

  if (url.pathname === "/api/chats" && req.method === "GET") {
    // No `?agent=` means the /chat list, which is Badger's own threads only —
    // a Playground conversation belongs to its agent's page, not here.
    const agent = agentSlug(url.searchParams.get("agent"));
    return json(res, 200, { persisted: true, chats: await historyStore.listChats(uid, { agent }) });
  }

  // Ids are minted in the browser and travel in a path segment, so they are
  // checked rather than trusted: anything but the base36 shape newChatId
  // produces is refused before it reaches a query.
  if (!/^[a-z0-9]{6,32}$/.test(id)) return json(res, 400, { error: "bad chat id" });

  if (req.method === "GET") {
    const chat = await historyStore.getChat(uid, id);
    return json(res, 200, { persisted: true, chat });
  }

  if (req.method === "PUT") {
    const body = JSON.parse(await readBody(req, 512 * 1024));
    const title = String(body?.title ?? "").slice(0, 300);
    const turns = Array.isArray(body?.turns) ? body.turns : [];
    if (!title || !turns.length) return json(res, 400, { error: "title and turns are required" });
    const agent = agentSlug(body?.agent);
    const ok = await historyStore.saveChat(uid, id, { title, turns, agent });
    // A false here means the id exists under a different uid. Same answer as
    // a malformed request rather than "that one is someone else's", which
    // would confirm the id exists.
    return json(res, ok ? 200 : 400, { persisted: true, saved: ok });
  }

  return json(res, 405, { error: "method not allowed" });
}

/**
 * A sub-agent slug as it may appear on a conversation, or null.
 *
 * Same shape the store enforces when it creates a folder, applied here as
 * well: this value reaches a query, and a conversation must never be filed
 * under a name no agent could have.
 */
function agentSlug(value) {
  const slug = String(value ?? "").trim();
  return /^[a-z0-9][a-z0-9-]{0,39}$/.test(slug) ? slug : null;
}

/**
 * Search history.
 *
 *   GET  /api/searches   recent queries, newest first
 *   POST /api/searches   record one
 *
 * The query and the facts already displayed — never the results. Onyx's
 * search_query table gives the reason in its own comment: the reply to a past
 * search is to run it again, because the corpus may have changed since.
 */
async function handleSearches(req, res) {
  if (!historyStore.dbConfigured()) return json(res, 200, { persisted: false, searches: [] });
  try {
    return await searchesRoute(req, res);
  } catch (err) {
    console.warn(`[history] searches unavailable: ${err.message}`);
    return json(res, 200, { persisted: false, searches: [] });
  }
}

async function searchesRoute(req, res) {

  const uid = sessionUid(req);

  if (req.method === "GET") {
    return json(res, 200, { persisted: true, searches: await historyStore.listSearches(uid) });
  }

  if (req.method === "POST") {
    const body = JSON.parse(await readBody(req, 8 * 1024));
    const text = String(body?.query ?? "").trim().slice(0, 500);
    if (!text) return json(res, 400, { error: "query is required" });
    await historyStore.recordSearch(uid, {
      query: text,
      resultCount: numberOrNull(body?.resultCount),
      path: body?.path === "index" || body?.path === "live" ? body.path : null,
      tookMs: numberOrNull(body?.tookMs),
      apiCalls: numberOrNull(body?.apiCalls),
    });
    return json(res, 200, { persisted: true });
  }

  return json(res, 405, { error: "method not allowed" });
}

/** Numbers arriving from a client are advisory: keep them only if they are. */
function numberOrNull(value) {
  return Number.isFinite(value) ? Math.trunc(value) : null;
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
  res.writeHead(200, {
    "content-type": MIME[extname(file)] ?? "application/octet-stream",
    "cache-control": cacheControl(file),
  });
  res.end(await readFile(file));
}


/**
 * How long the browser may keep this file.
 *
 * There were no cache headers at all, which is not "no caching" — with nothing
 * said, a browser applies its own heuristic, and the file it guesses wrong
 * about is index.html. That page names the hashed bundle to load, so a stale
 * copy of it pins the whole app to a previous build: new code deploys, the
 * browser keeps running the old one, and the mismatch shows up as features
 * that silently do nothing. It cost us a test session — the UI kept its
 * history in localStorage while the database sat there working.
 *
 * So the two kinds of file get opposite treatment, which is only safe because
 * Vite content-hashes the assets:
 *
 *   index.html   revalidate every time. It is small, and it is the only thing
 *                that knows which bundle is current.
 *   /assets/*    cache for a year. The filename contains a hash of the
 *                contents, so a changed file is a different URL and a cached
 *                one can never be stale.
 */
function cacheControl(file) {
  if (extname(file) === ".html") return "no-cache";
  return file.includes("/assets/")
    ? "public, max-age=31536000, immutable"
    : "public, max-age=3600";
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

// Bring the schema up to date before anything reads it. There is no shell
// step in the container and no human between `gcloud run deploy` and the
// first request, so a migration that has to be remembered is a migration that
// eventually is not. It is a no-op after the first boot, it never throws — a
// server that cannot migrate still starts and serves live search — and
// `--max-instances 1` means nothing races it.
try {
  const applied = await migrate({ quiet: true });
  if (applied) console.log(`[db] applied ${applied} migration(s)`);
} catch (err) {
  console.warn(`[db] could not migrate: ${err.message}`);
}

// Recreate the index from Postgres BEFORE the port opens, not after. Cloud Run
// starts sending traffic the moment the socket is listening, and a request
// that arrives during hydration would find no index, answer live, and spawn a
// crawl — spending forty seconds of API calls to rebuild something that was
// two hundred milliseconds away. Boot pays the query; nobody else does.
//
// An empty database is not an error here: hydrateFromDb says so and returns
// false, and the first search builds the index in the background. So a fresh
// deploy against a fresh database needs no manual step at all.
await hydrateFromDb();

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
    startRefreshTimer();
  } catch (err) {
    console.error(`github unreachable — search will fail until this is fixed: ${err.message}`);
  }
});
