#!/usr/bin/env node
// github_search — find issues and pull requests by text.
//
// Always scoped to the configured repository. The `repo:` qualifier is
// appended here rather than left to the model, because a bare natural-language
// query runs GitHub's semantic mode, and semantic mode cannot see issue
// comments and degrades as the query lengthens. Any qualifier switches GitHub
// to classic keyword search, which does reach comment text. See NOTES.md §4f.
import { exec, run, clip, asList, OWNER, REPO, REPO_SLUG } from "./_github.mjs";

run(async ({ query, kind, limit, since_days, date_field }) => {
  if (!query || !String(query).trim()) return "ERROR: `query` is required.";

  const parts = [String(query).trim()];
  if (!/\brepo:/.test(parts[0])) parts.push(`repo:${REPO_SLUG}`);
  if (kind === "issue") parts.push("is:issue");
  if (kind === "pr") parts.push("is:pr");

  // Date windows are computed here, never by the model. Asked "what shipped
  // last week" it produced created:>=2024-05-17 — two years wrong — because it
  // does not reliably know today's date, and every date qualifier it writes is
  // a silent correctness bug: the search succeeds and returns the wrong period.
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  if (since_days != null && !/\b(created|merged|closed|updated):/.test(parts[0])) {
    const d = Math.min(Math.max(Number(since_days) || 7, 1), 365);
    const since = new Date(today.getTime() - d * 86400_000).toISOString().slice(0, 10);
    const field = ["created", "merged", "closed", "updated"].includes(date_field) ? date_field : "created";
    parts.push(`${field}:>=${since}`);
  }
  const q = parts.join(" ");

  const per_page = Math.min(Math.max(Number(limit) || 10, 1), 30);
  const data = await exec("GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS", { q, per_page });

  const items = asList(data);
  const total = data.total_count ?? items.length;

  if (!items.length) {
    return (
      `No matches for: ${q}\n` +
      `Searched ${REPO_SLUG}. This is a real "nothing found", not an error.\n` +
      `Try broader words, drop a qualifier, or add in:title,body,comments to force keyword search.`
    );
  }

  const lines = items.map((i) => {
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
    `query: ${q}\n` +
    `today: ${todayStr} — use this date, do not recall one\n` +
    `${items.length} shown of ${total} total match(es) in ${OWNER}/${REPO}\n\n` +
    lines.join("\n") +
    `\nTo read a full thread including comments, call github_issue with its number.`
  );
});
