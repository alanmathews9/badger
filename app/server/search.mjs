// Structured GitHub search for the web UI — the first of Badger's two passes.
//
// Glean crawls its connectors into a central index and retrieves from that;
// Onyx does the same into Vespa. Both then hand the retrieved snippets to an
// LLM as a *separate* second pass. Badger keeps that split but drops the
// index: this module queries GitHub live, at ask-time. No generative model is
// involved on this path. The agent only enters on /api/ask.
//
// It reuses tools/scripts/_github.mjs rather than talking to Composio itself,
// so the read-only allowlist and the session preset that enforce it are shared
// with the agent's own tools rather than re-implemented here.
//
// ── The problem this module exists to solve ───────────────────────────────
//
// A search box shaped like Google's invites sentences. GitHub's issue search
// ANDs every word, so the more the user types the less they find. Measured on
// the demo repo: "billing" -> 1 hit, "payments" -> 3, "billing payments" -> 0.
//
// Query planning — stripping the sentence to keywords and OR-ing them — lives
// in tools/scripts/_search-query.mjs, shared with the agent's own
// github_search tool. It used to live here alone, and the agent's copy of the
// behaviour was the bug: the UI found twenty hits while Badger, asked the same
// question, reported that it had found nothing.
//
// What stays here is the half GitHub will not do: it filters, it never scores
// partial matches, so the ranking and the highlighting happen locally.
//
// One API call per search. The search endpoint is capped at 30 requests per
// minute and returns 403 rather than an empty list when you cross it, so
// per-term fan-out would have been the expensive way to get the same rows.
import { exec, asList, clip, OWNER, REPO, REPO_SLUG } from "../../tools/scripts/_github.mjs";
import { buildQuery, planQuery } from "../../tools/scripts/_search-query.mjs";

/**
 * One result row, shaped after Onyx's SearchDoc so the UI has the same fields
 * their frontend renders: an identifier, a link, a blurb, a source, a score,
 * and the highlights of what actually matched.
 *
 * @typedef {object} SearchRow
 * @property {string}  id
 * @property {"issue"|"pr"} kind
 * @property {number}  number
 * @property {string}  title
 * @property {string}  state             open | closed
 * @property {string}  author
 * @property {string}  updatedAt         ISO date, day precision
 * @property {number}  comments
 * @property {string}  url
 * @property {string}  snippet           plain body excerpt, no markup
 * @property {string[]} matchHighlights  excerpts with matches wrapped in <hi>
 * @property {string[]} matchedTerms     which query terms this row hit
 * @property {number}  score
 * @property {boolean} matchedInDiscussionOnly  see below
 */

/**
 * Search the configured repository's issues and pull requests.
 *
 * @param {string} query
 * @param {{limit?: number}} [opts]
 */
export async function search(query, { limit = 20 } = {}) {
  const raw = String(query ?? "").trim();
  if (!raw) throw new SearchError("empty query", 400);

  const plan = planQuery(raw);
  const { terms, droppedTerms } = plan;
  const resolved = buildQuery(raw, plan, { repoSlug: REPO_SLUG });
  const perPage = Math.min(Math.max(Number(limit) || 20, 1), 30);

  const startedAt = Date.now();
  const data = await runSearch(resolved, perPage);
  const tookMs = Date.now() - startedAt;

  const items = asList(data);
  const rows = items.map((item) => toRow(item, terms));

  // Only re-rank when we have terms to rank by. A passthrough query scores
  // every row zero, and sorting on that would throw away GitHub's own
  // relevance ordering in favour of an arbitrary date sort.
  if (terms.length) {
    rows.sort((a, b) => b.score - a.score || b.updatedAt.localeCompare(a.updatedAt));
  }

  const commentCalls = await attachDiscussionMatches(rows, terms);

  return {
    query: raw,
    resolvedQuery: resolved,
    repo: `${OWNER}/${REPO}`,
    terms,
    droppedTerms,
    total: data.total_count ?? items.length,
    tookMs,
    apiCalls: 1 + commentCalls,
    results: rows,
  };
}

/**
 * For rows whose only match is in the thread, go and fetch the comment.
 *
 * GitHub's search API says an issue matched but never says where, so a
 * discussion-only row otherwise shows an excerpt with nothing highlighted in
 * it — the row looks like a false positive when it is the opposite: on this
 * corpus the argument lives in the comments and the tidy summary lives in the
 * files.
 *
 * This costs one request per row, which is why it is capped hard. Only the
 * highest-ranked few are worth the spend, the search endpoint allows 30
 * requests a minute, and the count is reported in `apiCalls` rather than
 * hidden. Rows past the cap keep their honest "matched in the discussion"
 * label with no quote.
 */
