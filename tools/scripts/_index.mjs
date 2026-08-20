// The local search index: store, status and search.
//
// Typo tolerance, IDF and sub-second answers all need the text, which
// federation does not hold. So Badger keeps a local copy of what the connected
// sources hold, built by `npm run index` into one JSON file under
// `.gitagent/index/`.
//
// Here rather than under app/ because both the agent's tools and the web
// search must reach it, and the agent may not import from app/. A file rather
// than a database because the corpus is ~190 documents.
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

/** Serialised first and written in one call, so a partial write never parses. */
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
 * What state is the index in? Feeds the builder's `status` subcommand and the
 * search path's fallback rule. Callers must always report which path answered
 * and how old the copy is: index and live disagree between refreshes.
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
// BM25 with real IDF. Terms use the same suffix tolerance as
// _rank.termPattern, so the two paths agree on what a match is.
//
// The typo layer is vocabulary lookup, not query-engine fuzziness (Onyx
// measured fuzziness AUTO making recall worse). A query term absent from the
// vocabulary is replaced by the nearest term by trigram similarity, and the
// replacement is always REPORTED, never silent.

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
// normalised by its own length, then combined. Pooling them let a long body
// out-count a title hit and penalised a document's title match for its body
// length — the document titled "Refund Policy" ranked fourth for "refund
// policy".
const W_TITLE = 3;
const W_BODY = 1;

// Exact-phrase weights. Deliberately larger than a single term's BM25
// contribution: someone who quotes a phrase is asking for those words in that
// order, and a document that has them verbatim is a better answer than one
// that happens to contain each word separately.
const W_PHRASE_TITLE = 6;
const W_PHRASE_BODY = 3;
// Titles are nearly uniform in length, so normalising them hard punishes
// detail for no reason. Bodies vary by orders of magnitude: standard 0.75.
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

  // token -> document frequency: BM25's IDF input and the typo dictionary.
  // This map cannot exist federated, which is why typo tolerance needs an
  // index.
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
    let plan = planQuery(query, { max: 10 });

    // Quoted phrases are pulled out and matched directly; whatever sits
    // outside the quotes is planned and scored normally.
    //
    // planQuery returns passthrough with ZERO terms as soon as it sees a
    // double quote, because the live engines need the phrase untouched. The
    // index searcher inherited that, so every quoted query produced no rows
    // and fell through to live — and the model quotes constantly, because the
    // tool description tells it to. Holding the text makes an exact phrase a
    // substring test, which is cheap.
    const phrases = plan.passthrough
      ? [...String(query ?? "").matchAll(/"([^"]+)"/g)]
          .map((m) => m[1].trim().toLowerCase())
          .filter(Boolean)
      : [];
    if (phrases.length) {
      plan = planQuery(String(query ?? "").replace(/"[^"]*"/g, " "), { max: 10 });
    }

    const corrections = [];
    const unmatched = [];

    // Before scoring: a known term is used as typed, an unknown one is either
    // corrected visibly or declared unmatched. No silent third path.
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
          // Robertson's BM25F: each field's term frequency is normalised by
          // ITS OWN length before the weights combine them, then saturation
          // applies once to the sum.
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

    // Exact phrases on top of what the loose terms found, outweighing a single
    // word. Flat weights, not BM25: a phrase either occurs or it does not.
    if (phrases.length) {
      const byId = new Map(rows.map((r) => [r.id, r]));
      for (const doc of docs) {
        const title = String(doc.title ?? "").toLowerCase();
        const body = String(doc.body ?? "").toLowerCase();
        let bonus = 0;
        const hit = [];
        const hitTitle = [];
        for (const phrase of phrases) {
          const inTitle = title.includes(phrase);
          const inBody = body.includes(phrase);
          if (!inTitle && !inBody) continue;
          bonus += inTitle ? W_PHRASE_TITLE : W_PHRASE_BODY;
          hit.push(phrase);
          if (inTitle) hitTitle.push(phrase);
        }
        if (!bonus) continue;
        const existing = byId.get(doc.id);
        if (existing) {
          existing.score = Number((existing.score + bonus).toFixed(4));
          existing.matchedTerms = [...existing.matchedTerms, ...hit];
          existing.matchedInTitle = [...existing.matchedInTitle, ...hitTitle];
        } else {
          rows.push({
            ...doc,
            score: Number(bonus.toFixed(4)),
            matchedTerms: hit,
            matchedInTitle: hitTitle,
          });
        }
      }
      rows.sort((a, b) => b.score - a.score || String(b.date).localeCompare(String(a.date)));
    }

    return {
      terms: [...terms, ...phrases],
      droppedTerms: plan.droppedTerms,
      corrections,
      unmatched,
      total: rows.length,
      rows: rows.slice(0, limit),
    };
  }

  return { search, vocabSize: vocab.size };
}
