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
import { exec, asList, clip, REPO_SLUG } from "../../tools/scripts/_github.mjs";
import { buildQuery, planQuery } from "../../tools/scripts/_search-query.mjs";
import { searchDrive, searchGmail } from "./search-google.mjs";
// Ranking lives in rank.mjs so that every source is scored by the same
// function. It used to live here, which was fine while GitHub was the only
// source and wrong the moment there were three.
import { highlight, matchedIn, matcher, score, weightsOver, markTerms} from "./rank.mjs";
import { indexSearchAll, indexNote } from "./index-search.mjs";

/**
 * One result row, shaped after Onyx's SearchDoc so the UI has the same fields
 * their frontend renders: an identifier, a link, a blurb, a source, a score,
 * and the highlights of what actually matched.
 *
 * @typedef {object} SearchRow
 * @property {string}  id
 * @property {"issue"|"pr"} kind
 * @property {"github"|"gmail"|"drive"} source
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
export async function search(query, { limit = 20, userId, repo } = {}) {
  const raw = String(query ?? "").trim();
  if (!raw) throw new SearchError("empty query", 400);

  const plan = planQuery(raw);
  const { terms, droppedTerms } = plan;
  const slug = repo || REPO_SLUG;
  const resolved = buildQuery(raw, plan, { repoSlug: slug });
  const perPage = Math.min(Math.max(Number(limit) || 20, 1), 30);

  const startedAt = Date.now();
  const data = await runSearch(resolved, perPage, userId);
  const tookMs = Date.now() - startedAt;

  const items = asList(data);
  // One pass over the candidates to learn which terms actually separate them,
  // then score. A term present in every row this query returned cannot rank it.
  const weights = weightsOver(items, terms, (i) => `${i.title ?? ""} ${i.body ?? ""}`);
  const rows = items.map((item) => toRow(item, terms, weights));

  // Only re-rank when we have terms to rank by. A passthrough query scores
  // every row zero, and sorting on that would throw away GitHub's own
  // relevance ordering in favour of an arbitrary date sort.
  if (terms.length) {
    rows.sort((a, b) => b.score - a.score || b.updatedAt.localeCompare(a.updatedAt));
  }

  const commentCalls = await attachDiscussionMatches(rows, terms, { slug, userId });

  return {
    query: raw,
    resolvedQuery: resolved,
    repo: slug,
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
async function attachDiscussionMatches(rows, terms, { max = 4, slug, userId } = {}) {
  if (!terms.length) return 0;
  const targets = rows.filter((r) => r.matchedInDiscussionOnly).slice(0, max);
  if (!targets.length) return 0;

  const results = await Promise.allSettled(
    targets.map((row) =>
      exec(
        "GITHUB_LIST_ISSUE_COMMENTS",
        { owner: (slug ?? REPO_SLUG).split("/")[0], repo: (slug ?? REPO_SLUG).split("/")[1], issue_number: row.number },
        userId,
      ),
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

async function runSearch(q, perPage, userId) {
  try {
    return await exec("GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS", { q, per_page: perPage }, userId);
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
function toRow(item, terms, weights) {
  const isPr = Boolean(item.pull_request);
  const title = item.title ?? "";
  const body = String(item.body ?? "").replace(/\s+/g, " ").trim();

  const matchedInTitle = matchedIn(title, terms);
  const matchedInBody = matchedIn(body, terms);
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
    source: "github",
    kind: isPr ? "pr" : "issue",
    number: item.number,
    title,
    titleMarked: markTerms(title, terms),
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
    score: score({
      terms,
      matchedInTitle,
      matchedInBody,
      matchedInDiscussionOnly,
      comments: item.comments ?? 0,
      weights,
    }),
  };
}

/**
 * The index-first entry point /api/search actually calls.
 *
 * A fresh local index answers in milliseconds with typo correction and real
 * IDF; a missing or stale one falls back to the live federated search below,
 * while a background build runs (see index-search.mjs). The response always
 * carries `path` — "index" or "live" — and the index's age, because the two
 * will disagree between refreshes and the UI must be able to say which one
 * answered.
 *
 * The index only ever describes the demo corpus, so a caller asking for a
 * different repository is routed straight to the live path.
 */
export async function searchAll(query, opts = {}) {
  if (!opts.repo || opts.repo === REPO_SLUG) {
    const viaIndex = indexSearchAll(query, opts);
    if (viaIndex) return viaIndex;
  }
  const live = await searchAllLive(query, opts);
  live.path = "live";
  live.corrections = [];
  live.unmatched = [];
  live.index = indexNote();
  return live;
}

/**
 * Live fallback: search all three sources at once, and merge.
 *
 * The three run concurrently rather than in sequence: they are independent
 * HTTP calls to different providers, and a user watching a search box should
 * wait for the slowest, not the sum.
 *
 * **A failing source is reported, never dropped.** This is the part that
 * matters. If Drive is not connected, or Gmail rate limits, the honest result
 * is "GitHub found 12, Drive was not reached" — a silently shorter list is the
 * same failure as answering from one source and calling it the answer.
 *
 * Merging is a plain sort because every row was already re-scored locally by
 * rank.mjs. Each engine's own relevance number is discarded on the way in: they
 * are computed differently, on different corpora, and comparing them would be
 * guesswork. See rank.mjs.
 */
async function searchAllLive(query, { limit = 20, userId, repo } = {}) {
  const raw = String(query ?? "").trim();
  if (!raw) throw new SearchError("empty query", 400);

  const plan = planQuery(raw);
  const startedAt = Date.now();

  const settled = await Promise.allSettled([
    search(raw, { limit, userId, repo }),
    searchGmail(raw, { limit: Math.ceil(limit / 2), userId }),
    searchDrive(raw, { limit: Math.ceil(limit / 2), userId }),
  ]);

  const names = ["github", "gmail", "drive"];
  const sources = {};
  let rows = [];
  let apiCalls = 0;

  settled.forEach((outcome, i) => {
    const name = names[i];
    if (outcome.status === "fulfilled") {
      const value = outcome.value;
      const found = value.results ?? value.rows ?? [];
      rows = rows.concat(found);
      apiCalls += value.apiCalls ?? 1;
      sources[name] = {
        ok: true,
        count: found.length,
        total: value.total ?? found.length,
        resolvedQuery: value.resolvedQuery,
      };
    } else {
      // Keep the reason. "Not connected" and "rate limited" are different
      // facts, and the UI says which.
      sources[name] = {
        ok: false,
        count: 0,
        error: String(outcome.reason?.message ?? outcome.reason).slice(0, 200),
      };
    }
  });

  // One scale, so this is an ordering rather than a reconciliation. Ties break
  // on recency, which is the only other signal all three sources share.
  if (plan.terms.length) {
    rows.sort((a, b) => b.score - a.score || String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  return {
    query: raw,
    repo: repo || REPO_SLUG,
    terms: plan.terms,
    droppedTerms: plan.droppedTerms,
    total: rows.length,
    tookMs: Date.now() - startedAt,
    apiCalls,
    sources,
    results: rows.slice(0, limit),
  };
}

/** An error carrying the HTTP status the server should send. */
export class SearchError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = "SearchError";
    this.status = status;
  }
}
