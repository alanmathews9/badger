// The index path for /api/search — and the fallback rule that keeps it honest.
//
// When `.gitagent/index/` holds a fresh index, a search is answered from it:
// BM25 with real IDF, typo correction against the corpus vocabulary, zero API
// calls, single-digit milliseconds. When the index is missing or stale, the
// caller (search.mjs) falls back to today's live federated search, and this
// module quietly starts one background build so the next search can do
// better — that is the lazy build the plan specifies for Cloud Run's
// ephemeral disk, and it is the ONLY implicit rebuild: a fresh-enough index
// is never rebuilt behind the user's back.
//
// Two sources of truth will disagree between refreshes, so every response
// says which path answered and how old the copy is. A status display that
// has never been seen wrong is the failure this project keeps finding;
// the age figure is real and the path label is load-bearing.
import { statSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadIndex, createSearcher, INDEX_FILE } from "../../tools/scripts/_index.mjs";
import { highlight, markTerms } from "./rank.mjs";
import { clip } from "../../tools/scripts/_github.mjs";

/** Older than this, the copy falls back to live and a refresh is kicked off.
 *  A day: the corpus changes when someone reseeds it, not hourly. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

// The searcher is rebuilt only when the file on disk changes — construction
// tokenises every doc (~15ms), a search is pure lookup.
let cache = { mtimeMs: 0, searcher: null, index: null };

function current() {
  let mtimeMs;
  try {
    mtimeMs = statSync(INDEX_FILE).mtimeMs;
  } catch {
    return null;
  }
  if (mtimeMs !== cache.mtimeMs) {
    const index = loadIndex();
    if (!index) return null;
    cache = { mtimeMs, searcher: createSearcher(index), index };
  }
  return cache;
}

// One build at a time, and after a failure a cooldown rather than a retry
// storm — a server with no working credentials must not spend its life
// respawning a crawler that cannot succeed.
let building = false;
let lastFailureAt = 0;
const FAILURE_COOLDOWN_MS = 15 * 60 * 1000;

export function ensureIndexBuild(reason) {
  if (building || Date.now() - lastFailureAt < FAILURE_COOLDOWN_MS) return;
  building = true;
  const script = fileURLToPath(new URL("../../scripts/index-build.mjs", import.meta.url));
  console.log(`[index] background build started — ${reason}`);
  const child = spawn(process.execPath, [script], { stdio: ["ignore", "inherit", "inherit"] });
  child.on("exit", (code) => {
    building = false;
    if (code !== 0) lastFailureAt = Date.now();
    console.log(`[index] background build ${code === 0 ? "done" : `failed (exit ${code})`}`);
  });
  child.on("error", (err) => {
    building = false;
    lastFailureAt = Date.now();
    console.log(`[index] background build could not start: ${err.message}`);
  });
}

/** For the live path's response: why the index did not answer. */
export function indexNote() {
  const c = current();
  if (!c) return { exists: false, building };
  return {
    exists: true,
    builtAt: c.index.builtAt,
    ageMs: Date.now() - Date.parse(c.index.builtAt),
    stale: Date.now() - Date.parse(c.index.builtAt) > MAX_AGE_MS,
    building,
  };
}

/**
 * Answer a search from the index, or return null to say "fall back to live".
 * Null triggers the lazy build; the caller owns the live path.
 */
export function indexSearchAll(query, { limit = 20 } = {}) {
  const c = current();
  if (!c) {
    ensureIndexBuild("no index on disk");
    return null;
  }
  const ageMs = Date.now() - Date.parse(c.index.builtAt);
  if (ageMs > MAX_AGE_MS) {
    ensureIndexBuild(`index is ${(ageMs / 3_600_000).toFixed(1)}h old`);
    return null;
  }

  const startedAt = Date.now();
  // Ask for everything, count per source honestly, then cut to the limit.
  const found = c.searcher.search(query, { limit: c.index.docs.length });

  const sources = { github: 0, gmail: 0, drive: 0 };
  for (const row of found.rows) sources[row.source] += 1;

  const results = found.rows.slice(0, Math.min(Math.max(Number(limit) || 20, 1), 50))
    .map((row) => toUiRow(row, found.terms));

  return {
    query: String(query ?? "").trim(),
    repo: c.index.repo,
    terms: found.terms,
    droppedTerms: found.droppedTerms,
    corrections: found.corrections,
    unmatched: found.unmatched,
    total: found.total,
    tookMs: Date.now() - startedAt,
    apiCalls: 0,
    path: "index",
    index: { builtAt: c.index.builtAt, ageMs, docs: c.index.docs.length },
    sources: Object.fromEntries(
      Object.entries(sources).map(([name, count]) => [
        name,
        { ok: true, count, total: count },
      ]),
    ),
    results,
  };
}

/** An index doc, shaped as the row the UI already renders (see search.mjs). */
function toUiRow(row, terms) {
  const body = String(row.body ?? "").replace(/\s+/g, " ").trim();
  return {
    id: row.id,
    source: row.source,
    kind: row.type,
    number: row.meta?.number ?? null,
    title: row.title,
    titleMarked: markTerms(row.title, terms),
    state: row.meta?.state ?? "",
    author: row.author,
    updatedAt: row.date,
    comments: row.meta?.comments ?? 0,
    url: row.url,
    threadId: row.meta?.threadId ?? null,
    fileId: row.meta?.fileId ?? null,
    snippet: clip(body, 240),
    matchHighlights: highlight(body, row.matchedTerms),
    matchedTerms: row.matchedTerms,
    matchedInDiscussionOnly: false,
    discussion: null,
    score: row.score,
  };
}
