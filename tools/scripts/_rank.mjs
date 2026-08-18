// Local ranking, shared by every source and by both callers.
//
// This is the piece that makes a federated search across three systems
// coherent. GitHub keyword-ANDs and returns its own relevance order; Gmail
// returns its own order, which for an OR'd query is effectively newest-first;
// Drive returns a filtered list with no score and no snippet at all. Those
// three orderings are not comparable, and merging them by their own opinions is
// guesswork dressed as ranking.
//
// So every row from every source is re-scored here by one term-coverage
// function, and each engine's opinion is discarded. Cheap, honest, and it works
// without an index. The alternative is a real BM25 with IDF, which needs the
// text — that is phase 2, and it arrives with the index or not at all.
//
// There is no IDF, so "Brightsmile" counts the same as "app". Stated plainly
// because it is the main thing wrong with this ranking.
//
// ---------------------------------------------------------------------------
// **Why this lives under tools/ and not under app/.**
//
// It used to live in `app/server/rank.mjs`, and the comment there said "shared
// by every source" while in fact only the web search called it. All three of
// the agent's own search tools returned their engine's ordering untouched, and
// the cost was measured on 2026-08-18: asked whether Brightsmile had been told
// the app would be ready in March, `gmail_search` returned the ten most recent
// messages rather than the ten most relevant, so a February promise lost to
// July account noise and the agent answered that it could not find it. The
// thread was there the whole time.
//
// The agent must not import from `app/` — that is the boundary `npm run
// check:agent` enforces — so a ranking function that lives in `app/` is one the
// agent physically cannot use. Putting it here makes the sharing real in the
// only direction the boundary allows: `app/server/rank.mjs` now re-exports
// from this file.
// ---------------------------------------------------------------------------

export const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const matcher = (term) => new RegExp(`\\b${escapeRe(term)}`, "i");

/** Which of `terms` appear in this text. */
export const matchedIn = (text, terms) => terms.filter((t) => matcher(t).test(String(text ?? "")));

/**
 * Rank a row by how much of the query it covers.
 *
 * A title hit counts for more than a body hit — a document called "Leave Policy
 * 2026" answering "leave policy" should beat one that mentions leave in
 * passing.
 *
 * @param {object} o
 * @param {string[]} o.terms              the planned query terms
 * @param {string[]} o.matchedInTitle
 * @param {string[]} o.matchedInBody
 * @param {boolean}  [o.matchedInDiscussionOnly]  matched, but we cannot say where
 * @param {number}   [o.comments]         thread size, used only as a tiebreak
 */
export function score({
  terms,
  matchedInTitle,
  matchedInBody,
  matchedInDiscussionOnly = false,
  comments = 0,
}) {
  if (!terms.length) return 0;
  const titleWeight = 3;
  const bodyWeight = 1;
  // A discussion-only match is a real match, just an unlocatable one. Score it
  // as a weak body hit rather than zero, or the engine's own hits sort to the
  // bottom of our list for no reason the user can see.
  const discussionWeight = matchedInDiscussionOnly ? 0.5 : 0;
  const max = terms.length * (titleWeight + bodyWeight);
  const earned =
    matchedInTitle.length * titleWeight + matchedInBody.length * bodyWeight + discussionWeight;

  // A thread with argument in it is usually the better answer on this corpus.
  // Deliberately tiny — a tiebreak, never enough to outrank a real term hit.
  const discussion = Math.min(comments, 10) * 0.01;
  return Number((earned / max + discussion).toFixed(4));
}

/**
 * Sort rows by score, highest first, and keep the engine's order among ties.
 *
 * Stable by construction rather than by trusting `Array.sort` — a tie means we
 * have no opinion, and "no opinion" should leave the source's ordering alone
 * rather than shuffle it. With no terms to score against (a pass-through query)
 * every row ties, so the engine's order survives untouched, which is the
 * correct behaviour: the user asked for a literal search.
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
