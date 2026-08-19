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
    // A refresh bumps refreshedAt and leaves builtAt alone: freshness is
    // judged on the former, the daily full-rebuild sweep on the latter.
    refreshedAt: idx.refreshedAt ?? idx.builtAt,
    ageMs: Date.now() - Date.parse(idx.refreshedAt ?? idx.builtAt),
    docs: idx.docs.length,
    counts: idx.counts ?? {},
    apiCalls: idx.apiCalls,
    buildMs: idx.buildMs,
  };
}

// ── Search over the index ─────────────────────────────────────────────────
//
// BM25 with real IDF — the thing _rank.mjs plainly states it cannot be while
// we hold no text. Terms are matched with the same suffix tolerance as
// _rank.termPattern, so "weeks" finds "week" and "app" still refuses to match
// "Apple"; the two paths must not disagree about what a match is.
//
// The typo layer is vocabulary lookup, not query-engine fuzziness — Onyx
// measured fuzziness AUTO making recall worse and rejected it, and this design
// follows the measurement. A query term absent from the corpus vocabulary is
// replaced by the nearest vocabulary term by trigram similarity (pg_trgm-style
// padded trigrams), and the replacement is REPORTED in the result, never
// silent. A term nothing clears the threshold for is reported unmatched.

import { planQuery } from "./_search-query.mjs";
import { termPattern } from "./_rank.mjs";

const tokenize = (text) => {
  const out = [];
  for (const word of String(text ?? "").toLowerCase().split(/[^\p{L}\p{N}_-]+/u)) {
    const t = word.replace(/^[-_]+|[-_]+$/g, "");
    if (t.length >= 2) out.push(t);
  }
  return out;
};

const countInto = (map, tokens) => {
  for (const t of tokens) map.set(t, (map.get(t) ?? 0) + 1);
  return map;
};

/** pg_trgm-style trigrams: two spaces padded front, one behind, so the word's
 *  prefix weighs in — "paymnets" and "payments" share their opening. */
function trigrams(word) {
  const w = `  ${word} `;
  const grams = new Set();
  for (let i = 0; i + 3 <= w.length; i++) grams.add(w.slice(i, i + 3));
  return grams;
}

function similarity(aGrams, bGrams) {
  let shared = 0;
  for (const g of aGrams) if (bGrams.has(g)) shared += 1;
  return (2 * shared) / (aGrams.size + bGrams.size);
}

/** Below this, a correction is a guess, and guesses are reported as
 *  "matched nothing", never applied. 0.5 keeps one-transposition typos
 *  ("brigthsmile") and rejects noise ("xqzvwk" peaks around 0.15). */
const CORRECTION_THRESHOLD = 0.5;
/** Too short to correct reliably — "teh" is one edit from half of English. */
const MIN_CORRECTABLE = 4;

const BM25_K1 = 1.2;

// BM25F, not plain BM25: title and body are scored as SEPARATE fields, each
// normalised by its own length, then combined.
//
// Pooling them was a real defect, found by hand on "refund policy": the Drive
// document actually titled "Refund Policy" — every query term, and nothing but
// the query terms — came FOURTH, behind three documents that merely mention
// the words. Two things did it. The 3x title weight was applied as a term
// FREQUENCY multiplier inside one pooled field, so a long body could out-count
// it; and the length penalty used title+body together, so the longest document
// of the five was penalised for its body on a hit that was in its title.
//
// Per-field normalisation fixes both at once. A two-word title is short
// against the average title, so a hit in it is strong; the body's length is
// no longer able to dilute it.
const W_TITLE = 3;
const W_BODY = 1;
// Titles are nearly uniform in length, so normalising them hard punishes
// detail for no reason — a document called "Refund Policy for Deposits" is not
// less about refunds than one called "Refund Policy". Bodies vary by orders of
// magnitude and get the standard 0.75.
const B_TITLE = 0.5;
const B_BODY = 0.75;

/**
 * Build a searcher over one loaded index. Construction tokenises every doc
 * once (~178 docs, milliseconds); each search is then pure lookup — no model,
 * no network, nothing non-deterministic.
 */
