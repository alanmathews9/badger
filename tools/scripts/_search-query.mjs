// How a question becomes a GitHub search query.
//
// Shared by the agent's github_search tool and the web UI's search pass, so
// the two cannot drift. GitHub ANDs every word, so a whole question finds
// nothing:
//
//   "Halden engagement slip"                          -> 0 hits
//   "Halden engagement slip in:title,body,comments"   -> 0 hits
//   "halden OR engagement OR slip"                    -> 20 hits
//
// The middle line matters: adding `in:` cannot help, because the failure is
// AND semantics rather than search mode.

/**
 * GitHub rejects a query with more than five logical operators, so six OR'd
 * terms is the ceiling. Verified against the API — seven terms fails with
 * "Validation Failed: More than N operators", not with fewer results.
 */
export const MAX_TERMS = 6;

/**
 * Function words only. A stopword list that eats real query terms is worse
 * than no list at all.
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
 * text is stripped of stopwords and OR'd. The qualifier still filters:
 * `halden OR engagement OR slip is:issue` narrows 20 hits to 16.
 *
 * @param {string} raw
 * @returns {{terms: string[], droppedTerms: string[], qualifiers: string[], passthrough: boolean}}
 */
export function planQuery(raw, { max = MAX_TERMS } = {}) {
  const text = String(raw ?? "").trim();

  // A quoted phrase wants those words in that order; OR-ing it is wrong.
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

  // All stopwords or qualifiers: fall back to the query as typed.
  if (!candidates.length) {
    return { terms: [], droppedTerms: [], qualifiers: [], passthrough: true };
  }

  return {
    terms: candidates.slice(0, max),
    droppedTerms: candidates.slice(max),
    qualifiers,
    passthrough: false,
  };
}

/**
 * Gmail's ceiling is far higher than GitHub's and Drive has none, but every
 * extra OR'd term widens the result set without adding precision.
 */
export const MAX_TERMS_GOOGLE = 10;

/**
 * Assemble a Gmail query.
 *
 * Gmail ANDs bare words as GitHub does, so the same plan applies. Gmail's own
 * qualifiers survive planQuery because they match QUALIFIER_TOKEN.
 *
 * The parenthesis matters: `a OR b from:x` binds as `a OR (b from:x)`, so the
 * qualifier stops applying to half the query.
 */
export function buildGmailQuery(raw, plan, { extra = [] } = {}) {
  const parts = plan.passthrough
    ? [String(raw).trim()]
    : [plan.terms.length > 1 ? `(${plan.terms.join(" OR ")})` : plan.terms[0], ...plan.qualifiers];

  for (const qualifier of extra) if (qualifier) parts.push(qualifier);
  return parts.filter(Boolean).join(" ");
}

/**
 * Assemble a Google Drive query.
 *
 * No bare keywords: only `fullText contains 'term'` clauses joined with
 * `and`/`or`. `fullText` covers name, description and content, including Sheet
 * cells.
 *
 * `trashed = false` is always appended, or Drive returns deleted files.
 */
export function buildDriveQuery(raw, plan, { extra = [] } = {}) {
  const terms = plan.passthrough
    ? String(raw).trim().replace(/"/g, "").split(/\s+/).filter(Boolean)
    : plan.terms;

  const clauses = terms.map((t) => `fullText contains '${driveEscape(t)}'`);
  const parts = [];
  if (clauses.length) parts.push(clauses.length > 1 ? `(${clauses.join(" or ")})` : clauses[0]);
  for (const clause of extra) if (clause) parts.push(clause);
  parts.push("trashed = false");
  return parts.join(" and ");
}

/** Drive string literals are single-quoted; both quote and backslash escape. */
const driveEscape = (s) => String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");

/**
 * Assemble the query GitHub actually receives.
 *
 * `repo:` is always present, and not only for scoping: a bare natural-language
 * query puts GitHub into semantic mode, which cannot see issue comments. Any
 * qualifier switches it to classic keyword search. See docs/NOTES.md §4f.
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

/**
 * The footer every search tool appends, naming the sources this one is not.
 *
 * Prompt guidance delivered as data, which works where prose in RULES.md did
 * not: without it Badger searches one source, finds a good answer and stops.
 *
 * Two lines, because it is appended to every search result.
 */
export const CROSS_SOURCE =
  "\nSources hold different registers of the same events — Drive the written-down and " +
  "client-facing version, GitHub the internal argument, Gmail what was actually said to whom. " +
  "Before concluding, search at least one other source: github_search, drive_search, gmail_search.";
