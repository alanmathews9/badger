// How a question becomes a GitHub search query.
//
// Shared by the agent's github_search tool and the web UI's search pass,
// because they had drifted and the drift was a bug: the UI stripped a question
// down to keywords and OR'd them, while the agent handed GitHub the whole
// phrase. GitHub ANDs every word, so the agent's searches quietly failed on
// exactly the questions users ask.
//
//   "Halden engagement slip"                          -> 0 hits
//   "Halden engagement slip in:title,body,comments"   -> 0 hits
//   "halden OR engagement OR slip"                    -> 20 hits
//
// The middle line matters: the tool used to advise adding `in:` when a search
// came back empty, and that advice cannot work. The failure is AND semantics,
// not search mode.
//
// Onyx does not have this problem because it never searches GitHub. Its
// connector enumerates a repository with get_issues/get_pulls and indexes the
// lot into Vespa, which scores partial matches. Until Badger has an index of
// its own, OR-ing the terms is the closest honest approximation: it turns a
// filter into something that at least ranks.

/**
 * GitHub rejects a query with more than five logical operators, so six OR'd
 * terms is the ceiling. Verified against the API — seven terms fails with
 * "Validation Failed: More than N operators", not with fewer results.
 */
export const MAX_TERMS = 6;

/**
 * Enough of English to strip the scaffolding out of a spoken question without
 * taking a dependency. Deliberately short: a stopword list that eats real
 * query terms is worse than no list at all, so this covers function words
 * only. Onyx does the same thing at the top of its search_pipeline.
 */
const STOPWORDS = new Set(
  ("a about all am an and any are as at be been being but by can did do does doing done for from" +
    " had has have having he her here hers him his how i if in into is it its me my no nor not of" +
    " off on once only or other our out over own same she should so some such than that the their" +
    " them then there these they this those through to too under until up us was we were what when" +
    " where which while who whom why will with would you your")
    .split(" "),
);

/** A `qualifier:value` token — GitHub syntax, not a search term. */
const QUALIFIER_TOKEN = /^-?[A-Za-z_][A-Za-z_-]*:\S*$/;

/**
 * Split a query into GitHub qualifiers and searchable keywords.
 *
 * Qualifiers are preserved untouched and keep their AND behaviour; the free
 * text is stripped of stopwords and OR'd. Verified against the API: in
 * `halden OR engagement OR slip is:issue`, the qualifier still filters —
 * 20 hits become 16 issues, and `is:pr` returns the other 4.
 *
 * @param {string} raw
 * @returns {{terms: string[], droppedTerms: string[], qualifiers: string[], passthrough: boolean}}
 */
export function planQuery(raw) {
  const text = String(raw ?? "").trim();

  // A quoted phrase means the user wants those words in that order. Rewriting
  // it would be rude, and OR-ing it would be wrong.
  if (text.includes('"')) {
    return { terms: [], droppedTerms: [], qualifiers: [], passthrough: true };
  }

  const qualifiers = [];
  const free = [];
  for (const token of text.split(/\s+/)) {
    if (!token) continue;
    if (QUALIFIER_TOKEN.test(token)) qualifiers.push(token);
    else free.push(token);
  }

  const seen = new Set();
  const candidates = [];
  for (const word of free.join(" ").toLowerCase().split(/[^\p{L}\p{N}_-]+/u)) {
    const term = word.replace(/^[-_]+|[-_]+$/g, "");
    if (term.length < 2 || STOPWORDS.has(term) || seen.has(term)) continue;
    seen.add(term);
    candidates.push(term);
  }

  // Everything was a stopword or a qualifier ("how do we do it?"). Searching
  // for nothing finds nothing, so fall back to the query as typed.
  if (!candidates.length) {
    return { terms: [], droppedTerms: [], qualifiers: [], passthrough: true };
  }

  return {
    terms: candidates.slice(0, MAX_TERMS),
    droppedTerms: candidates.slice(MAX_TERMS),
    qualifiers,
    passthrough: false,
  };
}

/**
 * Assemble the query GitHub actually receives.
 *
 * `repo:` is always present, and not only for scoping: a bare
 * natural-language query puts GitHub into semantic mode, and semantic mode
 * cannot see issue comments — which is where this corpus keeps its real
 * answers. Any qualifier switches GitHub to classic keyword search, which does
 * reach comment text. See NOTES.md §4f.
 *
 * @param {string} raw            the query as written
 * @param {ReturnType<planQuery>} plan
 * @param {{repoSlug: string, extra?: string[]}} opts
 */
export function buildQuery(raw, plan, { repoSlug, extra = [] }) {
  const parts = plan.passthrough
    ? [String(raw).trim()]
    : [plan.terms.join(" OR "), ...plan.qualifiers];

  for (const qualifier of extra) if (qualifier) parts.push(qualifier);
  if (!/\brepo:/.test(parts.join(" "))) parts.push(`repo:${repoSlug}`);

  return parts.filter(Boolean).join(" ");
}