async function attachDiscussionMatches(rows, terms, { max = 4 } = {}) {
  if (!terms.length) return 0;
  const targets = rows.filter((r) => r.matchedInDiscussionOnly).slice(0, max);
  if (!targets.length) return 0;

  const results = await Promise.allSettled(
    targets.map((row) =>
      exec("GITHUB_LIST_ISSUE_COMMENTS", { owner: OWNER, repo: REPO, issue_number: row.number }),
    ),
  );

  results.forEach((result, i) => {
    // A failed fetch is not a failed row. It keeps its label and loses the
    // quote, which is exactly the state it was in before this ran.
    if (result.status !== "fulfilled") return;
    const row = targets[i];

    for (const comment of asList(result.value)) {
      const body = String(comment.body ?? "").replace(/\s+/g, " ").trim();
      const hit = terms.filter((t) => matcher(t).test(body));
      if (!hit.length) continue;

      row.discussion = {
        author: comment.user?.login ?? "unknown",
        at: (comment.created_at ?? "").slice(0, 10),
        excerpt: highlight(body, hit, { max: 1 })[0] ?? clip(body, 200),
      };
      row.matchedTerms = [...new Set([...row.matchedTerms, ...hit])];
      break;
    }
  });

  return targets.length;
}

async function runSearch(q, perPage) {
  try {
    return await exec("GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS", { q, per_page: perPage });
  } catch (err) {
    const msg = err?.message ?? String(err);
    // A rate limit must never reach the UI looking like "no results" — that is
    // the difference between "we found nothing" and "we did not look".
    if (/rate limit|\b403\b/i.test(msg)) {
      throw new SearchError(
        "GitHub's search API is rate limited at 30 requests per minute. This is not an empty result — wait about 30 seconds and try again.",
        429,
      );
    }
    throw new SearchError(msg, 502);
  }
}

/** Map GitHub's search item onto the row the UI renders, and score it. */
function toRow(item, terms) {
  const isPr = Boolean(item.pull_request);
  const title = item.title ?? "";
  const body = String(item.body ?? "").replace(/\s+/g, " ").trim();

  const matchedInTitle = terms.filter((t) => matcher(t).test(title));
  const matchedInBody = terms.filter((t) => matcher(t).test(body));
  const matchedTerms = [...new Set([...matchedInTitle, ...matchedInBody])];

  // GitHub's keyword search reaches comment text, but the search API never
  // says which comment matched — it returns the issue, not the hit. So when a
  // row comes back with no term visible in its title or body, the match was in
  // the discussion underneath. Worth surfacing rather than hiding: on this
  // corpus the argument lives in the comments and the tidy summary lives in
  // the files, which is the whole reason to search the comments at all.
  const matchedInDiscussionOnly = terms.length > 0 && matchedTerms.length === 0;

  return {
    id: `${isPr ? "pr" : "issue"}-${item.number}`,
    kind: isPr ? "pr" : "issue",
    number: item.number,
    title,
    state: item.state ?? "",
    author: item.user?.login ?? "unknown",
    updatedAt: (item.updated_at ?? item.created_at ?? "").slice(0, 10),
    comments: item.comments ?? 0,
    url: item.html_url ?? "",
    snippet: clip(body, 240),
    matchHighlights: highlight(body, terms),
    matchedTerms,
    matchedInDiscussionOnly,
    // Filled in later by attachDiscussionMatches, for the top few such rows.
    discussion: null,
    score: score({ terms, matchedInTitle, matchedInBody, matchedInDiscussionOnly, comments: item.comments ?? 0 }),
  };
}

/**
 * Rank a row by how much of the query it covers, since GitHub only filters.
 * A title hit counts for more than a body hit — "Halden retro" answering
 * "halden" should beat an issue that mentions Halden in passing.
 */
function score({ terms, matchedInTitle, matchedInBody, matchedInDiscussionOnly, comments }) {
  if (!terms.length) return 0;
  const titleWeight = 3;
  const bodyWeight = 1;
  // A discussion-only match is a real match, just an unlocatable one. Score it
  // as a weak body hit rather than zero, or GitHub's own hits sort to the
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
 * Excerpts of the body around each match, with the matched words wrapped in
 * <hi>…</hi>. The convention is Onyx's: the server says what matched, and the
 * frontend splits on the marker rather than being handed HTML to inject. The
 * design's <mark> highlighting is then a fact about the search, not a guess
 * made in the browser.
 */
function highlight(body, terms, { window = 160, max = 2 } = {}) {
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
    const slice = body.slice(start, end);
    excerpts.push(
      (start > 0 ? "…" : "") +
        slice.replace(new RegExp(`(${terms.map(escapeRe).join("|")})`, "gi"), "<hi>$1</hi>") +
        (end < body.length ? "…" : ""),
    );
  }
  return excerpts;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const matcher = (term) => new RegExp(`\\b${escapeRe(term)}`, "i");

/** An error carrying the HTTP status the server should send. */
export class SearchError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = "SearchError";
    this.status = status;
  }
}
