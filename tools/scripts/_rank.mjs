// Local ranking, shared by every source and by both callers.
//
// GitHub, Gmail and Drive each return their own ordering and the three are not
// comparable, so every row is re-scored here by one term-coverage function and
// each engine's opinion is discarded.
//
// Lives under tools/ because the agent may not import from app/ (the boundary
// `npm run check:agent` enforces); app/server/rank.mjs re-exports this file.

export const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The regex source for one term — the single definition of "this row matched".
 *
 * Match the term, an optional common inflection, then require a word boundary:
 * `app` matches "app" and "apps" but not "Apple". A trailing "s" is stripped
 * from the term above three characters, so "weeks" still finds "week". This is
 * suffix tolerance, not a stemmer.
 *
 * Used by both the scorer and the highlighter, which must not disagree.
 */
export function termPattern(term) {
  const raw = String(term);
  const stem = raw.length > 3 && /s$/i.test(raw) ? raw.slice(0, -1) : raw;
  return `\\b${escapeRe(stem)}(?:s|es|ed|d|ing|ly)?\\b`;
}

export const matcher = (term) => new RegExp(termPattern(term), "i");

/** One regex matching any of `terms`, for highlighting. */
export const anyTerm = (terms, flags = "gi") =>
  new RegExp(`(${terms.map(termPattern).join("|")})`, flags);

/** Which of `terms` appear in this text. */
export const matchedIn = (text, terms) => terms.filter((t) => matcher(t).test(String(text ?? "")));

/**
 * How much each term should count, as a document frequency over the candidate
 * pool. Weight is `log(1 + n/df)`: a term in every row scores ~0.69, a term in
 * one row of thirty scores ~3.4, so a term that appears everywhere stops
 * deciding the order.
 *
 * Not real IDF — the pool is what one query returned, not the corpus.
 *
 * @param {T[]} rows
 * @param {string[]} terms
 * @param {(row: T) => string} textOf   all searchable text for a row
 * @returns {Map<string, number>}
 * @template T
 */
export function weightsOver(rows, terms, textOf) {
  const n = rows.length || 1;
  const weights = new Map();
  for (const term of terms) {
    const re = matcher(term);
    let df = 0;
    for (const row of rows) if (re.test(String(textOf(row) ?? ""))) df += 1;
    weights.set(term, Math.log(1 + n / Math.max(df, 1)));
  }
  return weights;
}

/**
 * Rank a row by how much of the query it covers. A title hit counts triple a
 * body hit.
 *
 * @param {object} o
 * @param {string[]} o.terms              the planned query terms
 * @param {string[]} o.matchedInTitle
 * @param {string[]} o.matchedInBody
 * @param {boolean}  [o.matchedInDiscussionOnly]  matched, but we cannot say where
 * @param {number}   [o.comments]         thread size, used only as a tiebreak
 * @param {Map<string, number>} [o.weights]  from weightsOver; equal if omitted
 */
export function score({
  terms,
  matchedInTitle,
  matchedInBody,
  matchedInDiscussionOnly = false,
  comments = 0,
  weights,
}) {
  if (!terms.length) return 0;
  const titleWeight = 3;
  const bodyWeight = 1;
  const w = (t) => weights?.get(t) ?? 1;
  const sum = (list) => list.reduce((n, t) => n + w(t), 0);

  // A discussion-only match is real but unlocatable: a weak body hit, not zero.
  const discussionWeight = matchedInDiscussionOnly ? 0.5 * (sum(terms) / terms.length) : 0;
  // Normalised so the result stays a 0-1 coverage figure with or without weights.
  const max = sum(terms) * (titleWeight + bodyWeight);
  const earned =
    sum(matchedInTitle) * titleWeight + sum(matchedInBody) * bodyWeight + discussionWeight;

  // Tiebreak only — never enough to outrank a real term hit.
  const discussion = Math.min(comments, 10) * 0.01;
  return Number(((max ? earned / max : 0) + discussion).toFixed(4));
}

/**
 * Sort rows by score, highest first, keeping the engine's order among ties —
 * a tie means we have no opinion, so the source's ordering stands.
 *
 * @param {T[]} rows
 * @param {(row: T) => number} scoreOf
 * @returns {T[]} a new array
 * @template T
 */
export function rankBy(rows, scoreOf) {
  return rows
    .map((row, i) => ({ row, i, s: scoreOf(row) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map(({ row }) => row);
}
