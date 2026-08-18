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

/**
 * The regex source for one term — the single definition of "this row matched".
 *
 * A bare `\bterm` prefix match is too generous, and the cost was visible in the
 * product: searching "why was the Android app five weeks late" made `\bapp`
 * match **Apple** and **appointments**, so "Apple Wallet passes for
 * appointments?" scored as a hit on a question with nothing to do with it, and
 * the highlighter struck through the "App" in "Apple" as though that were the
 * reason.
 *
 * A bare whole-word match is too strict the other way — it would stop
 * "reminder" finding "reminders", which is the stemming that makes plain-English
 * questions work at all.
 *
 * So: match the term, optionally followed by a common English inflection, and
 * then require a word boundary. `app` matches "app" and "apps" but not "Apple";
 * `remind` matches "reminder"? No — and that is the accepted limit. This is
 * suffix tolerance, not a stemmer, and pretending otherwise would be the kind of
 * half-measure Onyx measured making recall worse.
 *
 * A trailing "s" is stripped from the term itself so the tolerance works in both
 * directions: a user typing "weeks" still finds "week". Only above three
 * characters, so "is" and "as" are left alone.
 *
 * Exported and used by both the scorer and the highlighter. They had separate
 * regexes once and disagreed — the highlighter had no boundary at all, so it
 * marked "h[app]ened" on rows that had scored correctly.
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
 * How much each term should count, judged across the rows actually retrieved.
 *
 * There is no corpus-wide IDF and there cannot be one while we hold no index —
 * but a document frequency computed over the *candidate pool* is free, and it
 * discriminates in exactly the place ranking happens.
 *
 * The problem it solves was visible in the product. Asked "why was the Android
 * app five weeks late", the planner produces `android OR app OR late`; `\bapp`
 * then matches "Apple" and "appointments", and with every term weighted
 * equally, "Apple Wallet passes for appointments?" ranked third on a question
 * that has nothing to do with it. "app" appeared in nearly every candidate, so
 * it separated nothing, while "android" appeared in a third and separated a
 * great deal.
 *
 * Weight is `log(1 + n/df)`: a term in every row scores ~0.69, a term in one row
 * of thirty scores ~3.4. Bounded, cheap, and it needs nothing we do not already
 * have in memory. It is not real IDF — the pool is what one query returned, not
 * the corpus — and it goes away in favour of the real thing if an index ever
 * lands.
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

  // A discussion-only match is a real match, just an unlocatable one. Score it
  // as a weak body hit rather than zero, or the engine's own hits sort to the
  // bottom of our list for no reason the user can see.
  const discussionWeight = matchedInDiscussionOnly ? 0.5 * (sum(terms) / terms.length) : 0;
  // Normalised against every term mattering everywhere, so the result stays a
  // 0-1 coverage figure whether or not weights are supplied.
  const max = sum(terms) * (titleWeight + bodyWeight);
  const earned =
    sum(matchedInTitle) * titleWeight + sum(matchedInBody) * bodyWeight + discussionWeight;

  // A thread with argument in it is usually the better answer on this corpus.
  // Deliberately tiny — a tiebreak, never enough to outrank a real term hit.
  const discussion = Math.min(comments, 10) * 0.01;
  return Number(((max ? earned / max : 0) + discussion).toFixed(4));
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
