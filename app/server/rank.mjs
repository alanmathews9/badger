// Local ranking, shared by every source.
//
// This is the piece that makes a federated search across three systems
// coherent. GitHub keyword-ANDs and returns its own relevance order; Gmail has
// its own syntax and its own opinion; Drive returns a filtered list with no
// score at all. Those three numbers are not comparable, and merging three
// ranked lists by their own scores is guesswork dressed as ranking.
//
// So every row from every source is re-scored here by one term-coverage
// function, and each engine's opinion is discarded. Cheap, honest, and it works
// without an index. The alternative is a real BM25 with IDF, which needs the
// text — that is phase 2, and it arrives with the index or not at all.
//
// There is no IDF, so "Halden" counts the same as "engagement". Stated plainly
// because it is the main thing wrong with this ranking.

export const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const matcher = (term) => new RegExp(`\\b${escapeRe(term)}`, "i");

/**
 * Rank a row by how much of the query it covers.
 *
 * A title hit counts for more than a body hit — a document called "Halden
 * retro" answering "halden" should beat one that mentions Halden in passing.
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
 * Excerpts of the body around each match, with matched words wrapped in
 * <hi>…</hi>. The convention is Onyx's: the server says what matched, and the
 * frontend splits on the marker rather than being handed HTML to inject.
 */
export function highlight(body, terms, { window = 160, max = 2 } = {}) {
  if (!body || !terms.length) return [];
  const re = new RegExp(`(${terms.map(escapeRe).join("|")})`, "gi");

  const excerpts = [];
  const used = [];
  for (const match of body.matchAll(re)) {
    if (excerpts.length >= max) break;
    const at = match.index;
    if (used.some((prev) => Math.abs(prev - at) < window)) continue;
    used.push(at);

    const start = Math.max(0, at - Math.floor(window / 3));
    const end = Math.min(body.length, at + window);
    excerpts.push(
      (start > 0 ? "…" : "") +
        body.slice(start, end).replace(new RegExp(`(${terms.map(escapeRe).join("|")})`, "gi"), "<hi>$1</hi>") +
        (end < body.length ? "…" : ""),
    );
  }
  return excerpts;
}

/** Which of `terms` appear in this text. */
export const matchedIn = (text, terms) => terms.filter((t) => matcher(t).test(String(text ?? "")));
