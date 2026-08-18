#!/usr/bin/env node
// github_search — find issues and pull requests by text.
//
// Always scoped to the configured repository.
//
// The query is planned rather than passed through: GitHub ANDs every word, so
// a question handed over whole finds nothing. "Halden engagement slip" scored
// zero against a repository that has twenty matching threads, and adding
// `in:title,body,comments` — which this tool used to advise — did not help,
// because the failure is AND semantics rather than search mode. See
// _search-query.mjs for the measurements and for why Onyx never hits this.
import { exec, run, clip, asList, contextFrom } from "./_github.mjs";
import { buildQuery, planQuery, CROSS_SOURCE } from "./_search-query.mjs";
import { matchedIn, rankBy, score } from "./_rank.mjs";

run(async (args) => {
  const { query, kind, limit, since_days, date_field } = args;
  if (!query || !String(query).trim()) return "ERROR: `query` is required.";

  // Whose GitHub, and which repo. Injected per request by the server.
  const { userId, slug: REPO_SLUG, owner: OWNER, repo: REPO } = contextFrom(args);

  const extra = [];
  if (kind === "issue") extra.push("is:issue");
  if (kind === "pr") extra.push("is:pr");

  // Date windows are computed here, never by the model. Asked "what shipped
  // last week" it produced created:>=2024-05-17 — two years wrong — because it
  // does not reliably know today's date, and every date qualifier it writes is
  // a silent correctness bug: the search succeeds and returns the wrong period.
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  if (since_days != null && !/\b(created|merged|closed|updated):/.test(query)) {
    const d = Math.min(Math.max(Number(since_days) || 7, 1), 365);
    const since = new Date(today.getTime() - d * 86400_000).toISOString().slice(0, 10);
    const field = ["created", "merged", "closed", "updated"].includes(date_field) ? date_field : "created";
    extra.push(`${field}:>=${since}`);
  }

  const plan = planQuery(query);
  const q = buildQuery(query, plan, { repoSlug: REPO_SLUG, extra });

  const per_page = Math.min(Math.max(Number(limit) || 10, 1), 30);
  // Over-fetch, rank, then cut — see the note in gmail-search.mjs. Re-sorting
  // only the rows the engine chose to show cannot surface the one it ranked
  // eleventh, which is usually the interesting one.
  const pool = Math.min(per_page * 3, 60);
  const data = await exec("GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS", { q, per_page: pool }, userId);

  const items = asList(data);
  const total = data.total_count ?? items.length;

  // Say what was actually searched. When the query was rewritten the model
  // needs to know, or it will re-run the same words expecting a different
  // result.
  const planNote = plan.passthrough
    ? `query: ${q}`
    : `query: ${q}\n(your words were reduced to keywords and OR'd — GitHub requires every word to match, so a whole question finds nothing)`;
  const droppedNote = plan.droppedTerms.length
    ? `\nNOTE: GitHub allows at most ${plan.terms.length} search terms, so these were not included: ${plan.droppedTerms.join(", ")}. Search them separately if they matter.`
    : "";

  if (!items.length) {
    return (
      `No matches for: ${q}\n` +
      `Searched ${REPO_SLUG}. This is a real "nothing found", not an error.${droppedNote}\n` +
      `Your words were already reduced to keywords and OR'd, so re-running with different phrasing of the same idea will not help. Try genuinely different words — a name, a client, a file path — or drop the kind/date filter.`
    );
  }

  // Re-scored locally rather than trusting GitHub's relevance order, by the
  // same function the web search and the other two tools use. A term that
  // matched neither title nor body matched in the comments, which the search
  // API will not tell us — scored as a weak hit rather than as zero, so a
  // thread GitHub found for a good reason does not sink to the bottom.
  const terms = plan.passthrough ? [] : plan.terms;
  const ranked = rankBy(items, (i) => {
    const inTitle = matchedIn(i.title, terms);
    const inBody = matchedIn(i.body, terms);
    return score({
      terms,
      matchedInTitle: inTitle,
      matchedInBody: inBody,
      matchedInDiscussionOnly: terms.length > 0 && !inTitle.length && !inBody.length,
      comments: i.comments ?? 0,
    });
  }).slice(0, per_page);

  const lines = ranked.map((i) => {
    const type = i.pull_request ? "PR" : "issue";
    const when = (i.updated_at ?? i.created_at ?? "").slice(0, 10);
    const who = i.user?.login ?? "unknown";
    const body = clip(i.body ?? "", 240).replace(/\n+/g, " ");
    return (
      `#${i.number} [${type}, ${i.state}] ${i.title}\n` +
      `  by @${who}, updated ${when}, ${i.comments ?? 0} comments\n` +
      `  ${i.html_url}\n` +
      (body ? `  ${body}\n` : "")
    );
  });

  return (
    `${planNote}${droppedNote}\n` +
    `today: ${todayStr} — use this date, do not recall one\n` +
    `${ranked.length} shown of ${total} total match(es) in ${OWNER}/${REPO}, most relevant first\n\n` +
    lines.join("\n") +
    `\nTo read a full thread including comments, call github_issue with its number.\n` +
    CROSS_SOURCE
  );
});
