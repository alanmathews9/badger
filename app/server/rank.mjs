// Ranking for the web search — the scoring itself lives under the agent.
//
// The scoring lives in `tools/scripts/_rank.mjs` so the agent's own tools can
// use it: `app/` may reach up into `tools/`, never the reverse.
//
// What stays here is `highlight`, which is presentation for the web UI. The
// agent has no use for <hi> markers; it reads the text.
export { escapeRe, matcher, matchedIn, score, rankBy, weightsOver, termPattern, anyTerm } from "../../tools/scripts/_rank.mjs";

import { anyTerm } from "../../tools/scripts/_rank.mjs";

/**
 * The whole string, with every term match wrapped in <hi>…</hi>.
 *
 * Titles used to be highlighted in the browser instead, by a third regex that
 * had no word boundary — so a search for "app" marked the "app" inside
 * "what actually happened", on a row that had scored correctly and whose body
 * excerpt was marked correctly beside it.
 *
 * That was the same drift twice over: the scorer, the excerpt highlighter and
 * the client all deciding separately what "matched" means. Marking here means
 * the browser renders what the server found and never forms an opinion of its
 * own — the same <hi> convention the excerpts already use.
 */
export function markTerms(text, terms) {
  const s = String(text ?? "");
  if (!s || !terms.length) return s;
  return s.replace(anyTerm(terms), "<hi>$1</hi>");
}

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
