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
export { escapeRe, matcher, matchedIn, score, rankBy } from "../../tools/scripts/_rank.mjs";

import { escapeRe } from "../../tools/scripts/_rank.mjs";

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
