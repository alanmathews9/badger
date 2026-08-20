#!/usr/bin/env node
// github_issue — one issue or PR, WITH its full comment thread.
//
// Issue and comments are fetched together on purpose. The comments are usually
// where the real answer is: the file or the issue body carries the official
// version, and the thread carries what the team actually concluded. Making the
// model remember a second call would mean it often stops at the official answer.
import { exec, run, clip, asList, contextFrom } from "./_github.mjs";
import { indexDocs, indexServes } from "./_index-tool.mjs";

/**
 * The open/closed warning, shared by the index and live paths so they cannot
 * drift apart.
 *
 * State is decision-bearing, so it is said in words rather than left to the
 * model to infer from a bracketed token. An open thread reported as a settled
 * decision is the most damaging error this agent can make — someone acts on it
 * — and prose instructions alone did not reliably prevent it.
 */
function stateBanner(type, state) {
  return state === "open"
    ? `\n!! This ${type} is OPEN. No conclusion has been recorded. Positions in the\n` +
      `!! thread are proposals or arguments, not decisions. Report them as such,\n` +
      `!! attribute them to whoever made them, and say it is unresolved.\n`
    : `\n(This ${type} is ${String(state).toUpperCase()}. Check the final comments for what settled it.)\n`;
}

run(async (args) => {
  const { number, max_comments } = args;
  // Whose GitHub, and which repo — injected per request by the server.
  const { userId, owner: OWNER, repo: REPO } = contextFrom(args);

  const n = Number(number);
  if (!Number.isInteger(n) || n < 1) return "ERROR: `number` must be an issue/PR number.";

  // Index first. The indexed body already carries the comments folded in
  // (index-build.mjs), which is the whole reason to open an issue at all, so
  // this is the same content the live call returns and not a summary of it.
  // The OPEN/CLOSED banner below is rebuilt identically, because it is the one
  // part of this output that changes what the reader believes.
  if (indexServes({ user: args._badger_user, repo: args._badger_repo })) {
    const hit = indexDocs((d) => d.source === "github" && (d.type === "issue" || d.type === "pr") && d.meta?.number === n);
    if (hit) {
      const d = hit.rows[0];
      const type = d.type === "pr" ? "PR" : "issue";
      return (
        hit.note +
        `#${d.meta.number} [${type}, ${d.meta.state}] ${d.title}\n` +
        `by @${d.author} on ${d.date}\n${d.url}\n` +
        stateBanner(type, d.meta.state) +
        `\n--- body and comments (${d.meta.comments ?? 0} comments, folded in) ---\n` +
        clip(d.body ?? "(empty)", 6000)
      );
    }
  }

  const issue = await exec("GITHUB_GET_AN_ISSUE", {
    owner: OWNER,
    repo: REPO,
    issue_number: n,
  }, userId);

  const cap = Math.min(Math.max(Number(max_comments) || 20, 1), 50);
  const comments = await exec("GITHUB_LIST_ISSUE_COMMENTS", {
    owner: OWNER,
    repo: REPO,
    issue_number: n,
    per_page: cap,
  }, userId);

  const list = asList(comments);
  const type = issue.pull_request ? "PR" : "issue";

  const head =
    `#${issue.number} [${type}, ${issue.state}] ${issue.title}\n` +
    `by @${issue.user?.login ?? "unknown"} on ${(issue.created_at ?? "").slice(0, 10)}` +
    `, updated ${(issue.updated_at ?? "").slice(0, 10)}\n` +
    `${issue.html_url}\n` +
    (issue.labels?.length ? `labels: ${issue.labels.map((l) => l.name ?? l).join(", ")}\n` : "") +
    `\n--- body ---\n${clip(issue.body ?? "(empty)", 2000)}\n`;

  const verdict =
    issue.state === "open"
      ? stateBanner(type, "open")
      : `\n(This ${type} is CLOSED${issue.closed_at ? ` on ${issue.closed_at.slice(0, 10)}` : ""}.` +
        ` Check the final comments for what settled it.)\n`;

  if (!list.length) return head + verdict + `\n--- comments ---\n(none)`;

  const thread = list
    .map(
      (c) =>
        `@${c.user?.login ?? "unknown"} on ${(c.created_at ?? "").slice(0, 10)}:\n` +
        `${clip(c.body ?? "", 1200)}`,
    )
    .join("\n\n");

  return (
    head +
    verdict +
    `\n--- comments (${list.length}${list.length >= cap ? `, capped at ${cap}` : ""}) ---\n` +
    thread
  );
});
