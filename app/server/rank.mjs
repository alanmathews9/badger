// Ranking for the web search — the scoring itself lives under the agent.
//
// `score`, `matchedIn`, `rankBy` and the regex helpers moved to
// `tools/scripts/_rank.mjs` so that the agent's own search tools can use them.
// The dependency only runs one way — `app/` may reach up into `tools/`, never
// the reverse — so a function shared by both has to live on the agent's side.
// See the note in that file for what it cost to discover this.
//
// What stays here is `highlight`, which is presentation for the web UI. The
// agent has no use for <hi> markers; it reads the text.
export { escapeRe, matcher, matchedIn, score, rankBy, weightsOver, termPattern, anyTerm } from "../../tools/scripts/_rank.mjs";

import { anyTerm } from "../../tools/scripts/_rank.mjs";

/**
 * Excerpts of the body around each match, with matched words wrapped in
 * <hi>…</hi>. The convention is Onyx's: the server says what matched, and the
 * frontend splits on the marker rather than being handed HTML to inject.
 */
export function highlight(body, terms, { window = 160, max = 2 } = {}) {
  if (!body || !terms.length) return [];
  // `\b` to agree with `matcher()` in _rank.mjs, which is what decides whether
  // a row matched at all. Without it the highlighter marked any substring, so a
  // search for "app" struck through "h[app]ened" and "[App]le" — results that
  // had scored correctly looked broken, and a reader could not tell which of
  // the highlights was the reason the row was there.
  // One shared pattern with the scorer, so a highlight always marks the thing
  // that actually earned the row its place. See termPattern in _rank.mjs.
  const re = anyTerm(terms);

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
        body.slice(start, end).replace(anyTerm(terms), "<hi>$1</hi>") +
        (end < body.length ? "…" : ""),
    );
  }
  return excerpts;
}
