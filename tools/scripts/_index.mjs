// The local search index: store, status, and (as of step 2) search.
//
// This is the reversal the README's retrieval section predicted. Federation
// holds no text, and every retrieval technique worth having — typo tolerance,
// IDF, sub-second answers — needs the text. So Badger now keeps a small local
// copy of what the connected sources hold, built on demand by
// `npm run index`, stored as one JSON file under `.gitagent/index/`.
//
// Why here and not under app/: both the agent's tools and the web search must
// be able to reach it, and the agent may not import from app/ — the boundary
// `npm run check:agent` enforces. Same placement logic as _rank.mjs, and
// app/server re-exports in the one direction the boundary allows.
//
// The store is deliberately a file, not a database. Onyx indexes into
// OpenSearch because it serves organisations; this corpus is ~170 documents,
// and a JSON file a few hundred KB long is searched in milliseconds by the
// code in this module. Delete `.gitagent/index/` and the copy is gone — that
// directory is already gitignored runtime state, and nothing else references
// it.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";

export const INDEX_DIR = new URL("../../.gitagent/index/", import.meta.url);
export const INDEX_FILE = new URL("index.json", INDEX_DIR);

/**
 * One indexed document. Doc-level, not chunked: the corpus documents are
 * small, and chunking is an embeddings-era concern. `vector` is reserved so
 * embeddings can arrive later as a column rather than a rebuild.
 *
 * @typedef {object} IndexDoc
 * @property {string} id       stable across rebuilds ("issue-8", "mail-<id>")
 * @property {"github"|"gmail"|"drive"} source
 * @property {string} type     issue | pr | file | commit | mail | doc | sheet …
 * @property {string} title
 * @property {string} body     full text, discussion folded in
 * @property {string} author
 * @property {string} date     ISO, day precision
 * @property {string} url
 * @property {object} meta     per-source extras the UI row needs (number, state…)
 * @property {null}   vector   reserved for embeddings; always null today
 */

/** Read the index, or null when it has never been built (or is corrupt). */
export function loadIndex() {
  try {
    const idx = JSON.parse(readFileSync(INDEX_FILE, "utf8"));
    if (!Array.isArray(idx?.docs)) return null;
    return idx;
  } catch {
    return null;
  }
}

/** Write the index atomically enough for one local process: temp then rename
 *  is overkill for a single-writer file, but a partial write must never parse,
 *  so the JSON is serialised first and written in one call. */
export function saveIndex(index) {
  mkdirSync(INDEX_DIR, { recursive: true });
  const payload = JSON.stringify(index);
  writeFileSync(INDEX_FILE, payload);
  return payload.length;
}

export function clearIndex() {
  rmSync(INDEX_DIR, { recursive: true, force: true });
}

/**
 * What state is the index in? Used by the builder's `status` subcommand and by
 * the search path's fallback rule — the output must always say which path
 * answered and how old the copy is, because index and live will disagree
 * between refreshes and a status display that cannot be seen wrong is the
 * exact failure this project keeps finding.
 */
export function indexStatus() {
  const idx = loadIndex();
  if (!idx) return { exists: false };
  return {
    exists: true,
    builtAt: idx.builtAt,
    ageMs: Date.now() - Date.parse(idx.builtAt),
    docs: idx.docs.length,
    counts: idx.counts ?? {},
    apiCalls: idx.apiCalls,
    buildMs: idx.buildMs,
  };
}