export function createSearcher(index) {
  const docs = index.docs;
  const N = docs.length || 1;

  const fields = docs.map((d) => {
    const title = countInto(new Map(), tokenize(d.title));
    const body = countInto(new Map(), tokenize(d.body));
    let lenTitle = 0;
    let lenBody = 0;
    for (const n of title.values()) lenTitle += n;
    for (const n of body.values()) lenBody += n;
    return { title, body, lenTitle, lenBody };
  });
  // One average per field, because that is what per-field normalisation means.
  const avgTitle = fields.reduce((a, f) => a + f.lenTitle, 0) / N || 1;
  const avgBody = fields.reduce((a, f) => a + f.lenBody, 0) / N || 1;

  // The corpus vocabulary: token -> document frequency. This is both BM25's
  // IDF input and the typo layer's dictionary — the whole reason typo
  // tolerance needs an index is that this map cannot exist federated.
  const vocab = new Map();
  const vocabGrams = new Map();
  for (const f of fields) {
    const seen = new Set([...f.title.keys(), ...f.body.keys()]);
    for (const t of seen) vocab.set(t, (vocab.get(t) ?? 0) + 1);
  }
  for (const t of vocab.keys()) vocabGrams.set(t, trigrams(t));

  /** Vocabulary tokens a query term reaches under the suffix rule. */
  function expansions(term) {
    const re = new RegExp(termPattern(term), "i");
    const hits = [];
    for (const t of vocab.keys()) if (re.test(t)) hits.push(t);
    return hits;
  }

  /** Nearest vocabulary term by trigram similarity, or null. Deterministic
   *  tie-break: similarity, then document frequency, then alphabet. */
  function nearest(term) {
    if (term.length < MIN_CORRECTABLE) return null;
    const grams = trigrams(term);
    let best = null;
    for (const [t, tGrams] of vocabGrams) {
      const s = similarity(grams, tGrams);
      if (s < CORRECTION_THRESHOLD) continue;
      if (
        !best ||
        s > best.s ||
        (s === best.s && (vocab.get(t) > vocab.get(best.t) || (vocab.get(t) === vocab.get(best.t) && t < best.t)))
      ) {
        best = { t, s };
      }
    }
    return best?.t ?? null;
  }

  function search(query, { limit = 20 } = {}) {
    const plan = planQuery(query, { max: 10 });
    const corrections = [];
    const unmatched = [];

    // The typo pass runs BEFORE scoring: a term the vocabulary knows is used
    // as typed; one it does not know is corrected visibly or declared
    // unmatched visibly. There is no silent third path.
    const terms = [];
    for (const term of plan.terms) {
      if (expansions(term).length) {
        terms.push(term);
        continue;
      }
      const fixed = nearest(term);
      if (fixed) {
        corrections.push({ from: term, to: fixed });
        terms.push(fixed);
      } else {
        unmatched.push(term);
      }
    }

    const rows = [];
    if (terms.length) {
      // Per term: which tokens it reaches, and in how many docs any of them
      // appear. That df feeds a standard BM25 idf.
      const reach = terms.map((term) => {
        const tokens = expansions(term);
        let df = 0;
        for (const f of fields) {
          if (tokens.some((t) => f.title.has(t) || f.body.has(t))) df += 1;
        }
        return { term, tokens, idf: Math.log(1 + (N - df + 0.5) / (df + 0.5)) };
      });

      docs.forEach((doc, i) => {
        const f = fields[i];
        let score = 0;
        const matchedTerms = [];
        const matchedInTitle = [];
        for (const { term, tokens, idf } of reach) {
          let tfTitle = 0;
          let tfBody = 0;
          for (const t of tokens) {
            tfTitle += f.title.get(t) ?? 0;
            tfBody += f.body.get(t) ?? 0;
          }
          if (!tfTitle && !tfBody) continue;
          matchedTerms.push(term);
          if (tfTitle) matchedInTitle.push(term);
          // Each field's term frequency is normalised by ITS OWN length before
          // the weights combine them; saturation then applies once to the sum.
          // This is Robertson's BM25F, and the ordering it produces is the
          // whole reason the fields are kept apart.
          const tf =
            W_TITLE * (tfTitle / (1 - B_TITLE + (B_TITLE * f.lenTitle) / avgTitle)) +
            W_BODY * (tfBody / (1 - B_BODY + (B_BODY * f.lenBody) / avgBody));
          score += (idf * (tf * (BM25_K1 + 1))) / (tf + BM25_K1);
        }
        if (score > 0) rows.push({ ...doc, score: Number(score.toFixed(4)), matchedTerms, matchedInTitle });
      });

      // Stable: ties keep index order, which is source order — "no opinion"
      // must not shuffle.
      rows.sort((a, b) => b.score - a.score || String(b.date).localeCompare(String(a.date)));
    }

    return {
      terms,
      droppedTerms: plan.droppedTerms,
      corrections,
      unmatched,
      total: rows.length,
      rows: rows.slice(0, limit),
    };
  }

  return { search, vocabSize: vocab.size };
}
